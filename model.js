"use strict";

/* ------------------------------------------------------------------
   WindFarm Investment Planner — model engine
   Pure functions only (no DOM). Mirrors the reference Formosa Blue
   workbook: valuation -> debt sizing -> returns -> sensitivity -> risk.
------------------------------------------------------------------- */

const MODEL = (() => {

  const M = 1e6; // units are USD m throughout

  function annuityFactor(r, n) {
    if (r === 0) return n;
    return (1 - Math.pow(1 + r, -n)) / r;
  }

  // Cash flows array, cfs[0] typically the up-front outflow (negative).
  function irr(cfs) {
    if (!Array.isArray(cfs) || cfs.length < 2) return NaN;
    const npv = (r) => cfs.reduce((a, c, i) => a + c / Math.pow(1 + r, i), 0);
    let lo = -0.9999, hi = 10;
    let blo = npv(lo);
    // The annuity is positive most periods; bracket where npv crosses zero.
    let bhi = npv(hi);
    if (blo * bhi > 0) {
      // Fall back to a scan to find a sign change.
      let found = false;
      for (let r = -0.9999; r <= 10; r += 0.001) {
        const f = npv(r);
        if (f === 0) return r;
        if (f > 0) { lo = r; blo = f; found = true; break; }
      }
      if (!found) return NaN;
      bhi = npv(hi);
    } else if (blo > 0) {
      [lo, hi, blo, bhi] = [hi, lo, bhi, blo]; // keep npv(lo) < 0
    }
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const f = npv(mid);
      if (Math.abs(f) < 1e-9) return mid;
      if (f < 0) { lo = mid; blo = f; } else { hi = mid; }
      if (Math.abs(hi - lo) < 1e-12) break;
    }
    return (lo + hi) / 2;
  }

  function build(inp, skipRisk) {
    const {
      capacity, cfP50, cfP90, hours, price,
      capex, opex,
      life, tenor,
      rd, re, tax, minDscr, maxGearing,
    } = inp;

    // 1. Generation & CFADS
    const genP50 = capacity * cfP50 * hours;            // MWh/yr
    const genP90 = capacity * cfP90 * hours;
    const revP50 = (genP50 * price) / M;                // $m
    const revP90 = (genP90 * price) / M;
    const cfadsP50 = revP50 - opex;
    const cfadsP90 = revP90 - opex;

    // 2. WACC
    const debtShare = maxGearing;
    const equityShare = 1 - maxGearing;
    const afterTaxRd = rd * (1 - tax);
    const wacc = equityShare * re + debtShare * afterTaxRd;

    // 3. Valuation (P50)
    const afWacc = annuityFactor(wacc, life);
    const pvCashFlows = cfadsP50 * afWacc;
    const npv = pvCashFlows - capex;
    const projectIrr = irr([-capex, ...Array(life).fill(cfadsP50)]);
    const genPv = genP50 * afWacc;                       // discounted energy, MWh
    const costPv = capex + opex * afWacc;                // $m
    const lcoe = costPv / genPv * M;                     // USD/MWh
    const breakevenPrice = costPv / genPv * M;
    const breakevenCapex = cfadsP50 * afWacc;
    const breakevenCf = (costPv * M / price) / (capacity * hours);

    // 4. Debt sizing (P90 — lender view)
    const afDebt = annuityFactor(rd, tenor);
    const maxAnnualService = cfadsP90 / minDscr;
    const dscrSupportedDebt = maxAnnualService * afDebt;
    const gearingCap = maxGearing * capex;
    const debt = Math.min(dscrSupportedDebt, gearingCap);
    const binding = debt === dscrSupportedDebt ? "DSCR" : "Gearing";
    const equity = capex - debt;
    const actualGearing = debt / capex;
    const annualService = debt / afDebt;
    const dscrP50 = cfadsP50 / annualService;
    const dscrP90 = cfadsP90 / annualService;

    // 5. 25-year cash flow (repayment = annuity, matches reference workbook)
    const years = [];
    for (let y = 0; y <= life; y++) {
      if (y === 0) {
        years.push({
          year: 0, generation: 0, revenue: 0, opex: 0, cfads: 0,
          debtService: 0, dscr: null, equityCf: -equity, cumEquity: -equity,
        });
        continue;
      }
      const ds = y <= tenor ? annualService : 0;
      const dsc = y <= tenor ? cfadsP50 / ds : null;
      const eqCf = cfadsP50 - ds;
      const prev = years[y - 1];
      years.push({
        year: y, generation: genP50, revenue: revP50, opex, cfads: cfadsP50,
        debtService: ds, dscr: dsc, equityCf: eqCf, cumEquity: prev.cumEquity + eqCf,
      });
    }
    const equityIrr = irr(years.map((y) => y.equityCf));

    // Stress tests (skipped inside stress runs to avoid runaway recursion)
    let stCapex = null, stOm = null;
    if (!skipRisk) {
      function stressRun(overrides) {
        const s = Object.assign({}, inp, overrides);
        return MODEL.run({ inputs: s, skipRisk: true });
      }
      stCapex = stressRun({ capex: capex * 1.25 });
      stOm = (() => {
        // O&M doubles from year 11 (project age), holding debt sizing on base numbers.
        let acc = -equity;
        const pos = [];
        for (let y = 1; y <= life; y++) {
          const o = y >= 11 ? opex * 2 : opex;
          const cf = revP50 - o;
          const ds = y <= tenor ? annualService : 0;
          acc += cf - ds;
          pos.push(cf - ds);
        }
        return { irr: irr([-equity, ...pos]), dscrY11: (revP50 - opex * 2) / annualService, cumEquityEnd: acc };
      })();
    }

    // Sensitivity matrix: NPV vs price x CAPEX (P50 basis)
    const prices = [90, 95, 100, 105, 110, 115, 120];
    const capexes = [2100, 2200, 2300, 2400, 2500, 2600];
    const sensitivity = prices.map((pr) =>
      capexes.map((cx) => {
        const rev = (genP50 * pr) / M;
        return (rev - opex) * afWacc - cx;
      })
    );

    return {
      generation: { p50: genP50, p90: genP90 },
      revenue: { p50: revP50, p90: revP90 },
      cfads: { p50: cfadsP50, p90: cfadsP90 },
      wacc: { value: wacc, debtShare, equityShare, afterTaxRd },
      valuation: { afWacc, pvCashFlows, npv, projectIrr, lcoe, costPv, genPv },
      breakeven: { price: breakevenPrice, capex: breakevenCapex, cf: breakevenCf, afWacc },
      debt: {
        afDebt, maxAnnualService, dscrSupportedDebt, gearingCap,
        debt, binding, equity, actualGearing, annualService, dscrP50, dscrP90,
      },
      years,
      equityIrr,
      stress: { capex: stCapex, om: stOm },
      sensitivity: { prices, capexes, grid: sensitivity },
    };
  }

  function run({ inputs, skipRisk = false } = {}) {
    const out = build(inputs, skipRisk);
    out.inputs = inputs;
    return out;
  }

  return { annuityFactor, irr, run };
})();
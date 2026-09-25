"use strict";

/* WindFarm Investment Planner — UI + live dashboard */

const $ = (id) => document.getElementById(id);

const BASELINE = {
  capacity: 600, cfP50: 0.45, cfP90: 0.40, hours: 8760, price: 100,
  capex: 2400, opex: 48, life: 25, tenor: 18,
  rd: 0.05, re: 0.12, tax: 0.20, minDscr: 1.40, maxGearing: 0.70,
};

const INPUT_IDS = {
  capacity: "inpCapacity", cfP50: "inpCfP50", cfP90: "inpCfP90", price: "inpPrice",
  capex: "inpCapex", opex: "inpOpex", life: "inpLife", tenor: "inpTenor",
  rd: "inpRd", re: "inpRe", tax: "inpTax", minDscr: "inpMinDscr", maxGearing: "inpGearing",
};

const SLIDERS = {
  capacity: { min: 100, max: 2000, step: 50 },
  cfP50: { min: 0.25, max: 0.60, step: 0.005 },
  cfP90: { min: 0.25, max: 0.60, step: 0.005 },
  price: { min: 50, max: 150, step: 1 },
  capex: { min: 800, max: 5000, step: 50 },
  opex: { min: 10, max: 200, step: 1 },
  life: { min: 15, max: 40, step: 1 },
  tenor: { min: 5, max: 30, step: 1 },
  rd: { min: 0.01, max: 0.12, step: 0.0025 },
  re: { min: 0.03, max: 0.25, step: 0.0025 },
  tax: { min: 0.05, max: 0.35, step: 0.01 },
  minDscr: { min: 1.0, max: 2.0, step: 0.05 },
  maxGearing: { min: 0.1, max: 0.9, step: 0.05 },
};

let reference = { inputs: { ...BASELINE } };
function referenceRun() { return MODEL.run({ inputs: reference.inputs }); }

const fmt = {
  num: (x, d = 0) => (typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: d }) : "—"),
  money: (x, d = 0) => (typeof x === "number" && Number.isFinite(x) ? "$" + x.toLocaleString("en-US", { maximumFractionDigits: d }) + "m" : "—"),
  pct: (x, d = 1) => (typeof x === "number" && Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "—"),
  mult: (x, d = 2) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(d) + "x" : "—"),
  energy: (x) => (typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("en-US") + " MWh" : "—"),
};

function readInputs() {
  const o = {};
  for (const [k, id] of Object.entries(INPUT_IDS)) o[k] = parseFloat($(id).value);
  o.hours = 8760;
  return o;
}

function setInputs(vals) {
  for (const [k, id] of Object.entries(INPUT_IDS)) $(id).value = vals[k];
}

function cls(v, ok) {
  return ok ? " good" : " bad";
}

/* ---------- verdict ---------- */
function renderVerdict(m) {
  const inp = m.inputs;
  const npv = m.valuation.npv, irr = m.valuation.projectIrr, wacc = m.wacc.value;
  const lcoe = m.valuation.lcoe, price = inp.price;
  const dscr = m.debt.dscrP90, minDscr = inp.minDscr, eqIrr = m.equityIrr, re = inp.re;

  const issues = [];
  if (npv < 0) issues.push(`NPV ${fmt.money(npv).replace("$", "\u2212$")} — negative after discounting at WACC ${fmt.pct(wacc)}`);
  if (irr < wacc) issues.push(`Project IRR ${fmt.pct(irr)} is below WACC ${fmt.pct(wacc)}`);
  if (lcoe > price) issues.push(`LCOE ${fmt.num(lcoe, 1)} is above the ${fmt.num(price, 0)} USD/MWh price (NPV<0 ⟺ IRR<WACC ⟺ LCOE>price)`);
  if (dscr !== null && dscr < minDscr) issues.push(`DSCR@P90 ${fmt.mult(dscr)} is below the ${fmt.mult(minDscr)} bank minimum`);
  if (eqIrr < re) issues.push(`Equity IRR ${fmt.pct(eqIrr)} is below the ${fmt.pct(re)} cost of equity`);

  const good = npv >= 0 && dscr !== null && dscr >= minDscr && eqIrr >= re;
  const card = $("verdictCard"), badge = $("verdictBadge"), title = $("verdictTitle"), reason = $("verdictReason");

  if (npv < 0) {
    card.className = "card verdict bad";
    badge.className = "verdict-badge bad";
    title.textContent = "Not investable as structured";
    badge.textContent = "REJECT";
  } else if (good) {
    card.className = "card verdict good";
    badge.className = "verdict-badge good";
    title.textContent = "Investable";
    badge.textContent = "APPROVE";
  } else {
    card.className = "card verdict warn";
    badge.className = "verdict-badge warn";
    title.textContent = "Marginal — bankable, but returns underwhelm";
    badge.textContent = "CAUTION";
  }
  reason.innerHTML = issues.length
    ? issues.map((i) => `<li>${i}</li>`).join("")
    : `<li>All three pillars clear — valuation, financing and covenants hold.</li>`;
}

/* ---------- KPIs ---------- */
function chipHtml(delta, fmtFx, better) {
  if (!Number.isFinite(delta) || delta === 0) return `<span class="chip neutral">= baseline</span>`;
  const gain = (better === "up" && delta > 0) || (better === "down" && delta < 0);
  const arrow = delta > 0 ? "▲" : "▼";
  return `<span class="chip ${gain ? "gain" : "loss"}">${arrow} ${fmtFx(delta)}</span>`;
}

function renderKpis(m, ref) {
  const inp = m.inputs;
  const npv = m.valuation.npv, irr = m.valuation.projectIrr, wacc = m.wacc.value;
  const lcoe = m.valuation.lcoe, price = inp.price;

  const npvEl = $("kpiNpv");
  npvEl.textContent = fmt.num(npv, 0) + "m";
  npvEl.className = "kpi-value nums" + cls(npv, npv >= 0);
  $("kpiNpvSub").innerHTML =
    chipHtml(npv - ref.valuation.npv, (d) => fmt.num(d, 0) + "m", "up") +
    `<span>NPV ${npv >= 0 ? "≥" : "<"} 0 · PV ${fmt.money(m.valuation.pvCashFlows, 0)} vs CAPEX ${fmt.money(inp.capex, 0)}</span>`;

  const irrEl = $("kpiIrr");
  irrEl.textContent = fmt.pct(irr);
  irrEl.className = "kpi-value nums" + cls(irr, irr >= wacc);
  $("kpiIrrSub").innerHTML =
    chipHtml(irr - ref.valuation.projectIrr, (d) => fmt.pct(d, 2), "up") +
    `<span>vs WACC ${fmt.pct(wacc)}</span>`;

  $("kpiWacc").textContent = fmt.pct(wacc);
  $("kpiWaccSub").textContent = `E ${fmt.pct(m.wacc.debtShare)} / D ${fmt.pct(1 - m.wacc.debtShare)}`;

  const lcoeEl = $("kpiLcoe");
  lcoeEl.textContent = fmt.num(lcoe, 1);
  lcoeEl.className = "kpi-value nums" + cls(lcoe, lcoe <= price);
  $("kpiLcoeSub").innerHTML =
    chipHtml(-(lcoe - ref.valuation.lcoe), (d) => fmt.num(d, 1), "up") +
    `<span>vs price ${fmt.num(price, 0)}</span>`;

  $("kpiDebt").textContent = fmt.money(m.debt.debt, 0);
  $("kpiDebtSub").innerHTML =
    chipHtml(m.debt.debt - ref.debt.debt, (d) => fmt.num(d, 0) + "m", null) +
    `<span>Equity ${fmt.money(m.debt.equity, 0)} · ${fmt.pct(m.debt.actualGearing, 1)}</span>`;

  const dEl = $("kpiDscrP90");
  const dscr = m.debt.dscrP90;
  dEl.textContent = dscr === null ? "—" : fmt.mult(dscr);
  dEl.className = "kpi-value nums" + (dscr === null ? "" : cls(dscr, dscr >= inp.minDscr));
  const dRef = ref.debt.dscrP90;
  $("kpiDscrSub").innerHTML =
    (dscr !== null && dRef !== null ? chipHtml(dscr - dRef, (d) => fmt.mult(d, 2), "up") : "") +
    `<span>min ${fmt.mult(inp.minDscr)} · ${m.debt.binding}-bound</span>`;

  const eqEl = $("kpiEquityIrr");
  const eqIrr = m.equityIrr;
  eqEl.textContent = fmt.pct(eqIrr);
  eqEl.className = "kpi-value nums" + cls(eqIrr, eqIrr >= inp.re);
  $("kpiEquityIrrSub").innerHTML =
    chipHtml(eqIrr - ref.equityIrr, (d) => fmt.pct(d, 2), "up") +
    `<span>vs ${fmt.pct(inp.re)}</span>`;
}

/* ---------- kv grid ---------- */
function kv(rows, containerId) {
  const el = $(containerId);
  el.innerHTML = rows.map(([k, v, cls]) =>
    `<div class="kv"><span class="k">${k}</span><span class="v ${cls || ""}">${v}</span></div>`
  ).join("");
}

function renderValuation(m) {
  const g = m.generation, r = m.revenue, c = m.cfads, v = m.valuation, inp = m.inputs;
  kv([
    ["CAPEX", fmt.money(inp.capex, 0)],
    ["OPEX / yr", fmt.money(inp.opex, 0)],
    ["Generation P50", fmt.energy(g.p50)],
    ["Generation P90", fmt.energy(g.p90)],
    ["Revenue P50", fmt.money(r.p50, 1)],
    ["Revenue P90", fmt.money(r.p90, 1)],
    ["CFADS P50", fmt.money(c.p50, 1)],
    ["CFADS P90", fmt.money(c.p90, 1)],
    ["PV of cash flows", fmt.money(v.pvCashFlows, 0)],
    ["NPV", fmt.money(v.npv, 0), cls(v.npv, v.npv >= 0)],
    ["Project IRR", fmt.pct(v.projectIrr), cls(v.projectIrr, v.projectIrr >= m.wacc.value)],
    ["WACC", fmt.pct(m.wacc.value)],
    ["LCOE", fmt.num(v.lcoe, 1) + " USD/MWh", cls(v.lcoe, v.lcoe <= inp.price)],
    ["PV of generation", fmt.energy(v.genPv)],
  ], "valuationGrid");
}

/* ---------- charts ---------- */
const W = 640, H = 220, PAD_L = 56, PAD_R = 12, PAD_T = 14, PAD_B = 26;
function axis(dots, maxAbs) {
  let s = "";
  const step = maxAbs / 4;
  for (let i = 0; i <= 4; i++) {
    const val = i * step;
    const y = H - PAD_B - (i / 4) * (H - PAD_T - PAD_B);
    s += `<text x="${PAD_L - 8}" y="${y + 3}" text-anchor="end" font-size="9" fill="#8a93a1">${fmt.num(val, 0)}${i === 4 ? "m" : ""}</text>`;
    s += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y}" y2="${y}" stroke="#e8ebef" stroke-width="1"/>`;
  }
  s += `<line x1="${PAD_L}" x2="${PAD_L}" y1="${PAD_T}" y2="${H - PAD_B}" stroke="#e8ebef"/>`;
  return s;
}
function polyline(points, cls, area) {
  const path = points.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
  let d = "";
  if (area) d = `<path d="${path} L ${points[points.length - 1].x.toFixed(1)},${H - PAD_B} L ${points[0].x.toFixed(1)},${H - PAD_B} Z" fill="${area}" opacity="0.12"/>`;
  return d + `<path d="${path}" class="chart-line ${cls}"/>`;
}
function scale(n, min, max) { return (n - min) / (max - min); }

function renderChartCum(m) {
  const rows = m.years;
  const min = Math.min(0, ...rows.map((y) => y.cumEquity));
  const max = Math.max(0, ...rows.map((y) => y.cumEquity));
  const range = max - min || 1;
  const pts = rows.map((y) => ({
    x: PAD_L + scale(y.year, 0, m.inputs.life) * (W - PAD_L - PAD_R),
    y: H - PAD_B - scale(y.cumEquity, min, max) * (H - PAD_T - PAD_B),
  }));
  const zeroY = H - PAD_B - scale(0, min, max) * (H - PAD_T - PAD_B);
  let s = axis(rows, Math.max(Math.abs(min), Math.abs(max)));
  s += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${zeroY}" y2="${zeroY}" stroke="#16202e" stroke-width="1"/>`;
  s += polyline(pts, "cum", "#1e5eff");
  s += `<text x="${W - PAD_R}" y="${zeroY - 4}" text-anchor="end" font-size="9" fill="#5b6675">cum-equity CF</text>`;
  const end = rows[rows.length - 1];
  s += `<circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="3" fill="#1e5eff"/>`;
  s += `<text x="${pts[pts.length - 1].x - 6}" y="${pts[pts.length - 1].y + 12}" text-anchor="end" font-size="9" fill="#1e5eff" font-weight="600">${fmt.money(end.cumEquity, 0)}</text>`;
  $("chartCum").innerHTML = s;
}

function renderChartDscr(m) {
  const rows = m.years.filter((y) => y.dscr !== null);
  const max = Math.max(2, ...rows.map((y) => y.dscr), m.inputs.minDscr);
  const pts = rows.map((y) => ({
    x: PAD_L + scale(y.year, 1, m.inputs.tenor) * (W - PAD_L - PAD_R),
    y: H - PAD_B - scale(y.dscr, 0, max) * (H - PAD_T - PAD_B),
  }));
  const yOf = (v) => H - PAD_B - scale(v, 0, max) * (H - PAD_T - PAD_B);
  let s = axis(rows, max);
  s += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${yOf(m.inputs.minDscr)}" y2="${yOf(m.inputs.minDscr)}" stroke="#b7791f" stroke-width="1.2" stroke-dasharray="5 4"/><text x="${PAD_L}" y="${yOf(m.inputs.minDscr) - 3}" font-size="8.5" fill="#b7791f">min ${fmt.mult(m.inputs.minDscr)}</text>`;
  s += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${yOf(1.20)}" y2="${yOf(1.20)}" stroke="#d3362b" stroke-width="1" stroke-dasharray="3 4"/><text x="${PAD_L}" y="${yOf(1.20) + 10}" font-size="8.5" fill="#d3362b">lock-up 1.20</text>`;
  s += polyline(pts, "dscr", "#0a8f5c");
  s += `<text x="${PAD_L + 2}" y="${PAD_T + 9}" font-size="9" fill="#5b6675">DSCR by year (within tenor)</text>`;
  $("chartDscr").innerHTML = s;
}

/* ---------- debt ---------- */
function renderDebt(m) {
  const d = m.debt;
  kv([
    ["CFADS P90 (lender basis)", fmt.money(d === 0 ? m.cfads.p90 : m.cfads.p90, 0)],
    ["Min DSCR", fmt.mult(m.inputs.minDscr)],
    ["Max annual debt service", fmt.money(d.maxAnnualService, 1)],
    ["Annuity factor @ Rd, tenor", fmt.num(d.afDebt, 2)],
    ["DSCR-supported debt", fmt.money(d.dscrSupportedDebt, 0)],
    ["Gearing cap (70% × CAPEX)", fmt.money(d.gearingCap, 0)],
    ["DEBT (min of the two)", fmt.money(d.debt, 0), "hl"],
    ["EQUITY (top-up)", fmt.money(d.equity, 0)],
    ["Actual gearing", fmt.pct(d.actualGearing, 1)],
    ["Annual debt service", fmt.money(d.annualService, 1)],
    ["DSCR @ P50", fmt.mult(d.dscrP50)],
    ["DSCR @ P90", d.dscrP90 === null ? "—" : fmt.mult(d.dscrP90)],
  ], "debtGrid");

  $("bindingAnswer").textContent = d.binding + "-bound";
  $("bindingNote").textContent =
    d.binding === "DSCR"
      ? `${fmt.money(d.dscrSupportedDebt, 0)} &lt; gearing cap ${fmt.money(d.gearingCap, 0)} — cash flow can't carry more debt. Talking up gearing won't help; lock revenue, extend tenor, or lift CFADS.`
      : `Gearing cap ${fmt.money(d.gearingCap, 0)} &lt; ${fmt.money(d.dscrSupportedDebt, 0)} — lenders cap leverage even though cash flow could service more.`;

  const maxBar = Math.max(d.dscrSupportedDebt, d.gearingCap, 1);
  const pD = (d.dscrSupportedDebt / maxBar) * 100;
  const pG = (d.gearingCap / maxBar) * 100;
  const b1 = $("barDscr"), b2 = $("barGear");
  b1.style.width = pD + "%";
  b2.style.width = pG + "%";
  b1.className = "bar-fill" + (d.binding === "DSCR" ? " binding" : "");
  b2.className = "bar-fill" + (d.binding === "Gearing" ? " binding" : "");
  $("valDscr").textContent = fmt.money(d.dscrSupportedDebt, 0);
  $("valGear").textContent = fmt.money(d.gearingCap, 0);
}

/* ---------- 25-year table ---------- */
function renderTable(m) {
  const tb = $("cashTable").querySelector("tbody");
  tb.innerHTML = m.years.map((y) => {
    const cumCls = y.cumEquity < 0 ? "neg" : "pos";
    const dsc = y.dscr === null ? `<td class="na">n/a</td>` : `<td>${fmt.mult(y.dscr)}</td>`;
    return `<tr class="body-row">
      <td>${y.year}</td><td>${y.generation ? fmt.num(y.generation) : "—"}</td>
      <td>${y.revenue ? fmt.money(y.revenue, 0) : "—"}</td>
      <td>${y.opex ? fmt.money(y.opex, 0) : "—"}</td>
      <td>${y.cfads ? fmt.money(y.cfads, 0) : "—"}</td>
      <td>${y.debtService ? fmt.money(y.debtService, 0) : "<span class='na'>—</span>"}</td>
      ${dsc}
      <td class="${y.equityCf < 0 ? "neg" : "pos"}">${y.equityCf ? fmt.money(y.equityCf, 0) : fmt.money(y.equityCf, 1)}</td>
      <td class="${cumCls}">${fmt.money(y.cumEquity, 0)}</td>
    </tr>`;
  }).join("");
}

function exportCsv(m) {
  const head = ["Year", "Generation (MWh)", "Revenue ($m)", "OPEX ($m)", "CFADS ($m)", "Debt service ($m)", "DSCR", "Equity CF ($m)", "Cum. equity CF ($m)"];
  const lines = m.years.map((y) => [
    y.year, y.generation || "", y.revenue || "", y.opex || "", y.cfads || "",
    y.debtService || "", y.dscr === null ? "n/a" : y.dscr.toFixed(2),
    y.equityCf.toFixed(2), y.cumEquity.toFixed(2),
  ].join(","));
  const blob = new Blob([head.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "windfarm-cashflow.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- sensitivity ---------- */
const RED = [211, 54, 43], GREY = [238, 239, 242], GREEN = [10, 143, 92];
function lerp(a, b, t) { return a + (b - a) * t; }
function cellColor(v, min, max) {
  if (v >= 0) return `rgb(${GREEN.map((c, i) => Math.round(lerp(GREY[i], c, Math.min(1, v / max)))).join(",")})`;
  return `rgb(${RED.map((c, i) => Math.round(lerp(GREY[i], c, Math.min(1, -v / -min)))).join(",")})`;
}

function renderSensitivity(m) {
  const { prices, capexes, grid } = m.sensitivity;
  const all = grid.flat();
  const min = Math.min(...all, 0), max = Math.max(...all, 0);
  const cells = [];
  for (let i = 0; i < prices.length; i++) {
    for (let j = 0; j < capexes.length; j++) {
      const v = grid[i][j], base = prices[i] === m.inputs.price && capexes[j] === m.inputs.capex;
      cells.push(
        `<div class="sens-cell${base ? " eq" : ""}" style="background:${cellColor(v, min, max)}" title="Price ${prices[i]} · CAPEX ${capexes[j]} → NPV ${fmt.money(v, 0)}">` +
        `${fmt.num(v, 0)}<span class="pv">${fmt.money(v, 0)}</span></div>`
      );
    }
  }
  const colLabs = `<div class="corner"></div>` +
    capexes.map((c) => `<div class="collab">${c}</div>`).join("");
  const rows = prices.map((p, i) =>
    `<div class="rowlab"><span>${p}</span></div>` + cells.slice(i * capexes.length, (i + 1) * capexes.length).join("")
  ).join("");
  $("sensGrid").innerHTML = colLabs + rows;
  $("sensAxis").textContent = "Price (USD/MWh) ↓";
}

function renderBreakeven(m) {
  const b = m.breakeven, inp = m.inputs;
  kv([
    ["Required price (alone)", fmt.num(b.price, 1) + " USD/MWh", cls(b.price, b.price <= inp.price)],
    ["Required CAPEX cut", fmt.money(b.capex, 0) + " vs " + fmt.money(inp.capex, 0), cls(b.capex, b.capex >= inp.capex)],
    ["Required capacity factor", fmt.pct(b.cf, 1) + " vs P50 " + fmt.pct(inp.cfP50, 2), cls(b.cf, b.cf <= inp.cfP50)],
  ], "breakevenGrid");
}

/* ---------- compare & reference ---------- */
function renderCompare(m, ref) {
  const isBaseline = JSON.stringify(reference.inputs) === JSON.stringify(BASELINE);
  $("compareNote").textContent = isBaseline
    ? "Reference = Formosa Blue baseline · move the sliders and watch the deltas repaint live."
    : "Reference = your pinned scenario · click Reset to return to Formosa Blue.";

  const money = (v) => fmt.money(v, 0);
  const dMoney = (v) => (v > 0 ? "+" : "") + fmt.num(v, 0) + "m";
  const dPct = (v) => (v > 0 ? "+" : "") + (v * 100).toFixed(2) + "pp";
  const dNum = (v) => (v > 0 ? "+" : "") + fmt.num(v, 1);

  const defs = [
    { label: "CAPEX", cur: m.inputs.capex, ref: ref.inputs.capex, show: money, delta: dMoney, better: "down" },
    { label: "Electricity price", cur: m.inputs.price, ref: ref.inputs.price, show: (v) => v + " USD/MWh", delta: dNum, better: "up" },
    { label: "Capacity factor P50", cur: m.inputs.cfP50, ref: ref.inputs.cfP50, show: (v) => fmt.pct(v, 2), delta: dPct, better: "up" },
    { label: "WACC", cur: m.wacc.value, ref: ref.wacc.value, show: (v) => fmt.pct(v, 1), delta: dPct, better: "down" },
    { label: "NPV", cur: m.valuation.npv, ref: ref.valuation.npv, show: money, delta: dMoney, better: "up" },
    { label: "Project IRR", cur: m.valuation.projectIrr, ref: ref.valuation.projectIrr, show: (v) => fmt.pct(v, 2), delta: dPct, better: "up" },
    { label: "LCOE", cur: m.valuation.lcoe, ref: ref.valuation.lcoe, show: (v) => fmt.num(v, 1) + " USD/MWh", delta: dNum, better: "down" },
    { label: "Debt", cur: m.debt.debt, ref: ref.debt.debt, show: money, delta: dMoney, better: null },
    { label: "Equity", cur: m.debt.equity, ref: ref.debt.equity, show: money, delta: dMoney, better: null },
    { label: "DSCR @ P90", cur: m.debt.dscrP90, ref: ref.debt.dscrP90, show: (v) => (v === null ? "—" : fmt.mult(v)), delta: (v) => (v > 0 ? "+" : "") + fmt.mult(v, 2), better: "up" },
    { label: "Equity IRR", cur: m.equityIrr, ref: ref.equityIrr, show: (v) => fmt.pct(v, 2), delta: dPct, better: "up" },
  ];

  $("cmpTable").querySelector("tbody").innerHTML = defs.map((d) => {
    const delta = (d.cur === null || d.ref === null) ? NaN : d.cur - d.ref;
    let cls = "neutral", label = "0";
    if (Number.isFinite(delta) && delta !== 0) {
      const gain = (d.better === "up" && delta > 0) || (d.better === "down" && delta < 0);
      cls = gain ? "gain" : "loss";
      label = d.delta(delta);
    } else if (!Number.isFinite(delta)) {
      label = "—";
    }
    return `<tr>
      <td class="metric">${d.label}</td>
      <td>${d.show(d.ref)}</td>
      <td>${d.show(d.cur)}</td>
      <td class="delta ${cls}">${label}</td>
    </tr>`;
  }).join("");
}

/* ---------- risk ---------- */
function renderRisk(m) {
  const inp = m.inputs, d = m.debt;
  const dscrP90 = d.dscrP90;
  const cov = $("covenantList");
  const covenantRows = [
    {
      name: "Bank minimum DSCR",
      floor: inp.minDscr,
      state: dscrP90 === null ? "warn" : (dscrP90 >= inp.minDscr ? "good" : "bad"),
      label: dscrP90 === null ? "no debt" : `${fmt.mult(dscrP90)} vs ${fmt.mult(inp.minDscr)}`,
    },
    {
      name: "Lock-up threshold (freeze dividends)",
      floor: 1.20,
      state: dscrP90 === null ? "warn" : (dscrP90 >= 1.20 ? "good" : (dscrP90 < 1.05 ? "bad" : "warn")),
      label: dscrP90 === null ? "no debt" : (dscrP90 >= 1.20 ? "OK · +" + (dscrP90 - 1.20).toFixed(2) + "x" : (dscrP90 < 1.05 ? "BREACH" : "AT RISK")),
    },
    {
      name: "Default threshold (accelerate clause)",
      floor: 1.05,
      state: dscrP90 === null ? "warn" : (dscrP90 >= 1.05 ? "good" : "bad"),
      label: dscrP90 === null ? "no debt" : (dscrP90 >= 1.05 ? "OK" : "BREACH — step-in risk"),
    },
  ];
  cov.innerHTML = covenantRows.map((r) =>
    `<div class="cov-item"><span>${r.name}</span><span class="badge ${r.state}">${r.label}</span></div>`
  ).join("");

  // Asymmetry
  const income = $("tglIncome").checked;
  const costLocked = ["tglIndex", "tglVessel", "tglOm"].every((id) => $(id).checked);
  const someProtection = ["tglIndex", "tglVessel", "tglOm"].some((id) => $(id).checked);
  const v = $("asymVerdict");
  if (income && costLocked) { v.textContent = "Sides matched — income fixed and costs indexed/locked."; v.className = "asym-verdict ok"; }
  else if (income && someProtection) { v.textContent = "Income locked but only partial cost protection — residual asymmetry. Consider full indexing."; v.className = "asym-verdict warn"; }
  else if (income) { v.textContent = "Income locked, cost open — asymmetric exposure: returns capped, losses open. The Formosa/森崴 failure pattern." ; v.className = "asym-verdict bad"; }
  else { v.textContent = "Income not locked — revenue floats to market while costs may be fixed. Reverse asymmetry — check PPA / CfD strategy."; v.className = "asym-verdict warn"; }

  // Stress
  const sc = m.stress.capex;
  const topUp = sc.debt.equity - d.equity;
  $("stCapex").innerHTML = `<span class="big">Equity IRR ${fmt.pct(sc.equityIrr)}</span>Shareholders fund an extra ${fmt.money(topUp, 0)} (banks won't re-lever)`;
  const so = m.stress.om;
  const omTrip = so.dscrY11 < 1.20;
  $("stOm").innerHTML = `<span class="big">Equity IRR ${fmt.pct(so.irr)}</span>Year-11 DSCR ${fmt.mult(so.dscrY11)} — ${omTrip ? "below lock-up: dividend freeze risk" : "holds above lock-up"}`;

  // Burial — sweepable depth with linear interpolation between the two study
  // anchors: 1 m (2.0% / $0.30m pa) and 3 m (0.5% / $0.075m pa, +$15m CAPEX).
  const depth = parseFloat($("selBurial").value) || 3;
  $("burialDepthVal").textContent = depth.toFixed(1) + " m";
  const t = Math.max(0, Math.min(1, (depth - 1) / 2));
  const fail = 0.02 + (0.005 - 0.02) * t;
  const yloss = 0.300 + (0.075 - 0.300) * t;   // $m / yr expected loss
  const capexDelta = 15 * t;                    // $m added vs 1 m baseline
  const pvLoss = yloss * m.valuation.afWacc;
  const pvSave = (0.300 - yloss) * m.valuation.afWacc; // PV savings vs 1 m
  kv([
    ["Burial depth (DoL)", depth.toFixed(1) + " m"],
    ["Annual fault probability", fmt.pct(fail, 2)],
    ["Annual expected loss", fmt.money(yloss, 3)],
    ["PV of loss over life", fmt.money(pvLoss, 1)],
    ["Added CAPEX vs 1 m", capexDelta >= 0.25 ? "+" + fmt.money(capexDelta, 0) : "baseline"],
    ["PV savings vs 1 m", fmt.money(pvSave, 1)],
  ], "burialGrid");
  const burialNote = $("burialGrid");
  burialNote.insertAdjacentHTML("beforeend",
    `<div class="kv"><span class="k">${t >= 0.5 ? "Trade-off" : "Surface NPV says"}</span><span class="v warn">` +
    (t >= 0.5
      ? "NPV alone says shallow; bankability flips it — insurability + covenant breach"
      : "3 m adds +$15m but cuts fault risk 4× — insurance & DSCR lock-up argue otherwise") +
    `</span></div>`);
}

/* ---------- master render ---------- */
let lastInputs = null;
function render() {
  const inputs = readInputs();
  const m = MODEL.run({ inputs });
  const ref = referenceRun();
  lastInputs = inputs;
  renderVerdict(m);
  renderKpis(m, ref);
  renderValuation(m);
  renderDebt(m);
  renderChartCum(m);
  renderChartDscr(m);
  renderTable(m);
  renderSensitivity(m);
  renderBreakeven(m);
  renderCompare(m, ref);
  renderRisk(m);
}

function injectSliders() {
  for (const [k, id] of Object.entries(INPUT_IDS)) {
    const cfg = SLIDERS[k];
    if (!cfg) continue;
    const num = $(id);
    if (!num || num.nextElementSibling && num.nextElementSibling.classList.contains("slider")) continue;
    const range = document.createElement("input");
    range.type = "range";
    range.className = "slider";
    range.min = cfg.min;
    range.max = cfg.max;
    range.step = cfg.step;
    range.value = num.value;
    range.setAttribute("aria-label", id);
    range.addEventListener("input", () => {
      num.value = range.value;
      render();
    });
    num.insertAdjacentElement("afterend", range);
  }
}

function bind() {
  for (const id of Object.values(INPUT_IDS)) {
    const num = $(id);
    if (!num) continue;
    num.addEventListener("input", () => {
      const sib = num.nextElementSibling;
      if (sib && sib.classList && sib.classList.contains("slider")) sib.value = num.value;
    });
    num.addEventListener("input", render);
  }
  const toggles = ["tglIncome", "tglIndex", "tglVessel", "tglOm", "selBurial"];
  toggles.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", render);
    el.addEventListener("change", render);
  });
  $("btnReset").addEventListener("click", () => { setInputs(BASELINE); render(); });
  $("btnPreset").addEventListener("click", () => { setInputs(BASELINE); render(); });
  $("btnPin").addEventListener("click", () => { reference.inputs = { ...readInputs() }; render(); });
  $("btnRefReset").addEventListener("click", () => { reference.inputs = { ...BASELINE }; render(); });
  $("btnCsv").addEventListener("click", () => {
    if (lastInputs) exportCsv(MODEL.run({ inputs: lastInputs }));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setInputs(BASELINE);
  injectSliders();
  bind();
  render();
});
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

function loadReference() {
  try {
    const r = JSON.parse(localStorage.getItem("wfpr_reference_v1"));
    if (r && r.inputs && r.inputs.capex) return { inputs: r.inputs, savedAt: r.savedAt || null };
  } catch (e) { /* fall through */ }
  return { inputs: { ...BASELINE }, savedAt: null };
}
function saveReference() {
  try { localStorage.setItem("wfpr_reference_v1", JSON.stringify({ inputs: reference.inputs, savedAt: reference.savedAt })); }
  catch (e) { /* private mode — keep in memory */ }
}
let reference = loadReference();
function referenceRun() { return MODEL.run({ inputs: reference.inputs }); }

/* Preferred/fixed inputs — the advisor will not suggest moving these. */
const LOCKED = new Set(["life", "rd"]);   // timeline + cost of debt are the user's hard constraints

const LEVERS = {
  capacity: { name: "Installed capacity", dir: 1, fmt: (v) => v + " MW", tip: "phase size / added turbines — pure scale; lifts revenue and CFADS." },
  cfP50: { name: "Capacity factor P50", dir: 1, fmt: (v) => fmt.pct(v, 2), tip: "mean yield — layout & turbine choice; drives NPV and returns." },
  cfP90: { name: "Capacity factor P90", dir: 1, fmt: (v) => fmt.pct(v, 2), tip: "bankable (P90) yield — lifts debt size and DSCR headroom." },
  price: { name: "Electricity price", dir: 1, fmt: (v) => v + " USD/MWh", tip: "PPA / CfD strike; merchant upside is only bankable once signed." },
  capex: { name: "CAPEX", dir: -1, fmt: (v) => fmt.money(v, 0), tip: "renegotiate EPC & balance of plant; de-scope where still bankable." },
  opex: { name: "OPEX", dir: -1, fmt: (v) => fmt.money(v, 1) + " /yr", tip: "O&M / MSA renegotiation, indexation caps, spares pooling." },
  life: { name: "Project life", dir: 1, fmt: (v) => v + " yr", tip: "life extension / design life." },
  tenor: { name: "Debt tenor", dir: 1, fmt: (v) => v + " yr", tip: "longer repayment cheapens annual service and eases DSCR (bank appetite)." },
  rd: { name: "Cost of debt (Rd)", dir: -1, fmt: (v) => fmt.pct(v, 2), tip: "debt margin + FX / swap cost." },
  re: { name: "Cost of equity (Re)", dir: -1, fmt: (v) => fmt.pct(v, 2), tip: "investor return target — the frame's own threshold; loosening it widens APPROVE." },
  tax: { name: "Tax rate", dir: -1, fmt: (v) => fmt.pct(v, 2), tip: "effective tax / incentive regime." },
  minDscr: { name: "Minimum DSCR", dir: -1, fmt: (v) => fmt.mult(v, 2), tip: "lender's minimum — the hardest covenant to renegotiate." },
  maxGearing: { name: "Max gearing", dir: 1, fmt: (v) => fmt.pct(v, 1), tip: "leverage ceiling — bites only when gearing-bound." },
};
const LEVER_NAMES = Object.fromEntries(Object.entries(LEVERS).map(([k, v]) => [k, v.name]));
const ADVISOR_FREE = { re: 1, minDscr: 1, maxGearing: 1 }; // may sweep the full slider range

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
    `<div class="kv${cls && cls.includes("key") ? " hlrow" : ""}"><span class="k">${k}</span><span class="v ${cls || ""}">${v}</span></div>`
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
    ["NPV", fmt.money(v.npv, 0), cls(v.npv, v.npv >= 0) + " key"],
    ["Project IRR", fmt.pct(v.projectIrr), cls(v.projectIrr, v.projectIrr >= m.wacc.value) + " key"],
    ["WACC", fmt.pct(m.wacc.value)],
    ["LCOE", fmt.num(v.lcoe, 1) + " USD/MWh", cls(v.lcoe, v.lcoe <= inp.price) + " key"],
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
    ["DEBT (min of the two)", fmt.money(d.debt, 0), "hl key"],
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
  tb.innerHTML = m.years.map((y, i) => {
    const prev = m.years[i - 1];
    const flash = (y.year === m.inputs.tenor) || (prev && prev.cumEquity < 0 && y.cumEquity >= 0);
    const cumCls = y.cumEquity < 0 ? "neg" : "pos";
    const dsc = y.dscr === null ? `<td class="na">n/a</td>` : `<td>${fmt.mult(y.dscr)}</td>`;
    return `<tr class="body-row${flash ? " flash" : ""}">
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
    ? "Deltas below are vs the baseline study case · save your own model as baseline and compare every change against it live."
    : "Deltas are vs your saved baseline (green = better). “Apply baseline” in the header loads it back into the sliders.";

  const bl = reference.inputs;
  $("baselineId").textContent = isBaseline
    ? "Baseline = default study case · 600 MW · 100 USD/MWh · 45% CF · capex 2,400m"
    : `Baseline = your saved model · ${bl.capex.toLocaleString()} $m capex · ${bl.price} USD/MWh · ${(bl.cfP50 * 100).toFixed(0)}% CF`
      + (reference.savedAt ? ` · saved ${new Date(reference.savedAt).toLocaleString()}` : "");

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

/* ---------- what to change right now ---------- */
function mustChange(m) {
  const g = gates(m);
  const failing = g.map((x, i) => ({ ...x, idx: i })).filter((x) => !x.pass);
  if (!failing.length) return { items: [], unresolvable: [] };

  const per = [];
  for (const fg of failing) {
    let best = null;
    for (const [lever, meta] of Object.entries(LEVERS)) {
      if (LOCKED.has(lever)) continue;
      const v0 = m.inputs[lever], cfg = SLIDERS[lever];
      if (typeof v0 !== "number" || !cfg) continue;
      const dir = meta.dir, free = ADVISOR_FREE[lever];
      const vHi = dir > 0 ? (free ? cfg.max : Math.max(v0, Math.min(cfg.max, v0 * 1.30))) : v0;
      const vLo = dir < 0 ? (free ? cfg.min : Math.min(v0, Math.max(cfg.min, v0 * 0.70))) : v0;
      if (vHi <= vLo) continue;
      for (let s = 1; s <= 60; s++) {
        const t = s / 60;
        const v = dir > 0 ? v0 + (vHi - v0) * t : v0 - (v0 - vLo) * t;
        const mm = MODEL.run({ inputs: { ...m.inputs, [lever]: v }, skipRisk: true });
        if (gates(mm)[fg.idx].pass) {
          const pct = (Math.abs(v - v0) / v0) * 100;
          if (!best || pct < best.pct) best = { lever, v0, newV: v, pct };
          break;
        }
      }
    }
    if (best) per.push({ gate: fg, ...best });
  }
  per.sort((a, b) => a.pct - b.pct);
  const unresolvable = failing.filter((f) => !per.some((p) => p.gate.idx === f.idx)).map((f) => f.short);
  return { items: per, unresolvable };
}

function renderTopStats(m) {
  const el = $("topStats");
  if (!el) return;
  const inp = m.inputs, d = m.debt;
  const npv = m.valuation.npv;
  el.innerHTML = [
    { k: "Live model", v: "valuation · financing · risk", cap: true },
    { k: "Capacity", v: inp.capacity.toLocaleString() + " MW" },
    { k: "CF P50", v: fmt.pct(inp.cfP50, 1) },
    { k: "Price", v: inp.price + " $/MWh" },
    { k: "WACC", v: fmt.pct(m.wacc.value, 1) },
    { k: "NPV", v: (npv > 0 ? "+" : "") + fmt.num(npv, 0) + "m", cls: npv >= 0 ? "pos" : "neg" },
    { k: "DSCR @ P90", v: d.dscrP90 === null ? "—" : fmt.mult(d.dscrP90, 2) },
    { k: "Equity IRR", v: fmt.pct(m.equityIrr, 1) },
  ].map((s) => s.cap
    ? `<span class="ts-caption">${s.v}</span>`
    : `<span class="ts-item${s.cls ? " " + s.cls : ""}"><i>${s.k}</i><b>${s.v}</b></span>`).join("");
}

function renderHighlights(m) {
  const res = mustChange(m);
  const el = $("keypoints"), note = $("keypointsNote");

  if (!res.items.length && !res.unresolvable.length) {
    el.innerHTML = `<div class="mc-ok">Every gate already passes — no variable has to move.</div>`;
    note.textContent = "";
    return;
  }

  el.innerHTML = res.items.slice(0, 6).map((s) => `
    <div class="mc-item">
      <span class="mc-gate-tag">fixes ${s.gate.short}</span>
      <span class="mc-move"><b>${LEVER_NAMES[s.lever]}</b> ${LEVERS[s.lever].fmt(s.v0)} <i class="mc-arrow">→</i> ${LEVERS[s.lever].fmt(s.newV)}</span>
      <span class="mc-pct">${LEVERS[s.lever].dir > 0 ? "↗" : "↘"} ${s.pct.toFixed(1)}%</span>
    </div>`).join("");

  const rows = [...new Set(res.items.map((s) => s.lever))].map((k) => LEVER_NAMES[k]).join(", ");
  note.textContent = res.unresolvable.length
    ? `${res.unresolvable.join(", ")} has no single-lever fix in a believable range — see the Advisor package. Cheapest moves: ${rows || "—"}.`
    : `Cheapest move per failing gate · ${rows} (value right of the → is the target) · locked 🔒 inputs never appear · full ranking in the Advisor.`;
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
  else if (income) { v.textContent = "Income locked, cost open — asymmetric exposure: returns capped, losses open. The classic fixed-revenue/open-cost failure pattern." ; v.className = "asym-verdict bad"; }
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

/* ---------- advisor: reach the investable frame ---------- */
function gates(m) {
  const inp = m.inputs, v = m.valuation, d = m.debt;
  return [
    { name: "NPV ≥ 0", short: "NPV", pass: v.npv >= 0, val: fmt.money(v.npv, 0) },
    { name: "LCOE ≤ price", short: "LCOE", pass: v.lcoe <= inp.price, val: `${fmt.num(v.lcoe, 1)} vs ${fmt.num(inp.price, 0)} USD/MWh` },
    { name: "Proj IRR ≥ WACC", short: "IRR", pass: v.projectIrr >= m.wacc.value - 1e-9, val: `${fmt.pct(v.projectIrr)} vs ${fmt.pct(m.wacc.value)}` },
    { name: "Equity IRR ≥ Re", short: "Eq IRR", pass: m.equityIrr >= inp.re - 1e-9, val: `${fmt.pct(m.equityIrr)} vs ${fmt.pct(inp.re)}` },
    { name: "DSCR@P90 ≥ minDSCR", short: "DSCR", pass: d.dscrP90 !== null && d.dscrP90 >= inp.minDscr, val: d.dscrP90 === null ? "no debt" : `${fmt.mult(d.dscrP90)} vs ${fmt.mult(inp.minDscr)}` },
  ];
}

function scanLevers(m) {
  const full = [], partial = [];
  for (const [lever, meta] of Object.entries(LEVERS)) {
    if (LOCKED.has(lever)) continue;
    const v0 = m.inputs[lever], cfg = SLIDERS[lever];
    if (typeof v0 !== "number" || !cfg) continue;
    const dir = meta.dir;
    const free = ADVISOR_FREE[lever];
    const vHi = dir > 0 ? (free ? cfg.max : Math.max(v0, Math.min(cfg.max, v0 * 1.30))) : v0;
    const vLo = dir < 0 ? (free ? cfg.min : Math.min(v0, Math.max(cfg.min, v0 * 0.70))) : v0;
    if (vHi <= vLo) continue;
    const steps = 50, gateIdx = [];
    let bestTie = 0, bestV = v0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const v = dir > 0 ? v0 + (vHi - v0) * t : v0 - (v0 - vLo) * t;
      const g = gates(MODEL.run({ inputs: { ...m.inputs, [lever]: v }, skipRisk: true }));
      for (let i = 0; i < g.length; i++) if (g[i].pass && gateIdx[i] === undefined) gateIdx[i] = t;
      if (gateIdx.filter((x) => x !== undefined).length === g.length) {
        const bIdx = gateIdx.indexOf(Math.max(...gateIdx));
        full.push({ lever, dir, v0, newV: v, pct: (Math.abs(v - v0) / v0) * 100, binding: g[bIdx].name });
        break;
      }
      const cover = gateIdx.filter((x) => x !== undefined).length;
      if (cover > bestTie) { bestTie = cover; bestV = v; }
    }
    if (gateIdx.filter((x) => x !== undefined).length < gates(m).length && bestTie > 0) {
      partial.push({ lever, dir, v0, newV: bestV, tie: bestTie, pct: (Math.abs(bestV - v0) / v0) * 100 });
    }
  }
  full.sort((a, b) => a.pct - b.pct);
  partial.sort((a, b) => (b.tie - a.tie) || (a.pct - b.pct));
  return { full, partial };
}

function renderAdvisor(m) {
  const g = gates(m), allPass = g.every((x) => x.pass);
  const { full, partial } = scanLevers(m);
  const locks = [...LOCKED].map((k) => LEVER_NAMES[k]).join(" · ");

  $("advLockNote").textContent = locks
    ? `Fixed by you (locked 🔒) → taken off the menu: ${locks}. Cost of equity is open, so it is a candidate below.`
    : "Nothing locked — every input is in play. Click 🔒 next to any input to fix it and remove it as a lever.";

  $("advGates").innerHTML = g.map((x) => `
    <div class="gate-chip ${x.pass ? "pass" : "fail"}">
      <span class="gate-name">${x.name}</span>
      <span class="gate-val">${x.val}</span>
    </div>`).join("");

  const list = $("advList"), note = $("advNote");
  if (allPass) {
    list.innerHTML = `<div class="adv-ok">Frame holds — every gate passes on current numbers. Nothing pushed; watch the headroom, not the verdict. Reconfirm you didn't nudge an input to make it true.</div>`;
    note.textContent = "";
  } else if (full.length) {
    list.innerHTML = `<p class="adv-title">Easiest way in — single-lever fixes, smallest move first</p>` +
      full.slice(0, 6).map((s) => `
        <div class="adv-item">
          <span class="adv-lever">${LEVER_NAMES[s.lever]} ${s.dir > 0 ? "↗" : "↘"}</span>
          <code class="adv-move">${LEVERS[s.lever].fmt(s.v0)} → ${LEVERS[s.lever].fmt(s.newV)} <em>${s.pct.toFixed(1)}% ${s.dir > 0 ? "up" : "down"}</em></code>
          <span class="adv-gate">unlocks · ${s.binding}</span>
          <span class="adv-tip">${LEVERS[s.lever].tip}</span>
        </div>`).join("");
    note.textContent = "Ranked by how little you have to move. The top one or two are usually the negotiable ones — drag the slider to confirm it live.";
  } else {
    const a = partial[0], b = partial[1] || a;
    list.innerHTML = `<p class="adv-title">No single lever closes every gate alone — build a package</p>
      ${partial.length ? `<div class="adv-item combo">
        <span class="adv-lever">${LEVER_NAMES[a.lever]} ${a.dir > 0 ? "↗" : "↘"}</span>
        <code class="adv-move">→ ${LEVERS[a.lever].fmt(a.newV)}</code>
        <span class="adv-gate">closes ${a.tie}/5 gates</span>
        <span style="grid-column:1/-1;font-size:11px;color:var(--ink-3)">+</span>
        <span class="adv-lever">${LEVER_NAMES[b.lever]} ${b.dir > 0 ? "↗" : "↘"}</span>
        <code class="adv-move">→ ${LEVERS[b.lever].fmt(b.newV)}</code>
        <span class="adv-gate">closes ${b.tie}/5 gates</span>
        <span class="adv-tip">Move both on the sliders — the package clears the gates the singles couldn't.</span>
      </div>` : `<div class="adv-ok" style="background:var(--amber-bg,#fdf3df);border-color:#f3d9a4">Nothing left to pull — unlock an input, or revise a hard constraint, to give the advisor room.</div>`}`;
    note.textContent = partial.length ? "These two together are the achievable framing; lock what's truly fixed and let the sliders reconcile the rest." : "";
  }
}

/* ---------- scenarios & report ---------- */
const SCEN_KEY = "wfpr_scenarios_v1";
function loadScenarios() {
  try { return JSON.parse(localStorage.getItem(SCEN_KEY) || "[]"); }
  catch (e) { return []; }
}
function persistScenarios() {
  try { localStorage.setItem(SCEN_KEY, JSON.stringify(scenarios.map((s) => ({ name: s.name, inputs: s.inputs })))); }
  catch (e) { /* private mode — keep in memory */ }
}
let scenarios = loadScenarios();

const OBJ_METRICS = {
  npv: { key: "npv", dir: 1, label: "NPV", fmt: (v) => fmt.money(v, 0) },
  eqIrr: { key: "eqIrr", dir: 1, label: "Equity IRR", fmt: (v) => fmt.pct(v, 2) },
  irr: { key: "irr", dir: 1, label: "Project IRR", fmt: (v) => fmt.pct(v, 2) },
  dscr: { key: "dscr", dir: 1, label: "DSCR @ P90", fmt: (v) => fmt.mult(v, 2) },
  lcoe: { key: "lcoe", dir: -1, label: "LCOE", fmt: (v) => fmt.num(v, 1) + " USD/MWh" },
};

function scenarioRows() {
  const curInputs = readInputs();
  const rows = [];
  rows.push({ name: "Current (working)", inputs: curInputs, isCurrent: true });
  scenarios.forEach((s) => rows.push({ name: s.name, inputs: s.inputs, isScen: true }));
  return rows.map((r) => {
    const m = MODEL.run({ inputs: r.inputs });
    const d = m.debt, v = m.valuation;
    return {
      ...r, m,
      npv: v.npv, irr: v.projectIrr, eqIrr: m.equityIrr, dscr: d.dscrP90,
      lcoe: v.lcoe, debt: d.debt, capex: r.inputs.capex, price: r.inputs.price,
    };
  });
}
function scenarioVerdict(m) {
  const npv = m.valuation.npv, dscr = m.debt.dscrP90;
  const ok = npv >= 0 && dscr !== null && dscr >= m.inputs.minDscr &&
    m.equityIrr >= m.inputs.re && m.valuation.lcoe <= m.inputs.price;
  return npv < 0 ? { t: "REJECT", c: "bad" } : ok ? { t: "APPROVE", c: "good" } : { t: "CAUTION", c: "warn" };
}

function renderScenarios() {
  const rows = scenarioRows();
  const cols = ["capex", "price", "npv", "irr", "eqIrr", "dscr", "lcoe", "debt"];
  const dirs = { lcoe: -1 };
  const best = {}, worst = {};
  cols.forEach((c) => {
    const vals = rows.map((r) => r[c]).filter((x) => x !== null && Number.isFinite(x));
    const d = dirs[c] || 1;
    best[c] = Math.max(...vals) * d, worst[c] = Math.min(...vals) * d;
  });

  const obj = OBJ_METRICS[$("reportObj").value];
  const winner = obj
    ? rows.slice().sort((a, b) => obj.dir * ((b[obj.key] - a[obj.key]) || 0))[0]
    : null;

  $("reportBest").innerHTML = winner
    ? `<b>Best by ${obj.label}</b> → “${escapeHtml(winner.name)}”: ${obj.fmt(winner[obj.key])}`
    : "";

  const tb = $("scenTable").querySelector("tbody");
  tb.innerHTML = rows.map((r, i) => {
    const vd = scenarioVerdict(r.m);
    const star = winner && i === rows.indexOf(winner) ? "<sup>★</sup>" : "";
    const del = r.isScen ? `<button class="scen-del" data-idx="${i - 1}" title="Remove scenario">✕</button>` : "";
    const cell = (c) => {
      let cls = "";
      const val = r[c];
      if (val === null || val === undefined) return `<td class="na">—</td>`;
      if (Number.isFinite(val)) {
        const d = dirs[c] || 1;
        if (val * d === best[c]) cls = " cell-best";
        else if (val * d === worst[c]) cls = " cell-worst";
      }
      if (c === "capex") return `<td class="nums${cls}">${fmt.num(val, 0)}</td>`;
      if (c === "price") return `<td class="nums${cls}">${val}</td>`;
      if (c === "npv" || c === "debt") return `<td class="nums${cls}">${fmt.money(val, 0)}</td>`;
      if (c === "irr" || c === "eqIrr") return `<td class="nums${cls}">${fmt.pct(val, 2)}</td>`;
      if (c === "dscr") return `<td class="nums${cls}">${fmt.mult(val, 2)}</td>`;
      if (c === "lcoe") return `<td class="nums${cls}">${fmt.num(val, 1)}</td>`;
      return `<td>—</td>`;
    };
    $("scenEmpty").textContent = rows.length >= 3
      ? "Best per column is green, worst is red. ★ = winner by your objective. Scenarios persist in this browser."
      : "Save more scenarios — the report rows and best-per-column update automatically.";
    return `<tr class="${winner && i === rows.indexOf(winner) ? "row-best" : ""}">
      <td class="metric">${del}${escapeHtml(r.name)}${star}</td>
      ${cols.map(cell).join("")}
      <td><span class="badge ${vd.c}">${vd.t}</span></td>
    </tr>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function exportReport() {
  const rows = scenarioRows();
  const lines = [];
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  lines.push("WIND FARM INVESTMENT — SCENARIO COMPARISON REPORT");
  lines.push("Generated," + new Date().toLocaleString());
  const obj = OBJ_METRICS[$("reportObj").value];
  if (obj) {
    const ranked = rows.slice().sort((a, b) => obj.dir * ((b[obj.key] - a[obj.key]) || 0));
    lines.push("Best by, " + obj.label + "," + esc(ranked[0].name) + "," + obj.fmt(ranked[0][obj.key]));
  }
  lines.push("");
  lines.push("SECTION 1 — COMPARISON");
  lines.push(esc("Scenario") + "," + esc("CAPEX $m") + "," + esc("Price $/MWh") + "," + esc("NPV $m") + "," + esc("Proj IRR") + "," + esc("Equity IRR") + "," + esc("DSCR@P90") + "," + esc("LCOE") + "," + esc("Debt $m") + "," + esc("Verdict"));
  rows.forEach((r) => {
    const vd = scenarioVerdict(r.m);
    lines.push(esc(r.name) + "," + r.capex + "," + r.price + "," + r.npv.toFixed(2) + "," + (r.irr * 100).toFixed(2) + "%," + (r.eqIrr * 100).toFixed(2) + "%," + (r.dscr === null ? "n/a" : r.dscr.toFixed(3)) + "," + r.lcoe.toFixed(2) + "," + r.debt.toFixed(2) + "," + vd.t);
  });
  lines.push("");
  lines.push("SECTION 2 — PER-SCENARIO DIAGNOSTIC");
  rows.forEach((r) => {
    lines.push("");
    lines.push("SCENARIO," + esc(r.name));
    lines.push("Inputs," + esc(Object.entries(r.inputs).filter(([k]) => k !== "hours" && k !== "life" && k !== "rd").map(([k, v]) => `${k}=${v}`).join(" ")));
    gates(r.m).forEach((g) => lines.push("Gate," + esc(g.name) + "," + (g.pass ? "PASS" : "FAIL") + "," + esc(g.val)));
    const mc = mustChange(r.m);
    mc.items.forEach((s) => lines.push("Fix," + esc(LEVER_NAMES[s.lever]) + " → " + esc(LEVERS[s.lever].fmt(s.newV)) + "," + esc(s.gate.name) + ", " + s.pct.toFixed(1) + "% " + (LEVERS[s.lever].dir > 0 ? "up" : "down")));
    if (!mc.items.length && !mc.unresolvable.length) lines.push("Fix,all gates pass,no move needed");
    if (mc.unresolvable.length) lines.push("Fix,no single-lever fix for," + mc.unresolvable.join(" / "));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "windfarm-scenario-report.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
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
  renderTopStats(m);
  renderHighlights(m);
  renderAdvisor(m);
  renderRisk(m);
  renderScenarios();
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

function applyLock(k) {
  const num = $(INPUT_IDS[k]);
  if (!num) return;
  const label = num.closest("label"), lock = label.querySelector(".lock");
  const slider = num.nextElementSibling && num.nextElementSibling.classList.contains("slider") ? num.nextElementSibling : label.querySelector(".slider");
  const locked = LOCKED.has(k);
  num.disabled = locked;
  if (slider) slider.disabled = locked;
  label.classList.toggle("locked", locked);
  lock.textContent = locked ? "🔒" : "🔓";
  lock.title = locked
    ? `Fixed (preference) — the advisor will not move ${LEVER_NAMES[k]}`
    : `Movable — ${LEVER_NAMES[k]} is a candidate lever for the advisor`;
}

function injectLocks() {
  for (const [k, id] of Object.entries(INPUT_IDS)) {
    const num = $(id);
    if (!num) continue;
    const label = num.closest("label");
    if (label.querySelector(".lctrl")) continue;
    const ctrl = document.createElement("span");
    ctrl.className = "lctrl";
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "lock";
    lock.dataset.lever = k;
    ctrl.appendChild(lock);
    ctrl.appendChild(num);
    label.insertBefore(ctrl, label.querySelector(".slider"));
  }
  for (const k of Object.keys(INPUT_IDS)) applyLock(k);
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
  document.querySelectorAll(".lock").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.lever;
      if (LOCKED.has(k)) LOCKED.delete(k); else LOCKED.add(k);
      applyLock(k);
      render();
    });
  });
  $("btnReset").addEventListener("click", () => { setInputs(BASELINE); render(); });
  $("btnPreset").addEventListener("click", () => { setInputs(reference.inputs); render(); });
  $("btnPin").addEventListener("click", () => {
    reference.inputs = { ...readInputs() };
    reference.savedAt = Date.now();
    saveReference();
    render();
  });
  $("btnRefReset").addEventListener("click", () => { reference.inputs = { ...BASELINE }; reference.savedAt = null; saveReference(); render(); });
  $("btnCsv").addEventListener("click", () => {
    if (lastInputs) exportCsv(MODEL.run({ inputs: lastInputs }));
  });
  $("btnSaveScen").addEventListener("click", () => {
    const name = ($("scenName").value || "").trim() || `Scenario ${scenarios.length + 1}`;
    scenarios.push({ name, inputs: { ...readInputs() } });
    persistScenarios();
    $("scenName").value = "";
    render();
  });
  $("btnExportReport").addEventListener("click", exportReport);
  $("reportObj").addEventListener("change", render);
  $("scenTable").querySelector("tbody").addEventListener("click", (ev) => {
    const btn = ev.target.closest(".scen-del");
    if (!btn) return;
    scenarios.splice(parseInt(btn.dataset.idx, 10), 1);
    persistScenarios();
    render();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setInputs(BASELINE);
  injectSliders();
  injectLocks();
  bind();
  render();
});
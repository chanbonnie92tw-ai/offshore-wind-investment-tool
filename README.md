# WindFarm Investment Planner

A standalone, zero-dependency web tool for modelling and stress-testing an
offshore wind farm investment decision. Built on the three-pillar project
finance framework — **Valuation · Financing · Risk** — and calibrated against a
reference "Formosa Blue" 600 MW baseline case.

No build step, no server, no libraries. Open `index.html` in a browser and drag
anything; the whole dashboard recomputes instantly.

## Modules

| # | Module | What it answers |
|---|--------|-----------------|
| 0 | Compare vs reference | Live delta table vs a baseline (Formosa Blue) or a pinned scenario |
| 1 | Valuation | NPV, Project IRR, WACC, LCOE — the "three ways of saying the same thing" |
| 2 | Debt sizing | DSCR-supported vs gearing cap → `MIN()` → which constraint is **binding** |
| 3 | 25-yr cash flow | Annual table, DSCR term structure, cumulative equity curve, Equity IRR |
| 4 | Sensitivity | NPV heatmap vs price × CAPEX, breakeven levers, CSV export |
| 5 | Risk & covenant | DSCR lock-up / default headroom, asymmetric-exposure check, stress tests, burial-depth sweep |

## How it works

Read `model.js` first — it is a pure, testable core with no DOM access. `app.js`
is the live dashboard on top.

Key conventions (learned the hard way):

- **P50 vs P90** — valuation uses P50 (shareholder view); debt sizing uses P90 (lender view).
- **Debt size is back-solved**, not chosen: `Min( CFADS(P90)/MinDSCR × AF, gearing × CAPEX )`. The smaller one dictates how much you can actually borrow.
- **Same thing, three ways** — `LCOE > price ⟺ NPV < 0 ⟺ Project IRR < WACC`. If any one of these is inconsistent with the other two, the assumptions deserve a second look.
- **A decision is covenant-driven, not just NPV-driven** — e.g. burial depth 1 m vs 3 m is NPV-negative on the face of it, but a single fault trips DSCR lock-up, so the decision flips.

## Verification

The model was validated against a reference workbook (Formosa Blue 600 MW baseline):

| Metric | Reference | This tool |
|--------|-----------|-----------|
| Generation P50 / P90 (MWh) | 2,365,200 / 2,102,400 | 2,365,200 / 2,102,400 |
| Revenue P50/P90 ($m) | 236.52 / 210.24 | 236.52 / 210.24 |
| CFADS P50/P90 ($m) | 188.52 / 162.24 | 188.52 / 162.24 |
| WACC | 6.40% | 6.40% |
| NPV ($m) | −79.03 | −79.03 |
| Project IRR | 6.04% | 6.04% |
| LCOE (USD/MWh) | 102.71 | 102.71 |
| Debt / Equity ($m) | 1,354.66 / 1,045.34 (DSCR-bound) | same |
| DSCR @ P90 | 1.40× | 1.40× |
| Equity IRR | 6.88% | 6.88% |

Note: a sample practice workbook reports Equity IRR ≈ 6.55%; recomputing on that
workbook's own cash-flow series yields 6.88% (matches the study notes), so 6.88%
is used here. All other figures agree row-for-row.

## Deploy

Static site — drop these files on GitHub Pages / Netlify / any static host.

## Disclaimer

Built for learning and planning only. Not investment advice; not a substitute for
Lender's Technical Advisor diligence.
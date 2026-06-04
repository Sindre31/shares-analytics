# MERIDIAN PMX — Portfolio Model Exchange

A data-dense, Bloomberg-terminal-style site that runs **10 canonical portfolio-construction models** live against a universe of 23 **real instruments tradable on Nordnet Norway** — 20 Oslo Børs shares plus 3 UCITS ETF diversifiers — on real market data, vs the **OBX** benchmark.

Live: https://shares-analytics.vercel.app

## Pages

- **`index.html`** — landing page: hero, ticker tape (real last closes & 1-day moves), risk/return scatter of all 10 model books vs OBX (click a dot to open the model), sortable comparison table, and the investable universe (click a row for the cross-model view).
- **`asset.html?t=TICKER`** — single-share view: KPIs, real performance vs OBX, correlations, and **how every model treats the share** (held/excluded, weight, rank). Reachable from the search box in the header of every page.
- **`models/01…10-*.html`** — one page per model, each running its *own* construction logic:

| # | Model | Mode | # | Model | Mode |
|---|-------|------|---|-------|------|
| 01 | Mean-Variance Optimization | interactive | 06 | Fama-French Multi-Factor | interactive |
| 02 | CAPM | interactive | 07 | Equal Weight (1/N) | static |
| 03 | Black-Litterman | interactive | 08 | Momentum | interactive |
| 04 | Risk Parity | interactive | 09 | Value | interactive |
| 05 | Minimum Variance | interactive | 10 | Hierarchical Risk Parity | static |

Each model page renders KPIs (return / vol / Sharpe / max-DD), a real growth-of-100 backtest vs OBX, the target book with weight bars, an allocation donut, risk-contribution bars, and an **ⓘ** info drawer. Interactive models recompute the entire book live from their sliders.

## Universe (Nordnet Norway)

Oslo Børs: EQNR, AKRBP, FRO, SUBC, DNB, STB, GJF, ENTRA, TEL, MOWI, SALM, ORK, NHY, YAR, KOG, TOM, VEI, NOD, ATEA, SCATC.
UCITS diversifiers: EUNL (iShares Core MSCI World), EUNH (iShares Core EUR Govt Bond), XEON (Xtrackers EUR Overnight = cash proxy).

## Stack

Zero-dependency static site — vanilla HTML/CSS/JS with hand-rolled SVG charts (`assets/charts.js`). No build step.

```
index.html            entry / landing
asset.html            single-share cross-model view (?t=TICKER)
models/*.html         10 model pages
assets/terminal.css   shared design system (dark terminal, Swiss sans + IBM Plex Mono)
assets/charts.js      SVG chart helpers (donut, line, bars, scatter, spark)
assets/data.js        real market data snapshot (generated — see below)
assets/models.js      universe + 10 model compute functions + info content
assets/app.js         shared chrome (header/search/ticker/footer), info drawer, model renderer
assets/index.js       landing page renderer
assets/asset.js       asset page renderer
scripts/fetch_market.py  data snapshot generator
```

## Run locally

Any static server works:

```sh
npx serve .
# or
python3 -m http.server
```

## Data

Real market data, snapshotted into `assets/data.js` (generated with `yfinance`):

- **Universe** — last close & 1-day change (local ccy), 2y realized volatility, 2y beta vs OBX, 12-1 month momentum, trailing P/E, P/B, dividend yield, market cap (converted to NOK bn via EURNOK), quality (ROE).
- **Returns** — last 120 monthly total returns per instrument; performance charts are **real monthly-rebalanced backtests**, and pairwise correlations used in the risk math are computed from the last 36 months.
- **Expected returns (μ)** — estimates by construction: `0.55 × CAPM-implied (rf + β·ERP, ERP = 5%) + 0.45 × trailing-10y annualized (clipped to [−5%, 35%])`.
- **Risk-free rate** — Norges Bank key policy rate (styringsrenten), fetched from the Norges Bank API.
- **Benchmark** — OBX (`OBX.OL`, with fallbacks).

### Refresh

Automatic: `.github/workflows/refresh-data.yml` runs nightly (Tue–Sat 03:30 UTC), commits a new `assets/data.js` when markets moved, and Vercel auto-deploys the push.

Manual:

```sh
python3 -m venv .venv && .venv/bin/pip install yfinance numpy
.venv/bin/python scripts/fetch_market.py
```

Returns are in each instrument's trading currency (NOK / EUR), unhedged. Not investment advice.

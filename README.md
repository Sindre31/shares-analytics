# MERIDIAN PMX — Portfolio Model Exchange

A data-dense, Bloomberg-terminal-style site over the **full Nordnet Norway catalog** — every Norwegian share (~293) and every fund (~880) Nordnet offers — with **10 canonical portfolio-construction models** running live on the 60 most-traded Oslo Børs names + UCITS diversifiers, vs the **OBX** benchmark.

Live: https://shares-analytics.vercel.app

## Pages

- **`index.html`** — landing page: hero, ticker tape (real last closes & 1-day moves), risk/return scatter of all 10 model books vs OBX (click a dot to open the model), sortable comparison table, and the model universe (click a row for the cross-model view).
- **`asset.html?id=<nordnet-id>`** — instrument view for **any of the ~1,170 searchable instruments**. Shares: KPIs, real performance vs OBX, correlations, Nordnet owner count, deep link to Nordnet, and — for model-universe members — **how every model treats the share** (held/excluded, weight, rank). Funds: Nordnet return summary (1M–10Y), effective fee, Morningstar rating, KIID risk, AUM, SFDR/ESG, manager.
- **header search (every page)** — type a ticker or name; matches rank by relevance then Nordnet owner count.
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

- **Catalog (searchable):** every Norwegian share and every fund on Nordnet NO, imported from Nordnet's public API (`instrument_search` stocklist/fundlist).
- **Model universe (what the 10 models trade):** the 60 most-traded Oslo Børs shares with ≥3 years of history and sane volatility (≤80% ann. — keeps real cyclicals, drops meme/distressed blowups), plus UCITS diversifiers: EUNL (MSCI World), EUNH (EUR govt bonds), XEON (cash proxy). Selection is dynamic — it follows traded value at each refresh.

## Stack

Zero-dependency static site — vanilla HTML/CSS/JS with hand-rolled SVG charts (`assets/charts.js`). No build step.

```
index.html            entry / landing
asset.html            instrument view (?id=<nordnet-id> or ?t=<yahoo-ticker>)
models/*.html         10 model pages
assets/terminal.css   shared design system (dark terminal, Swiss sans + IBM Plex Mono)
assets/charts.js      SVG chart helpers (donut, line, bars, scatter, spark)
assets/data.js        model-universe snapshot (generated)
assets/catalog.js     search index — all Nordnet NO instruments (generated)
data/i/<id>.json      per-instrument detail (generated, ~1,170 files)
assets/models.js      universe + 10 model compute functions + info content
assets/app.js         shared chrome (header/search/ticker/footer), info drawer, model renderer
assets/index.js       landing page renderer
assets/asset.js       instrument page renderer (shares + funds)
scripts/fetch_market.py  Nordnet + Yahoo importer
```

## Run locally

Any static server works:

```sh
npx serve .
# or
python3 -m http.server
```

## Data

- **Nordnet public API** — instrument lists, last price & 1-day move, key ratios (P/E, P/B, P/S, yield), Nordnet owner counts, deep-link slugs; for funds also fees, Morningstar rating, KIID risk, AUM, SFDR/ESG, return summaries (1M–10Y). Nordnet does **not** expose fund NAV history publicly, so funds show return summaries instead of charts.
- **Yahoo Finance** (`yfinance`) — 11y daily history for all ~293 Oslo Børs shares + ETFs: monthly returns (charts are **real monthly-rebalanced backtests**), 2y vol & beta vs OBX, 12-1 momentum; sector/mcap/ROE for the model universe.
- **Expected returns (μ)** — estimates by construction: `0.55 × CAPM-implied (rf + β·ERP, ERP = 5%) + 0.45 × trailing-10y annualized (clipped to [−5%, 35%])`.
- **Risk-free rate** — Norges Bank key policy rate (styringsrenten), from the Norges Bank API.
- **Benchmark** — OBX (`OBX.OL`, with fallbacks).
- Correlations in the risk math are computed from the last 36 real monthly returns. HRP clusters group by sector dynamically.

### Refresh

Automatic: `.github/workflows/refresh-data.yml` runs nightly (Tue–Sat 03:30 UTC), commits a new `assets/data.js` when markets moved, and Vercel auto-deploys the push.

Manual:

```sh
python3 -m venv .venv && .venv/bin/pip install yfinance numpy
.venv/bin/python scripts/fetch_market.py
```

Returns are in each instrument's trading currency (NOK / EUR), unhedged. Not investment advice.

# MERIDIAN PMX — Portfolio Model Exchange

A data-dense, Bloomberg-terminal-style site that runs **10 canonical portfolio-construction models** live against a shared synthetic universe of 17 assets.

## Pages

- **`index.html`** — landing page: hero, live ticker tape, risk/return scatter of all 10 model books vs. the MGX benchmark (click a dot to open the model), sortable comparison table, and the investable universe.
- **`models/01…10-*.html`** — one page per model, each running its *own* construction logic:

| # | Model | Mode | # | Model | Mode |
|---|-------|------|---|-------|------|
| 01 | Mean-Variance Optimization | interactive | 06 | Fama-French Multi-Factor | interactive |
| 02 | CAPM | interactive | 07 | Equal Weight (1/N) | static |
| 03 | Black-Litterman | interactive | 08 | Momentum | interactive |
| 04 | Risk Parity | interactive | 09 | Value | interactive |
| 05 | Minimum Variance | interactive | 10 | Hierarchical Risk Parity | static |

Each model page renders KPIs (return / vol / Sharpe / max-DD), a growth-of-100 performance line vs. benchmark with alpha, the target book with weight bars, an allocation donut, risk-contribution bars, and an **ⓘ** info drawer (summary, mechanism, formula, strengths/limits, provenance). Interactive models recompute the entire book live from their sliders.

## Stack

Zero-dependency static site — vanilla HTML/CSS/JS with hand-rolled SVG charts (`assets/charts.js`). No build step.

```
index.html            entry / landing
models/*.html         10 model pages
assets/terminal.css   shared design system (dark terminal, Swiss sans + IBM Plex Mono)
assets/charts.js      SVG chart helpers (donut, line, bars, scatter, spark)
assets/models.js      universe + 10 model compute functions + info content
assets/app.js         shared chrome (header/ticker/footer), info drawer, model-page renderer
assets/index.js       landing page renderer
```

## Run locally

Any static server works:

```sh
npx serve .
# or
python3 -m http.server
```

## Data

All data is **synthetic / illustrative** — tickers are fictional. Real estimates can be swapped into `assets/models.js` (the `U` universe table) and every chart updates automatically.

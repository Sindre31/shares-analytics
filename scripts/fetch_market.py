#!/usr/bin/env python3
"""Refresh the real-market-data snapshot -> assets/data.js

Usage:
    python3 -m venv .venv && .venv/bin/pip install yfinance
    .venv/bin/python scripts/fetch_market.py
"""
import json, math, sys, datetime as dt
from pathlib import Path
import yfinance as yf
import numpy as np

# ticker, name, sector
UNIVERSE = [
    ("NVDA", "NVIDIA Corporation",        "Technology"),
    ("NOW",  "ServiceNow Inc",            "Technology"),
    ("MSFT", "Microsoft Corporation",     "Technology"),
    ("VRTX", "Vertex Pharmaceuticals",    "Healthcare"),
    ("CAT",  "Caterpillar Inc",           "Industrials"),
    ("FSLR", "First Solar Inc",           "Energy"),
    ("PG",   "Procter & Gamble",          "Staples"),
    ("XOM",  "Exxon Mobil Corporation",   "Energy"),
    ("JPM",  "JPMorgan Chase & Co",       "Financials"),
    ("ABT",  "Abbott Laboratories",       "Healthcare"),
    ("VZ",   "Verizon Communications",    "Telecom"),
    ("NEM",  "Newmont Corporation",       "Materials"),
    ("O",    "Realty Income Corp",        "Real Estate"),
    ("DUK",  "Duke Energy Corporation",   "Utilities"),
    ("VXUS", "Vanguard Total Intl Stock", "International"),
    ("AGG",  "iShares Core US Agg Bond",  "Fixed Income"),
    ("BIL",  "SPDR 1-3M T-Bill ETF",      "Cash"),
]
BENCH = "SPY"
ERP = 4.5                      # equity risk premium for CAPM-implied mu
W_CAPM, W_HIST = 0.55, 0.45    # mu = blend of CAPM-implied and trailing-10y
HIST_CLIP = (-5.0, 35.0)
NO_FUNDAMENTALS = {"AGG", "BIL"}              # P/E & P/B meaningless
ETF_QUAL = {"VXUS": 0.64, "AGG": 0.70, "BIL": 1.00}
ETF_PB = {"VXUS": 1.9}                        # factsheet fallback (yfinance lacks ETF P/B)

tickers = [t for t, _, _ in UNIVERSE] + [BENCH]

print("downloading 11y daily history...", file=sys.stderr)
hist = yf.download(tickers, period="11y", interval="1d", auto_adjust=True, progress=False)["Close"]
hist = hist.dropna(how="all")

monthly = hist.resample("ME").last()
mrets = monthly.pct_change().dropna(how="all").tail(120)
daily = hist.pct_change().tail(504)

try:
    irx = yf.download("^IRX", period="1mo", interval="1d", progress=False)["Close"].dropna()
    rf = float(np.asarray(irx.iloc[-1]).reshape(-1)[0])
except Exception as e:
    print("IRX failed:", e, file=sys.stderr)
    rf = 4.2

bench_d = daily[BENCH].dropna()

def hist_ann(t):
    r = mrets[t].fillna(0.0).values
    growth = float(np.prod(1 + r))
    return (growth ** (12 / len(r)) - 1) * 100

assets = []
for t, name, sector in UNIVERSE:
    d = daily[t].dropna()
    al = d.align(bench_d, join="inner")
    beta = float(np.cov(al[0], al[1])[0, 1] / np.var(al[1]))
    vol = float(d.std() * math.sqrt(252) * 100)
    mc = monthly[t].dropna()
    mom = float((mc.iloc[-2] / mc.iloc[-13] - 1) * 100) if len(mc) >= 13 else 0.0
    closes = hist[t].dropna()
    px, chg = float(closes.iloc[-1]), float((closes.iloc[-1] / closes.iloc[-2] - 1) * 100)

    info = {}
    try:
        info = yf.Ticker(t).info or {}
    except Exception as e:
        print(f"info failed for {t}: {e}", file=sys.stderr)
    pe = 0 if t in NO_FUNDAMENTALS else (info.get("trailingPE") or 0)
    pb = 0 if t in NO_FUNDAMENTALS else (info.get("priceToBook") or ETF_PB.get(t, 0))
    dy = info.get("dividendYield") or 0
    if dy and dy < 0.25:
        dy *= 100  # fraction -> percent
    mcap_bn = (info.get("marketCap") or info.get("totalAssets") or 0) / 1e9
    roe = info.get("returnOnEquity")
    qual = ETF_QUAL.get(t, max(0.05, min(1.0, roe if roe is not None else 0.5)))

    capm = rf + beta * ERP
    h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(t)))
    er = W_CAPM * capm + W_HIST * h

    assets.append(dict(t=t, name=name, sector=sector,
                       er=round(er, 1), vol=round(vol, 1), beta=round(beta, 2),
                       mom=round(mom, 1), pe=round(pe, 1) if pe else 0,
                       pb=round(pb, 2) if pb else 0, div=round(dy, 2),
                       mcap=round(mcap_bn, 1), qual=round(qual, 2),
                       px=round(px, 2), chg=round(chg, 2)))
    print(f"{t}: er={er:.1f} vol={vol:.1f} beta={beta:.2f} mom={mom:.1f}", file=sys.stderr)

bvol = float(bench_d.std() * math.sqrt(252) * 100)
bcloses = hist[BENCH].dropna()
bench = dict(code="SPX", ticker=BENCH, name="S&P 500",
             er=round(W_CAPM * (rf + ERP) + W_HIST * min(HIST_CLIP[1], hist_ann(BENCH)), 1),
             vol=round(bvol, 1), px=round(float(bcloses.iloc[-1]), 2),
             chg=round(float(bcloses.iloc[-1] / bcloses.iloc[-2] - 1) * 100, 2))

rets = {t: [round(float(v), 4) for v in mrets[t].fillna(0.0).values] for t in tickers}
dates = [d.strftime("%Y-%m") for d in mrets.index]

out = dict(asof=dt.date.today().isoformat(), rf=round(rf, 2), erp=ERP,
           bench=bench, universe=assets, dates=dates, rets=rets)

target = Path(__file__).resolve().parent.parent / "assets" / "data.js"
js = ("/* data.js — real market data snapshot (generated " + out["asof"] + " via yfinance)\n"
      "   px/chg = last close & 1-day move; rets = last 120 monthly total returns.\n"
      "   Expected returns: 0.55·CAPM-implied (rf + beta*ERP) + 0.45·trailing-10y (clipped). */\n"
      "window.MERIDIAN_DATA = " + json.dumps(out) + ";\n")
target.write_text(js)
print(f"\nwrote {target} — rf={rf:.2f}%, {len(dates)} months, {len(assets)} assets", file=sys.stderr)

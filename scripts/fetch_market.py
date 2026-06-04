#!/usr/bin/env python3
"""Refresh the real-market-data snapshot -> assets/data.js

Universe: instruments tradable on Nordnet Norway — Oslo Bors (OBX) stocks
plus UCITS ETF diversifiers. Benchmark: OBX. Risk-free: Norges Bank key rate.

Usage:
    python3 -m venv .venv && .venv/bin/pip install yfinance numpy
    .venv/bin/python scripts/fetch_market.py
"""
import json, math, sys, urllib.request, datetime as dt
from pathlib import Path
import yfinance as yf
import numpy as np

# ticker (Yahoo), name, sector, currency
UNIVERSE = [
    ("EQNR.OL",  "Equinor",               "Energy",        "NOK"),
    ("AKRBP.OL", "Aker BP",               "Energy",        "NOK"),
    ("FRO.OL",   "Frontline",             "Shipping",      "NOK"),
    ("SUBC.OL",  "Subsea 7",              "Oil Services",  "NOK"),
    ("DNB.OL",   "DNB Bank",              "Financials",    "NOK"),
    ("STB.OL",   "Storebrand",            "Financials",    "NOK"),
    ("GJF.OL",   "Gjensidige Forsikring", "Insurance",     "NOK"),
    ("ENTRA.OL", "Entra",                 "Real Estate",   "NOK"),
    ("TEL.OL",   "Telenor",               "Telecom",       "NOK"),
    ("MOWI.OL",  "Mowi",                  "Seafood",       "NOK"),
    ("SALM.OL",  "SalMar",                "Seafood",       "NOK"),
    ("ORK.OL",   "Orkla",                 "Staples",       "NOK"),
    ("NHY.OL",   "Norsk Hydro",           "Materials",     "NOK"),
    ("YAR.OL",   "Yara International",    "Materials",     "NOK"),
    ("KOG.OL",   "Kongsberg Gruppen",     "Defence",       "NOK"),
    ("TOM.OL",   "Tomra Systems",         "Industrials",   "NOK"),
    ("VEI.OL",   "Veidekke",              "Construction",  "NOK"),
    ("NOD.OL",   "Nordic Semiconductor",  "Technology",    "NOK"),
    ("ATEA.OL",  "Atea",                  "Technology",    "NOK"),
    ("SCATC.OL", "Scatec",                "Renewables",    "NOK"),
    ("EUNL.DE",  "iShares Core MSCI World (UCITS)",  "Global Equity", "EUR"),
    ("EUNH.DE",  "iShares Core EUR Govt Bond (UCITS)","Fixed Income", "EUR"),
    ("XEON.DE",  "Xtrackers EUR Overnight (UCITS)",  "Cash",          "EUR"),
]
CASH = "XEON.DE"
BOND = "EUNH.DE"
BENCH_CANDIDATES = ["OBX.OL", "^OSEAX", "OBXEDNB.OL"]  # OBX index, fallback all-share, fallback DNB OBX ETF
ERP = 5.0                      # equity risk premium for CAPM-implied mu (Norway)
W_CAPM, W_HIST = 0.55, 0.45    # mu = blend of CAPM-implied and trailing-10y
HIST_CLIP = (-5.0, 35.0)
NO_FUNDAMENTALS = {BOND, CASH}                  # P/E & P/B meaningless
ETF_QUAL = {"EUNL.DE": 0.64, BOND: 0.70, CASH: 1.00}
ETF_PB = {"EUNL.DE": 3.2}                       # factsheet fallback (yfinance lacks ETF P/B)
ETF_PE = {"EUNL.DE": 19.0}                      # factsheet fallback
ETF_AUM_EUR_BN = {"EUNL.DE": 95.0, BOND: 5.5}   # factsheet fallback when totalAssets missing


def norges_bank_key_rate():
    """Current Norges Bank policy rate (styringsrenten), %"""
    url = ("https://data.norges-bank.no/api/data/IR/B.KPRA.SD.R"
           "?format=sdmx-json&lastNObservations=1")
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            j = json.load(r)
        series = j["data"]["dataSets"][0]["series"]
        obs = next(iter(series.values()))["observations"]
        return float(next(iter(obs.values()))[0])
    except Exception as e:
        print("Norges Bank API failed:", e, "— falling back to 4.0", file=sys.stderr)
        return 4.0


def pick_bench():
    for c in BENCH_CANDIDATES:
        try:
            h = yf.download(c, period="11y", interval="1d", auto_adjust=True, progress=False)["Close"].dropna()
            if len(h) > 2000:
                print(f"benchmark: {c} ({len(h)} obs)", file=sys.stderr)
                return c, h.squeeze()
        except Exception as e:
            print(f"bench {c} failed: {e}", file=sys.stderr)
    raise SystemExit("no benchmark ticker worked")


rf = norges_bank_key_rate()
print(f"risk-free (Norges Bank key rate): {rf}%", file=sys.stderr)
bench_t, bench_hist = pick_bench()

# EUR -> NOK for market-cap comparability (cap-weighting needs one currency)
try:
    fx = float(np.asarray(yf.download("EURNOK=X", period="5d", interval="1d", progress=False)["Close"].dropna().iloc[-1]).reshape(-1)[0])
except Exception as e:
    print("EURNOK failed:", e, "— falling back to 11.5", file=sys.stderr)
    fx = 11.5
print(f"EURNOK: {fx:.2f}", file=sys.stderr)

tickers = [t for t, _, _, _ in UNIVERSE]
print("downloading 11y daily history...", file=sys.stderr)
hist = yf.download(tickers, period="11y", interval="1d", auto_adjust=True, progress=False)["Close"]
hist = hist.dropna(how="all")
hist["__BENCH__"] = bench_hist

monthly = hist.resample("ME").last()
mrets = monthly.pct_change().dropna(how="all").tail(120)
daily = hist.pct_change().tail(504)
bench_d = daily["__BENCH__"].dropna()


def hist_ann(col):
    r = mrets[col].fillna(0.0).values
    growth = float(np.prod(1 + r))
    return (growth ** (12 / len(r)) - 1) * 100


assets = []
for t, name, sector, ccy in UNIVERSE:
    d = daily[t].dropna()
    if len(d) < 250:
        print(f"SKIP {t}: only {len(d)} daily obs", file=sys.stderr)
        continue
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
    pe = 0 if t in NO_FUNDAMENTALS else (info.get("trailingPE") or ETF_PE.get(t, 0))
    pb = 0 if t in NO_FUNDAMENTALS else (info.get("priceToBook") or ETF_PB.get(t, 0))
    dy = info.get("dividendYield") or 0
    if dy and dy < 0.25:
        dy *= 100  # fraction -> percent
    mcap_bn = (info.get("marketCap") or info.get("totalAssets") or ETF_AUM_EUR_BN.get(t, 0) * 1e9) / 1e9
    if ccy == "EUR":
        mcap_bn *= fx  # store all mcaps in NOK bn
    roe = info.get("returnOnEquity")
    qual = ETF_QUAL.get(t, max(0.05, min(1.0, roe if roe is not None else 0.5)))

    capm = rf + beta * ERP
    h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(t)))
    er = W_CAPM * capm + W_HIST * h

    assets.append(dict(t=t, name=name, sector=sector, ccy=ccy,
                       er=round(er, 1), vol=round(vol, 1), beta=round(beta, 2),
                       mom=round(mom, 1), pe=round(pe, 1) if pe else 0,
                       pb=round(pb, 2) if pb else 0, div=round(dy, 2),
                       mcap=round(mcap_bn, 1), qual=round(qual, 2),
                       px=round(px, 2), chg=round(chg, 2)))
    print(f"{t}: er={er:.1f} vol={vol:.1f} beta={beta:.2f} mom={mom:.1f} pe={pe} mcap={mcap_bn:.0f}bn", file=sys.stderr)

bvol = float(bench_d.std() * math.sqrt(252) * 100)
bcloses = hist["__BENCH__"].dropna()
bench = dict(code="OBX", ticker="__BENCH__", source=bench_t, name="Oslo Bors OBX",
             er=round(W_CAPM * (rf + ERP) + W_HIST * min(HIST_CLIP[1], hist_ann("__BENCH__")), 1),
             vol=round(bvol, 1), px=round(float(bcloses.iloc[-1]), 2),
             chg=round(float(bcloses.iloc[-1] / bcloses.iloc[-2] - 1) * 100, 2))

cols = [a["t"] for a in assets] + ["__BENCH__"]
rets = {t: [round(float(v), 4) for v in mrets[t].fillna(0.0).values] for t in cols}
dates = [d.strftime("%Y-%m") for d in mrets.index]

out = dict(asof=dt.date.today().isoformat(), rf=round(rf, 2), erp=ERP,
           cash=CASH, bond=BOND,
           bench=bench, universe=assets, dates=dates, rets=rets)

target = Path(__file__).resolve().parent.parent / "assets" / "data.js"
js = ("/* data.js — real market data snapshot (generated " + out["asof"] + " via yfinance)\n"
      "   Universe: Nordnet Norway — Oslo Bors stocks + UCITS ETFs. Benchmark: OBX.\n"
      "   px/chg = last close & 1-day move (local ccy); rets = last 120 monthly total returns.\n"
      "   Expected returns: 0.55*CAPM-implied (rf + beta*ERP) + 0.45*trailing-10y (clipped). */\n"
      "window.MERIDIAN_DATA = " + json.dumps(out) + ";\n")
target.write_text(js)
print(f"\nwrote {target} — rf={rf:.2f}%, {len(dates)} months, {len(assets)} assets", file=sys.stderr)

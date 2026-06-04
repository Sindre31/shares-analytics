#!/usr/bin/env python3
"""Import the full Nordnet Norway universe -> assets/data.js, assets/catalog.js, data/i/*.json

- All Norwegian shares (Nordnet stocklist, ~293) — full Yahoo price history,
  Nordnet key ratios, owners, deep-link slug.
- All funds offered on Nordnet NO (~880) — Nordnet return summaries, fees,
  Morningstar rating, risk, AUM.
- Model universe = top N shares by traded value with >=36 months history,
  plus UCITS ETF diversifiers (EUNL/EUNH/XEON). Benchmark OBX, risk-free
  Norges Bank key rate.

Usage:
    python3 -m venv .venv && .venv/bin/pip install yfinance numpy
    .venv/bin/python scripts/fetch_market.py
"""
import json, math, sys, time, urllib.request, datetime as dt
from pathlib import Path
import yfinance as yf
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
NN = "https://www.nordnet.no/api/2"
HDRS = {"Accept": "application/json", "client-id": "NEXT",
        "User-Agent": "Mozilla/5.0 (compatible; meridian-pmx/1.0; personal project)"}

MODEL_N = 60                   # liquid shares in the model universe
ERP = 5.0                      # equity risk premium for CAPM-implied mu
W_CAPM, W_HIST = 0.55, 0.45    # mu = blend of CAPM-implied and trailing-10y
HIST_CLIP = (-5.0, 35.0)

ETFS = [  # UCITS diversifiers (tradable on Nordnet NO)
    dict(t="EUNL.DE", name="iShares Core MSCI World (UCITS)",   sector="Global Equity", ccy="EUR", qual=0.64, pe=19.0, pb=3.2),
    dict(t="EUNH.DE", name="iShares Core EUR Govt Bond (UCITS)",sector="Fixed Income",  ccy="EUR", qual=0.70, pe=0,    pb=0),
    dict(t="XEON.DE", name="Xtrackers EUR Overnight (UCITS)",   sector="Cash",          ccy="EUR", qual=1.00, pe=0,    pb=0),
]
CASH, BOND = "XEON.DE", "EUNH.DE"


def get(url):
    req = urllib.request.Request(url, headers=HDRS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def page_all(query, extra=""):
    out, offset = [], 0
    while True:
        d = get(f"{NN}/instrument_search/query/{query}?limit=100&offset={offset}{extra}")
        rs = d.get("results", [])
        out += rs
        offset += len(rs)
        if offset >= d.get("total_hits", 0) or not rs:
            return out
        time.sleep(0.25)


def norges_bank_key_rate():
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


def yahoo_sym(nn_symbol):
    return nn_symbol.replace(" ", "-") + ".OL"


# ---------------- 1. Nordnet lists ----------------
print("fetching Nordnet stocklist (NO)...", file=sys.stderr)
stocks_raw = page_all("stocklist", "&apply_filters=exchange_country%3DNO")
print(f"  {len(stocks_raw)} shares", file=sys.stderr)

print("fetching Nordnet fundlist...", file=sys.stderr)
funds_raw = page_all("fundlist")
print(f"  {len(funds_raw)} funds", file=sys.stderr)

rf = norges_bank_key_rate()
print(f"risk-free (Norges Bank key rate): {rf}%", file=sys.stderr)


def f(x, d=2):
    return round(float(x), d) if x is not None else None


def price_of(r):
    p = (r.get("price_info") or {}).get("last") or {}
    return f(p.get("price"))


shares = []
for r in stocks_raw:
    ii, pi = r.get("instrument_info", {}), r.get("price_info", {})
    kr, hr = r.get("key_ratios_info", {}) or {}, r.get("historical_returns_info", {}) or {}
    if not ii.get("symbol"):
        continue
    shares.append(dict(
        id=ii["instrument_id"], sym=ii["symbol"], yt=yahoo_sym(ii["symbol"]),
        name=(ii.get("long_name") or ii.get("name") or ii["symbol"]).title(),
        ccy=ii.get("currency", "NOK"), isin=ii.get("isin"),
        px=price_of(r), chg=f(pi.get("diff_pct")),
        turn=f((pi.get("turnover_normalized") or 0), 0),
        pe=f(kr.get("pe")), pb=f(kr.get("pb")), ps=f(kr.get("ps")),
        div=f(kr.get("dividend_yield")) or 0,
        owners=(r.get("statistical_info") or {}).get("number_of_owners", 0),
        slug=(r.get("nnx_info") or {}).get("display_slug"),
        y={k: f(v, 1) for k, v in hr.items() if isinstance(v, (int, float))},
    ))

funds = []
for r in funds_raw:
    ii, pi = r.get("instrument_info", {}), r.get("price_info", {})
    fi, hr = r.get("fund_info", {}) or {}, r.get("historical_returns_info", {}) or {}
    if not ii.get("instrument_id"):
        continue
    funds.append(dict(
        id=ii["instrument_id"],
        name=ii.get("display_name") or ii.get("name"),
        ccy=ii.get("currency", "NOK"), isin=ii.get("isin"),
        px=price_of(r), chg=f(hr.get("yield_1d")),
        cat=fi.get("fund_category") or fi.get("fund_type") or "Fond",
        owners=(r.get("statistical_info") or {}).get("number_of_owners", 0),
        slug=(r.get("nnx_info") or {}).get("display_slug"),
        y={k: f(v, 1) for k, v in hr.items() if isinstance(v, (int, float))},
        fund=dict(ms=fi.get("fund_ms_rating"), fee=f(fi.get("fund_yearly_fee")),
                  calcFee=f(fi.get("fund_calculated_fee")), risk=fi.get("fund_raw_risk"),
                  riskGroup=fi.get("fund_risk_group"), aum=f((fi.get("fund_total_market_value") or 0) / 1e9, 2),
                  admin=fi.get("fund_branding_company") or fi.get("fund_admin_company"),
                  type=fi.get("fund_type"), sfdr=fi.get("fund_sfdr_article"),
                  esg=fi.get("fund_esg_score"), minInv=fi.get("fund_min_investment"),
                  selection=bool(fi.get("fund_nordnet_selection"))),
    ))

# ---------------- 2. Yahoo history for all shares + ETFs + benchmark ----------------
yahoo_ts = [s["yt"] for s in shares] + [e["t"] for e in ETFS]

print("picking benchmark...", file=sys.stderr)
bench_t, bench_hist = None, None
for c in ["OBX.OL", "^OSEAX", "OBXEDNB.OL"]:
    try:
        h = yf.download(c, period="11y", interval="1d", auto_adjust=True, progress=False)["Close"].dropna()
        if len(h) > 2000:
            bench_t, bench_hist = c, h.squeeze()
            print(f"  benchmark: {c}", file=sys.stderr)
            break
    except Exception as e:
        print(f"  bench {c} failed: {e}", file=sys.stderr)
if bench_hist is None:
    raise SystemExit("no benchmark ticker worked")

print(f"downloading 11y daily history for {len(yahoo_ts)} tickers...", file=sys.stderr)
hist = yf.download(yahoo_ts, period="11y", interval="1d", auto_adjust=True, progress=False, threads=True)["Close"]
hist = hist.dropna(how="all")
hist["__BENCH__"] = bench_hist

monthly = hist.resample("ME").last()
mrets = monthly.pct_change().dropna(how="all").tail(120)
daily = hist.pct_change().tail(504)
bench_d = daily["__BENCH__"].dropna()

try:
    fx = float(np.asarray(yf.download("EURNOK=X", period="5d", interval="1d", progress=False)["Close"].dropna().iloc[-1]).reshape(-1)[0])
except Exception:
    fx = 11.5
print(f"EURNOK: {fx:.2f}", file=sys.stderr)


def months_of(yt):
    if yt not in mrets.columns:
        return 0
    return int(mrets[yt].notna().sum())


def rets_list(yt):
    return [round(float(v), 4) for v in mrets[yt].fillna(0.0).values]


def hist_ann(yt):
    r = mrets[yt].dropna()
    if len(r) < 12:
        return 0.0
    growth = float(np.prod(1 + r.values))
    return (growth ** (12 / len(r)) - 1) * 100


def stats_for(yt):
    d = hist[yt].dropna() if yt in hist.columns else None
    if d is None or len(d) < 60:
        return None
    dr = d.pct_change().tail(504).dropna()
    al = dr.align(bench_d, join="inner")
    if len(al[0]) < 60:
        return None
    beta = float(np.cov(al[0], al[1])[0, 1] / np.var(al[1]))
    vol = float(dr.std() * math.sqrt(252) * 100)
    mc = monthly[yt].dropna()
    mom = float((mc.iloc[-2] / mc.iloc[-13] - 1) * 100) if len(mc) >= 13 else 0.0
    return dict(beta=round(beta, 2), vol=round(vol, 1), mom=round(mom, 1))


# ---------------- 3. model universe: top-N by traded value ----------------
# sanity guard: exclude hyper-volatile names (meme/distressed) from the MODEL universe
# (they stay searchable in the catalog); 80% ann. vol keeps real cyclicals, drops blowups
def sane(s):
    st = stats_for(s["yt"])
    return st is not None and st["vol"] <= 80

eligible = [s for s in shares if s["px"] and months_of(s["yt"]) >= 36 and sane(s)]
eligible.sort(key=lambda s: s["turn"] or 0, reverse=True)
core = eligible[:MODEL_N]
core_set = {s["id"] for s in core}
print(f"model universe: {len(core)} shares (most-traded, >=36mo history) + {len(ETFS)} ETFs", file=sys.stderr)

print("fetching sector/mcap/quality for model universe (yfinance .info)...", file=sys.stderr)
U = []
for s in core:
    info = {}
    try:
        info = yf.Ticker(s["yt"]).info or {}
    except Exception as e:
        print(f"  info failed {s['yt']}: {e}", file=sys.stderr)
    time.sleep(0.12)
    sector = info.get("sector") or "Oslo Børs"
    mcap = (info.get("marketCap") or 0) / 1e9
    roe = info.get("returnOnEquity")
    qual = max(0.05, min(1.0, roe if roe is not None else 0.5))
    st = stats_for(s["yt"])
    capm = rf + st["beta"] * ERP
    h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(s["yt"])))
    er = W_CAPM * capm + W_HIST * h
    U.append(dict(t=s["yt"], nn=s["id"], name=s["name"], sector=sector, ccy=s["ccy"],
                  er=round(er, 1), vol=st["vol"], beta=st["beta"], mom=st["mom"],
                  pe=s["pe"] or 0, pb=s["pb"] or 0, div=s["div"] or 0,
                  mcap=round(mcap, 1), qual=round(qual, 2),
                  px=s["px"], chg=s["chg"] or 0, slug=s["slug"]))

for e in ETFS:
    st = stats_for(e["t"])
    capm = rf + st["beta"] * ERP
    h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(e["t"])))
    info = {}
    try:
        info = yf.Ticker(e["t"]).info or {}
    except Exception:
        pass
    aum_bn_nok = ((info.get("totalAssets") or {"EUNL.DE": 95e9, "EUNH.DE": 5.5e9, "XEON.DE": 22e9}.get(e["t"], 0)) / 1e9) * fx
    dy = info.get("dividendYield") or 0
    if dy and dy < 0.25:
        dy *= 100
    U.append(dict(t=e["t"], nn=None, name=e["name"], sector=e["sector"], ccy=e["ccy"],
                  er=round(W_CAPM * capm + W_HIST * h, 1), vol=st["vol"], beta=st["beta"], mom=st["mom"],
                  pe=e["pe"], pb=e["pb"], div=round(dy, 2), mcap=round(aum_bn_nok, 1), qual=e["qual"],
                  px=round(float(hist[e["t"]].dropna().iloc[-1]), 2),
                  chg=round(float(hist[e["t"]].dropna().iloc[-1] / hist[e["t"]].dropna().iloc[-2] - 1) * 100, 2),
                  slug=None))

bvol = float(bench_d.std() * math.sqrt(252) * 100)
bcl = hist["__BENCH__"].dropna()
bench = dict(code="OBX", ticker="__BENCH__", source=bench_t, name="Oslo Børs OBX",
             er=round(W_CAPM * (rf + ERP) + W_HIST * min(HIST_CLIP[1], hist_ann("__BENCH__")), 1),
             vol=round(bvol, 1), px=round(float(bcl.iloc[-1]), 2),
             chg=round(float(bcl.iloc[-1] / bcl.iloc[-2] - 1) * 100, 2))

rets = {a["t"]: rets_list(a["t"]) for a in U}
rets["__BENCH__"] = rets_list("__BENCH__")
dates = [d.strftime("%Y-%m") for d in mrets.index]
asof = dt.date.today().isoformat()

data = dict(asof=asof, rf=round(rf, 2), erp=ERP, cash=CASH, bond=BOND,
            bench=bench, universe=U, dates=dates, rets=rets,
            counts=dict(shares=len(shares), funds=len(funds)))

# ---------------- 4. catalog (search index, all instruments) ----------------
catalog = []
for s in shares:
    catalog.append(dict(id=s["id"], sym=s["sym"], yt=s["yt"], name=s["name"], type="EQ",
                        cat="Aksje · Oslo Børs", ccy=s["ccy"], px=s["px"], chg=s["chg"],
                        owners=s["owners"], inU=s["id"] in core_set))
for fd in funds:
    catalog.append(dict(id=fd["id"], sym=None, yt=None, name=fd["name"], type="FND",
                        cat=fd["cat"], ccy=fd["ccy"], px=fd["px"], chg=fd["chg"],
                        owners=fd["owners"], inU=False))

# ---------------- 5. per-instrument detail files ----------------
ddir = ROOT / "data" / "i"
ddir.mkdir(parents=True, exist_ok=True)
old = {p.name for p in ddir.glob("*.json")}
written = set()
for s in shares:
    det = dict(id=s["id"], sym=s["sym"], yt=s["yt"], name=s["name"], type="EQ",
               cat="Aksje · Oslo Børs", ccy=s["ccy"], isin=s["isin"], px=s["px"], chg=s["chg"],
               owners=s["owners"], slug=s["slug"], y=s["y"],
               ratios=dict(pe=s["pe"], pb=s["pb"], ps=s["ps"], div=s["div"]),
               stats=stats_for(s["yt"]), months=months_of(s["yt"]),
               rets=rets_list(s["yt"]) if months_of(s["yt"]) else [])
    (ddir / f"{s['id']}.json").write_text(json.dumps(det))
    written.add(f"{s['id']}.json")
for fd in funds:
    det = dict(id=fd["id"], name=fd["name"], type="FND", cat=fd["cat"], ccy=fd["ccy"],
               isin=fd["isin"], px=fd["px"], chg=fd["chg"], owners=fd["owners"],
               slug=fd["slug"], y=fd["y"], fund=fd["fund"])
    (ddir / f"{fd['id']}.json").write_text(json.dumps(det))
    written.add(f"{fd['id']}.json")
for stale in old - written:
    (ddir / stale).unlink()

# ---------------- 6. write JS modules ----------------
(ROOT / "assets" / "data.js").write_text(
    "/* data.js — model-universe snapshot (generated " + asof + ")\n"
    "   Source: Nordnet NO lists + Yahoo history + Norges Bank key rate.\n"
    "   Model universe = " + str(MODEL_N) + " most-traded Oslo Børs shares (>=36mo history) + UCITS ETFs.\n"
    "   Expected returns: 0.55*CAPM-implied (rf + beta*ERP) + 0.45*trailing-10y (clipped). */\n"
    "window.MERIDIAN_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")

(ROOT / "assets" / "catalog.js").write_text(
    "/* catalog.js — all Nordnet NO instruments for search (generated " + asof + ")\n"
    "   " + str(len(shares)) + " shares + " + str(len(funds)) + " funds. Detail in data/i/<id>.json. */\n"
    "window.MERIDIAN_CAT = " + json.dumps(catalog, ensure_ascii=False) + ";\n", encoding="utf-8")

print(f"\nwrote assets/data.js ({len(U)} model assets), assets/catalog.js ({len(catalog)} instruments), "
      f"data/i/*.json ({len(written)} files)", file=sys.stderr)

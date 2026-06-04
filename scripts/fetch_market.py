#!/usr/bin/env python3
"""Import the full Nordnet catalog -> assets/data.js, assets/catalog.json, data/s/*.json

- ALL shares on Nordnet (~12,200: NO/US/CA/SE/DE/FI/DK/...) + ALL funds (~880).
- Yahoo price history: every Norwegian share (11y daily) + the most-owned
  foreign shares (10y monthly, price-validated against Nordnet's last).
- Model universe = top N Oslo Bors shares by traded value with >=36 months
  history and sane volatility, plus UCITS ETF diversifiers.
- Benchmark OBX, risk-free Norges Bank key rate.

Outputs:
  assets/data.js        model universe + benchmark (loaded on every page)
  assets/catalog.json   search index, all instruments (lazy-loaded on first search)
  data/s/<id%256>.json  detail shards: id -> instrument detail

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

MODEL_N = 60                   # liquid Oslo Bors shares in the model universe
FOREIGN_HIST_MAX = 3000        # most-owned foreign shares to fetch history for
FOREIGN_MIN_OWNERS = 30
SHARDS = 256
ERP = 5.0
W_CAPM, W_HIST = 0.55, 0.45
HIST_CLIP = (-5.0, 35.0)

# Nordnet exchange_country -> Yahoo suffix
YSUF = {"NO": ".OL", "SE": ".ST", "DK": ".CO", "FI": ".HE", "DE": ".DE", "US": "",
        "CA": ".TO", "FR": ".PA", "NL": ".AS", "BE": ".BR", "IT": ".MI", "ES": ".MC",
        "PT": ".LS", "AT": ".VI", "CH": ".SW", "GB": ".L", "IE": ".IR"}

ETFS = [
    dict(t="EUNL.DE", name="iShares Core MSCI World (UCITS)",   sector="Global Equity", ccy="EUR", qual=0.64, pe=19.0, pb=3.2),
    dict(t="EUNH.DE", name="iShares Core EUR Govt Bond (UCITS)",sector="Fixed Income",  ccy="EUR", qual=0.70, pe=0,    pb=0),
    dict(t="XEON.DE", name="Xtrackers EUR Overnight (UCITS)",   sector="Cash",          ccy="EUR", qual=1.00, pe=0,    pb=0),
]
CASH, BOND = "XEON.DE", "EUNH.DE"


def get(url):
    req = urllib.request.Request(url, headers=HDRS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 2:
                raise
            print(f"  retry {url.split('?')[0]}: {e}", file=sys.stderr)
            time.sleep(2)


def page_all(query, extra=""):
    out, offset = [], 0
    while True:
        d = get(f"{NN}/instrument_search/query/{query}?limit=100&offset={offset}{extra}")
        rs = d.get("results", [])
        out += rs
        offset += len(rs)
        if offset % 2000 < 100:
            print(f"  ...{offset}/{d.get('total_hits')}", file=sys.stderr)
        if offset >= d.get("total_hits", 0) or not rs:
            return out
        time.sleep(0.2)


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


def f(x, d=2):
    return round(float(x), d) if x is not None else None


def yahoo_sym(sym, country):
    if country not in YSUF:
        return None
    s = sym.replace(" ", "-")
    if country == "US":
        s = s.replace(".", "-")
    return s + YSUF[country]


# ---------------- 1. Nordnet lists ----------------
print("fetching Nordnet stocklist (ALL countries)...", file=sys.stderr)
stocks_raw = page_all("stocklist")
print(f"  {len(stocks_raw)} shares", file=sys.stderr)

print("fetching Nordnet fundlist...", file=sys.stderr)
funds_raw = page_all("fundlist")
print(f"  {len(funds_raw)} funds", file=sys.stderr)

rf = norges_bank_key_rate()
print(f"risk-free (Norges Bank key rate): {rf}%", file=sys.stderr)


def price_of(r):
    p = (r.get("price_info") or {}).get("last") or {}
    return f(p.get("price"))


shares = []
for r in stocks_raw:
    ii, pi = r.get("instrument_info", {}), r.get("price_info", {})
    kr, hr = r.get("key_ratios_info", {}) or {}, r.get("historical_returns_info", {}) or {}
    ei = r.get("exchange_info", {}) or {}
    if not ii.get("symbol") or not ii.get("instrument_id"):
        continue
    country = ei.get("exchange_country") or "?"
    exch = (ei.get("exchanges") or [country])[0]
    shares.append(dict(
        id=ii["instrument_id"], sym=ii["symbol"], country=country, exch=exch,
        yt=yahoo_sym(ii["symbol"], country),
        name=(ii.get("long_name") or ii.get("name") or ii["symbol"]).title(),
        ccy=ii.get("currency", "?"), isin=ii.get("isin"),
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
        ccy=ii.get("currency", "?"), isin=ii.get("isin"),
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

no_shares = [s for s in shares if s["country"] == "NO"]
foreign = [s for s in shares if s["country"] != "NO" and s["yt"]
           and (s["owners"] or 0) >= FOREIGN_MIN_OWNERS]
foreign.sort(key=lambda s: s["owners"] or 0, reverse=True)
foreign = foreign[:FOREIGN_HIST_MAX]
print(f"history targets: {len(no_shares)} NO (daily) + {len(foreign)} foreign (monthly, most-owned)", file=sys.stderr)

# ---------------- 2. benchmark + Norwegian daily history ----------------
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

no_ts = [s["yt"] for s in no_shares] + [e["t"] for e in ETFS]
print(f"downloading 11y daily history for {len(no_ts)} NO tickers + ETFs...", file=sys.stderr)
hist = yf.download(no_ts, period="11y", interval="1d", auto_adjust=True, progress=False, threads=True)["Close"]
hist = hist.dropna(how="all")
hist["__BENCH__"] = bench_hist

monthly = hist.resample("ME").last()
mrets = monthly.pct_change().dropna(how="all").tail(120)
daily = hist.pct_change().tail(504)
bench_d = daily["__BENCH__"].dropna()
bench_m = mrets["__BENCH__"]

try:
    fx = float(np.asarray(yf.download("EURNOK=X", period="5d", interval="1d", progress=False)["Close"].dropna().iloc[-1]).reshape(-1)[0])
except Exception:
    fx = 11.5
print(f"EURNOK: {fx:.2f}", file=sys.stderr)

# foreign monthly history is fetched LATER (after .info calls for the model
# universe) so yfinance rate limits hit the bulk download, not the metadata
f_mrets = {}


def fetch_foreign_history():
    fmap = {s["yt"]: s for s in foreign}
    chunk = 400
    for i in range(0, len(foreign), chunk):
        ts = [s["yt"] for s in foreign[i:i + chunk]]
        print(f"  foreign monthly chunk {i // chunk + 1}/{(len(foreign) + chunk - 1) // chunk} ({len(ts)})", file=sys.stderr)
        try:
            h = None
            for attempt in range(2):
                h = yf.download(ts, period="10y", interval="1mo", auto_adjust=True, progress=False, threads=True)["Close"]
                got = 0 if h is None or h.empty else int(h.notna().any().sum())
                if got >= len(ts) * 0.5:
                    break
                print(f"  chunk thin ({got}/{len(ts)}) — backing off 90s and retrying", file=sys.stderr)
                time.sleep(90)
        except Exception as e:
            print(f"  chunk failed: {e}", file=sys.stderr)
            continue
        if h is None or h.empty:
            continue
        if not hasattr(h, "columns"):  # single series
            h = h.to_frame(name=ts[0])
        for t in h.columns:
            col = h[t].dropna()
            if len(col) < 13:
                continue
            s = fmap.get(t)
            if not s:
                continue
            last = float(col.iloc[-1])
            if last <= 0:
                continue
            if s["px"]:
                if abs(last / s["px"] - 1) > 0.15:
                    continue  # wrong listing / GBp scale / stale — no chart for this one
            else:
                # Nordnet hides last price for some foreign names anonymously — backfill from Yahoo
                s["px"] = round(last, 2)
                if s.get("chg") is None and isinstance(s["y"].get("yield_1d"), (int, float)):
                    s["chg"] = s["y"]["yield_1d"]
            rr = col.pct_change().dropna()
            f_mrets[t] = rr
        time.sleep(0.5)
    print(f"  validated foreign history: {len(f_mrets)}", file=sys.stderr)


def info_with_backoff(yt, tries=3):
    for k in range(tries):
        try:
            return yf.Ticker(yt).info or {}
        except Exception as e:
            if "Too Many Requests" in str(e) or "429" in str(e):
                wait = 60 * (k + 1)
                print(f"  429 on {yt} — backing off {wait}s", file=sys.stderr)
                time.sleep(wait)
            else:
                print(f"  info failed {yt}: {e}", file=sys.stderr)
                return {}
    return {}


def months_of(yt):
    if yt in mrets.columns:
        return int(mrets[yt].notna().sum())
    if yt in f_mrets:
        return int(min(120, len(f_mrets[yt])))
    return 0


def clean_ret(v):
    v = float(v)
    return round(v, 4) if math.isfinite(v) and abs(v) < 20 else 0.0


def rets_list(yt):
    if yt in mrets.columns:
        return [clean_ret(v) for v in mrets[yt].fillna(0.0).values]
    if yt in f_mrets:
        r = f_mrets[yt].tail(120)
        return [clean_ret(v) for v in r.values]
    return []


def hist_ann(yt):
    if yt in mrets.columns:
        r = mrets[yt].dropna()
    elif yt in f_mrets:
        r = f_mrets[yt].tail(120)
    else:
        return 0.0
    if len(r) < 12:
        return 0.0
    growth = float(np.prod(1 + r.values))
    return (growth ** (12 / len(r)) - 1) * 100


def stats_daily(yt):
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
    return dict(beta=round(beta, 2), vol=round(vol, 1), mom=round(mom, 1), src="2y daily")


def stats_monthly(yt):
    if yt not in f_mrets:
        return None
    r = f_mrets[yt].tail(36)
    if len(r) < 13:
        return None
    al = r.align(bench_m, join="inner")
    beta = float(np.cov(al[0], al[1])[0, 1] / np.var(al[1])) if len(al[0]) >= 12 else None
    vol = float(r.std() * math.sqrt(12) * 100)
    rr = f_mrets[yt]
    mom = float((np.prod(1 + rr.iloc[-13:-1].values) - 1) * 100) if len(rr) >= 13 else 0.0
    return dict(beta=round(beta, 2) if beta is not None else None,
                vol=round(vol, 1), mom=round(mom, 1), src="3y monthly")


# ---------------- 4. model universe (Oslo Bors, unchanged policy) ----------------
def sane(s):
    st = stats_daily(s["yt"])
    return st is not None and st["vol"] <= 80


eligible = [s for s in no_shares if s["px"] and months_of(s["yt"]) >= 36 and sane(s)]
eligible.sort(key=lambda s: s["turn"] or 0, reverse=True)
core = eligible[:MODEL_N]
core_ids = {s["id"] for s in core}
print(f"model universe: {len(core)} NO shares + {len(ETFS)} ETFs", file=sys.stderr)

print("fetching sector/mcap/quality for model universe (yfinance .info)...", file=sys.stderr)
U = []
for s in core:
    info = info_with_backoff(s["yt"])
    time.sleep(0.5)
    sector = info.get("sector") or "Oslo Børs"
    mcap = (info.get("marketCap") or 0) / 1e9
    roe = info.get("returnOnEquity")
    qual = max(0.05, min(1.0, roe if roe is not None else 0.5))
    st = stats_daily(s["yt"])
    capm = rf + st["beta"] * ERP
    h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(s["yt"])))
    er = W_CAPM * capm + W_HIST * h
    U.append(dict(t=s["yt"], nn=s["id"], name=s["name"], sector=sector, ccy=s["ccy"],
                  er=round(er, 1), vol=st["vol"], beta=st["beta"], mom=st["mom"],
                  pe=s["pe"] or 0, pb=s["pb"] or 0, div=s["div"] or 0,
                  mcap=round(mcap, 1), qual=round(qual, 2),
                  px=s["px"], chg=s["chg"] or 0, slug=s["slug"]))

for e in ETFS:
    st = stats_daily(e["t"])
    capm = rf + st["beta"] * ERP
    h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(e["t"])))
    info = info_with_backoff(e["t"])
    time.sleep(0.5)
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

# now the bulk foreign download (model-universe metadata is already secured)
fetch_foreign_history()

rets = {a["t"]: rets_list(a["t"]) for a in U}
rets["__BENCH__"] = rets_list("__BENCH__")
dates = [d.strftime("%Y-%m") for d in mrets.index]
asof = dt.date.today().isoformat()

data = dict(asof=asof, rf=round(rf, 2), erp=ERP, cash=CASH, bond=BOND,
            bench=bench, universe=U, dates=dates, rets=rets,
            counts=dict(shares=len(shares), funds=len(funds),
                        withHistory=len(no_ts) + len(f_mrets)))

# ---------------- 5. catalog (lazy search index) ----------------
catalog = []
for s in shares:
    catalog.append(dict(id=s["id"], sym=s["sym"], name=s["name"], type="EQ",
                        cat=f"Aksje · {s['exch']}", ccy=s["ccy"], px=s["px"], chg=s["chg"],
                        owners=s["owners"], inU=s["id"] in core_ids,
                        yt=s["yt"] if s["id"] in core_ids else None))
for fd in funds:
    catalog.append(dict(id=fd["id"], sym=None, name=fd["name"], type="FND",
                        cat=fd["cat"], ccy=fd["ccy"], px=fd["px"], chg=fd["chg"],
                        owners=fd["owners"], inU=False, yt=None))

# ---------------- 6. detail shards ----------------
sdir = ROOT / "data" / "s"
sdir.mkdir(parents=True, exist_ok=True)
shards = [dict() for _ in range(SHARDS)]
for s in shares:
    has_hist = months_of(s["yt"]) > 0 if s["yt"] else False
    st = stats_daily(s["yt"]) if s["country"] == "NO" else stats_monthly(s["yt"])
    det = dict(id=s["id"], sym=s["sym"], yt=s["yt"], name=s["name"], type="EQ",
               cat=f"Aksje · {s['exch']}", ccy=s["ccy"], isin=s["isin"], px=s["px"], chg=s["chg"],
               owners=s["owners"], slug=s["slug"], y=s["y"],
               ratios=dict(pe=s["pe"], pb=s["pb"], ps=s["ps"], div=s["div"]),
               stats=st, months=months_of(s["yt"]) if s["yt"] else 0,
               rets=rets_list(s["yt"]) if has_hist else [])
    shards[s["id"] % SHARDS][str(s["id"])] = det
for fd in funds:
    det = dict(id=fd["id"], name=fd["name"], type="FND", cat=fd["cat"], ccy=fd["ccy"],
               isin=fd["isin"], px=fd["px"], chg=fd["chg"], owners=fd["owners"],
               slug=fd["slug"], y=fd["y"], fund=fd["fund"])
    shards[fd["id"] % SHARDS][str(fd["id"])] = det
for i, sh in enumerate(shards):
    (sdir / f"{i}.json").write_text(json.dumps(sh, ensure_ascii=False, allow_nan=False), encoding="utf-8")

# remove the old per-instrument layout if present
old_dir = ROOT / "data" / "i"
if old_dir.exists():
    for p in old_dir.glob("*.json"):
        p.unlink()
    old_dir.rmdir()

# ---------------- 7. write JS/JSON modules ----------------
(ROOT / "assets" / "data.js").write_text(
    "/* data.js — model-universe snapshot (generated " + asof + ")\n"
    "   Source: Nordnet lists + Yahoo history + Norges Bank key rate.\n"
    "   Model universe = " + str(MODEL_N) + " most-traded Oslo Børs shares (>=36mo history, vol<=80%) + UCITS ETFs.\n"
    "   Expected returns: 0.55*CAPM-implied (rf + beta*ERP) + 0.45*trailing-10y (clipped). */\n"
    "window.MERIDIAN_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")

(ROOT / "assets" / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")

old_cat = ROOT / "assets" / "catalog.js"
if old_cat.exists():
    old_cat.unlink()

print(f"\nwrote assets/data.js ({len(U)} model assets), assets/catalog.json ({len(catalog)} instruments), "
      f"data/s/*.json ({SHARDS} shards, {len(shares) + len(funds)} instruments, {len(f_mrets)} foreign with history)", file=sys.stderr)

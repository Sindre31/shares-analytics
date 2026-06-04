#!/usr/bin/env python3
"""Import the full Nordnet catalog -> assets/data.js, assets/catalog.json, data/s/*.json

- ALL shares on Nordnet (~12,200) + ALL funds (~880) -> searchable catalog + detail shards.
- TWO model universes:
    oslo:   the 100 most-traded Oslo Bors shares (>=36mo history, vol<=80%) + UCITS ETFs,
            benchmark OBX
    global: the 60 most-owned foreign shares on Nordnet (same sanity filters) + UCITS ETFs,
            benchmark S&P 500 (^GSPC)
- Yahoo history: model-universe members + all NO shares daily 11y; other most-owned
  foreign shares monthly 10y (price-validated against Nordnet).
- Risk-free: Norges Bank key rate (NOK investor perspective for both universes).

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

OSLO_N = 100                   # most-traded Oslo Bors shares in the oslo universe
GLOBAL_N = 60                  # most-owned foreign shares in the global universe
GLOBAL_CAND = 140              # candidates to download daily history for
FOREIGN_HIST_MAX = 3000        # most-owned foreign shares to fetch monthly history for
FOREIGN_MIN_OWNERS = 30
SHARDS = 256
ERP = 5.0
W_CAPM, W_HIST = 0.55, 0.45
HIST_CLIP = (-5.0, 35.0)
MAX_VOL = 80.0

YSUF = {"NO": ".OL", "SE": ".ST", "DK": ".CO", "FI": ".HE", "DE": ".DE", "US": "",
        "CA": ".TO", "FR": ".PA", "NL": ".AS", "BE": ".BR", "IT": ".MI", "ES": ".MC",
        "PT": ".LS", "AT": ".VI", "CH": ".SW", "GB": ".L", "IE": ".IR"}

ETFS = [
    dict(t="EUNL.DE", name="iShares Core MSCI World (UCITS)",   sector="Global Equity", ccy="EUR", qual=0.64, pe=19.0, pb=3.2),
    dict(t="EUNH.DE", name="iShares Core EUR Govt Bond (UCITS)",sector="Fixed Income",  ccy="EUR", qual=0.70, pe=0,    pb=0),
    dict(t="XEON.DE", name="Xtrackers EUR Overnight (UCITS)",   sector="Cash",          ccy="EUR", qual=1.00, pe=0,    pb=0),
]
CASH, BOND = "XEON.DE", "EUNH.DE"
ETF_AUM_EUR = {"EUNL.DE": 95e9, "EUNH.DE": 5.5e9, "XEON.DE": 22e9}


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


def clean_ret(v):
    v = float(v)
    return round(v, 4) if math.isfinite(v) and abs(v) < 20 else 0.0


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


# ---------------- 1. Nordnet lists ----------------
print("fetching Nordnet stocklist (ALL countries)...", file=sys.stderr)
stocks_raw = page_all("stocklist")
print(f"  {len(stocks_raw)} shares", file=sys.stderr)

print("fetching Nordnet fundlist...", file=sys.stderr)
funds_raw = page_all("fundlist")
print(f"  {len(funds_raw)} funds", file=sys.stderr)

print("fetching Nordnet etflist...", file=sys.stderr)
etfs_raw = page_all("etflist")
print(f"  {len(etfs_raw)} ETFs", file=sys.stderr)

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

etfs = []
for r in etfs_raw:
    ii, pi = r.get("instrument_info", {}), r.get("price_info", {})
    fi, hr = r.get("fund_info", {}) or {}, r.get("historical_returns_info", {}) or {}
    ei = r.get("exchange_info", {}) or {}
    if not ii.get("symbol") or not ii.get("instrument_id"):
        continue
    country = ei.get("exchange_country") or "?"
    etfs.append(dict(
        id=ii["instrument_id"], sym=ii["symbol"], country=country,
        exch=(ei.get("exchanges") or [country])[0] or country,
        yt=yahoo_sym(ii["symbol"], country),
        name=(ii.get("long_name") or ii.get("name") or ii["symbol"]),
        ccy=ii.get("currency", "?"), isin=ii.get("isin"),
        px=price_of(r), chg=f(pi.get("diff_pct")) if pi.get("diff_pct") is not None else f(hr.get("yield_1d")),
        turn=f((pi.get("turnover_normalized") or 0), 0),
        pe=None, pb=None, ps=None, div=0,
        owners=(r.get("statistical_info") or {}).get("number_of_owners", 0),
        slug=(r.get("nnx_info") or {}).get("display_slug"),
        y={k: f(v, 1) for k, v in hr.items() if isinstance(v, (int, float))},
        cat=fi.get("fund_category") or fi.get("fund_type") or "ETF",
        fund=dict(ms=fi.get("fund_ms_rating"), fee=f(fi.get("fund_yearly_fee")),
                  calcFee=f(fi.get("fund_calculated_fee")), risk=fi.get("fund_raw_risk"),
                  riskGroup=fi.get("fund_risk_group"), aum=f((fi.get("fund_total_market_value") or 0) / 1e9, 2),
                  admin=fi.get("fund_branding_company") or fi.get("fund_admin_company"),
                  type=fi.get("fund_type"), sfdr=fi.get("fund_sfdr_article"),
                  esg=fi.get("fund_esg_score"), minInv=fi.get("fund_min_investment"),
                  selection=bool(fi.get("fund_nordnet_selection"))),
    ))

no_shares = [s for s in shares if s["country"] == "NO"]
foreign_all = [s for s in shares if s["country"] != "NO" and s["yt"]
               and (s["owners"] or 0) >= FOREIGN_MIN_OWNERS]
# ETFs join the monthly-history pipeline regardless of country (owners >= 10)
etf_hist_targets = [s for s in etfs if s["yt"] and (s["owners"] or 0) >= 10]
foreign_all.sort(key=lambda s: s["owners"] or 0, reverse=True)
g_cand = foreign_all[:GLOBAL_CAND]
g_cand_ts = [s["yt"] for s in g_cand]
foreign_rest = foreign_all[:FOREIGN_HIST_MAX]

# ---------------- 2. benchmarks + daily history (NO + global candidates + ETFs) ----------------
print("picking benchmarks...", file=sys.stderr)
bench_t, bench_hist = None, None
for c in ["OBX.OL", "^OSEAX", "OBXEDNB.OL"]:
    try:
        h = yf.download(c, period="11y", interval="1d", auto_adjust=True, progress=False)["Close"].dropna()
        if len(h) > 2000:
            bench_t, bench_hist = c, h.squeeze()
            print(f"  oslo benchmark: {c}", file=sys.stderr)
            break
    except Exception as e:
        print(f"  bench {c} failed: {e}", file=sys.stderr)
if bench_hist is None:
    raise SystemExit("no Oslo benchmark worked")

gbench_hist = yf.download("^GSPC", period="11y", interval="1d", auto_adjust=True, progress=False)["Close"].dropna().squeeze()
print(f"  global benchmark: ^GSPC ({len(gbench_hist)} obs)", file=sys.stderr)

daily_ts = [s["yt"] for s in no_shares] + g_cand_ts + [e["t"] for e in ETFS]
daily_ts = list(dict.fromkeys(daily_ts))
print(f"downloading 11y daily history for {len(daily_ts)} tickers...", file=sys.stderr)
hist = yf.download(daily_ts, period="11y", interval="1d", auto_adjust=True, progress=False, threads=True)["Close"]
hist = hist.dropna(how="all")
hist["__BENCH__"] = bench_hist
hist["__BENCHG__"] = gbench_hist

monthly = hist.resample("ME").last()
mrets = monthly.pct_change().dropna(how="all").tail(120)
daily = hist.pct_change().tail(504)
bench_d = daily["__BENCH__"].dropna()
gbench_d = daily["__BENCHG__"].dropna()
gbench_m = mrets["__BENCHG__"].dropna()

# FX -> NOK for market-cap comparability
fxmap = {"NOK": 1.0}
for ccy, pair in [("EUR", "EURNOK=X"), ("USD", "USDNOK=X"), ("SEK", "SEKNOK=X"), ("DKK", "DKKNOK=X"),
                  ("CAD", "CADNOK=X"), ("CHF", "CHFNOK=X"), ("GBP", "GBPNOK=X")]:
    try:
        fxmap[ccy] = float(np.asarray(yf.download(pair, period="5d", interval="1d", progress=False)["Close"].dropna().iloc[-1]).reshape(-1)[0])
    except Exception:
        fxmap[ccy] = {"EUR": 11.5, "USD": 10.5, "SEK": 1.05, "DKK": 1.55, "CAD": 7.6, "CHF": 12.8, "GBP": 13.4}[ccy]
print("FX:", {k: round(v, 2) for k, v in fxmap.items()}, file=sys.stderr)

f_mrets = {}


def months_of(yt):
    if yt in mrets.columns:
        return int(mrets[yt].notna().sum())
    if yt in f_mrets:
        return int(min(120, len(f_mrets[yt])))
    return 0


def rets_list(yt):
    if yt in mrets.columns:
        return [clean_ret(v) for v in mrets[yt].fillna(0.0).values]
    if yt in f_mrets:
        return [clean_ret(v) for v in f_mrets[yt].tail(120).values]
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
    # clamp glitchy returns (bad split adjustments can show < -100% months,
    # which would make the cumulative product negative -> complex root)
    vals = np.clip(r.values, -0.95, 20.0)
    growth = max(1e-9, float(np.prod(1 + vals)))
    return (growth ** (12 / len(vals)) - 1) * 100


def stats_daily(yt, bd=None):
    bd = bench_d if bd is None else bd
    d = hist[yt].dropna() if yt in hist.columns else None
    if d is None or len(d) < 60:
        return None
    dr = d.pct_change().tail(504).dropna()
    al = dr.align(bd, join="inner")
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
    vol = float(r.std() * math.sqrt(12) * 100)
    rr = f_mrets[yt]
    mom = float((np.prod(1 + rr.iloc[-13:-1].values) - 1) * 100) if len(rr) >= 13 else 0.0
    # beta vs the global benchmark — align by calendar month (yahoo 1mo rows are
    # month-start labelled, our resampled bench is month-end labelled)
    beta = None
    try:
        a = r.copy(); a.index = a.index.to_period("M")
        b = gbench_m.copy(); b.index = b.index.to_period("M")
        al = a.align(b, join="inner")
        if len(al[0]) >= 12 and float(np.var(al[1])) > 0:
            beta = round(float(np.cov(al[0], al[1])[0, 1] / np.var(al[1])), 2)
    except Exception:
        pass
    return dict(beta=beta, vol=round(vol, 1), mom=round(mom, 1), src="3y monthly")


def build_member(s, bd):
    """Universe member dict from a Nordnet share record (needs daily history)."""
    info = info_with_backoff(s["yt"])
    time.sleep(0.5)
    sector = info.get("sector") or s["exch"]
    mcap = (info.get("marketCap") or 0) / 1e9 * fxmap.get(s["ccy"], 1.0)
    roe = info.get("returnOnEquity")
    qual = max(0.05, min(1.0, roe if roe is not None else 0.5))
    st = stats_daily(s["yt"], bd)
    capm = rf + st["beta"] * ERP
    h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(s["yt"])))
    er = W_CAPM * capm + W_HIST * h
    px = s["px"]
    if not px and s["yt"] in hist.columns:
        px = round(float(hist[s["yt"]].dropna().iloc[-1]), 2)
    return dict(t=s["yt"], nn=s["id"], name=s["name"], sector=sector, ccy=s["ccy"],
                er=round(er, 1), vol=st["vol"], beta=st["beta"], mom=st["mom"],
                pe=s["pe"] or 0, pb=s["pb"] or 0, div=s["div"] or 0,
                mcap=round(mcap, 1), qual=round(qual, 2),
                px=px, chg=s["chg"] if s["chg"] is not None else 0, slug=s["slug"])


def etf_members(bd):
    out = []
    for e in ETFS:
        st = stats_daily(e["t"], bd)
        capm = rf + st["beta"] * ERP
        h = max(HIST_CLIP[0], min(HIST_CLIP[1], hist_ann(e["t"])))
        info = info_with_backoff(e["t"])
        time.sleep(0.5)
        aum = ((info.get("totalAssets") or ETF_AUM_EUR.get(e["t"], 0)) / 1e9) * fxmap["EUR"]
        dy = info.get("dividendYield") or 0
        if dy and dy < 0.25:
            dy *= 100
        out.append(dict(t=e["t"], nn=None, name=e["name"], sector=e["sector"], ccy=e["ccy"],
                        er=round(W_CAPM * capm + W_HIST * h, 1), vol=st["vol"], beta=st["beta"], mom=st["mom"],
                        pe=e["pe"], pb=e["pb"], div=round(dy, 2), mcap=round(aum, 1), qual=e["qual"],
                        px=round(float(hist[e["t"]].dropna().iloc[-1]), 2),
                        chg=round(float(hist[e["t"]].dropna().iloc[-1] / hist[e["t"]].dropna().iloc[-2] - 1) * 100, 2),
                        slug=None))
    return out


def sane_daily(s, bd):
    st = stats_daily(s["yt"], bd)
    return st is not None and st["vol"] <= MAX_VOL


# ---------------- 3. OSLO universe ----------------
eligible = [s for s in no_shares if months_of(s["yt"]) >= 36 and sane_daily(s, bench_d)]
eligible.sort(key=lambda s: s["turn"] or 0, reverse=True)
oslo_core = eligible[:OSLO_N]
print(f"oslo universe: {len(oslo_core)} shares (pool {len(eligible)}) + {len(ETFS)} ETFs", file=sys.stderr)
print("fetching .info for oslo universe...", file=sys.stderr)
U_oslo = [build_member(s, bench_d) for s in oslo_core]

# ---------------- 4. GLOBAL universe ----------------
g_eligible = [s for s in g_cand if months_of(s["yt"]) >= 36 and sane_daily(s, gbench_d)]
g_eligible.sort(key=lambda s: s["owners"] or 0, reverse=True)
global_core = g_eligible[:GLOBAL_N]
print(f"global universe: {len(global_core)} shares (pool {len(g_eligible)}) + {len(ETFS)} ETFs", file=sys.stderr)
print("fetching .info for global universe...", file=sys.stderr)
U_global = [build_member(s, gbench_d) for s in global_core]

print("fetching .info for ETFs...", file=sys.stderr)
U_oslo += etf_members(bench_d)
U_global += etf_members(gbench_d)

core_ids = {s["id"]: "oslo" for s in oslo_core}
core_ids.update({s["id"]: "global" for s in global_core})

# ---------------- 5. remaining foreign monthly history ----------------
def fetch_foreign_history():
    targets = [s for s in foreign_rest + etf_hist_targets if s["yt"] not in mrets.columns]
    fmap = {s["yt"]: s for s in targets}
    chunk = 400
    for i in range(0, len(targets), chunk):
        ts = [s["yt"] for s in targets[i:i + chunk]]
        print(f"  foreign monthly chunk {i // chunk + 1}/{(len(targets) + chunk - 1) // chunk} ({len(ts)})", file=sys.stderr)
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
        if not hasattr(h, "columns"):
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
                    continue  # wrong listing / GBp scale / stale
            else:
                s["px"] = round(last, 2)  # Nordnet hides price for some foreign names anonymously
                if s.get("chg") is None and isinstance(s["y"].get("yield_1d"), (int, float)):
                    s["chg"] = s["y"]["yield_1d"]
            f_mrets[t] = col.pct_change().dropna()
        time.sleep(0.5)
    print(f"  validated foreign monthly history: {len(f_mrets)}", file=sys.stderr)


fetch_foreign_history()

# ---- fund NAV history: Yahoo lookup by ISIN for the most-owned funds ----
FUND_HIST_MAX = 250
fund_rets = {}   # fund id -> list of monthly returns
fund_stats = {}  # fund id -> stats dict


def fetch_fund_history():
    cand = sorted([fd for fd in funds if fd["isin"] and (fd["px"] or 0) > 0],
                  key=lambda x: x["owners"] or 0, reverse=True)[:FUND_HIST_MAX]
    print(f"fund history: looking up {len(cand)} ISINs on Yahoo...", file=sys.stderr)
    sym_of = {}
    for k, fd in enumerate(cand):
        try:
            qs = yf.Search(fd["isin"], max_results=1).quotes
            if qs and qs[0].get("symbol"):
                sym_of[fd["id"]] = qs[0]["symbol"]
        except Exception as e:
            if "429" in str(e) or "Too Many" in str(e):
                print("  429 on ISIN search — backing off 60s", file=sys.stderr)
                time.sleep(60)
        time.sleep(0.25)
        if k % 50 == 49:
            print(f"  ...{k + 1}/{len(cand)} ({len(sym_of)} resolved)", file=sys.stderr)
    print(f"  resolved {len(sym_of)} symbols; downloading monthly NAVs...", file=sys.stderr)
    ids = list(sym_of.keys())
    fd_by_id = {fd["id"]: fd for fd in cand}
    chunk = 50
    for i in range(0, len(ids), chunk):
        part = ids[i:i + chunk]
        ts = [sym_of[j] for j in part]
        try:
            h = yf.download(ts, period="10y", interval="1mo", auto_adjust=True, progress=False, threads=True)["Close"]
        except Exception as e:
            print(f"  fund chunk failed: {e}", file=sys.stderr)
            continue
        if h is None or h.empty:
            continue
        if not hasattr(h, "columns"):
            h = h.to_frame(name=ts[0])
        for j in part:
            t = sym_of[j]
            if t not in h.columns:
                continue
            col = h[t].dropna()
            fd = fd_by_id[j]
            if len(col) < 13:
                continue
            last = float(col.iloc[-1])
            if last <= 0 or abs(last / fd["px"] - 1) > 0.15:
                continue  # wrong share class / ccy mismatch
            rr = col.pct_change().dropna().tail(120)
            vals = [clean_ret(v) for v in rr.values]
            if len(vals) < 13:
                continue
            fund_rets[j] = vals
            r36 = np.array(vals[-36:])
            momv = float(np.prod(1 + np.array(vals[-13:-1])) - 1) * 100
            fund_stats[j] = dict(beta=None, vol=round(float(r36.std() * math.sqrt(12) * 100), 1),
                                 mom=round(momv, 1), src="NAV monthly (Yahoo)")
        time.sleep(1)
    print(f"  fund NAV history: {len(fund_rets)} funds", file=sys.stderr)


fetch_fund_history()

# backfill hidden Nordnet prices for any share covered by the daily batch
for _s in shares:
    if not (_s["px"] or 0) and _s["yt"] and _s["yt"] in hist.columns:
        _col = hist[_s["yt"]].dropna()
        if len(_col):
            _s["px"] = round(float(_col.iloc[-1]), 2)
            if _s.get("chg") is None and len(_col) > 1:
                _s["chg"] = round(float(_col.iloc[-1] / _col.iloc[-2] - 1) * 100, 2)


def bench_block(code, ticker_col, source, name, bd):
    bvol = float(bd.std() * math.sqrt(252) * 100)
    bcl = hist[ticker_col].dropna()
    return dict(code=code, ticker=ticker_col, source=source, name=name,
                er=round(W_CAPM * (rf + ERP) + W_HIST * min(HIST_CLIP[1], hist_ann(ticker_col)), 1),
                vol=round(bvol, 1), px=round(float(bcl.iloc[-1]), 2),
                chg=round(float(bcl.iloc[-1] / bcl.iloc[-2] - 1) * 100, 2))


def universe_block(U, bench):
    rr = {a["t"]: rets_list(a["t"]) for a in U}
    rr[bench["ticker"]] = rets_list(bench["ticker"])
    return dict(universe=U, bench=bench, rets=rr)


asof = dt.date.today().isoformat()
dates = [d.strftime("%Y-%m") for d in mrets.index]
data = dict(asof=asof, rf=round(rf, 2), erp=ERP, cash=CASH, bond=BOND, dates=dates,
            fx={k: round(v, 4) for k, v in fxmap.items()},
            universes=dict(
                oslo=universe_block(U_oslo, bench_block("OBX", "__BENCH__", bench_t, "Oslo Børs OBX", bench_d)),
                global_=None,  # placeholder replaced below (json key 'global')
            ),
            counts=dict(shares=len(shares), funds=len(funds), etfs=len(etfs), withHistory=0))
data["universes"]["global"] = universe_block(U_global, bench_block("SPX", "__BENCHG__", "^GSPC", "S&P 500", gbench_d))
del data["universes"]["global_"]

# ---------------- 6. catalog ----------------
catalog = []
for s in shares:
    inu = core_ids.get(s["id"])
    catalog.append(dict(id=s["id"], sym=s["sym"], name=s["name"], type="EQ",
                        cat=f"Aksje · {s['exch']}", ccy=s["ccy"], px=s["px"], chg=s["chg"],
                        owners=s["owners"], inU=inu, yt=s["yt"] if inu else None,
                        isin=s["isin"]))
for fd in funds:
    catalog.append(dict(id=fd["id"], sym=None, name=fd["name"], type="FND",
                        cat=fd["cat"], ccy=fd["ccy"], px=fd["px"], chg=fd["chg"],
                        owners=fd["owners"], inU=None, yt=None, isin=fd["isin"]))
for e in etfs:
    catalog.append(dict(id=e["id"], sym=e["sym"], name=e["name"], type="ETF",
                        cat=f"ETF · {e['cat']}", ccy=e["ccy"], px=e["px"], chg=e["chg"],
                        owners=e["owners"], inU=None, yt=None, isin=e["isin"]))

# ---------------- 7. detail shards ----------------
sdir = ROOT / "data" / "s"
sdir.mkdir(parents=True, exist_ok=True)
shard_data = [dict() for _ in range(SHARDS)]
with_hist = 0
for s in shares:
    has_hist = months_of(s["yt"]) > 0 if s["yt"] else False
    if has_hist:
        with_hist += 1
    st = stats_daily(s["yt"]) if (s["yt"] in hist.columns) else stats_monthly(s["yt"])
    det = dict(id=s["id"], sym=s["sym"], yt=s["yt"], name=s["name"], type="EQ",
               cat=f"Aksje · {s['exch']}", ccy=s["ccy"], isin=s["isin"], px=s["px"], chg=s["chg"],
               owners=s["owners"], slug=s["slug"], y=s["y"],
               ratios=dict(pe=s["pe"], pb=s["pb"], ps=s["ps"], div=s["div"]),
               stats=st, months=months_of(s["yt"]) if s["yt"] else 0,
               rets=rets_list(s["yt"]) if has_hist else [], inU=core_ids.get(s["id"]))
    shard_data[s["id"] % SHARDS][str(s["id"])] = det
for fd in funds:
    det = dict(id=fd["id"], name=fd["name"], type="FND", cat=fd["cat"], ccy=fd["ccy"],
               isin=fd["isin"], px=fd["px"], chg=fd["chg"], owners=fd["owners"],
               slug=fd["slug"], y=fd["y"], fund=fd["fund"])
    if fd["id"] in fund_rets:
        det["rets"] = fund_rets[fd["id"]]
        det["months"] = len(fund_rets[fd["id"]])
        det["stats"] = fund_stats.get(fd["id"])
        with_hist += 1
    shard_data[fd["id"] % SHARDS][str(fd["id"])] = det
for e in etfs:
    has_hist = months_of(e["yt"]) > 0 if e["yt"] else False
    if has_hist:
        with_hist += 1
    det = dict(id=e["id"], sym=e["sym"], yt=e["yt"], name=e["name"], type="ETF",
               cat=f"ETF · {e['cat']}", ccy=e["ccy"], isin=e["isin"], px=e["px"], chg=e["chg"],
               owners=e["owners"], slug=e["slug"], y=e["y"], fund=e["fund"],
               ratios=dict(pe=None, pb=None, ps=None, div=0),
               stats=stats_monthly(e["yt"]) if e["yt"] else None,
               months=months_of(e["yt"]) if e["yt"] else 0,
               rets=rets_list(e["yt"]) if has_hist else [])
    shard_data[e["id"] % SHARDS][str(e["id"])] = det
for i, sh in enumerate(shard_data):
    (sdir / f"{i}.json").write_text(json.dumps(sh, ensure_ascii=False, allow_nan=False), encoding="utf-8")

data["counts"]["withHistory"] = with_hist

# ---------------- 8. write modules ----------------
(ROOT / "assets" / "data.js").write_text(
    "/* data.js — dual model-universe snapshot (generated " + asof + ")\n"
    "   oslo: " + str(OSLO_N) + " most-traded Oslo Børs shares + UCITS ETFs, benchmark OBX.\n"
    "   global: " + str(GLOBAL_N) + " most-owned foreign shares on Nordnet + UCITS ETFs, benchmark S&P 500.\n"
    "   Expected returns: 0.55*CAPM-implied (rf + beta*ERP) + 0.45*trailing-10y (clipped). */\n"
    "window.MERIDIAN_DATA = " + json.dumps(data, ensure_ascii=False, allow_nan=False) + ";\n", encoding="utf-8")

(ROOT / "assets" / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, allow_nan=False), encoding="utf-8")

print(f"\nwrote assets/data.js (oslo {len(U_oslo)} + global {len(U_global)}), "
      f"assets/catalog.json ({len(catalog)}), data/s/*.json ({with_hist} with history)", file=sys.stderr)

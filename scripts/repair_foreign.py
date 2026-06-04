#!/usr/bin/env python3
"""Repair pass for detail shards:
1. Replace non-finite monthly returns (Infinity/NaN from zero-price months) with 0.
2. Fetch monthly history for most-owned foreign shares that missed it during
   the main import (rate-limited chunks), price-validated, with backoff.
3. Update counts.withHistory in assets/data.js.
"""
import json, math, re, sys, time
from pathlib import Path
import numpy as np
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
SHARDS = 256
sdir = ROOT / "data" / "s"

shards = {}
for i in range(SHARDS):
    shards[i] = json.loads((sdir / f"{i}.json").read_text(encoding="utf-8"))  # py json accepts Infinity

# ---- 1. clean non-finite rets ----
cleaned = 0
for sh in shards.values():
    for d in sh.values():
        rr = d.get("rets")
        if not rr:
            continue
        for k, v in enumerate(rr):
            if v is None or not math.isfinite(v) or abs(v) >= 20:
                rr[k] = 0.0
                cleaned += 1
print(f"cleaned {cleaned} non-finite return values", file=sys.stderr)

# ---- 2. missing foreign history ----
targets = []
for sh in shards.values():
    for d in sh.values():
        if (d.get("type") == "EQ" and d.get("yt") and not d.get("rets")
                and "Oslo" not in (d.get("cat") or "") and (d.get("owners") or 0) >= 30
                and (d.get("px") or 0) > 0):
            targets.append(d)
targets.sort(key=lambda d: d.get("owners") or 0, reverse=True)
targets = targets[:2500]
print(f"fetching history for {len(targets)} foreign shares missing it", file=sys.stderr)

byyt = {d["yt"]: d for d in targets}
fixed = 0
chunk = 300
for i in range(0, len(targets), chunk):
    ts = [d["yt"] for d in targets[i:i + chunk]]
    print(f"  chunk {i // chunk + 1}/{(len(targets) + chunk - 1) // chunk}", file=sys.stderr)
    h = None
    for attempt in range(3):
        try:
            h = yf.download(ts, period="10y", interval="1mo", auto_adjust=True, progress=False, threads=True)["Close"]
        except Exception as e:
            print(f"   error: {e}", file=sys.stderr)
            h = None
        got = 0 if h is None or h.empty else int(h.notna().any().sum())
        if got >= len(ts) * 0.5:
            break
        print(f"   thin ({got}/{len(ts)}) — backoff 90s", file=sys.stderr)
        time.sleep(90)
    if h is None or h.empty:
        continue
    if not hasattr(h, "columns"):
        h = h.to_frame(name=ts[0])
    for t in h.columns:
        col = h[t].dropna()
        d = byyt.get(t)
        if d is None or len(col) < 13:
            continue
        last = float(col.iloc[-1])
        if last <= 0 or abs(last / d["px"] - 1) > 0.15:
            continue
        rr = col.pct_change().dropna().tail(120)
        vals = [round(float(v), 4) if math.isfinite(v) and abs(v) < 20 else 0.0 for v in rr.values]
        if len(vals) < 13:
            continue
        d["rets"] = vals
        d["months"] = len(vals)
        r36 = np.array(vals[-36:])
        mom = float(np.prod(1 + np.array(vals[-13:-1])) - 1) * 100
        d["stats"] = dict(beta=None, vol=round(float(r36.std() * math.sqrt(12) * 100), 1),
                          mom=round(mom, 1), src="3y monthly")
        fixed += 1
    time.sleep(3)
print(f"added history for {fixed} shares", file=sys.stderr)

# ---- 3. write back ----
for i, sh in shards.items():
    (sdir / f"{i}.json").write_text(json.dumps(sh, ensure_ascii=False, allow_nan=False), encoding="utf-8")

with_hist = sum(1 for sh in shards.values() for d in sh.values() if d.get("rets"))
dpath = ROOT / "assets" / "data.js"
src = dpath.read_text(encoding="utf-8")
m = re.search(r"window\.MERIDIAN_DATA = (.*);\n$", src, re.S)
data = json.loads(m.group(1))
data["counts"]["withHistory"] = with_hist
dpath.write_text(src[:m.start(1)] + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"done — instruments with history: {with_hist}", file=sys.stderr)

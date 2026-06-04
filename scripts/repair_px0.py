#!/usr/bin/env python3
"""Repair pass: foreign shares where Nordnet hides the price from anonymous
API users (px=0) — fetch Yahoo monthly history, backfill px from Yahoo's last
close, chg from Nordnet's yield_1d. Updates shards + catalog.json + counts."""
import json, math, re, sys, time
from pathlib import Path
import numpy as np
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
SHARDS = 256
sdir = ROOT / "data" / "s"

shards = {i: json.loads((sdir / f"{i}.json").read_text(encoding="utf-8")) for i in range(SHARDS)}

targets = []
for sh in shards.values():
    for d in sh.values():
        if (d.get("type") == "EQ" and d.get("yt") and not (d.get("px") or 0)
                and not d.get("rets") and (d.get("owners") or 0) >= 30):
            targets.append(d)
targets.sort(key=lambda d: d.get("owners") or 0, reverse=True)
targets = targets[:2000]
print(f"px=0 targets: {len(targets)}", file=sys.stderr)

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
        if got >= len(ts) * 0.4:
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
        if last <= 0:
            continue
        rr = col.pct_change().dropna().tail(120)
        vals = [round(float(v), 4) if math.isfinite(v) and abs(v) < 20 else 0.0 for v in rr.values]
        if len(vals) < 13:
            continue
        d["px"] = round(last, 2)
        if d.get("chg") is None and isinstance((d.get("y") or {}).get("yield_1d"), (int, float)):
            d["chg"] = d["y"]["yield_1d"]
        d["rets"] = vals
        d["months"] = len(vals)
        r36 = np.array(vals[-36:])
        mom = float(np.prod(1 + np.array(vals[-13:-1])) - 1) * 100
        d["stats"] = dict(beta=None, vol=round(float(r36.std() * math.sqrt(12) * 100), 1),
                          mom=round(mom, 1), src="3y monthly")
        fixed += 1
    time.sleep(3)
print(f"backfilled {fixed} shares", file=sys.stderr)

for i, sh in shards.items():
    (sdir / f"{i}.json").write_text(json.dumps(sh, ensure_ascii=False, allow_nan=False), encoding="utf-8")

# sync catalog px/chg
cpath = ROOT / "assets" / "catalog.json"
cat = json.loads(cpath.read_text(encoding="utf-8"))
det = {d["id"]: d for sh in shards.values() for d in sh.values()}
for c in cat:
    d = det.get(c["id"])
    if d and (d.get("px") or 0) and not (c.get("px") or 0):
        c["px"], c["chg"] = d["px"], d.get("chg")
cpath.write_text(json.dumps(cat, ensure_ascii=False, allow_nan=False), encoding="utf-8")

with_hist = sum(1 for sh in shards.values() for d in sh.values() if d.get("rets"))
dpath = ROOT / "assets" / "data.js"
src = dpath.read_text(encoding="utf-8")
m = re.search(r"window\.MERIDIAN_DATA = (.*);\n$", src, re.S)
data = json.loads(m.group(1))
data["counts"]["withHistory"] = with_hist
dpath.write_text(src[:m.start(1)] + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"done — instruments with history: {with_hist}", file=sys.stderr)

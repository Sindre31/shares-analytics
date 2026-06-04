#!/usr/bin/env python3
"""Repair pass: refetch yfinance .info (sector/mcap/ROE) for model-universe
entries that were rate-limited during the main import, then rewrite data.js.
Patient: 2s between calls, 90s backoff on 429, up to 4 rounds."""
import json, re, sys, time
from pathlib import Path
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
path = ROOT / "assets" / "data.js"
src = path.read_text(encoding="utf-8")
m = re.search(r"window\.MERIDIAN_DATA = (.*);\n$", src, re.S)
data = json.loads(m.group(1))

damaged = [a for a in data["universe"] if a.get("nn") and (not a.get("mcap") or a.get("sector") == "Oslo Børs")]
print(f"repairing {len(damaged)} entries", file=sys.stderr)

for rnd in range(4):
    still = [a for a in damaged if not a.get("mcap") or a.get("sector") == "Oslo Børs"]
    if not still:
        break
    print(f"round {rnd + 1}: {len(still)} remaining", file=sys.stderr)
    for a in still:
        try:
            info = yf.Ticker(a["t"]).info or {}
        except Exception as e:
            if "Too Many Requests" in str(e) or "429" in str(e):
                print("  429 — backing off 90s", file=sys.stderr)
                time.sleep(90)
                continue
            print(f"  {a['t']}: {e}", file=sys.stderr)
            time.sleep(2)
            continue
        sector = info.get("sector")
        mcap = (info.get("marketCap") or 0) / 1e9
        roe = info.get("returnOnEquity")
        if sector:
            a["sector"] = sector
        if mcap:
            a["mcap"] = round(mcap, 1)
        if roe is not None:
            a["qual"] = round(max(0.05, min(1.0, roe)), 2)
        print(f"  {a['t']}: {a['sector']} mcap={a['mcap']} qual={a['qual']}", file=sys.stderr)
        time.sleep(2)

left = [a["t"] for a in data["universe"] if a.get("nn") and (not a.get("mcap") or a.get("sector") == "Oslo Børs")]
header = src[:m.start(1)]
path.write_text(header + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"done — unrepaired: {left or 'none'}", file=sys.stderr)

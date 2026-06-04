#!/usr/bin/env python3
"""Quality gate for generated data — exits non-zero if the snapshot looks broken,
so the nightly workflow refuses to commit/deploy it.

Checks:
  - assets/data.js parses; both universes present with sane sizes & benchmarks
  - returns series exist and are finite
  - assets/catalog.json parses (strict — no Infinity/NaN) with sane size
  - all 256 shards parse strictly; coverage of instruments with history above floor
"""
import json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors = []


def err(msg):
    errors.append(msg)
    print("FAIL:", msg, file=sys.stderr)


def strict_parse(text, name):
    def reject(x):
        raise ValueError(f"{name}: non-finite constant {x}")
    return json.loads(text, parse_constant=reject)


# ---- data.js ----
try:
    src = (ROOT / "assets" / "data.js").read_text(encoding="utf-8")
    m = re.search(r"window\.MERIDIAN_DATA = (.*);\n$", src, re.S)
    data = strict_parse(m.group(1), "data.js")
    for key, floor in (("oslo", 80), ("global", 50)):
        u = data["universes"].get(key)
        if not u:
            err(f"universe '{key}' missing")
            continue
        n = len(u.get("universe", []))
        if n < floor:
            err(f"universe '{key}' too small: {n} < {floor}")
        b = u.get("bench") or {}
        if not b.get("code") or not (b.get("px") or 0) > 0:
            err(f"universe '{key}' benchmark broken: {b}")
        rr = u.get("rets") or {}
        for a in u.get("universe", []):
            series = rr.get(a["t"])
            if not series or len(series) < 36:
                err(f"{key}: missing/short returns for {a['t']}")
                break
            if any(v is None or not math.isfinite(v) for v in series):
                err(f"{key}: non-finite return in {a['t']}")
                break
    if (data.get("counts") or {}).get("withHistory", 0) < 2500:
        err(f"withHistory too low: {data['counts'].get('withHistory')}")
    if data.get("rf") is None or not (0 <= data["rf"] <= 15):
        err(f"implausible rf: {data.get('rf')}")
except Exception as e:
    err(f"data.js unreadable: {e}")

# ---- catalog ----
try:
    cat = strict_parse((ROOT / "assets" / "catalog.json").read_text(encoding="utf-8"), "catalog")
    if len(cat) < 10000:
        err(f"catalog too small: {len(cat)}")
    if sum(1 for c in cat if (c.get("px") or 0) > 0) < len(cat) * 0.5:
        err("less than half the catalog has prices")
except Exception as e:
    err(f"catalog.json unreadable: {e}")

# ---- shards ----
shard_total = 0
for i in range(256):
    try:
        sh = strict_parse((ROOT / "data" / "s" / f"{i}.json").read_text(encoding="utf-8"), f"shard {i}")
        shard_total += len(sh)
    except Exception as e:
        err(f"shard {i} broken: {e}")
if shard_total < 10000:
    err(f"shards cover too few instruments: {shard_total}")

if errors:
    print(f"\nvalidation FAILED with {len(errors)} error(s)", file=sys.stderr)
    sys.exit(1)
print(f"validation OK — {shard_total} instruments, withHistory={data['counts']['withHistory']}, "
      f"oslo={len(data['universes']['oslo']['universe'])}, global={len(data['universes']['global']['universe'])}",
      file=sys.stderr)

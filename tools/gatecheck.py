import json
import os

from PIL import Image

base = "/home/ilham/makefun-work/radar/entry"
X = "/home/ilham/makefun-work/radar/kit/token-radar-01-kit/input/snapshot.json"
snap = json.load(open(X))
slugs = {p["slug"] for p in snap["protocols"]}
wl = set(snap["watchlist"])

ok = True
for n in sorted(os.listdir(base + "/screenshots")):
    p = os.path.join(base, "screenshots", n)
    im = Image.open(p)
    size = os.path.getsize(p)
    long_ok = max(im.size) <= 1440
    short_ok = min(im.size) >= 800
    size_ok = size <= 524288
    print("SHOT %-12s %s long<=1440:%s short>=800:%s <=512KiB:%s" % (n, im.size, long_ok, short_ok, size_ok))
    ok = ok and long_ok and short_ok and size_ok

print("screenshots count:", len(os.listdir(base + "/screenshots")), "(3-4 needed)")
print()

b = json.load(open(base + "/out/board.json"))
rows = b["rows"]
checks = {
    "rows 100..4000": 100 <= len(rows) <= 4000,
    "ranks 1..N": sorted(r["rank"] for r in rows) == list(range(1, len(rows) + 1)),
    "implied desc": all(rows[i]["implied_value_usd"] >= rows[i + 1]["implied_value_usd"] for i in range(len(rows) - 1)),
    "positive int": all(isinstance(r["implied_value_usd"], int) and r["implied_value_usd"] > 0 for r in rows),
    "not all equal": len({r["implied_value_usd"] for r in rows}) > 1,
    "farm 3..12 x 20..600": all(3 <= len(r["farm_steps"]) <= 12 and all(20 <= len(s.strip()) <= 600 for s in r["farm_steps"]) for r in rows),
    "slugs real": all(r["slug"] in slugs for r in rows),
    "watchlist covered": wl <= {r["slug"] for r in rows},
    "has >=100 rows": len(rows) >= 100,
}
for k, v in checks.items():
    print("BOARD %-22s %s" % (k, v))
    ok = ok and v

d = os.path.getsize(base + "/out/dossier.json")
print("DOSSIER bytes", d, "<=1.5MiB", d <= 1_572_864)
ok = ok and d <= 1_572_864

# no network address in the dashboard
import re
bad = 0
for root, _dd, fs in os.walk(base + "/out/dashboard"):
    for f in fs:
        if re.search(r"https?://", open(os.path.join(root, f), encoding="utf-8", errors="ignore").read()):
            bad += 1
print("DASH no-http files violating:", bad)
ok = ok and bad == 0

print("\nALL GATE ROWS:", "PASS" if ok else "FAIL")

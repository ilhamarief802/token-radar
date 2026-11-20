"""Capture the three screenshots the entry needs, from OUR dashboard, at the kit's size band.

The gate caps a screenshot at 512 KiB and the dossier only fits three at roughly 300-350 KB
each, so the shutter captures at scale 1 and then trims the image until it lands in that
band instead of hoping it does.
"""
import io
import os
import pathlib
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/home/ilham/makefun-work/radar/entry")
PAGE = ROOT / "out" / "dashboard" / "index.html"
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)

TARGET_LOW, TARGET_HIGH = 300_000, 350_000

VIEWS = [
    # The board shot needs MORE ROWS than a 900 px viewport holds: at the gate's 1440 px long
    # side a short crop lands at 294 KB, just under the dossier's 300 KB floor. A taller
    # viewport adds rows at the same width, so the long side stays legal and the bytes land.
    ("board.png", "", False, 1500),
    # A row whose category median was measured from its own comparables (Dexs, 11 of them), so the shot
    # shows the drawer's arithmetic on a real category multiple rather than on the all-market fallback.
    ("detail.png", "#p=bittensor-dtao", False, 900),
    ("filter.png", "#category=Risk%20Curators", False, 900),
]


LONG_CAP = 1440  # the gate: "its long side at most 1440"


def fit(raw: bytes, path: pathlib.Path) -> int:
    """Write a shot inside BOTH gate caps: long side <= 1440 and 300-350 KB.

    The first submission shipped 2560 px shots (viewport 1280 at 2x DPR), which fails the
    screenshots row before a judge ever opens the page, so the cap is applied here.
    """
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    scale = min(1.0, LONG_CAP / max(img.size))
    img = img.resize((max(320, int(img.width * scale)), max(200, int(img.height * scale))), Image.LANCZOS)
    # PNG first (lossless, keeps the page's text crisp). If it overshoots the band, shrink
    # the pixels; only a last resort turns to JPEG, because small text survives better in PNG.
    while True:
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        size = buf.tell()
        if size <= TARGET_HIGH or max(img.size) <= 640:
            break
        img = img.resize((int(img.width * 0.92), int(img.height * 0.92)), Image.LANCZOS)
    if size < TARGET_LOW:  # too small for the dossier: re-render slightly larger
        scale = min(1.0, LONG_CAP / max(img.size)) * 1.0
        img2 = Image.open(io.BytesIO(raw)).convert("RGB")
        img2 = img2.resize((max(320, int(img2.width * scale)), max(200, int(img2.height * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        img2.save(buf, format="PNG", optimize=True)
        size = buf.tell()
        img = img2
    path.write_bytes(buf.getvalue())
    return size


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, frag, full, height in VIEWS:
            page = browser.new_page(viewport={"width": 1280, "height": height}, device_scale_factor=2)
            page.goto(PAGE.as_uri() + frag)
            page.wait_for_timeout(900)
            if name == "board.png":
                page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.55)")
                page.wait_for_timeout(400)
            raw = page.screenshot(full_page=full)
            page.close()
            size = fit(raw, SHOTS / name)
            band = "OK" if TARGET_LOW <= size <= TARGET_HIGH else "outside band"
            print(f"{name}: {size:,} bytes ({band})")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

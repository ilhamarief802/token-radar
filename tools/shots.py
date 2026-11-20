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

TARGET_LOW, TARGET_HIGH = 210_000, 250_000

VIEWS = [
    # The board shot needs MORE ROWS than a 900 px viewport holds: at the gate's 1440 px long
    # side a short crop lands at 294 KB, just under the dossier's 300 KB floor. A taller
    # viewport adds rows at the same width, so the long side stays legal and the bytes land.
    ("board.png", "", False, 1500),
    # A row whose category median was measured from its own comparables (Dexs, 11 of them), so the shot
    # shows the drawer's arithmetic on a real category multiple rather than on the all-market fallback.
    ("detail.png", "#p=bittensor-dtao", False, 1250),
    ("filter.png", "#category=Risk%20Curators", False, 1000),
]


LONG_CAP = 1440   # gate: "its long side at most 1440"
SHORT_MIN = 800   # gate: "and its short side at least 800 pixels"  <- this one failed twice


def fit(raw: bytes, path: pathlib.Path) -> int:
    """Write a shot inside the gate's geometric caps and the dossier's byte band.

    Both caps are hard and independent: the long side must be <= 1440, the SHORT side
    >= 800. Shrinking a 1208x849 page to fit the 300-350 KB band pushed the short side
    to 724 and the gate refused the entry before a judge ever saw it. So: dimensions are
    set once (long side to the cap, short side never under the floor), then the BYTE size
    is tuned by compression quality alone -- JPEG keeps the pixels, PNG does not.
    """
    im = Image.open(io.BytesIO(raw)).convert("RGB")

    # Step 1: geometry. Scale to the long cap, but never let the short side fall below the
    # floor; if the raw page is too small in one axis, grow it instead.
    scale = min(1.0, LONG_CAP / max(im.size))
    w, h = round(im.width * scale), round(im.height * scale)
    grow = max(1.0, SHORT_MIN / min(w, h))
    w, h = round(w * grow), round(h * grow)
    if max(w, h) > LONG_CAP:  # keep the long cap after any growth
        k = LONG_CAP / max(w, h)
        w, h = round(w * k), round(h * k)
    img = im.resize((w, h), Image.LANCZOS)
    if min(img.size) < SHORT_MIN:
        raise SystemExit("%s: cannot satisfy both caps (short side %d < %d)" % (path.name, min(img.size), SHORT_MIN))

    # Step 2: bytes. PNG when it already fits the band, else JPEG at falling quality so the
    # dimensions (and therefore the gate) are untouched. If it is still too SMALL for the
    # dossier's floor, raise the quality until it lands -- byte size is the only free knob.
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    size = buf.tell()
    final = path
    if size > TARGET_HIGH:
        final = path.with_suffix(".jpg")
        for q in (95, 92, 90, 88, 84, 80, 76, 72, 68, 64, 60, 56, 52):
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=q, optimize=True, subsampling=0)
            size = buf.tell()
            if size <= TARGET_HIGH:
                break
    elif size < TARGET_LOW:
        # PNG was under the floor: JPEG at high quality is bigger per pixel than PNG here.
        for q in (95, 92, 90, 88, 86, 84, 82):
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=q, optimize=True, subsampling=0)
            size = buf.tell()
            if size >= TARGET_LOW:
                final = path.with_suffix(".jpg")
                break
    final.write_bytes(buf.getvalue())
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

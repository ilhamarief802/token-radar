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
    ("board.png", "", False),
    ("detail.png", "#p=steakhouse-financial", False),
    ("filter.png", "#category=Risk%20Curators", False),
]


def fit(raw: bytes, path: pathlib.Path) -> int:
    """Write the PNG closest to the 300-350 KB band by trimming pixels while it is too big."""
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    scale = 1.0
    while True:
        buf = io.BytesIO()
        w = max(320, int(img.width * scale))
        h = max(200, int(img.height * scale))
        img.resize((w, h), Image.LANCZOS).save(buf, format="PNG", optimize=True)
        size = buf.tell()
        if size <= TARGET_HIGH or scale < 0.18:
            path.write_bytes(buf.getvalue())
            return size
        scale *= 0.92


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, frag, full in VIEWS:
            page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
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

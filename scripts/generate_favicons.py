#!/usr/bin/env python3
"""Regenerate raster favicons from the vector source (favicon.svg).

The repo keeps only the SVG. The PNG / ICO files are build artifacts —
regenerate them after editing the SVG and copy them next to index.html.

    python3 scripts/generate_favicons.py        # run from the repo root

Requires: playwright + chromium and Pillow:
    pip install playwright pillow && playwright install chromium
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "favicon.svg"

TARGETS = {
    "favicon-16x16.png": 16,
    "favicon-32x32.png": 32,
    "apple-touch-icon.png": 180,
}

def main() -> None:
    try:
        from playwright.sync_api import sync_playwright
        from PIL import Image
    except ImportError as e:
        sys.exit(f"missing dependency ({e}); pip install playwright pillow")

    if not SVG.exists():
        sys.exit(f"not found: {SVG}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 512, "height": 512})
        page.goto(SVG.as_uri())
        # screenshot the <svg> element at native resolution, then downscale
        el = page.locator("svg")
        full = ROOT / ".favicon_full.png"
        el.screenshot(path=str(full))
        browser.close()

    with Image.open(full) as img:
        img = img.convert("RGBA")
        for name, size in TARGETS.items():
            img.resize((size, size), Image.LANCZOS).save(ROOT / name)
            print("wrote", name)
        # multi-size .ico (16/32/48) from a 64px master
        master = img.resize((64, 64), Image.LANCZOS)
        master.save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
        print("wrote favicon.ico")
    full.unlink()

if __name__ == "__main__":
    main()

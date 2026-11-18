#!/usr/bin/env python3
"""Make the Help guide's pictures (public/help/*.webp) from the README screenshots (docs/images/*.png).
Run after the screenshots test: SHOTS_DIR=docs/images node --test --test-name-pattern=screenshots test/browser.test.js
Small WebP files keep BandWatch.exe and the website quick."""
import os
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "..", "docs", "images")
dst = os.path.join(here, "..", "public", "help")
os.makedirs(dst, exist_ok=True)
for name in sorted(os.listdir(src)):
    if not name.endswith(".png"):
        continue
    im = Image.open(os.path.join(src, name)).convert("RGB")
    if im.width > 960:
        im = im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS)
    out = os.path.join(dst, name[:-4] + ".webp")
    im.save(out, "WEBP", quality=78, method=6)
    print(f"{name} -> {os.path.basename(out)} {os.path.getsize(out) // 1024} kB")

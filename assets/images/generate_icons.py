"""Render the Invenio Field brand SVGs to Expo app icon PNGs.

Source of truth: docs/brand/app-icon*.svg and docs/brand/splash-icon.svg.
Requires: rsvg-convert (brew install librsvg) and Pillow.
"""

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "docs" / "brand"
OUTPUT = Path(__file__).resolve().parent

# (source SVG, output PNG, size, flatten to RGB)
EXPORTS = [
    # App Store rejects an icon with an alpha channel.
    (BRAND / "app-icon.svg", OUTPUT / "icon.png", 1024, True),
    (BRAND / "app-icon-adaptive.svg", OUTPUT / "adaptive-icon.png", 1024, False),
    (BRAND / "splash-icon.svg", OUTPUT / "splash-icon.png", 1024, False),
    (BRAND / "app-icon.svg", OUTPUT / "favicon.png", 48, True),
]


def main() -> None:
    rsvg = shutil.which("rsvg-convert")
    if not rsvg:
        sys.exit("rsvg-convert not found. Install with: brew install librsvg")

    for src, dest, size, flatten in EXPORTS:
        if not src.exists():
            sys.exit(f"Missing source SVG: {src}")
        subprocess.run(
            [rsvg, "-w", str(size), "-h", str(size), str(src), "-o", str(dest)],
            check=True,
        )
        if flatten:
            Image.open(dest).convert("RGB").save(dest, "PNG")
        print(f"Created {dest.name} ({size}x{size}) from {src.name}")

    print("\nAll icons generated successfully.")


if __name__ == "__main__":
    main()

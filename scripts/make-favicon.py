#!/usr/bin/env python3
"""Render the crosshair mark to favicon.ico and apple-touch-icon.png.

Geometry is kept in the same 64-unit space as public/favicon.svg so the raster
and vector versions stay identical. Change one, change both.

ImageMagick's built-in SVG renderer cannot handle the clip path and stroked
arcs, so the raster is drawn here rather than converted from the SVG.

    python3 scripts/make-favicon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

BLACK = (17, 17, 17, 255)
WHITE = (255, 255, 255, 255)
ORANGE = (226, 87, 28, 255)

# 64-unit design space, matching favicon.svg.
UNITS = 64
CENTRE = 32.0
R_OUTER = 32.0  # equals half the canvas: the mark fills the full width/height
R_RING_INNER = 28.0
R_DISC = 17.2
BAR_HALF = 3.7
R_DOT = 3.2

SUPERSAMPLE = 8


def render(size: int, background: tuple[int, int, int, int] | None = None) -> Image.Image:
    px = size * SUPERSAMPLE
    scale = px / UNITS
    img = Image.new("RGBA", (px, px), background or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def box(r: float) -> list[float]:
        return [(CENTRE - r) * scale, (CENTRE - r) * scale, (CENTRE + r) * scale, (CENTRE + r) * scale]

    d.ellipse(box(R_OUTER), fill=BLACK)
    d.ellipse(box(R_RING_INNER), fill=WHITE)
    # Upper-left quadrant: 180 deg (left) to 270 deg (top), clockwise.
    d.pieslice(box(R_RING_INNER), start=180, end=270, fill=ORANGE)
    d.ellipse(box(R_DISC), fill=BLACK)

    # Crossbars, drawn full-width then clipped back to the circle below.
    d.rectangle([(CENTRE - BAR_HALF) * scale, 0, (CENTRE + BAR_HALF) * scale, px], fill=BLACK)
    d.rectangle([0, (CENTRE - BAR_HALF) * scale, px, (CENTRE + BAR_HALF) * scale], fill=BLACK)

    d.ellipse(box(R_DOT), fill=ORANGE)

    if background is None:
        # Keep the corners transparent — the bars would otherwise poke out.
        mask = Image.new("L", (px, px), 0)
        ImageDraw.Draw(mask).ellipse(box(R_OUTER), fill=255)
        img.putalpha(mask)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    # Multi-resolution ICO: browsers pick per context (tab, bookmark, shortcut).
    sizes = [16, 32, 48, 64, 128, 256]
    frames = [render(s) for s in sizes]
    frames[-1].save(PUBLIC / "favicon.ico", format="ICO", sizes=[(s, s) for s in sizes])

    # iOS composites onto its own background and ignores alpha, so bake white in.
    render(180, background=WHITE).save(PUBLIC / "apple-touch-icon.png", format="PNG")

    for f in ("favicon.ico", "apple-touch-icon.png"):
        print(f"  {f:24} {(PUBLIC / f).stat().st_size:>7,} bytes")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Render a preview of the applications table so every status tone can be
compared side by side.

Colours are parsed out of app/assets/css/tokens.css and the tone-per-status
mapping is read from the database, so the image cannot drift from the app. The
typeface is not Archivo — that ships as woff2 and converting it needs fontTools
plus brotli, neither of which is installed. Type here is indicative; colour is
exact.

    python3 scripts/tag-preview.py [output.png]
"""

import re
import sqlite3
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "app" / "assets" / "css" / "tokens.css"
DB = ROOT / "data" / "jobhunt.db"

S = 2  # supersample, downscaled at the end
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def tokens() -> dict[str, str]:
    text = TOKENS.read_text()
    return {m[1]: m[2].strip() for m in re.finditer(r"(--[\w-]+):\s*([^;]+);", text)}


def resolve(value: str, table: dict[str, str], depth: int = 0) -> str:
    """Follows var(--x) indirection — several tokens alias others."""
    m = re.fullmatch(r"var\(\s*(--[\w-]+)\s*\)", value.strip())
    if m and depth < 10:
        return resolve(table[m[1]], table, depth + 1)
    return value.strip()


def rgb(value: str) -> tuple[int, int, int]:
    value = resolve(value, T).lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def mix_over(fg: str, pct: float, bg: tuple[int, int, int]) -> tuple[int, int, int]:
    """color-mix(in srgb, <fg> <pct>%, transparent) composited onto bg."""
    f = rgb(fg)
    return tuple(round(f[i] * pct + bg[i] * (1 - pct)) for i in range(3))


T = tokens()
PAGE = rgb(T["--color-bg"])
TEXT = rgb(T["--color-text"])
DIVIDER = mix_over(T["--color-text"], 0.40, PAGE)
INK_TH = mix_over(T["--color-text"], 0.60, PAGE)
INK_MUTED = mix_over(T["--color-text"], 0.55, PAGE)
ACCENT = rgb(T["--color-accent"])
FILED_BG = rgb(T["--tone-filed-bg"])
FILED_INK = rgb(T["--tone-filed-ink"])

TONE = {
    t: (rgb(T[f"--tone-{t}-bg"]), rgb(T[f"--tone-{t}-ink"]))
    for t in ("quiet", "active", "positive", "closed", "generic")
}

# Real tone assignments, straight from the vocabulary.
con = sqlite3.connect(DB)
STATUSES = con.execute(
    "SELECT label, tone FROM status WHERE is_active = 1 ORDER BY sort_order"
).fetchall()
con.close()

SAMPLE = [
    ("Northwind Logistics", "Senior Frontend Engineer", "Awaiting response", "2026-07-18", False),
    ("Cedar & Vine", "Staff Software Engineer", "Awaiting response", "2026-07-11", True),
    ("Lumen Robotics", "Frontend Engineer, Platform", "Screener call", "2026-06-30", True),
    ("Harborview Capital", "Senior UI Engineer", "Interview round 1", "2026-06-22", False),
    ("Bright Path Health", "Design System Engineer", "Interview round 2", "2026-06-15", True),
    ("Gridline Energy", "Senior Frontend Developer", "Interview round 3", "2026-06-02", False),
    ("Ninth Wave Studio", "Lead Frontend Engineer", "Interview round 4", "2026-05-28", True),
    ("Solace Systems", "Staff Engineer, Web", "Follow up", "2026-05-19", False),
    ("Fenwick Data", "Senior Software Engineer", "None", "2026-05-04", True),
    ("Anchorpoint Health", "Frontend Architect", "None", "2026-04-27", False),
    ("Meridian Freight", "Senior React Developer", "None", "2026-04-11", True),
    ("Tidewater Labs", "UI Engineer", "None", "2026-03-30", False),
]

f_h1 = ImageFont.truetype(BOLD, 30 * S)
f_body = ImageFont.truetype(REG, 14 * S)
f_sub = ImageFont.truetype(REG, 13 * S)
f_th = ImageFont.truetype(REG, 11 * S)
f_tag = ImageFont.truetype(REG, 11 * S)
f_kick = ImageFont.truetype(BOLD, 11 * S)

COLS = [40, 300, 610, 900, 1130, 1290]  # x offsets, unscaled
W, PAD = 1420, 40
ROW_H, HEAD_H = 46, 150


def spaced(d, xy, text, font, fill, tracking):
    """Pillow has no letter-spacing; the uppercase headers need it."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + tracking
    return x


def tag(d, x, y, label, bg, ink, font=f_tag):
    tw = d.textlength(label, font=font)
    pad_x, pad_y = 10 * S, 4 * S
    box = (x, y, x + tw + pad_x * 2, y + font.size + pad_y * 2)
    d.rectangle(box, fill=bg)
    d.text((x + pad_x, y + pad_y - 1 * S), label, font=font, fill=ink)
    return box[2]


def outline_tag(d, x, y, label):
    tw = d.textlength(label, font=f_tag)
    pad_x, pad_y = 10 * S, 4 * S
    box = (x, y, x + tw + pad_x * 2, y + f_tag.size + pad_y * 2)
    d.rectangle(box, fill=FILED_BG, outline=FILED_INK, width=1 * S)
    d.text((x + pad_x, y + pad_y - 1 * S), label, font=f_tag, fill=FILED_INK)


height = HEAD_H + ROW_H * (len(STATUSES) + 1) + 250
img = Image.new("RGB", (W * S, height * S), PAGE)
d = ImageDraw.Draw(img)

d.text((PAD * S, 34 * S), "Applications", font=f_h1, fill=TEXT)
d.text((PAD * S, 78 * S), f"{len(STATUSES)} statuses, one row each", font=f_sub, fill=INK_MUTED)

# Header row
y = HEAD_H
for label, x in zip(["COMPANY", "ROLE", "STATUS", "NEXT STEP", "APPLIED", "FILED"], COLS):
    spaced(d, (x * S, y * S), label, f_th, INK_TH, 1.1 * S)
y += 30
d.line([(PAD * S, y * S), ((W - PAD) * S, y * S)], fill=DIVIDER, width=2 * S)

for (label, tone), (company, role, step, applied, filed) in zip(STATUSES, SAMPLE):
    y += 14
    bg, ink = TONE[tone]
    d.text((COLS[0] * S, y * S), company, font=f_body, fill=TEXT)
    d.text((COLS[1] * S, y * S), role, font=f_body, fill=TEXT)
    tag(d, COLS[2] * S, (y - 3) * S, label, bg, ink)
    d.text((COLS[3] * S, y * S), step, font=f_body, fill=TEXT)
    d.text((COLS[4] * S, y * S), applied, font=f_body, fill=TEXT)
    if filed:
        outline_tag(d, COLS[5] * S, (y - 3) * S, "Filed")
    y += ROW_H - 14
    d.line([(PAD * S, y * S), ((W - PAD) * S, y * S)], fill=DIVIDER, width=1 * S)

# Legend
y += 46
spaced(d, (PAD * S, y * S), "TONES", f_kick, ACCENT, 1.6 * S)
y += 30
x = PAD * S
for tone in ("quiet", "active", "positive", "closed", "generic"):
    bg, ink = TONE[tone]
    x = tag(d, x, y * S, tone, bg, ink) + 14 * S
x += 10 * S
outline_tag(d, x, y * S, "Filed")

y += 44
notes = {
    "quiet": "open, waiting on them",
    "active": "in motion",
    "positive": "the good outcome",
    "closed": "ended",
    "generic": "non-semantic label (document kinds)",
}
for tone, note in notes.items():
    d.text((PAD * S, y * S), f"{tone} — {note}", font=f_sub, fill=INK_MUTED)
    y += 24

out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tag-preview.png"
img.resize((W, height), Image.LANCZOS).save(out)
print(f"  wrote {out}  ({out.stat().st_size:,} bytes)")

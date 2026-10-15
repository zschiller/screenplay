# Crops each capture to the same CSS-px region per option, light and dark.
# Usage: python3 -I crop.py <captures-dir> <out-dir>
import sys
from pathlib import Path
from PIL import Image

CAP, OUT = Path(sys.argv[1]), Path(sys.argv[2])
S = 2  # device pixel ratio of the captures

# name: (label, x, y, w, h) in CSS px
CROPS = {
    "today-cursor": ("hb_today", 470, 150, 380, 150),
    "today-away": ("hb_today-away", 470, 150, 380, 150),
    "today-pages": ("hb_today", 0, 60, 380, 80),
    "a-cursor": ("hb_a", 470, 150, 380, 150),
    "a-away": ("hb_a-away", 470, 150, 380, 150),
    "b-pages": ("hb_b", 0, 60, 440, 80),
    "c-pill": ("hb_c", 1132, 0, 380, 90),
    "d-pill": ("hb_d", 236, 0, 440, 44),
}

OUT.mkdir(parents=True, exist_ok=True)
for name, (label, x, y, w, h) in CROPS.items():
    for theme in ("light", "dark"):
        src = CAP / label / f"host-badge.{theme}.png"
        if not src.exists():
            continue
        im = Image.open(src)
        im.crop((x * S, y * S, (x + w) * S, (y + h) * S)).save(OUT / f"{name}-{theme}.png", optimize=True)
    for theme in ("light", "dark"):
        src = CAP / label / f"host-badge.{theme}.png"
        full = OUT / f"{label[3:]}-full-{theme}.png"
        if src.exists() and not full.exists():
            im = Image.open(src)
            im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(full, optimize=True)
print("ok")

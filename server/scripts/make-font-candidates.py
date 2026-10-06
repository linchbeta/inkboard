"""Build the font-comparison candidates (assets/fonts/candidates/*.bdf).

Bitmap fonts (BDF) are subset; TrueType fonts are rasterised once at fixed pixel sizes
(anti-aliased, then thresholded at 50%) into BDF, so the backend draws every candidate
pixel-exact. Only the characters used by src/screens/fontCompare.ts are kept.

Needs Python 3 + Pillow. Usage:
  python scripts/make-font-candidates.py <src dir>
<src dir> must contain: wqy-bitmapsong/wenquanyi_9pt.bdf (12px) and wenquanyi_12pt.bdf (16px),
ref-*.bdf decoded from the EPD-nRF5 reference, BarlowCondensed-SemiBold.ttf / -Bold.ttf,
LXGWWenKai-Medium.ttf.
"""
import os
import re
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "assets", "fonts", "candidates")


def charset():
    src = open(os.path.join(ROOT, "src", "screens", "fontCompare.ts"), encoding="utf-8").read()
    chars = {chr(c) for c in range(0x20, 0x7F)}
    chars |= {ch for ch in src if ord(ch) > 0x7F}
    return {ord(c) for c in chars}


def subset_bdf(src, dst, keep):
    text = open(src, encoding="latin-1").read().replace("\r\n", "\n")
    head, _, rest = text.partition("STARTCHAR")
    blocks = ["STARTCHAR" + b for b in rest.split("STARTCHAR")]
    kept = []
    for b in blocks:
        m = re.search(r"^ENCODING (-?\d+)$", b, re.M)
        if m and int(m.group(1)) in keep:
            kept.append(b.split("ENDFONT")[0])
    head = re.sub(r"^CHARS \d+$", f"CHARS {len(kept)}", head, flags=re.M)
    with open(dst, "w", encoding="latin-1", newline="\n") as f:
        f.write(head + "".join(kept) + "ENDFONT\n")
    print(f"{os.path.basename(dst)}: {len(kept)} glyphs")


def ttf_to_bdf(src, px, dst, keep, name):
    font = ImageFont.truetype(src, size=px)
    ascent, descent = font.getmetrics()
    pad = px
    glyphs = []
    for cp in sorted(keep):
        ch = chr(cp)
        # Skip characters the font does not have (getmask of a .notdef would be a box).
        if cp > 0x7F and font.getmask(ch).getbbox() is None and ch.strip():
            continue
        adv = round(font.getlength(ch))
        img = Image.new("L", (adv + 2 * pad, ascent + descent + 2 * pad), 0)
        ImageDraw.Draw(img).text((pad, pad + ascent), ch, font=font, fill=255, anchor="ls")
        bw = img.point(lambda v: 255 if v >= 128 else 0)
        box = bw.getbbox()
        if box is None:
            glyphs.append((cp, adv, 0, 0, 0, 0, []))
            continue
        left, top, right, bottom = box
        w, h = right - left, bottom - top
        rows = []
        for yy in range(top, bottom):
            v = 0
            for xx in range(left, right):
                v = (v << 1) | (1 if bw.getpixel((xx, yy)) else 0)
            rows.append(v << ((w + 7) // 8 * 8 - w))
        glyphs.append((cp, adv, w, h, left - pad, (pad + ascent) - bottom, rows))
    with open(dst, "w", encoding="ascii", newline="\n") as f:
        f.write(f"STARTFONT 2.1\nFONT {name}\nSIZE {px} 75 75\nFONTBOUNDINGBOX {px * 2} {ascent + descent} 0 {-descent}\n")
        f.write(f"STARTPROPERTIES 3\nPIXEL_SIZE {px}\nFONT_ASCENT {ascent}\nFONT_DESCENT {descent}\nENDPROPERTIES\n")
        f.write(f"CHARS {len(glyphs)}\n")
        for cp, adv, w, h, xo, yo, rows in glyphs:
            f.write(f"STARTCHAR U+{cp:04X}\nENCODING {cp}\nSWIDTH 500 0\nDWIDTH {adv} 0\nBBX {w} {h} {xo} {yo}\nBITMAP\n")
            for r in rows:
                f.write(f"{r:0{(w + 7) // 8 * 2}X}\n")
            f.write("ENDCHAR\n")
        f.write("ENDFONT\n")
    print(f"{os.path.basename(dst)}: {len(glyphs)} glyphs (ascent {ascent}, descent {descent})")


def main():
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    keep = charset()
    subset_bdf(os.path.join(src, "wqy-bitmapsong", "wenquanyi_9pt.bdf"), os.path.join(OUT, "wqy-bitmapsong-12px.bdf"), keep)
    subset_bdf(os.path.join(src, "wqy-bitmapsong", "wenquanyi_12pt.bdf"), os.path.join(OUT, "wqy-bitmapsong-16px.bdf"), keep)
    subset_bdf(os.path.join(src, "ref-wqy6_t_lunar.bdf"), os.path.join(OUT, "ref-wqy-zenhei-9px.bdf"), keep)
    subset_bdf(os.path.join(src, "ref-helvB14_tn.bdf"), os.path.join(OUT, "ref-helvetica-bold-20px.bdf"), keep)
    subset_bdf(os.path.join(src, "ref-helvB18_tn.bdf"), os.path.join(OUT, "ref-helvetica-bold-25px.bdf"), keep)
    sb = os.path.join(src, "BarlowCondensed-SemiBold.ttf")
    b = os.path.join(src, "BarlowCondensed-Bold.ttf")
    ttf_to_bdf(sb, 36, os.path.join(OUT, "barlow-condensed-semibold-36px.bdf"), keep, "BarlowCondensed-SemiBold-36")
    ttf_to_bdf(sb, 48, os.path.join(OUT, "barlow-condensed-semibold-48px.bdf"), keep, "BarlowCondensed-SemiBold-48")
    ttf_to_bdf(b, 80, os.path.join(OUT, "barlow-condensed-bold-80px.bdf"), keep, "BarlowCondensed-Bold-80")
    wk = os.path.join(src, "LXGWWenKai-Medium.ttf")
    ttf_to_bdf(wk, 24, os.path.join(OUT, "lxgw-wenkai-medium-24px.bdf"), keep, "LXGWWenKai-Medium-24")
    ttf_to_bdf(wk, 32, os.path.join(OUT, "lxgw-wenkai-medium-32px.bdf"), keep, "LXGWWenKai-Medium-32")


if __name__ == "__main__":
    main()

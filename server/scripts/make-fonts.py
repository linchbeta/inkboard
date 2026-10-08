"""Build the large display fonts (assets/fonts/*.bdf.gz) from TrueType sources.

Each font is rasterised once per pixel size with Pillow (anti-aliased, thresholded at
50%) into BDF, then gzipped. The backend draws them pixel-exact like the bitmap fonts.

  LXGW WenKai Medium (霞鹜文楷, SIL OFL 1.1)    large Chinese: full GB2312 at 20-40 px,
                                              and the poems' characters at 48/56 px;
                                              Japanese (JIS X 0208: kana, kanji) and Korean
                                              (KS X 1001 Hangul) beyond that in "-extra"
                                              files, merged in when loaded (needs the full
                                              WenKai release, not a GB2312 subset)
  Inter Medium (SIL OFL 1.1)                  large Latin + IPA (word of the day)
  Barlow Condensed Bold (SIL OFL 1.1)         large numbers (market, year progress)
  Noto Sans SC Medium (思源黑体 design,       large Chinese on the 4.2" (even strokes at
    SIL OFL 1.1; "Source" is a reserved name)  119 dpi; optional on the 3.98"): 20-40 px

The "-extra" files are rasterised from the outlines here (numpy, 4x4 samples per pixel,
non-zero winding, a pixel inked at half coverage -- what Pillow's 50% threshold of its
anti-aliased rendering does): Pillow 9.5's FreeType crashes on CJK glyphs of WenKai 1.5.

Needs Python 3 + Pillow + fontTools (+ numpy for --extra). Usage:
  python scripts/make-fonts.py <LXGWWenKai-Medium.ttf> <Inter_24pt-Medium.ttf> <BarlowCondensed-Bold.ttf> <NotoSansSC-Medium.otf>
  python scripts/make-fonts.py --extra <LXGWWenKai-Medium.ttf>     (only the Japanese / Korean files)
  python scripts/make-fonts.py --add <LXGWWenKai-Medium.ttf> <NotoSansSC-Medium.otf>
      (after adding poems: the characters they need that the WenKai and Noto files lack are
      rendered and added; the glyphs already there stay exactly as they are)

The committed files were made with Pillow 9.5.0 (FreeType 2.13.0) from LXGW WenKai v1.522:
with those the WenKai files come out byte for byte the same (the Noto ones were made from
an earlier Noto Sans SC than its 2.004 release). A newer Pillow draws the glyphs a little
differently, so use 9.5.0 (Python 3.11) for --add too.
"""
import gzip
import os
import re
import sys
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "assets", "fonts")

ASCII = set(range(0x20, 0x7F))
PUNCT = {ord(c) for c in "，。、；：？！“”‘’（）《》【】「」『』…—–·％＋－／～ ・°℃"}
IPA = set(range(0x250, 0x2B0)) | {0x2C8, 0x2CC, 0x2D0, 0x2D1, 0xE6, 0xF0, 0x14B, 0x3B8}
LATIN1 = set(range(0xA0, 0x180))
DIGITS = {ord(c) for c in "0123456789+-−.,%:/ ()"}


def gb2312():
    out = set()
    for b1 in range(0xA1, 0xF8):
        for b2 in range(0xA1, 0xFF):
            try:
                out.add(ord(bytes([b1, b2]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    return out


def legacy_charset(codec, rows, cols=range(0xA1, 0xFF)):
    out = set()
    for b1 in rows:
        for b2 in cols:
            try:
                ch = bytes([b1, b2]).decode(codec)
            except UnicodeDecodeError:
                continue
            if len(ch) == 1:
                out.add(ord(ch))
    return out


def japanese_korean():
    """JIS X 0208 (kana, kanji, symbols) and the 2350 Hangul syllables of KS X 1001."""
    return legacy_charset("euc_jp", range(0xA1, 0xF5)) | legacy_charset("euc_kr", range(0xB0, 0xC9))


def poem_chars():
    src = open(os.path.join(ROOT, "src", "data", "poems.ts"), encoding="utf-8").read()
    return {ord(ch) for ch in src if ord(ch) > 0x2E7F} | PUNCT | ASCII


def ttf_to_bdf(src, px, keep, name):
    font = ImageFont.truetype(src, size=px, layout_engine=ImageFont.Layout.BASIC)  # raqm crashes on some symbols
    cmap = TTFont(src, lazy=True).getBestCmap()
    ascent, descent = font.getmetrics()
    pad = px
    glyphs = []
    for cp in sorted(keep):
        ch = chr(cp)
        if cp not in cmap:
            continue  # not in the font (would render .notdef)
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
        data = bw.crop(box).tobytes()
        rows = []
        for yy in range(h):
            v = 0
            for xx in range(w):
                v = (v << 1) | (1 if data[yy * w + xx] else 0)
            rows.append(v << ((w + 7) // 8 * 8 - w))
        glyphs.append((cp, adv, w, h, left - pad, (pad + ascent) - bottom, rows))
    write_bdf(name, px, ascent, descent, glyphs)


def write_bdf(name, px, ascent, descent, glyphs):
    parts = [f"STARTFONT 2.1\nFONT {name}\nSIZE {px} 75 75\nFONTBOUNDINGBOX {px * 2} {ascent + descent} 0 {-descent}\n",
             f"STARTPROPERTIES 3\nPIXEL_SIZE {px}\nFONT_ASCENT {ascent}\nFONT_DESCENT {descent}\nENDPROPERTIES\n",
             f"CHARS {len(glyphs)}\n"]
    for cp, adv, w, h, xo, yo, rows in glyphs:
        parts.append(f"STARTCHAR U+{cp:04X}\nENCODING {cp}\nSWIDTH 500 0\nDWIDTH {adv} 0\nBBX {w} {h} {xo} {yo}\nBITMAP\n")
        parts.extend(f"{r:0{(w + 7) // 8 * 2}X}\n" for r in rows)
        parts.append("ENDCHAR\n")
    parts.append("ENDFONT\n")
    dst = os.path.join(OUT, f"{name}.bdf.gz")
    with gzip.open(dst, "wt", encoding="ascii", newline="\n", compresslevel=9) as f:
        f.write("".join(parts))
    print(f"{os.path.basename(dst)}: {len(glyphs)} glyphs, {os.path.getsize(dst) // 1024} KB (ascent {ascent}, descent {descent})")


class _FlatPen:
    """Collects a glyph's contours as polylines (curves flattened), in font units."""

    def __new__(cls, glyph_set):
        from fontTools.pens.basePen import BasePen

        class Pen(BasePen):
            def __init__(self):
                super().__init__(glyph_set)
                self.contours, self.cur = [], []

            def _moveTo(self, p):
                self.cur = [p]

            def _lineTo(self, p):
                self.cur.append(p)

            def _qCurveToOne(self, p1, p2):
                (x0, y0) = self.cur[-1]
                for i in range(1, 9):
                    t = i / 8
                    a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
                    self.cur.append((a * x0 + b * p1[0] + c * p2[0], a * y0 + b * p1[1] + c * p2[1]))

            def _curveToOne(self, p1, p2, p3):
                (x0, y0) = self.cur[-1]
                for i in range(1, 11):
                    t = i / 10
                    a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                    self.cur.append((a * x0 + b * p1[0] + c * p2[0] + d * p3[0], a * y0 + b * p1[1] + c * p2[1] + d * p3[1]))

            def _closePath(self):
                if len(self.cur) > 2:
                    self.contours.append(self.cur)
                self.cur = []

            _endPath = _closePath

        return Pen()


def _raster(contours, scale, S=4):
    """Contours (font units) -> (left, top, rows of 0/1) in pixels, y down from the baseline."""
    import numpy as np
    edges = []
    for c in contours:
        pts = [(x * scale, -y * scale) for x, y in c]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
            if y0 != y1:
                edges.append((x0, y0, x1, y1))
    if not edges:
        return None
    e = np.array(edges)
    left, right = int(np.floor(e[:, [0, 2]].min())), int(np.ceil(e[:, [0, 2]].max()))
    top, bottom = int(np.floor(e[:, [1, 3]].min())), int(np.ceil(e[:, [1, 3]].max()))
    w, h = right - left, bottom - top
    xs = left + (np.arange(w * S) + 0.5) / S
    inside = np.zeros((h * S, w * S), dtype=bool)
    x0, y0, x1, y1 = e.T
    lo, hi, d = np.minimum(y0, y1), np.maximum(y0, y1), np.where(y1 > y0, 1, -1)
    for r in range(h * S):
        y = top + (r + 0.5) / S
        m = (lo <= y) & (y < hi)
        if not m.any():
            continue
        xi = x0[m] + (y - y0[m]) * (x1[m] - x0[m]) / (y1[m] - y0[m])
        order = np.argsort(xi)
        xi, dd = xi[order], d[m][order]
        suffix = np.concatenate([np.cumsum(dd[::-1])[::-1], [0]])  # sum of directions from index k on
        inside[r] = suffix[np.searchsorted(xi, xs, side="right")] != 0
    cov = inside.reshape(h, S, w, S).sum(axis=(1, 3))
    return left, top, (cov * 2 >= S * S).astype(np.uint8)


def outline_to_bdf(src, px, keep, name, ascent, descent):
    """Like ttf_to_bdf, rasterising the outlines here (see the module notes)."""
    tt = TTFont(src)
    cmap, gs, hmtx = tt.getBestCmap(), tt.getGlyphSet(), tt["hmtx"]
    scale = px / tt["head"].unitsPerEm
    glyphs = []
    for cp in sorted(keep):
        if cp not in cmap:
            continue
        gname = cmap[cp]
        adv = round(hmtx[gname][0] * scale)
        pen = _FlatPen(gs)
        gs[gname].draw(pen)
        r = _raster(pen.contours, scale)
        if r is None:
            glyphs.append((cp, adv, 0, 0, 0, 0, []))
            continue
        left, top, bm = r
        ys, xs = bm.nonzero()
        if not len(ys):
            glyphs.append((cp, adv, 0, 0, 0, 0, []))
            continue
        bm = bm[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        h, w = bm.shape
        rows = []
        for row in bm:
            v = 0
            for bit in row:
                v = (v << 1) | int(bit)
            rows.append(v << ((w + 7) // 8 * 8 - w))
        bottom = top + ys.max() + 1  # (exclusive, y down from the baseline)
        glyphs.append((cp, adv, w, h, left + int(xs.min()), -bottom, rows))
    write_bdf(name, px, ascent, descent, glyphs)


def extra(wenkai, full):
    keep = japanese_korean() - full
    for px in (20, 22, 24, 28, 32, 40):
        ascent, descent = ImageFont.truetype(wenkai, size=px, layout_engine=ImageFont.Layout.BASIC).getmetrics()
        outline_to_bdf(wenkai, px, keep, f"lxgw-wenkai-{px}px-extra", ascent, descent)


def _read_bdf(path):
    """(header lines up to CHARS, {codepoint: glyph block text}) of a .bdf.gz written here."""
    header, glyphs, cur, cp = [], {}, None, None
    with gzip.open(path, "rt", encoding="ascii") as f:
        for ln in f:
            if cur is None and ln.startswith("STARTCHAR"):
                cur = [ln]
            elif cur is not None:
                cur.append(ln)
                if ln.startswith("ENCODING"):
                    cp = int(ln.split()[1])
                elif ln.startswith("ENDCHAR"):
                    glyphs[cp] = "".join(cur)
                    cur = None
            elif not ln.startswith(("CHARS", "ENDFONT")):
                header.append(ln)
    return header, glyphs


def add_missing(src, px, keep, name):
    """Adds the glyphs of `keep` that assets/fonts/<name>.bdf.gz lacks, rendered from `src`."""
    global OUT
    path = os.path.join(OUT, f"{name}.bdf.gz")
    header, glyphs = _read_bdf(path)
    cmap = TTFont(src, lazy=True).getBestCmap()
    missing = {cp for cp in keep if cp not in glyphs and cp in cmap}
    if not missing:
        return
    import tempfile
    real_out, OUT = OUT, tempfile.mkdtemp()
    try:
        ttf_to_bdf(src, px, missing, name)
        _, new = _read_bdf(os.path.join(OUT, f"{name}.bdf.gz"))
    finally:
        OUT = real_out
    glyphs.update(new)
    with gzip.open(path, "wt", encoding="ascii", newline="\n", compresslevel=9) as f:
        f.write("".join(header) + f"CHARS {len(glyphs)}\n" + "".join(glyphs[cp] for cp in sorted(glyphs)) + "ENDFONT\n")
    print(f"{name}: +{len(new)} glyphs ({''.join(chr(cp) for cp in sorted(new))})")


def add(wenkai, sans):
    full = gb2312() | ASCII | PUNCT | poem_chars()
    for px in (20, 22, 24, 28, 32, 40):
        add_missing(wenkai, px, full, f"lxgw-wenkai-{px}px")
        add_missing(sans, px, full, f"noto-sans-sc-medium-{px}px")
    for px in (48, 56):
        add_missing(wenkai, px, poem_chars(), f"lxgw-wenkai-{px}px-poems")


def main():
    if sys.argv[1] == "--add":
        add(sys.argv[2], sys.argv[3])
        return
    if sys.argv[1] == "--extra":
        extra(sys.argv[2], gb2312() | ASCII | PUNCT | poem_chars())
        return
    wenkai, inter, barlow, sans = sys.argv[1:5]
    full = gb2312() | ASCII | PUNCT | poem_chars()  # some poems use characters outside GB2312
    for px in (20, 22, 24, 28, 32, 40):
        ttf_to_bdf(wenkai, px, full, f"lxgw-wenkai-{px}px")
    extra(wenkai, full)
    poems = poem_chars()
    for px in (48, 56):
        ttf_to_bdf(wenkai, px, poems, f"lxgw-wenkai-{px}px-poems")
    latin = ASCII | LATIN1 | IPA | {0x2019, 0x2014, 0x2026}
    for px in (20, 24, 32, 48, 64, 80):
        ttf_to_bdf(inter, px, latin, f"inter-medium-{px}px")
    for px in (32, 44, 56, 72, 96):
        ttf_to_bdf(barlow, px, DIGITS, f"barlow-condensed-bold-{px}px")
    for px in (20, 22, 24, 28, 32, 40):
        ttf_to_bdf(sans, px, full, f"noto-sans-sc-medium-{px}px")


if __name__ == "__main__":
    main()

"""
Generates src/setup_screen_data.h: the screen shown in WiFi setup mode, for our two
panels (768x552 and 400x300): a header, two numbered steps (the hotspot to join, in a
black pill; the address to open) and a footer with how long it lasts / how to restart.

The static part is laid out here with the backend's pixel fonts (../server/assets/fonts)
and stored as a raw-deflate 1-bit image; the firmware inflates it with the ROM's tinfl
(no code size) and draws the hotspot name (glyphs stored here too) in white on the pill.

    python tools/make_setup_screen.py [preview_dir]      (needs Pillow)
"""
import gzip, os, sys, zlib
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "..", "inkboard", "assets", "fonts")
OUT = os.path.join(HERE, "..", "src", "setup_screen_data.h")
CHARS = "InkBoard-0123456789ABCDEF"  # what a hotspot name can contain


class Bdf:
    """Minimal BDF reader: glyph bitmaps, offsets and advances."""
    def __init__(self, name):
        p = os.path.join(FONTS, name)
        data = gzip.open(p, "rt", encoding="utf-8").read() if p.endswith(".gz") else open(p, encoding="utf-8").read()
        self.glyphs, self.ascent = {}, 0
        g = None
        for ln in data.splitlines():
            k = ln.split()
            if not k:
                continue
            if k[0] == "FONT_ASCENT":
                self.ascent = int(k[1])
            elif k[0] == "ENCODING":
                g = {"code": int(k[1]), "rows": []}
            elif k[0] == "DWIDTH" and g is not None:
                g["adv"] = int(k[1])
            elif k[0] == "BBX" and g is not None:
                g["w"], g["h"], g["x"], g["y"] = map(int, k[1:5])
            elif k[0] == "BITMAP" and g is not None:
                g["bits"] = True
            elif k[0] == "ENDCHAR" and g is not None:
                self.glyphs[g["code"]] = g
                g = None
            elif g is not None and g.get("bits"):
                g["rows"].append(int(k[0], 16))

    def width(self, s):
        return sum(self.glyphs[ord(c)]["adv"] for c in s)

    def draw(self, img, s, x, base, color=0):
        """Draws `s` with its baseline at `base`; returns the end x."""
        px = img.load()
        for c in s:
            g = self.glyphs[ord(c)]
            nbytes = (g["w"] + 7) // 8
            top = base - g["y"] - g["h"]
            for r, bits in enumerate(g["rows"]):
                for col in range(g["w"]):
                    if bits >> (nbytes * 8 - 1 - col) & 1:
                        xx, yy = x + g["x"] + col, top + r
                        if 0 <= xx < img.width and 0 <= yy < img.height:
                            px[xx, yy] = color
            x += g["adv"]
        return x

    def mask(self, c):
        """A glyph as (advance, width, height, x offset, y offset from baseline top, packed rows)."""
        g = self.glyphs[ord(c)]
        return g


def wifi_icon(d, cx, cy, s, w):
    """Three arcs over a dot (the dot at cx, cy)."""
    for k in (1, 2, 3):
        r = s * k
        d.arc((cx - r, cy - r, cx + r, cy + r), 225, 315, fill=0, width=w)
    d.ellipse((cx - w, cy - w, cx + w, cy + w), fill=0)


def design(W, H, m, f, sz):
    """f: fonts by role; sz: sizes and positions by role. Returns image, name font, name x, baseline."""
    img = Image.new("1", (W, H), 1)
    d = ImageDraw.Draw(img)
    title, label, big, num, hint, brand = (Bdf(f[k]) for k in ("title", "label", "big", "num", "hint", "brand"))

    # header: icon, title, brand; a rule under it
    wifi_icon(d, m + sz["icon"], sz["head"] - sz["icon"] // 3, sz["icon"] // 3, sz["iconw"])
    title.draw(img, "WiFi 设置", m + sz["icon"] * 2 + sz["gap"], sz["head"])
    brand.draw(img, "InkBoard", W - m - brand.width("InkBoard"), sz["head"])
    d.rectangle((m, sz["rule"], W - m, sz["rule"] + sz["line"] - 1), fill=0)

    # two steps: a big number, a label, the value
    x = m + sz["col"]
    name_x = name_base = 0
    for n, (lab, base) in enumerate((("手机连接这个 WiFi 热点", sz["step1"]), ("然后用浏览器打开", sz["step2"])), 1):
        num.draw(img, str(n), m, base + sz["numdrop"])
        label.draw(img, lab, x, base)
        vtop = base + sz["vgap"]
        if n == 1:
            widest = big.width("InkBoard-") + 4 * max(big.glyphs[ord(c)]["adv"] for c in "0123456789ABCDEF")
            d.rounded_rectangle((x, vtop, x + widest + 2 * sz["pad"], vtop + sz["pillh"]), sz["pillh"] // 2, fill=0)
            name_x, name_base = x + sz["pad"], vtop + (sz["pillh"] + big.ascent) // 2 - sz["nudge"]
        else:
            big.draw(img, "192.168.4.1", x, vtop + big.ascent)

    # footer: a hairline and two hints
    d.rectangle((m, sz["foot"], W - m, sz["foot"]), fill=0)
    for text, base in (("10 分钟内有效。短按 BOOT 跳过，只显示日历", sz["hint1"]),
                       ("以后要重新设置：按 RESET 后按住 BOOT，直到指示灯常亮", sz["hint2"])):
        assert hint.width(text) <= W - 2 * m, f"{W}: hint too wide: {text}"
        hint.draw(img, text, m, base)
    return img, big, name_x, name_base


def layout_398():
    return design(768, 552, 56, {
        "title": "lxgw-wenkai-32px.bdf.gz", "label": "lxgw-wenkai-28px.bdf.gz", "big": "inter-medium-48px.bdf.gz",
        "num": "barlow-condensed-bold-96px.bdf.gz", "hint": "lxgw-wenkai-20px.bdf.gz", "brand": "inter-medium-24px.bdf.gz",
    }, {"head": 88, "icon": 24, "iconw": 4, "gap": 8, "rule": 112, "line": 3, "col": 84,
        "step1": 178, "step2": 340, "numdrop": 70, "vgap": 18, "pillh": 74, "pad": 24, "nudge": 2,
        "foot": 462, "hint1": 494, "hint2": 522})


def layout_42():
    return design(400, 300, 14, {
        "title": "lxgw-wenkai-20px.bdf.gz", "label": "lxgw-wenkai-20px.bdf.gz", "big": "inter-medium-32px.bdf.gz",
        "num": "barlow-condensed-bold-56px.bdf.gz", "hint": "wqy-bitmapsong-12px.subset.bdf", "brand": "inter-medium-20px.bdf.gz",
    }, {"head": 30, "icon": 13, "iconw": 2, "gap": 4, "rule": 40, "line": 2, "col": 44,
        "step1": 70, "step2": 160, "numdrop": 38, "vgap": 9, "pillh": 44, "pad": 12, "nudge": 1,
        "foot": 236, "hint1": 258, "hint2": 278})


def pack(img):
    """imgBuf layout: 1 bit per pixel, MSB first, 1 = white."""
    W, H = img.size
    px = img.load()
    out = bytearray()
    for y in range(H):
        for x0 in range(0, W, 8):
            b = 0
            for k in range(8):
                b = b << 1 | (1 if px[x0 + k, y] else 0)
            out.append(b)
    return bytes(out)


def glyph_table(font):
    """Glyphs for CHARS: per glyph advance, bbox and packed rows (MSB first)."""
    entries, data = [], bytearray()
    for c in CHARS:
        g = font.glyphs[ord(c)]
        nbytes = (g["w"] + 7) // 8
        entries.append((len(data), g["adv"], g["w"], g["h"], g["x"], g["y"]))
        for row in g["rows"]:
            data += row.to_bytes(nbytes, "big")
    return entries, bytes(data)


def c_array(name, data):
    lines = [", ".join(f"0x{b:02X}" for b in data[i:i + 20]) for i in range(0, len(data), 20)]
    return f"static const uint8_t {name}[] = {{\n  " + ",\n  ".join(lines) + "\n};\n"


def emit(tag, cond, img, font, name_x, base):
    raw = pack(img)
    co = zlib.compressobj(9, zlib.DEFLATED, -15)          # raw deflate, as tinfl expects without a zlib header
    z = co.compress(raw) + co.flush()
    entries, gdata = glyph_table(font)
    s = f"#if {cond}\n"
    s += f"// {img.width}x{img.height}: {len(raw)} bytes -> {len(z)} deflated; name glyphs {len(gdata)} bytes\n"
    s += c_array("SETUP_SCREEN_Z", z)
    s += f"static const uint32_t SETUP_SCREEN_RAW_LEN = {len(raw)};\n"
    s += c_array("SETUP_GLYPH_BITS", gdata)
    s += f'static const char SETUP_CHARS[] = "{CHARS}";\n'
    s += "// per character of SETUP_CHARS: offset into SETUP_GLYPH_BITS, advance, width, height, x offset, y offset (BDF)\n"
    s += f"static const int16_t SETUP_GLYPHS[{len(CHARS)}][6] = {{\n  " + ",\n  ".join("{" + ", ".join(map(str, e)) + "}" for e in entries) + "\n};\n"
    s += f"static const int SETUP_NAME_X = {name_x}, SETUP_NAME_BASE = {base};  // the hotspot name: white, on the pill\n"
    s += "#define HAVE_SETUP_SCREEN 1\n#endif\n\n"
    print(f"{tag}: {len(raw)} -> {len(z)} bytes deflated, glyphs {len(gdata)} bytes")
    return s


def main():
    preview = sys.argv[1] if len(sys.argv) > 1 else None
    out = "// Generated by tools/make_setup_screen.py -- do not edit.\n#pragma once\n#include <stdint.h>\n\n"
    for tag, cond, fn in (("3.98", "EPD_WIDTH == 768 && EPD_HEIGHT == 552", layout_398),
                          ("4.2", "EPD_WIDTH == 400 && EPD_HEIGHT == 300", layout_42)):
        img, font, name_x, base = fn()
        out += emit(tag, cond, img, font, name_x, base)
        if preview:
            demo = img.copy()
            font.draw(demo, "InkBoard-C634", name_x, base, color=1)
            demo.convert("L").save(os.path.join(preview, f"setup_{tag}.png"))
    open(OUT, "w", encoding="utf-8", newline="\n").write(out)


if __name__ == "__main__":
    main()

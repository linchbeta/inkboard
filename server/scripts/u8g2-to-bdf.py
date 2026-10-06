"""Decode u8g2 fonts (C string arrays) from the EPD-nRF5 reference into BDF files.

u8g2 font format (see u8g2 u8g2_font.c): 23-byte header, then ASCII glyphs
(1-byte encoding, 1-byte jump), then a unicode section (lookup table + glyphs with
2-byte encoding, 1-byte jump). Each glyph is a little-endian bit stream:
w, h, x, y, dx, then run-length pairs (zeros, ones) with a repeat bit.
"""
import re
import sys

def parse_c_arrays(path):
    src = open(path, encoding="latin-1").read()
    arrays = {}
    for m in re.finditer(r'const uint8_t (\w+)\[\d+\][^=]*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);', src):
        name, body = m.group(1), m.group(2)
        data = bytearray()
        for lit in re.findall(r'"((?:[^"\\]|\\.)*)"', body):
            i = 0
            while i < len(lit):
                ch = lit[i]
                if ch == "\\":
                    nxt = lit[i + 1]
                    if nxt in "01234567":
                        j = i + 1
                        while j < len(lit) and j < i + 4 and lit[j] in "01234567":
                            j += 1
                        data.append(int(lit[i + 1:j], 8))
                        i = j
                        continue
                    if nxt == "x":
                        j = i + 2
                        while j < len(lit) and lit[j] in "0123456789abcdefABCDEF":
                            j += 1
                        data.append(int(lit[i + 2:j], 16) & 0xFF)
                        i = j
                        continue
                    data.append({"n": 10, "t": 9, "r": 13, "0": 0, "\\": 92, '"': 34, "'": 39, "a": 7,
                                 "b": 8, "f": 12, "v": 11, "?": 63}[nxt])
                    i += 2
                    continue
                data.append(ord(ch))
                i += 1
        arrays[name] = bytes(data)
    return arrays


class Bits:
    def __init__(self, data, pos):
        self.data, self.pos, self.bit = data, pos, 0

    def u(self, cnt):
        val = 0
        for k in range(cnt):
            b = (self.data[self.pos] >> self.bit) & 1
            val |= b << k
            self.bit += 1
            if self.bit == 8:
                self.bit = 0
                self.pos += 1
        return val

    def s(self, cnt):
        return self.u(cnt) - (1 << (cnt - 1))


def decode_glyph(font, hdr, pos):
    b = Bits(font, pos)
    w = b.u(hdr["bw"]); h = b.u(hdr["bh"])
    x = b.s(hdr["bx"]); y = b.s(hdr["by"]); dx = b.s(hdr["bd"])
    pix = [[0] * w for _ in range(h)]
    cx = cy = 0
    def run(n, v):
        nonlocal cx, cy
        while n > 0 and cy < h:
            take = min(n, w - cx)
            if v:
                for k in range(take):
                    pix[cy][cx + k] = 1
            cx += take; n -= take
            if cx >= w:
                cx = 0; cy += 1
    if w > 0 and h > 0:
        while cy < h:
            a = b.u(hdr["b0"]); c1 = b.u(hdr["b1"])
            while True:
                run(a, 0); run(c1, 1)
                if b.u(1) == 0 or cy >= h:
                    break
    return w, h, x, y, dx, pix


def decode_font(font):
    hdr = dict(cnt=font[0], b0=font[2], b1=font[3], bw=font[4], bh=font[5], bx=font[6], by=font[7], bd=font[8],
               ascent=font[13] if font[13] < 128 else font[13] - 256,
               descent=font[14] if font[14] < 128 else font[14] - 256)
    glyphs = {}
    p = 23
    while font[p + 1] != 0:  # ASCII part
        glyphs[font[p]] = decode_glyph(font, hdr, p + 2)
        p += font[p + 1]
    uni = 23 + ((font[21] << 8) | font[22])
    if (font[21] | font[22]) and uni + 1 < len(font):
        q = uni + ((font[uni] << 8) | font[uni + 1])  # first entry offset -> glyph block start
        while q + 2 < len(font):
            enc = (font[q] << 8) | font[q + 1]
            if enc == 0 or font[q + 2] == 0:
                break
            glyphs[enc] = decode_glyph(font, hdr, q + 3)
            q += font[q + 2]
    return hdr, glyphs


def write_bdf(path, name, hdr, glyphs):
    ascent = max(1, max((g[1] + g[3] for g in glyphs.values()), default=1))
    descent = max(0, -min((g[3] for g in glyphs.values()), default=0))
    with open(path, "w", encoding="ascii") as f:
        f.write(f"STARTFONT 2.1\nFONT {name}\nSIZE {ascent + descent} 75 75\n")
        f.write(f"FONTBOUNDINGBOX {max(g[0] for g in glyphs.values())} {ascent + descent} 0 {-descent}\n")
        f.write(f"STARTPROPERTIES 3\nPIXEL_SIZE {ascent + descent}\nFONT_ASCENT {ascent}\nFONT_DESCENT {descent}\nENDPROPERTIES\n")
        f.write(f"CHARS {len(glyphs)}\n")
        for enc, (w, h, x, y, dx, pix) in sorted(glyphs.items()):
            f.write(f"STARTCHAR U+{enc:04X}\nENCODING {enc}\nSWIDTH 500 0\nDWIDTH {dx} 0\nBBX {w} {h} {x} {y}\nBITMAP\n")
            nbytes = (w + 7) // 8
            for row in pix:
                v = 0
                for bit in row:
                    v = (v << 1) | bit
                v <<= nbytes * 8 - w
                f.write(f"{v:0{nbytes * 2}X}\n" if nbytes else "00\n")
            f.write("ENDCHAR\n")
        f.write("ENDFONT\n")


if __name__ == "__main__":
    arrays = parse_c_arrays(sys.argv[1])
    for name in sys.argv[3:]:
        hdr, glyphs = decode_font(arrays[name])
        out = f"{sys.argv[2]}/ref-{name.replace('u8g2_font_', '')}.bdf"
        write_bdf(out, name, hdr, glyphs)
        print(f"{name}: {len(glyphs)} glyphs (header says {hdr['cnt']}) -> {out}")

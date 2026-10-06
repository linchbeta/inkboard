// Minimal BDF (Glyph Bitmap Distribution Format) reader for pixel fonts.
// Glyphs are drawn exactly as designed: no scaling, no anti-aliasing, integer positions.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export interface Glyph {
  /** Horizontal advance in pixels (DWIDTH). */
  advance: number;
  /** Bitmap box: width, height and offset of its lower-left corner from the origin. */
  w: number;
  h: number;
  xOff: number;
  yOff: number;
  /** One entry per bitmap row (top first); bit (w-1-x) of rows[y] is pixel x. */
  rows: bigint[];
}

export interface BitmapFont {
  name: string;
  pixelSize: number;
  ascent: number;
  descent: number;
  glyphs: Map<number, Glyph>;
  fallback: Glyph | undefined;
}

/**
 * Glyphs decoded on first use: large CJK fonts have thousands of glyphs, and a screen
 * needs only a few dozen. `has` / `get` behave like a Map holding them all.
 */
class LazyGlyphs extends Map<number, Glyph> {
  constructor(private readonly lines: string[], private readonly index: Map<number, number>) { super(); }
  override has(cp: number): boolean { return this.index.has(cp); }
  override get size(): number { return this.index.size; }
  override get(cp: number): Glyph | undefined {
    let g = super.get(cp);
    if (g) return g;
    const at = this.index.get(cp);
    if (at === undefined) return undefined;
    g = decodeGlyph(this.lines, at);
    super.set(cp, g);
    return g;
  }
  override *keys(): MapIterator<number> { yield* this.index.keys(); }
}

/** Decodes the glyph whose STARTCHAR line is lines[i]. */
function decodeGlyph(lines: string[], i: number): Glyph {
  let advance = 0, w = 0, h = 0, xOff = 0, yOff = 0;
  i++;
  for (; i < lines.length && lines[i] !== "BITMAP"; i++) {
    const p = lines[i].split(" ");
    if (p[0] === "DWIDTH") advance = Number(p[1]);
    else if (p[0] === "BBX") [w, h, xOff, yOff] = p.slice(1, 5).map(Number);
  }
  i++; // skip BITMAP
  const rows: bigint[] = [];
  const shift = BigInt(Math.ceil(w / 8) * 8 - w);
  // Hex rows are left-aligned to whole bytes; shift so bit (w-1) is the leftmost pixel.
  for (; i < lines.length && lines[i] !== "ENDCHAR"; i++) rows.push(BigInt("0x" + (lines[i] || "0")) >> shift);
  return { advance, w, h, xOff, yOff, rows };
}

export function parseBdf(text: string, name = "bdf"): BitmapFont {
  // Trim: some BDF files (e.g. WenQuanYi) have trailing spaces, like "BITMAP ".
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  const font: BitmapFont = { name, pixelSize: 0, ascent: 0, descent: 0, glyphs: new Map(), fallback: undefined };
  let defaultChar = -1;
  let i = 0;
  for (; i < lines.length && !lines[i].startsWith("STARTCHAR"); i++) {
    const [key, ...rest] = lines[i].split(" ");
    if (key === "PIXEL_SIZE") font.pixelSize = Number(rest[0]);
    else if (key === "FONT_ASCENT") font.ascent = Number(rest[0]);
    else if (key === "FONT_DESCENT") font.descent = Number(rest[0]);
    else if (key === "DEFAULT_CHAR") defaultChar = Number(rest[0]);
  }
  // index: code point -> line of its STARTCHAR (ENCODING follows within a few lines)
  const index = new Map<number, number>();
  for (; i < lines.length; i++) {
    if (!lines[i].startsWith("STARTCHAR")) continue;
    for (let k = i + 1; k < i + 8 && k < lines.length; k++) {
      if (lines[k].startsWith("ENCODING ")) { const enc = Number(lines[k].slice(9)); if (enc >= 0) index.set(enc, i); break; }
    }
  }
  font.glyphs = new LazyGlyphs(lines, index);
  font.fallback = font.glyphs.get(defaultChar) ?? font.glyphs.get(0x3f);
  return font;
}

export function loadBdf(path: string): BitmapFont {
  const raw = readFileSync(path);
  const text = path.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return parseBdf(text, path.split(/[\\/]/).pop());
}

/** Doubles every pixel of every bit in a row (k times), for integer-scaled bitmap fonts. */
function widenRow(bits: bigint, w: number, k: number): bigint {
  let out = 0n;
  for (let x = 0; x < w; x++) {
    const on = (bits >> BigInt(w - 1 - x)) & 1n;
    for (let j = 0; j < k; j++) out = (out << 1n) | on;
  }
  return out;
}

/**
 * A bitmap font with every pixel drawn as a k x k block: crisp, even strokes at large
 * sizes on coarse panels (glyphs scaled on first use).
 */
export function scaleFont(base: BitmapFont, k: number): BitmapFont {
  const scaled = new Map<number, Glyph>();
  const scale = (g: Glyph): Glyph => ({
    advance: g.advance * k, w: g.w * k, h: g.h * k, xOff: g.xOff * k, yOff: g.yOff * k,
    rows: g.rows.flatMap((r) => Array<bigint>(k).fill(widenRow(r, g.w, k))),
  });
  const glyphs = new (class extends Map<number, Glyph> {
    override has(cp: number) { return base.glyphs.has(cp); }
    override get size() { return base.glyphs.size; }
    override get(cp: number) {
      let g = scaled.get(cp);
      if (g) return g;
      const b = base.glyphs.get(cp);
      if (!b) return undefined;
      g = scale(b);
      scaled.set(cp, g);
      return g;
    }
  })();
  return {
    name: `${base.name}x${k}`, pixelSize: base.pixelSize * k, ascent: base.ascent * k, descent: base.descent * k,
    glyphs, fallback: base.fallback && scale(base.fallback),
  };
}

/** `font` with the glyphs of `extra` it lacks (same size and baseline), looked up lazily. */
export function withExtraGlyphs(font: BitmapFont, extra: BitmapFont): BitmapFont {
  const own = font.glyphs;
  const glyphs = new (class extends Map<number, Glyph> {
    override has(cp: number) { return own.has(cp) || extra.glyphs.has(cp); }
    override get size() { return own.size + extra.glyphs.size; }
    override get(cp: number) { return own.get(cp) ?? extra.glyphs.get(cp); }
  })();
  return { ...font, glyphs };
}

export function glyphFor(font: BitmapFont, cp: number): Glyph | undefined {
  return font.glyphs.get(cp) ?? font.fallback;
}

/** Width in pixels of `text` when drawn with `font`. */
export function measure(font: BitmapFont, text: string): number {
  let w = 0;
  for (const ch of text) w += glyphFor(font, ch.codePointAt(0)!)?.advance ?? 0;
  return w;
}

/** Line height (ascent + descent). */
export function lineHeight(font: BitmapFont): number {
  return font.ascent + font.descent;
}

/**
 * Calls `plot(x, y)` for every set pixel of `text`, with the top of the line box at
 * `top` (baseline = top + ascent). Returns the x after the last glyph.
 */
export function rasterize(font: BitmapFont, text: string, x: number, top: number,
                          plot: (x: number, y: number) => void): number {
  const baseline = top + font.ascent;
  for (const ch of text) {
    const g = glyphFor(font, ch.codePointAt(0)!);
    if (!g) continue;
    const gx = x + g.xOff;
    const gy = baseline - g.yOff - g.h; // top row of the bitmap
    for (let r = 0; r < g.h; r++) {
      const bits = g.rows[r];
      if (bits === 0n) continue;
      for (let c = 0; c < g.w; c++) {
        if ((bits >> BigInt(g.w - 1 - c)) & 1n) plot(gx + c, gy + r);
      }
    }
    x += g.advance;
  }
  return x;
}

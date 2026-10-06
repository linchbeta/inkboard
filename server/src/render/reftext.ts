// Text helpers for layouts ported from the EPD-nRF5 reference: fonts carry the u8g2
// metrics the reference computes positions with, text is placed by baseline (GFX cursor
// semantics), and widths follow GFX_getUTF8Width.
import type { Canvas } from "./canvas.js";
import { type BitmapFont, glyphFor, rasterize } from "./bdf.js";
import { fonts, bigFont, type BigFamily } from "./fonts.js";
import { Ink } from "../panels.js";
import { batteryLevel } from "../data/calendar.js";

/** A font plus the u8g2 metrics the reference layout is computed with. */
export interface RefFont { f: BitmapFont; ascent: number; descent: number }

export interface InkBox { x0: number; x1: number; y0: number; y1: number }

/** The reference's fonts (u8g2 names) mapped to our bitmap fonts + their u8g2 metrics. */
export function refFonts() {
  const F = fonts();
  return {
    helvB18: { f: F.helv25, ascent: 19, descent: -5 } as RefFont,
    helvB14: { f: F.helv20, ascent: 14, descent: -4 } as RefFont,
    wqy12: { f: F.wqy16, ascent: 11, descent: -3 } as RefFont, // reference "wqy12" = 16px
    wqy9: { f: F.wqy12, ascent: 8, descent: -2 } as RefFont,   // reference "wqy9" = 12px
    wqy6: { f: F.tiny9, ascent: 7, descent: -2 } as RefFont,   // reference "wqy6" = 9px
  };
}

export const height = (rf: RefFont): number => rf.ascent - rf.descent;

/** GFX_getUTF8Width: advances, but the last glyph counts its real ink width + x offset. */
export function width(rf: RefFont, s: string): number {
  let w = 0;
  let last: ReturnType<typeof glyphFor>;
  for (const ch of s) {
    last = glyphFor(rf.f, ch.codePointAt(0)!);
    w += last?.advance ?? 0;
  }
  if (last && last.w !== 0) w = w - last.advance + last.w + last.xOff;
  return w;
}

/** Exact bounding box of the set pixels of `s` drawn at (x, baseline), or undefined if blank. */
export function inkBounds(rf: RefFont, s: string, x: number, baseline: number): InkBox | undefined {
  let b: InkBox | undefined;
  for (const ch of s) {
    const g = glyphFor(rf.f, ch.codePointAt(0)!);
    if (!g) continue;
    const top = baseline - g.yOff - g.h;
    let cols = 0n;
    g.rows.forEach((bits, r) => {
      if (bits === 0n) return;
      cols |= bits;
      const y = top + r;
      b = b ? { ...b, y0: Math.min(b.y0, y), y1: Math.max(b.y1, y) } : { x0: Infinity, x1: -Infinity, y0: y, y1: y };
    });
    if (cols !== 0n) {
      let first = -1, last = -1;
      for (let cIdx = 0; cIdx < g.w; cIdx++) {
        if ((cols >> BigInt(g.w - 1 - cIdx)) & 1n) { if (first < 0) first = cIdx; last = cIdx; }
      }
      b!.x0 = Math.min(b!.x0, x + g.xOff + first);
      b!.x1 = Math.max(b!.x1, x + g.xOff + last);
    }
    x += g.advance;
  }
  return b;
}

/** Draws with the text baseline at `baseline`; returns the new x. */
export function print(c: Canvas, rf: RefFont, s: string, x: number, baseline: number, ink: Ink): number {
  return c.text(rf.f, s, x, baseline - rf.f.ascent, ink);
}

/** Like print, but pixels landing on red are drawn white. */
export function printOverRed(c: Canvas, rf: RefFont, s: string, x: number, baseline: number, ink: Ink): number {
  return rasterize(rf.f, s, x, baseline - rf.f.ascent, (px, py) => {
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return;
    c.set(px, py, c.get(px, py) === Ink.Red ? Ink.White : ink);
  });
}

/** x so that the ink of `s` is horizontally centred on cx. */
export function centeredX(rf: RefFont, s: string, cx: number): number {
  const b = inkBounds(rf, s, 0, 0);
  return b ? Math.round(cx - (b.x0 + b.x1) / 2) : cx;
}

/** x and baseline so that the ink of `s` is centred on (cx, cy). */
export function centeredAt(rf: RefFont, s: string, cx: number, cy: number): { x: number; baseline: number } {
  const b = inkBounds(rf, s, 0, 0);
  if (!b) return { x: cx, baseline: cy };
  return { x: Math.round(cx - (b.x0 + b.x1) / 2), baseline: Math.round(cy - (b.y0 + b.y1) / 2) };
}

/**
 * Battery as in the reference's DrawBattery(gfx, x, y, iw, voltage): "3.9V" text left of a
 * 20x10 icon whose right edge is at x. One decimal only, so ADC jitter does not change the frame.
 */
export function drawBattery(c: Canvas, x: number, y: number, volts: number): void {
  const { wqy9 } = refFonts();
  const mv = Math.round(volts * 1000);
  const iw = 20;
  const bx = x - iw;
  const level = batteryLevel(mv);
  print(c, wqy9, `${Math.floor(mv / 1000)}.${Math.floor((mv % 1000) / 100)}V`, bx - width(wqy9, "3.2V") - 2, y + 9, Ink.Black);
  c.rect(bx, y, bx + iw, y + 10, Ink.White);
  c.frame(bx, y, bx + iw, y + 10, Ink.Black);
  c.rect(bx + iw, y + 4, bx + iw + 2, y + 6, Ink.Black);
  c.rect(bx + 2, y + 2, bx + 2 + Math.floor((16 * level) / 100), y + 8, Ink.Black);
}

/** A large font (see fonts.ts) as a RefFont, so print / width / centring work with it. */
export function bigRef(family: BigFamily, px: number): RefFont {
  const f = bigFont(family, px);
  // Noto Sans SC reports generous line metrics (24 px -> ascent 28 + descent 7); lay it
  // out on its em box instead (ideographs sit from 0.88 em above to 0.12 em below the baseline)
  if (family === "sans") return { f, ascent: Math.round(px * 0.88), descent: -Math.round(px * 0.12) };
  return { f, ascent: f.ascent, descent: -f.descent };
}

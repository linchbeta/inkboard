// Large 7-segment numbers, ported from the EPD-nRF5 reference's Draw7Number()
// (originally contributed by William Zaggle to the Arduino forum). Built from tapered
// line segments, so the digits stay crisp at any integer size.
//
//   cS = segment size; one digit is (11*cS + 2) wide (incl. spacing), 20*cS + 4 tall.
//   nD = digit cells (negative = blank leading zeros instead of "0").
import type { Canvas } from "./canvas.js";
import type { Ink } from "../panels.js";

const DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x00, 0x40];

const hline = (c: Canvas, x: number, y: number, w: number, ink: Ink) => { if (w > 0) c.rect(x, y, x + w, y + 1, ink); };
const vline = (c: Canvas, x: number, y: number, h: number, ink: Ink) => { if (h > 0) c.rect(x, y, x + 1, y + h, ink); };

/** Draws `n` with its top-left corner at (xLoc, yLoc). Unlit segments are drawn in `bg`. */
export function draw7Number(c: Canvas, n: number, xLoc: number, yLoc: number, cS: number,
                            fg: Ink, bg: Ink, nD: number): void {
  let num = Math.abs(n);
  const S2 = 5 * cS, S3 = 2 * cS, S4 = 7 * cS;
  const x1 = cS + 1, x2 = S3 + S2 + 1, y1 = yLoc + x1, y3 = yLoc + S3 + S4 + 1;
  // [x offset, y, horizontal?] for segments a..g
  const seg: [number, number, boolean][] = [
    [x1, yLoc, true], [x2, y1, false], [x2, y3 + x1, false], [x1, 2 * y3 - yLoc, true],
    [0, y3 + x1, false], [0, y1, false], [x1, y3, true],
  ];
  let cnt = Math.min(10, Math.max(1, Math.abs(nD)));
  const d = S2 + 3 * S3 + 2;
  xLoc += cnt * d;
  for (; cnt > 0; cnt--) {
    const i = num > 9 ? num % 10 : nD < 0 && num === 0 ? 10 : num;
    xLoc -= d;
    num = Math.floor(num / 10);
    for (let j = 0; j < 7; j++) {
      const ink = DIGITS[i] & (1 << j) ? fg : bg;
      const [ox, oy, horiz] = seg[j];
      let w: number, t: number, h: number, a: number, b: number;
      if (horiz) {
        w = S2; t = oy + S3; h = oy + cS; a = xLoc + ox + cS; b = oy;
        for (; b < h; b++, a--, w += 2) hline(c, a, b, w, ink);
      } else {
        w = S4; t = xLoc + ox + S3; h = xLoc + ox + cS; b = xLoc + ox; a = oy + cS;
        for (; b < h; b++, a--, w += 2) vline(c, b, a, w, ink);
      }
      for (; b < t; b++, a++, w -= 2) {
        if (horiz) hline(c, a, b, w, ink); else vline(c, b, a, w, ink);
      }
    }
  }
}

/** Width and height of an nD-digit 7-segment number at size cS (as used by the reference). */
export function size7(cS: number, nD: number): { w: number; h: number } {
  return { w: Math.abs(nD) * (11 * cS + 2) - 2 * cS, h: 20 * cS + 4 };
}

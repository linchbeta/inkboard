// Adafruit-GFX-compatible primitives (same integer algorithms as the GFX library the
// EPD-nRF5 reference uses), so ported layouts match it pixel for pixel.
import type { Canvas } from "./canvas.js";
import type { Ink } from "../panels.js";

export function vline(c: Canvas, x: number, y: number, h: number, ink: Ink): void {
  if (h <= 0) return;
  c.rect(x, y, x + 1, y + h, ink);
}

export function fillCircleHelper(c: Canvas, x0: number, y0: number, r: number, corners: number,
                                 delta: number, ink: Ink): void {
  let f = 1 - r;
  let ddFx = 1;
  let ddFy = -2 * r;
  let x = 0;
  let y = r;
  let px = x;
  let py = y;
  delta++;
  while (x < y) {
    if (f >= 0) { y--; ddFy += 2; f += ddFy; }
    x++;
    ddFx += 2;
    f += ddFx;
    if (x < y + 1) {
      if (corners & 1) vline(c, x0 + x, y0 - y, 2 * y + delta, ink);
      if (corners & 2) vline(c, x0 - x, y0 - y, 2 * y + delta, ink);
    }
    if (y !== py) {
      if (corners & 1) vline(c, x0 + py, y0 - px, 2 * px + delta, ink);
      if (corners & 2) vline(c, x0 - py, y0 - px, 2 * px + delta, ink);
      py = y;
    }
    px = x;
  }
}

/** Filled circle of radius r centred on (x0, y0). */
export function fillCircle(c: Canvas, x0: number, y0: number, r: number, ink: Ink): void {
  vline(c, x0, y0 - r, 2 * r + 1, ink);
  fillCircleHelper(c, x0, y0, r, 3, 0, ink);
}

/** 1px circle outline (midpoint algorithm). */
export function drawCircle(c: Canvas, x0: number, y0: number, r: number, ink: Ink): void {
  let f = 1 - r;
  let ddFx = 1;
  let ddFy = -2 * r;
  let x = 0;
  let y = r;
  c.set(x0, y0 + r, ink); c.set(x0, y0 - r, ink); c.set(x0 + r, y0, ink); c.set(x0 - r, y0, ink);
  while (x < y) {
    if (f >= 0) { y--; ddFy += 2; f += ddFy; }
    x++;
    ddFx += 2;
    f += ddFx;
    c.set(x0 + x, y0 + y, ink); c.set(x0 - x, y0 + y, ink); c.set(x0 + x, y0 - y, ink); c.set(x0 - x, y0 - y, ink);
    c.set(x0 + y, y0 + x, ink); c.set(x0 - y, y0 + x, ink); c.set(x0 + y, y0 - x, ink); c.set(x0 - y, y0 - x, ink);
  }
}

export function fillRoundRect(c: Canvas, x: number, y: number, w: number, h: number, r: number, ink: Ink): void {
  const maxRadius = Math.floor(Math.min(w, h) / 2);
  if (r > maxRadius) r = maxRadius;
  c.rect(x + r, y, x + w - r, y + h, ink);
  fillCircleHelper(c, x + w - r - 1, y + r, r, 1, h - 2 * r - 1, ink);
  fillCircleHelper(c, x + r, y + r, r, 2, h - 2 * r - 1, ink);
}

/** Dotted line from (x0,y0) to (x1,y1), inclusive: `dot` px on, `space` px off. */
export function dottedLine(c: Canvas, x0: number, y0: number, x1: number, y1: number, ink: Ink,
                           dot: number, space: number): void {
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1]; }
  if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
  const dx = x1 - x0;
  const dy = Math.abs(y1 - y0);
  let err = Math.trunc(dx / 2);
  const ystep = y0 < y1 ? 1 : -1;
  let draw = true;
  let len = 0;
  for (; x0 <= x1; x0++) {
    if (draw) {
      if (steep) c.set(y0, x0, ink); else c.set(x0, y0, ink);
      if (++len >= dot) { len = 0; draw = false; }
    } else if (++len >= space) {
      len = 0;
      draw = true;
    }
    err -= dy;
    if (err < 0) { y0 += ystep; err += dx; }
  }
}

// Weather icons drawn from geometry (circles, thick lines, polygons) at any integer size,
// so they stay crisp on e-paper. Outlines are solid black; at 32 px and up the interiors
// are coloured with tones, dithered with Floyd–Steinberg at the end (see dither.ts):
//   sun   yellow core shading to orange at the rim, red rays
//   moon  yellow with a pale-yellow terminator
//   cloud white at the top shading to light grey underneath (darker for rain/storm)
//   bolt  yellow with an orange tip
// Below 32 px the dots would only add noise, so small icons use flat inks. On B/W/R
// panels yellow renders as red, so the colour parts become red and the greys stay.
import type { Canvas } from "./canvas.js";
import { Ink } from "../panels.js";
import type { IconKind } from "../data/weather.js";
import { type Paint, paintPixel } from "./dither.js";

interface Circle { x: number; y: number; r: number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function disk(c: Canvas, cx: number, cy: number, r: number, paint: Paint): void {
  const rr = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rr) paintPixel(c, paint, x, y);
    }
  }
}

/** Union of circles (+ optional rect), filled; `grow` enlarges every part (for outlines). */
function fillUnion(c: Canvas, circles: Circle[], rect: [number, number, number, number] | undefined,
                   grow: number, paint: Paint): void {
  for (const k of circles) disk(c, k.x, k.y, k.r + grow, paint);
  if (!rect) return;
  const x0 = Math.round(rect[0] - grow), y0 = Math.round(rect[1] - grow);
  const x1 = Math.round(rect[2] + grow), y1 = Math.round(rect[3] + grow);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) paintPixel(c, paint, x, y);
}

/** Line of thickness t (round caps). */
function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, t: number, paint: Paint): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) disk(c, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, t / 2, paint);
}

/** Even-odd scanline polygon fill. */
function fillPolygon(c: Canvas, pts: [number, number][], paint: Paint): void {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) {
        xs.push(ax + ((y + 0.5 - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) paintPixel(c, paint, x, y);
    }
  }
}

function sun(c: Canvas, cx: number, cy: number, r: number, t: number, color: boolean): void {
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    line(c, cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r * 1.4,
            cx + Math.cos(a) * r * 1.85, cy + Math.sin(a) * r * 1.85, t, color ? Ink.Red : Ink.Black);
  }
  disk(c, cx, cy, r + t, Ink.Black);
  // yellow core, shading to orange towards the rim
  const face: Paint = color
    ? (x, y) => {
        const red = 0.55 * clamp01((Math.hypot(x - cx, y - cy) / r - 0.45) / 0.55);
        return [[Ink.Red, red], [Ink.Yellow, 1 - red]];
      }
    : Ink.Yellow;
  disk(c, cx, cy, r, face);
}

function moon(c: Canvas, cx: number, cy: number, r: number, t: number, color: boolean): void {
  // the lit side (towards the bite) is full yellow, the far side fades to pale yellow
  const bx = cx + r * 0.55, by = cy - r * 0.45;
  const face: Paint = color
    ? (x, y) => {
        const d = Math.hypot(x - bx, y - by) / (2 * r);
        return [[Ink.Yellow, 1 - 0.5 * clamp01((d - 0.5) / 0.5)]];
      }
    : Ink.Yellow;
  disk(c, cx, cy, r + t, Ink.Black);
  disk(c, cx, cy, r, face);
  // bite out a crescent: white disk offset up-right, with its own outline inside the moon
  disk(c, bx, by, r * 0.85 + t, Ink.Black);
  disk(c, bx, by, r * 0.85, Ink.White);
  // clean the part of the bite that lies outside the moon
  for (let y = Math.floor(cy - 2 * r); y <= cy + 2 * r; y++) for (let x = Math.floor(cx - 2 * r); x <= cx + 2 * r; x++) {
    const inMoon = (x - cx) ** 2 + (y - cy) ** 2 <= (r + t) ** 2;
    const inBite = (x - bx) ** 2 + (y - by) ** 2 <= (r * 0.85 + t) ** 2;
    if (inBite && !inMoon) c.set(x, y, Ink.White);
  }
}

/**
 * Cloud occupying roughly [x, x+w] x [y, y+0.62w]. `shade` is the grey (black share)
 * reached at the bottom of the cloud; the top stays white.
 */
function cloud(c: Canvas, x: number, y: number, w: number, t: number, shade: number): void {
  const circles: Circle[] = [
    { x: x + w * 0.52, y: y + w * 0.3, r: w * 0.24 },
    { x: x + w * 0.27, y: y + w * 0.42, r: w * 0.17 },
    { x: x + w * 0.76, y: y + w * 0.43, r: w * 0.16 },
  ];
  const rect: [number, number, number, number] = [x + w * 0.27, y + w * 0.42, x + w * 0.76, y + w * 0.59];
  fillUnion(c, circles, rect, t, Ink.Black);
  const top = y + w * 0.06, bottom = y + w * 0.59;
  const body: Paint = shade > 0
    ? (_px, py) => [[Ink.Black, shade * clamp01((py - top) / (bottom - top) - 0.25) / 0.75]]
    : Ink.White;
  fillUnion(c, circles, rect, 0, body);
}

/**
 * Draws a weather icon in the square [x, x+size) x [y, y+size).
 * Stroke width scales with size (1 px at 16, 2 px at 32+, 3 px at 72+).
 */
export function drawWeatherIcon(c: Canvas, kind: IconKind, isDay: boolean, x: number, y: number, size: number): void {
  const s = size;
  const t = s >= 72 ? 3 : s >= 32 ? 2 : 1;
  const color = s >= 32;
  const light = color ? 0.25 : 0;   // plain cloud underside
  const dark = color ? 0.5 : 0;     // rain / snow / storm cloud underside
  switch (kind) {
    case "clear":
      if (isDay) sun(c, x + s / 2, y + s / 2, s * 0.22, t, color);
      else moon(c, x + s / 2, y + s / 2, s * 0.3, t, color);
      return;
    case "partly":
      if (isDay) sun(c, x + s * 0.36, y + s * 0.36, s * 0.16, t, color);
      else moon(c, x + s * 0.38, y + s * 0.34, s * 0.2, t, color);
      cloud(c, x + s * 0.22, y + s * 0.36, s * 0.76, t, light);
      return;
    case "cloudy":
      cloud(c, x + s * 0.06, y + s * 0.18, s * 0.88, t, light);
      return;
    case "fog":
      cloud(c, x + s * 0.12, y + s * 0.06, s * 0.76, t, light);
      for (let k = 0; k < 3; k++) {
        const yy = y + s * (0.62 + k * 0.13);
        line(c, x + s * (0.14 + (k % 2) * 0.08), yy, x + s * (0.86 - (k % 2) * 0.08), yy, t, Ink.Black);
      }
      return;
    case "rain":
      cloud(c, x + s * 0.1, y + s * 0.04, s * 0.8, t, dark);
      for (let k = 0; k < 4; k++) {
        const xx = x + s * (0.24 + k * 0.17);
        line(c, xx, y + s * 0.66, xx - s * 0.07, y + s * 0.9, t, Ink.Black);
      }
      return;
    case "snow":
      cloud(c, x + s * 0.1, y + s * 0.04, s * 0.8, t, dark);
      for (let k = 0; k < 3; k++) {
        const cx = x + s * (0.28 + k * 0.22), cy = y + s * (k % 2 ? 0.86 : 0.76), r = s * 0.07;
        for (let a = 0; a < 3; a++) {
          const ang = (a * Math.PI) / 3;
          line(c, cx - Math.cos(ang) * r, cy - Math.sin(ang) * r, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, Math.max(1, t - 1), Ink.Black);
        }
      }
      return;
    case "thunder": {
      cloud(c, x + s * 0.1, y + s * 0.02, s * 0.8, t, dark);
      const bolt: [number, number][] = [
        [x + s * 0.52, y + s * 0.52], [x + s * 0.36, y + s * 0.76], [x + s * 0.5, y + s * 0.76],
        [x + s * 0.42, y + s * 0.98], [x + s * 0.66, y + s * 0.68], [x + s * 0.53, y + s * 0.68], [x + s * 0.62, y + s * 0.52],
      ];
      // outline: the bolt grown by t, then the yellow bolt with an orange lower tip
      for (const [dx, dy] of [[-t, 0], [t, 0], [0, -t], [0, t]]) fillPolygon(c, bolt.map(([px, py]) => [px + dx, py + dy]), Ink.Black);
      const fill: Paint = color
        ? (px, py) => {
            const red = 0.5 * clamp01((py - (y + s * 0.7)) / (s * 0.28));
            return [[Ink.Red, red], [Ink.Yellow, 1 - red]];
          }
        : Ink.Yellow;
      fillPolygon(c, bolt, fill);
      return;
    }
  }
}

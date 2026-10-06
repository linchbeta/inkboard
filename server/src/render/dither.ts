// Dithering for vector fills: mixes panel inks into in-between tones (orange = red +
// yellow, greys = black + white, ...). Shapes mark their interior pixels with a tone
// (`Canvas.setTone`); `resolveTones` then runs Floyd–Steinberg error diffusion over just
// those pixels, matching against the panel's measured colours (like the reference web
// tool does for photos). Edges, outlines and text stay solid; error never leaks across
// them. Until resolved, toned pixels show a Bayer 4x4 ordered-dither fallback.
import { Ink, type Panel, effectiveInk } from "../panels.js";
import type { Canvas } from "./canvas.js";

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Weights of non-white inks; the rest of the pixels stay white. Sum must be <= 1. */
export type Tone = readonly (readonly [Ink, number])[];

/** A solid ink or a position-dependent tone (gradients). */
export type Paint = Ink | ((x: number, y: number) => Tone);

/** Ordered-dither ink of `tone` at pixel (x, y) (the fallback before resolving). */
export function ditherInk(tone: Tone, x: number, y: number): Ink {
  const t = (BAYER4[y & 3][x & 3] + 0.5) / 16;
  let acc = 0;
  for (const [ink, w] of tone) {
    acc += w;
    if (t < acc) return ink;
  }
  return Ink.White;
}

/** Paints one pixel: solid ink, or a tone left for `resolveTones`. */
export function paintPixel(c: Canvas, paint: Paint, x: number, y: number): void {
  if (typeof paint !== "function") { c.set(x, y, paint); return; }
  const tone = paint(x, y);
  c.setTone(x, y, tone, ditherInk(tone, x, y));
}

export const TONES = {
  orange: [[Ink.Red, 0.5], [Ink.Yellow, 0.5]],
  lightOrange: [[Ink.Red, 0.25], [Ink.Yellow, 0.75]],
  paleYellow: [[Ink.Yellow, 0.5]],
  grey25: [[Ink.Black, 0.25]],
  grey50: [[Ink.Black, 0.5]],
} satisfies Record<string, Tone>;

const INKS = [Ink.Black, Ink.White, Ink.Yellow, Ink.Red] as const;

/**
 * Floyd–Steinberg (serpentine) over the toned pixels, quantising each to the closest
 * ink the panel can show (by measured colour). Clears the tone layer afterwards.
 */
export function resolveTones(c: Canvas, panel: Panel): void {
  const mask = c.toneMask, tone = c.tone;
  if (!mask || !tone) return;
  const rgb = (ink: Ink): [number, number, number] => {
    const m = panel.measured;
    const e = effectiveInk(panel, ink);
    return e === Ink.Black ? m.black : e === Ink.White ? m.white : e === Ink.Yellow ? m.yellow : m.red;
  };
  const colours = INKS.map((i) => rgb(i));
  const usable = INKS.filter((i) => effectiveInk(panel, i) === i);
  const W = c.width, H = c.height;
  // target colour of every toned pixel, in a working buffer that accumulates error
  const work = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    let white = 1;
    for (let k = 0; k < 3; k++) work[i * 3 + k] = 0;
    for (const ink of [Ink.Black, Ink.Yellow, Ink.Red]) {
      const w = tone[i * 4 + ink];
      if (!w) continue;
      white -= w;
      for (let k = 0; k < 3; k++) work[i * 3 + k] += w * colours[ink][k];
    }
    for (let k = 0; k < 3; k++) work[i * 3 + k] += Math.max(0, white) * colours[Ink.White][k];
  }
  // Only the inks a pixel's tone mixes are candidates: a grey must never pick up red or
  // yellow dots from accumulated error (and an orange no black or white ones). Shares are
  // counted per ink the panel really shows (yellow counts as red on B/W/R).
  const nearest = (i: number, r: number, g: number, b: number): Ink => {
    const share = [0, 0, 0, 0];
    let rest = 1;
    for (const ink of [Ink.Black, Ink.Yellow, Ink.Red]) {
      share[effectiveInk(panel, ink)] += tone[i * 4 + ink];
      rest -= tone[i * 4 + ink];
    }
    share[Ink.White] += rest;
    let best: Ink = Ink.White, bestD = Infinity;
    for (const ink of usable) {
      if (share[ink] <= 0.001) continue;
      const [cr, cg, cb] = colours[ink];
      // weighted RGB distance (green counts most for perceived lightness)
      const d = 2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2;
      if (d < bestD) { bestD = d; best = ink; }
    }
    return best;
  };

  // Panels whose colour particles need neighbours (lone red / yellow pixels show dark on
  // the 3.98"): colourful tones are dithered in dot x dot blocks first.
  const dot = panel.colorDot ?? 1;
  if (dot > 1) {
    const BW = Math.floor(W / dot), BH = Math.floor(H / dot);
    const bwork = new Float32Array(BW * BH * 3), bmask = new Uint8Array(BW * BH);
    const colourful = (i: number) => tone[i * 4 + Ink.Red] + tone[i * 4 + Ink.Yellow] > 0.001;
    for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
      let ok = true;
      for (let dy = 0; dy < dot && ok; dy++) for (let dx = 0; dx < dot; dx++) {
        const i = (by * dot + dy) * W + bx * dot + dx;
        if (!mask[i] || !colourful(i)) { ok = false; break; }
      }
      if (!ok) continue;
      const b = by * BW + bx;
      bmask[b] = 1;
      for (let dy = 0; dy < dot; dy++) for (let dx = 0; dx < dot; dx++) {
        const i = (by * dot + dy) * W + bx * dot + dx;
        for (let k = 0; k < 3; k++) bwork[b * 3 + k] += work[i * 3 + k] / (dot * dot);
      }
    }
    const bspread = (x: number, y: number, err: number[], f: number) => {
      if (x < 0 || x >= BW || y >= BH) return;
      const j = y * BW + x;
      if (!bmask[j]) return;
      for (let k = 0; k < 3; k++) bwork[j * 3 + k] += err[k] * f;
    };
    for (let by = 0; by < BH; by++) {
      const dir = (by & 1) === 0 ? 1 : -1;
      for (let n = 0; n < BW; n++) {
        const bx = dir > 0 ? n : BW - 1 - n;
        const b = by * BW + bx;
        if (!bmask[b]) continue;
        const i0 = by * dot * W + bx * dot;
        const r = bwork[b * 3], g = bwork[b * 3 + 1], bl = bwork[b * 3 + 2];
        const best = nearest(i0, r, g, bl);
        for (let dy = 0; dy < dot; dy++) for (let dx = 0; dx < dot; dx++) {
          const i = (by * dot + dy) * W + bx * dot + dx;
          c.px[i] = best;
          mask[i] = 0; // done: the per-pixel pass below skips it
        }
        const err = [r - colours[best][0], g - colours[best][1], bl - colours[best][2]];
        bspread(bx + dir, by, err, 7 / 16);
        bspread(bx - dir, by + 1, err, 3 / 16);
        bspread(bx, by + 1, err, 5 / 16);
        bspread(bx + dir, by + 1, err, 1 / 16);
      }
    }
  }

  const spread = (x: number, y: number, err: number[], f: number) => {
    if (x < 0 || x >= W || y >= H) return;
    const j = y * W + x;
    if (!mask[j]) return; // never bleed into outlines, text or plain background
    for (let k = 0; k < 3; k++) work[j * 3 + k] += err[k] * f;
  };
  for (let y = 0; y < H; y++) {
    const ltr = (y & 1) === 0;
    const dir = ltr ? 1 : -1;
    for (let n = 0; n < W; n++) {
      const x = ltr ? n : W - 1 - n;
      const i = y * W + x;
      if (!mask[i]) continue;
      const r = work[i * 3], g = work[i * 3 + 1], b = work[i * 3 + 2];
      const best = nearest(i, r, g, b);
      c.px[i] = best;
      const err = [r - colours[best][0], g - colours[best][1], b - colours[best][2]];
      spread(x + dir, y, err, 7 / 16);
      spread(x - dir, y + 1, err, 3 / 16);
      spread(x, y + 1, err, 5 / 16);
      spread(x + dir, y + 1, err, 1 / 16);
    }
  }
  c.tone = undefined;
  c.toneMask = undefined;
}

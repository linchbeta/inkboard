// Photos on e-paper: cover-crop + area-average resize, then whole-image Floyd–Steinberg
// error diffusion (serpentine) to the inks the panel can show, matched by the panel's
// measured colours. Before dithering the image is mapped into the panel's real range
// (paper white is not 255, ink black is not 0), so white paper stays clean instead of
// collecting dots, and saturation is lifted a little because the inks are dull.
import { Canvas } from "./canvas.js";
import { Ink, type Panel, effectiveInk } from "../panels.js";
import type { RgbImage } from "./png.js";

/** Centre-crops `src` to the aspect of w x h and resizes it (box filter when shrinking). */
export function coverResize(src: RgbImage, w: number, h: number): RgbImage {
  const scale = Math.min(src.width / w, src.height / h); // source px per target px
  const cw = w * scale, ch = h * scale;
  const ox = (src.width - cw) / 2, oy = (src.height - ch) / 2;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(oy + y * scale), sy1 = Math.max(sy0 + 1, Math.floor(oy + (y + 1) * scale));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(ox + x * scale), sx1 = Math.max(sx0 + 1, Math.floor(ox + (x + 1) * scale));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < Math.min(sy1, src.height); sy++) {
        for (let sx = sx0; sx < Math.min(sx1, src.width); sx++) {
          const i = (sy * src.width + sx) * 3;
          r += src.rgb[i]; g += src.rgb[i + 1]; b += src.rgb[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 3;
      rgb[o] = r / n; rgb[o + 1] = g / n; rgb[o + 2] = b / n;
    }
  }
  return { width: w, height: h, rgb };
}

/** Rotates by quarter turns clockwise (0..3). */
export function rotate(img: RgbImage, quarter: number): RgbImage {
  const q = ((quarter % 4) + 4) % 4;
  if (q === 0) return img;
  const { width: w, height: h } = img;
  const W = q % 2 ? h : w, H = q % 2 ? w : h;
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [X, Y] = q === 1 ? [h - 1 - y, x] : q === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
    rgb.set(img.rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3), (Y * W + X) * 3);
  }
  return { width: W, height: H, rgb };
}

/**
 * Crops to a rectangle in fractions of the image (0..1 = the image). The rectangle may
 * reach beyond the image (zoomed out); that part is filled with white (paper).
 */
export function crop(img: RgbImage, r: { x: number; y: number; w: number; h: number }): RgbImage {
  const x0 = Math.round(r.x * img.width), y0 = Math.round(r.y * img.height);
  const w = Math.max(1, Math.round(r.w * img.width)), h = Math.max(1, Math.round(r.h * img.height));
  if (x0 === 0 && y0 === 0 && w === img.width && h === img.height) return img;
  const rgb = new Uint8Array(w * h * 3).fill(255);
  const sx0 = Math.max(0, x0), sx1 = Math.min(img.width, x0 + w);
  if (sx1 > sx0) {
    for (let y = Math.max(0, -y0); y < h && y0 + y < img.height; y++) {
      rgb.set(img.rgb.subarray(((y0 + y) * img.width + sx0) * 3, ((y0 + y) * img.width + sx1) * 3), (y * w + (sx0 - x0)) * 3);
    }
  }
  return { width: w, height: h, rgb };
}

export interface DitherOptions {
  /** -100..100, added to every channel (scaled to 0..255 / 100 * 0.5). */
  brightness?: number;
  /** Contrast multiplier around mid grey (1 = unchanged). */
  contrast?: number;
  /** Saturation multiplier (1 = unchanged, 0 = grey). */
  saturation?: number;
  /** Gamma on 0..1 values (<1 brightens mid tones, >1 darkens). */
  gamma?: number;
  /** Unsharp-mask amount (0 = off), applied after resizing. */
  sharpen?: number;
  /** Share of the quantisation error that is diffused (1 = classic Floyd–Steinberg). */
  strength?: number;
}

export const DITHER_DEFAULTS: Required<DitherOptions> = {
  brightness: 0, contrast: 1.1, saturation: 1.25, gamma: 1, sharpen: 0, strength: 1,
};

/** Unsharp mask with a 3x3 box blur. */
function sharpenImage(img: RgbImage, amount: number): RgbImage {
  if (amount <= 0) return img;
  const { width: w, height: h } = img;
  const rgb = new Uint8Array(img.rgb.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      sum += img.rgb[(yy * w + xx) * 3 + k]; n++;
    }
    const v = img.rgb[(y * w + x) * 3 + k];
    rgb[(y * w + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(v + amount * (v - sum / n))));
  }
  return { width: w, height: h, rgb };
}

/** Draws `img` (already sized) at (x, y), Floyd–Steinberg dithered to the panel's inks. */
export function ditherImage(c: Canvas, src: RgbImage, x0: number, y0: number, panel: Panel, opts: DitherOptions = {}): void {
  const o = { ...DITHER_DEFAULTS, ...opts };
  const img = sharpenImage(src, o.sharpen);
  const m = panel.measured;
  const inks = [Ink.Black, Ink.White, Ink.Yellow, Ink.Red].filter((i) => effectiveInk(panel, i) === i);
  const col = (i: Ink) => (i === Ink.Black ? m.black : i === Ink.White ? m.white : i === Ink.Yellow ? m.yellow : m.red);
  const pal = inks.map((i) => ({ ink: i, rgb: col(i) }));
  const lo = [0, 1, 2].map((k) => Math.min(...pal.map((p) => p.rgb[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...pal.map((p) => p.rgb[k])));
  const { width: w, height: h } = img;
  const work = new Float32Array(w * h * 3);
  const bright = o.brightness * 1.28;
  for (let i = 0; i < w * h; i++) {
    const yv = 0.299 * img.rgb[i * 3] + 0.587 * img.rgb[i * 3 + 1] + 0.114 * img.rgb[i * 3 + 2];
    for (let k = 0; k < 3; k++) {
      let v = yv + o.saturation * (img.rgb[i * 3 + k] - yv); // saturation
      v = 128 + o.contrast * (v - 128) + bright;            // contrast, brightness
      v = Math.max(0, Math.min(255, v)) / 255;
      if (o.gamma !== 1) v = Math.pow(v, o.gamma);
      work[i * 3 + k] = m.black[k] + v * (m.white[k] - m.black[k]); // into the panel's range
    }
  }
  const add = (x: number, y: number, e0: number, e1: number, e2: number, f: number) => {
    if (x < 0 || x >= w || y >= h) return;
    const j = (y * w + x) * 3;
    work[j] += e0 * f; work[j + 1] += e1 * f; work[j + 2] += e2 * f;
  };
  for (let y = 0; y < h; y++) {
    const ltr = (y & 1) === 0, dir = ltr ? 1 : -1;
    for (let n = 0; n < w; n++) {
      const x = ltr ? n : w - 1 - n;
      const i = (y * w + x) * 3;
      // Clamp to the panel's range: colours the inks cannot make (blue, green) would
      // otherwise pile up unbounded error and smear into blobs and streaks.
      const clampK = (v: number, k: number) => Math.max(lo[k], Math.min(hi[k], v));
      const r = clampK(work[i], 0), g = clampK(work[i + 1], 1), b = clampK(work[i + 2], 2);
      let best = pal[0], bestD = Infinity;
      for (const p of pal) {
        // "redmean" weighted RGB distance, a cheap approximation of perceived difference
        const rm = (r + p.rgb[0]) / 2;
        const dr = r - p.rgb[0], dg = g - p.rgb[1], db = b - p.rgb[2];
        const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
        if (d < bestD) { bestD = d; best = p; }
      }
      c.set(x0 + x, y0 + y, best.ink);
      const e0 = (r - best.rgb[0]) * o.strength, e1 = (g - best.rgb[1]) * o.strength, e2 = (b - best.rgb[2]) * o.strength;
      add(x + dir, y, e0, e1, e2, 7 / 16);
      add(x - dir, y + 1, e0, e1, e2, 3 / 16);
      add(x, y + 1, e0, e1, e2, 5 / 16);
      add(x + dir, y + 1, e0, e1, e2, 1 / 16);
    }
  }
}

/**
 * Built-in test chart for judging dithering without uploading anything: hue sweep
 * (fading to white at the top and black at the bottom), a grey ramp, and a warm and a
 * cool gradient.
 */
export function testChart(w = 1200, h = 860): RgbImage {
  const rgb = new Uint8Array(w * h * 3);
  const hsv = (hh: number, s: number, v: number): [number, number, number] => {
    const f = (n: number) => { const k = (n + hh * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  };
  const sweepH = Math.round(h * 0.62), rampH = Math.round(h * 0.12);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c: [number, number, number];
    const u = x / (w - 1);
    if (y < sweepH) {
      const t = y / (sweepH - 1); // 0 top .. 1 bottom
      c = t < 0.5 ? hsv(u, t * 2, 1) : hsv(u, 1, 1 - (t - 0.5) * 2 * 0.85);
    } else if (y < sweepH + rampH) {
      c = [u * 255, u * 255, u * 255];
    } else if (y < sweepH + rampH + (h - sweepH - rampH) / 2) {
      c = [255, 255 - 140 * u, 255 - 230 * u]; // white -> warm orange (skin, sunsets)
    } else {
      c = [255 - 200 * u, 255 - 120 * u, 255 - 40 * u]; // white -> sky blue (no blue ink: greys)
    }
    const o = (y * w + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  }
  return { width: w, height: h, rgb };
}

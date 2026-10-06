// Pixel canvas holding one Ink per pixel at the panel's native resolution.
// Everything is integer-aligned; nothing is ever scaled.
import { Ink } from "../panels.js";
import { type BitmapFont, rasterize, measure, lineHeight } from "./bdf.js";

export class Canvas {
  readonly px: Uint8Array;
  /**
   * Continuous-tone pixels waiting for error-diffusion dithering (see dither.ts):
   * per pixel the share of each ink (index = Ink), the rest white. `toneMask` marks them;
   * any solid drawing over a pixel clears its mark. Allocated on first use.
   */
  tone?: Float32Array;
  toneMask?: Uint8Array;

  constructor(readonly width: number, readonly height: number, background: Ink = Ink.White) {
    this.px = new Uint8Array(width * height).fill(background);
  }

  set(x: number, y: number, ink: Ink): void {
    // fractional coordinates would index the wrong pixel of the flat buffer
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      const i = y * this.width + x;
      this.px[i] = ink;
      if (this.toneMask) this.toneMask[i] = 0;
    }
  }

  /**
   * Marks a pixel as a mix of inks (`weights[ink]` shares, the rest white), resolved later
   * by `resolveTones`. `fallback` is shown if the canvas is never resolved.
   */
  setTone(x: number, y: number, weights: readonly (readonly [Ink, number])[], fallback: Ink): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (!this.tone) {
      this.tone = new Float32Array(this.width * this.height * 4);
      this.toneMask = new Uint8Array(this.width * this.height);
    }
    const i = y * this.width + x;
    this.tone.fill(0, i * 4, i * 4 + 4);
    for (const [ink, w] of weights) this.tone[i * 4 + ink] += w;
    this.toneMask![i] = 1;
    this.px[i] = fallback;
  }

  get(x: number, y: number): Ink {
    return this.px[y * this.width + x] as Ink;
  }

  /** Filled rectangle covering [x0, x1) x [y0, y1). */
  rect(x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
    // Round first: fractional bounds would index the wrong pixels in the flat buffer.
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(this.width, Math.round(x1)); y1 = Math.min(this.height, Math.round(y1));
    for (let y = y0; y < y1; y++) {
      this.px.fill(ink, y * this.width + x0, y * this.width + x1);
      this.toneMask?.fill(0, y * this.width + x0, y * this.width + x1);
    }
  }

  /** 1px outline of [x0, x1) x [y0, y1). */
  frame(x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
    this.rect(x0, y0, x1, y0 + 1, ink);
    this.rect(x0, y1 - 1, x1, y1, ink);
    this.rect(x0, y0, x0 + 1, y1, ink);
    this.rect(x1 - 1, y0, x1, y1, ink);
  }

  /** Horizontal dotted line: `on` px drawn, `off` px skipped. */
  dottedH(x0: number, x1: number, y: number, ink: Ink, on = 1, off = 4): void {
    for (let x = x0; x < x1; x++) if ((x - x0) % (on + off) < on) this.set(x, y, ink);
  }

  /** Vertical dotted line. */
  dottedV(x: number, y0: number, y1: number, ink: Ink, on = 1, off = 4): void {
    for (let y = y0; y < y1; y++) if ((y - y0) % (on + off) < on) this.set(x, y, ink);
  }

  /** Filled circle centred on (cx, cy). */
  fillCircle(cx: number, cy: number, r: number, ink: Ink): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) this.set(cx + x, cy + y, ink);
    }
  }

  /**
   * Draws `text` with a bitmap font, top of the line box at `top`. Returns the end x.
   * Pixels are copied exactly from the font: 1px strokes stay 1px.
   */
  text(font: BitmapFont, text: string, x: number, top: number, ink: Ink): number {
    return rasterize(font, text, x, top, (px, py) => this.set(px, py, ink));
  }

  /**
   * Large text: each font pixel becomes an exact `scale` x `scale` block (integer only,
   * so edges stay crisp). For headline digits until larger pixel fonts are bundled.
   */
  textScaled(font: BitmapFont, text: string, x: number, top: number, scale: number, ink: Ink): number {
    if (!Number.isInteger(scale) || scale < 1) throw new Error("scale must be a positive integer");
    rasterize(font, text, 0, 0, (px, py) => {
      this.rect(x + px * scale, top + py * scale, x + (px + 1) * scale, top + (py + 1) * scale, ink);
    });
    return x + measure(font, text) * scale;
  }

  /** Draws `text` horizontally centred in [x0, x1). */
  textCentered(font: BitmapFont, text: string, x0: number, x1: number, top: number, ink: Ink): void {
    this.text(font, text, x0 + Math.floor((x1 - x0 - measure(font, text)) / 2), top, ink);
  }

  /** Draws `text` right-aligned so it ends at x1. */
  textRight(font: BitmapFont, text: string, x1: number, top: number, ink: Ink): void {
    this.text(font, text, x1 - measure(font, text), top, ink);
  }
}

export { measure, lineHeight };

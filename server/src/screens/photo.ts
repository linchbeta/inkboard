// Photo frame ("相框"): an uploaded photo, Floyd–Steinberg dithered over the whole image.
// "frame" style: the photo on a white mat with a hairline keyline and a museum-label
// caption (red marker, title, date); "full" style: edge to edge. Without photos the
// built-in test chart is shown, so dithering can be judged right away.
import { Canvas } from "../render/canvas.js";
import { refFonts, width, print } from "../render/reftext.js";
import { coverResize, ditherImage, testChart, rotate, crop } from "../render/image.js";
import type { PhotoEdits } from "../data/photos.js";
import type { RgbImage } from "../render/png.js";
import { type Panel, Ink } from "../panels.js";
import type { ScreenContext } from "./testPattern.js";

export interface PhotoContext {
  title: string; date?: Date; image: RgbImage; style: "frame" | "full"; edits?: PhotoEdits;
  /** Rounded corners on square panels (the 3.98" follows its glass instead). */
  corner?: PhotoCorner;
}
export type PhotoCorner = "none" | "s" | "m" | "l";

/** Corner radius in pixels for a square panel: a share of its short side. */
export function cornerPx(panel: Panel, corner: PhotoCorner = "none"): number {
  if (panel.cornerRadius > 0) return 0;
  const k = { none: 0, s: 0.03, m: 0.05, l: 0.08 }[corner] ?? 0;
  return Math.round(Math.min(panel.width, panel.height) * k);
}

/** Rotation, crop, then cover-fit to w x h (the steps before tone and dithering). */
function prepared(p: PhotoContext, w: number, h: number): RgbImage {
  const e = p.edits;
  const img = e ? crop(rotate(p.image, e.rotate), e.crop) : p.image;
  return coverResize(img, w, h);
}

let chart: RgbImage | undefined;

/**
 * Where the photo goes, per panel and style (shared with the editor's crop frame).
 * On rounded panels (3.98") the frame drops the square keyline: the photo gets rounded
 * corners echoing the glass, a wider mat, and the caption is indented clear of the
 * panel's corner curve. Square panels keep the hairline keyline.
 */
export function photoArea(panel: Panel, style: "frame" | "full", corner: PhotoCorner = "none") {
  const W = panel.width, H = panel.height;
  const chosen = cornerPx(panel, corner); // square panels: the chosen rounding
  if (style === "full") return { x: 0, y: 0, w: W, h: H, radius: chosen, keyline: false, capH: 0, capInset: 0 };
  const large = H >= 400;
  const rounded = panel.cornerRadius > 0;
  const m = rounded ? Math.round(panel.cornerRadius * 0.67) : large ? 20 : 10; // mat
  const capH = large ? 44 : 26;
  return {
    x: m, y: m, w: W - 2 * m, h: H - m - capH,
    radius: rounded ? Math.round(panel.cornerRadius * 0.75) : chosen,
    keyline: !rounded && !chosen, // a square hairline only around square corners
    capH,
    capInset: rounded ? Math.round(panel.cornerRadius * 0.4) : 0, // caption clear of the glass corner
  };
}

/** Paints the photo's corners outside a radius-r rounded rectangle with paper white. */
function roundCorners(c: Canvas, x: number, y: number, w: number, h: number, r: number): void {
  if (r <= 0) return;
  for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) {
    const ox = r - dx - 0.5, oy = r - dy - 0.5;
    if (ox * ox + oy * oy <= r * r) continue;
    c.set(x + dx, y + dy, Ink.White); c.set(x + w - 1 - dx, y + dy, Ink.White);
    c.set(x + dx, y + h - 1 - dy, Ink.White); c.set(x + w - 1 - dx, y + h - 1 - dy, Ink.White);
  }
}

export function renderPhoto(panel: Panel, ctx: ScreenContext): Canvas {
  const { wqy12, wqy9 } = refFonts();
  const W = panel.width, H = panel.height;
  const large = H >= 400;
  const c = new Canvas(W, H);
  const p: PhotoContext = ctx.photo ?? { title: "抖动测试图 · Floyd-Steinberg", image: (chart ??= testChart()), style: "frame" };
  const a = photoArea(panel, p.style, p.corner);
  ditherImage(c, prepared(p, a.w, a.h), a.x, a.y, panel, p.edits);
  roundCorners(c, a.x, a.y, a.w, a.h, a.radius);
  if (p.style === "full") return c;
  if (a.keyline) c.frame(a.x - 1, a.y - 1, a.x + a.w + 1, a.y + a.h + 1, Ink.Black); // hairline keyline

  // caption: red marker, title (left), date (right)
  const font = large ? wqy12 : wqy9;
  const left = a.x + a.capInset, right = a.x + a.w - a.capInset;
  const base = a.y + a.h + Math.round((a.capH + font.ascent) / 2) - (large ? 2 : 1);
  const mark = large ? 8 : 6;
  const markTop = base - font.ascent + Math.floor((font.ascent - mark) / 2);
  c.rect(left, markTop, left + mark, markTop + mark, Ink.Red);
  let title = p.title || "相框";
  const dateStr = p.date ? `${p.date.getFullYear()}.${String(p.date.getMonth() + 1).padStart(2, "0")}.${String(p.date.getDate()).padStart(2, "0")}` : "";
  const maxW = right - left - mark - (large ? 12 : 8) - (dateStr ? width(wqy9, dateStr) + 16 : 0);
  while (title.length > 1 && width(font, title) > maxW) title = title.slice(0, -2) + "…";
  print(c, font, title, left + mark + (large ? 12 : 8), base, Ink.Black);
  if (dateStr) print(c, wqy9, dateStr, right - width(wqy9, dateStr), base, Ink.Black);
  return c;
}

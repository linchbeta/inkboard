// Shared pieces for the content screens: a common header (title, date, battery, rule),
// CJK-aware word wrapping and integer-scaled text for large type.
import { Canvas } from "../render/canvas.js";
import { refFonts, width, print, drawBattery, type RefFont } from "../render/reftext.js";
import { rasterize, measure } from "../render/bdf.js";
import { type Panel, Ink } from "../panels.js";
import { WEEKDAY } from "../data/calendar.js";
import type { ScreenContext } from "./testPattern.js";

export interface Frame { c: Canvas; W: number; H: number; large: boolean; m: number; top: number }

/**
 * New canvas with the standard header: title (and optional subtitle) left, date and
 * battery right, a rule below. `top` is the first free row under the rule.
 */
export function screenWithHeader(panel: Panel, ctx: ScreenContext, title: string, subtitle = ""): Frame {
  const { wqy12, wqy9 } = refFonts();
  const W = panel.width, H = panel.height, large = H >= 400;
  const c = new Canvas(W, H);
  const m = large ? 20 : 10;
  const base = large ? 36 : 22;
  let x = print(c, wqy12, title, m, base, Ink.Black);
  if (subtitle) print(c, wqy9, subtitle, x + 10, base, Ink.Black);
  const now = ctx.now;
  const date = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAY[now.getDay()]}`;
  const bw = ctx.batteryV !== undefined ? 60 : 0;
  print(c, wqy9, date, W - m - bw - width(wqy9, date), base, Ink.Black);
  if (ctx.batteryV !== undefined) drawBattery(c, W - m, base - 10, ctx.batteryV);
  const rule = base + (large ? 12 : 8);
  c.rect(m, rule, W - m, rule + 1, Ink.Black);
  return { c, W, H, large, m, top: rule + 1 };
}

const NO_LINE_START = new Set([..."，。、；：？！）》」』”’,.;:?!)%"]);
const isWide = (ch: string) => ch.codePointAt(0)! > 0x2e7f;

/**
 * Breaks text into lines of at most maxW px (scaled by `scale`): CJK may break between any
 * two characters, Latin words only at spaces; closing punctuation never starts a line.
 * Explicit newlines are kept. Returns at most maxLines lines ("…" marks a cut).
 */
export function wrapText(rf: RefFont, text: string, maxW: number, maxLines = Infinity, scale = 1): string[] {
  const out: string[] = [];
  const w = (s: string) => width(rf, s) * scale;
  for (const para of text.replace(/\r/g, "").split("\n")) {
    // tokens: single CJK chars, or runs of non-space Latin, or spaces
    const tokens = para.match(/[⺀-￿]|[^\s⺀-￿]+|\s+/g) ?? [""];
    let line = "";
    for (const t of tokens) {
      const next = line + t;
      if (w(next.trimEnd()) <= maxW || line.trim() === "") {
        line = next;
        continue;
      }
      if (NO_LINE_START.has(t[0])) {
        // closing punctuation never starts a line: hang it if its ink (left half) still
        // fits, else carry the previous character down with it
        if (w(next.trimEnd()) - maxW <= w(t) / 2) { line = next; continue; }
        const chars = [...line.trimEnd()];
        if (chars.length > 1 && isWide(chars[chars.length - 1])) {
          out.push(chars.slice(0, -1).join(""));
          line = chars[chars.length - 1] + t;
          continue;
        }
      }
      out.push(line.trimEnd());
      line = t.trimStart();
    }
    out.push(line.trimEnd());
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last.length > 1 && w(last + "…") > maxW) last = last.slice(0, -1);
    cut[maxLines - 1] = last + "…";
    return cut;
  }
  return out;
}

/** Lines of whole items (never split inside one), joined by `sep`; "…" marks a cut. */
export function wrapItems(rf: RefFont, items: string[], maxW: number, maxLines = Infinity, sep = "  "): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const it of items) {
    const next = cur ? cur + sep + it : it;
    if (width(rf, next) <= maxW || !cur) { cur = next; continue; }
    lines.push(cur);
    cur = it;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = ellipsize(rf, cut[maxLines - 1] + sep + "…", maxW);
    return cut;
  }
  return lines;
}

/** Text drawn with each font pixel as a scale x scale block, baseline at `baseline`. */
export function printScaled(c: Canvas, rf: RefFont, s: string, x: number, baseline: number, scale: number, ink: Ink): number {
  if (scale === 1) return print(c, rf, s, x, baseline, ink);
  const top = baseline - rf.f.ascent * scale;
  rasterize(rf.f, s, 0, 0, (px, py) => c.rect(x + px * scale, top + py * scale, x + (px + 1) * scale, top + (py + 1) * scale, ink));
  return x + measure(rf.f, s) * scale; // advances (keeps trailing spaces), like print()
}

/** Shortened to fit maxW px, with "…". */
export function ellipsize(rf: RefFont, s: string, maxW: number): string {
  if (width(rf, s) <= maxW) return s;
  while (s.length > 1 && width(rf, s + "…") > maxW) s = s.slice(0, -1);
  return s + "…";
}

/** A large opening quotation mark ("❝"-like: two filled drops), top-left at (x, y). */
export function drawQuoteMark(c: Canvas, x: number, y: number, size: number, ink: Ink): void {
  const r = size * 0.22;
  for (const ox of [0, size * 0.55]) {
    const cx = x + ox + r, cy = y + size - r;
    // tail: a curved wedge rising from the left of the drop
    for (let yy = Math.floor(y); yy <= cy; yy++) {
      const t = (cy - yy) / (cy - y); // 0 at the drop centre, 1 at the top
      const xr = cx - r + t * t * r * 1.6, w = r * (1 - t) * 1.15 + 1;
      c.rect(Math.round(xr), yy, Math.round(xr + w), yy + 1, ink);
    }
    for (let yy = -Math.ceil(r); yy <= r; yy++) for (let xx = -Math.ceil(r); xx <= r; xx++) {
      if (xx * xx + yy * yy <= r * r) c.set(Math.round(cx + xx), Math.round(cy + yy), ink);
    }
  }
}

/** Centred one-line note (e.g. "请在管理页面设置…") in the free area. */
export function emptyNote(f: Frame, text: string): void {
  const { wqy12 } = refFonts();
  const lines = wrapText(wqy12, text, f.W - 4 * f.m);
  const y0 = Math.round((f.top + f.H) / 2 - (lines.length * 22) / 2) + wqy12.ascent;
  lines.forEach((l, i) => print(f.c, wqy12, l, Math.round((f.W - width(wqy12, l)) / 2), y0 + i * 22, Ink.Black));
}

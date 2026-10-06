// 年度进度 (TRMNL's "Days Left This Year", its no. 3 plugin): how much of the year, quarter,
// month, week and day has passed, and the whole year as a week-by-weekday dot grid
// (past days filled, today red, days off yellow) like a contribution graph.
import { refFonts, width, print, bigRef } from "../render/reftext.js";
import { paintPixel, type Tone } from "../render/dither.js";
import type { Canvas } from "../render/canvas.js";
import { type Panel, Ink } from "../panels.js";
import { holidayOf, isoWeek, nextHoliday } from "../data/calendar.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader } from "./common.js";

const DAY = 86_400_000;

/** Fraction of [start, end) elapsed at `now`. */
const frac = (now: Date, start: Date, end: Date) => Math.max(0, Math.min(1, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));

export function progressRows(now: Date): { label: string; value: number; note: string }[] {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const q = Math.floor(m / 3);
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(y, m, d - dow);
  const days = Math.round((new Date(y + 1, 0, 1).getTime() - new Date(y, 0, 1).getTime()) / DAY);
  const dayNo = Math.round((new Date(y, m, d).getTime() - new Date(y, 0, 1).getTime()) / DAY) + 1;
  const monthDays = new Date(y, m + 1, 0).getDate();
  return [
    { label: `${y}年`, value: frac(now, new Date(y, 0, 1), new Date(y + 1, 0, 1)), note: `还剩 ${days - dayNo} 天` },
    { label: `第${q + 1}季度`, value: frac(now, new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 1)), note: `还剩 ${Math.round((new Date(y, q * 3 + 3, 1).getTime() - new Date(y, m, d + 1).getTime()) / DAY)} 天` },
    { label: `${m + 1}月`, value: frac(now, new Date(y, m, 1), new Date(y, m + 1, 1)), note: `还剩 ${monthDays - d} 天` },
    { label: "本周", value: frac(now, weekStart, new Date(y, m, d - dow + 7)), note: `还剩 ${6 - dow} 天` },
    { label: "今天", value: frac(now, new Date(y, m, d), new Date(y, m, d + 1)), note: `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}` },
  ];
}

function bar(c: Canvas, x0: number, y0: number, x1: number, y1: number, value: number, tone: Tone): void {
  const fx = x0 + Math.round((x1 - x0) * value);
  for (let y = y0; y < y1; y++) for (let x = x0; x < fx; x++) paintPixel(c, () => tone, x, y);
  c.frame(x0, y0, x1, y1, Ink.Black);
}

export function renderYearProgress(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9, helvB14 } = refFonts();
  const now = ctx.now;
  const y = now.getFullYear();
  const f = screenWithHeader(panel, ctx, "年度进度", `${y}年 第${isoWeek(y, now.getMonth() + 1, now.getDate())}周`);
  const { c, W, H, large, m } = f;
  const rows = progressRows(now);
  const font = large ? wqy12 : wqy9;
  const bx1 = W - m;

  // ── section heights first, so the free space can be shared out evenly ──
  const big = bigRef("barlow", large ? 96 : 56);
  const leftH = font.ascent + (large ? 14 : 8) + big.ascent + (large ? 18 : 10) + font.ascent;
  const rowH = large ? 34 : 19;
  const aH = Math.max(leftH, 5 * rowH);
  const jan1 = new Date(y, 0, 1);
  const firstDow = (jan1.getDay() + 6) % 7;
  const days = Math.round((new Date(y + 1, 0, 1).getTime() - jan1.getTime()) / DAY);
  const weeks = Math.ceil((firstDow + days) / 7);
  const labelCol = large ? 26 : 0; // weekday labels only where the rows are tall enough
  const gAvail = bx1 - (m + labelCol);
  const cell = Math.floor(gAvail / weeks);
  const dot = cell - (large ? 3 : 2);
  const monthH = large ? 18 : 12, legendH = large ? 30 : 20;
  const bH = monthH + 7 * cell + legendH;
  const cH = large ? 40 : 26;
  const free = Math.max(0, H - f.top - aH - bH - cH);
  const gap = Math.floor(free / 3.5); // top, A|B, B|C, half at the bottom

  // ── A: big red percentage (left), bars (right) ──
  const aTop = f.top + gap;
  const daysPast = Math.round((new Date(y, now.getMonth(), now.getDate()).getTime() - jan1.getTime()) / DAY) + 1;
  let ly = aTop + font.ascent;
  print(c, font, `${y} 年已经过去`, m, ly, Ink.Black);
  ly += (large ? 14 : 8) + big.ascent;
  const pct = `${(rows[0].value * 100).toFixed(1)}%`;
  print(c, big, pct, m - (large ? 3 : 2), ly, Ink.Red);
  ly += (large ? 18 : 10) + font.ascent;
  let x = print(c, font, "已过 ", m, ly, Ink.Black);
  x = print(c, font, String(daysPast), x, ly, Ink.Red);
  x = print(c, font, " 天，还剩 ", x, ly, Ink.Black);
  x = print(c, font, String(days - daysPast), x, ly, Ink.Red);
  print(c, font, " 天", x, ly, Ink.Black);

  const bx0 = large ? 330 : 176;
  const labelW = large ? 74 : 44, noteW = large ? 96 : 0;
  const tones: Tone[] = [[[Ink.Red, 1]], [[Ink.Yellow, 1]], [[Ink.Yellow, 1]], [[Ink.Yellow, 1]], [[Ink.Black, 0.35]]];
  const barsTop = aTop + Math.round((aH - 5 * rowH) / 2);
  rows.forEach((r, i) => {
    const base = barsTop + i * rowH + (large ? 20 : 13);
    print(c, font, r.label, bx0, base, Ink.Black);
    const p = `${Math.floor(r.value * 100)}%`;
    const barX0 = bx0 + labelW, barX1 = bx1 - noteW - width(font, "100%") - 8;
    bar(c, barX0, base - (large ? 12 : 8), barX1, base + (large ? 2 : 1), r.value, tones[i]);
    print(c, font, p, barX1 + 6, base, i === 0 ? Ink.Red : Ink.Black);
    if (noteW) print(c, wqy9, r.note, bx1 - width(wqy9, r.note), base, Ink.Black);
  });

  // ── B: the year as a week x weekday grid ──
  const gx0 = m + labelCol + Math.floor((gAvail - cell * weeks) / 2);
  const gy0 = aTop + aH + gap + monthH;
  const today = daysPast - 1;
  if (large) ["一", "三", "五", "日"].forEach((t, k) => {
    const row = [0, 2, 4, 6][k];
    print(c, wqy9, t, m, gy0 + row * cell + Math.round(dot / 2) + 5, Ink.Black);
  });
  let monthLabelEnd = -Infinity;
  for (let i = 0; i < days; i++) {
    const dt = new Date(y, 0, 1 + i);
    const k = firstDow + i, col = Math.floor(k / 7), row = k % 7;
    const gx = gx0 + col * cell, gy = gy0 + row * cell;
    const off = holidayOf(y, dt.getMonth() + 1, dt.getDate()) === "off";
    if (dt.getDate() === 1) {
      const lbl = `${dt.getMonth() + 1}月`;
      if (gx > monthLabelEnd + 3 && gx + width(wqy9, lbl) < bx1) monthLabelEnd = print(c, wqy9, lbl, gx, gy0 - (large ? 6 : 4), Ink.Black);
    }
    if (i === today) { // red, one px larger all round, with a black ring (stands out from red days off on B/W/R)
      c.frame(gx - 2, gy - 2, gx + dot + 2, gy + dot + 2, Ink.Black);
      c.rect(gx - 1, gy - 1, gx + dot + 1, gy + dot + 1, Ink.Red);
    } else if (i < today) {
      c.rect(gx, gy, gx + dot, gy + dot, off ? Ink.Yellow : Ink.Black);
    } else {
      if (off) c.rect(gx, gy, gx + dot, gy + dot, Ink.Yellow);
      c.frame(gx, gy, gx + dot, gy + dot, Ink.Black);
    }
  }
  const legY = gy0 + 7 * cell + legendH - (large ? 8 : 6);
  {
    let lx = gx0;
    const sw = large ? 10 : 7;
    for (const [label, draw] of [
      ["已过", (lx0: number, t: number) => c.rect(lx0, t, lx0 + sw, t + sw, Ink.Black)],
      ["今天", (lx0: number, t: number) => { c.frame(lx0 - 1, t - 1, lx0 + sw + 1, t + sw + 1, Ink.Black); c.rect(lx0, t, lx0 + sw, t + sw, Ink.Red); }],
      ["假日", (lx0: number, t: number) => c.rect(lx0, t, lx0 + sw, t + sw, Ink.Yellow)],
      ["未来", (lx0: number, t: number) => c.frame(lx0, t, lx0 + sw, t + sw, Ink.Black)],
    ] as const) {
      draw(lx, legY - sw + 1);
      lx = print(c, wqy9, label, lx + sw + 4, legY, Ink.Black) + (large ? 18 : 10);
    }
  }

  // ── C: coming days off: "接下来  元旦 89天  春节 ..." ──
  const cTop = gy0 + 7 * cell + legendH + gap;
  c.dottedH(m, bx1, cTop, Ink.Black, 1, 3);
  const hy = cTop + cH - (large ? 10 : 6);
  x = print(c, font, "接下来", m, hy, Ink.Black) + (large ? 18 : 10);
  let from = new Date(y, now.getMonth(), now.getDate());
  for (let k = 0; k < 5; k++) {
    const h = nextHoliday(from.getFullYear(), from.getMonth() + 1, from.getDate());
    if (!h) break;
    const [hy2, hm, hd] = h.date.split("-").map(Number); // local date (new Date("Y-M-D") would be UTC)
    const n = Math.round((new Date(hy2, hm - 1, hd).getTime() - new Date(y, now.getMonth(), now.getDate()).getTime()) / DAY);
    const g = large ? 26 : 12;
    const need = width(font, h.name) + 6 + width(helvB14, String(n)) + 3 + width(wqy9, "天");
    if (x + need > bx1) break;
    x = print(c, font, h.name, x, hy, Ink.Red) + 6;
    x = print(c, helvB14, String(n), x, hy, Ink.Black) + 3;
    x = print(c, wqy9, "天", x, hy, Ink.Black) + g;
    from = new Date(hy2, hm - 1, hd);
  }
  return c;
}

export const yearProgressMode: Screen = {
  name: "年度进度",
  description: "今年、本季、本月、本周、今天各过了多少，加整年的日历点阵图。",
  render: renderYearProgress,
};

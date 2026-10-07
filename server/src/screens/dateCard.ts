// Date card ("日期牌"), adapted from the EPD-nRF5 reference's clock mode (GUI/GUI.c
// DrawClock, "else" branch): same header (date, weekday, lunar, battery) and footer
// (year stem/branch + zodiac, ISO week, next solar term), with the big HH:MM replaced by a
// big 7-segment day of month, since a battery device cannot refresh every minute.
// Red day number on weekends and days off (a make-up work day 班 stays black).
//
// On large panels (3.98") the big number moves to the left half and the right half gets
// an almanac column: holiday countdown, lunar date with stems/branches, 宜/忌, today's
// weather and the year's progress. Small panels (4.2") keep the single-column card.
// Upright, the large card puts the number on top and the almanac column under it.
import { isLarge } from "./common.js";
import { Canvas } from "../render/canvas.js";
import { refFonts, width, print, centeredX, centeredAt, drawBattery, type RefFont } from "../render/reftext.js";
import { draw7Number, size7 } from "../render/sevenseg.js";
import { fillCircle } from "../render/gfx.js";
import { drawWeatherIcon } from "../render/weatherIcons.js";
import { paintPixel, TONES } from "../render/dither.js";
import { type Panel, Ink } from "../panels.js";
import {
  WEEKDAY, LUNAR_MONTH, LUNAR_DATE, lunarOf, isoWeek, festivalOf, holidayOf, nextSolarTerm,
  holidayPeriod, nextHoliday, almanacOf,
} from "../data/calendar.js";
import { describeCode, windDirection, windLevel } from "../data/weather.js";
import type { ScreenContext } from "./testPattern.js";

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface DateCardLayout {
  /** Area between the two rules where the big number (and festival line) are centred. */
  body: { y0: number; y1: number };
  /** Horizontal centre of the number's column. */
  cx: number;
  /** Height reserved below the number for the festival / holiday line (0 if none). */
  noteH: number;
  number: { x0: number; y0: number; w: number; h: number; ink: Ink };
  /** Ink boxes of the right-hand column's items (large panels), for overlap tests. */
  boxes: { what: string; x0: number; y0: number; x1: number; y1: number }[];
}

export function renderDateCard(panel: Panel, ctx: ScreenContext, layoutOut?: DateCardLayout[]): Canvas {
  const { helvB18, wqy12, wqy9 } = refFonts();
  const W = panel.width;
  const H = panel.height;
  const large = isLarge(panel);
  const c = new Canvas(W, H);
  const now = ctx.now;
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const lunar = lunarOf(y, m, d);
  const padding = large ? 46 : 40;

  // ── Header: 2026年10月02日 / 星期五  八月廿二 / battery ──
  let tx = print(c, helvB18, String(y), padding, 36, Ink.Red);
  tx = print(c, wqy12, "年", tx, 36, Ink.Black);
  tx = print(c, helvB18, pad2(m), tx, 36, Ink.Red);
  tx = print(c, wqy12, "月", tx, 36, Ink.Black);
  tx = print(c, helvB18, pad2(d), tx, 36, Ink.Red);
  print(c, wqy12, "日", tx, 36, Ink.Black);
  print(c, wqy9, `星期${WEEKDAY[now.getDay()]}`, padding, 58, Ink.Black);
  print(c, wqy9, (lunar.leap ? "闰" : "") + LUNAR_MONTH[lunar.month] + LUNAR_DATE[lunar.day], padding + 38, 58, Ink.Black);
  if (ctx.batteryV !== undefined) drawBattery(c, W - padding, 25, ctx.batteryV);
  // the large layout shows the weather in its own block
  if (ctx.weatherLine && !(large && ctx.weather)) print(c, wqy9, ctx.weatherLine, W - padding - width(wqy9, ctx.weatherLine), 58, Ink.Black);
  c.rect(padding - 10, 68, W - (padding - 10), 69, Ink.Black);

  // ── Body: big 7-segment day of month, festival / holiday line below ──
  const bodyTop = 69, bodyBottom = H - 68;
  const hol = holidayOf(y, m, d);
  const festival = festivalOf(y, m, d, lunar);
  const note = [festival, hol === "off" ? "休" : hol === "work" ? "班" : undefined].filter(Boolean).join(" · ");
  const noteH = note ? 16 + (large ? 16 : 8) : 0; // 16px line + gap
  const nD = d > 9 ? 2 : 1;
  // large: left column [padding, splitX); small: full width; upright large: the top part
  const tall = large && H > W;
  const splitX = large && !tall ? Math.round(W * 0.52) : W;
  const cx = large && !tall ? Math.round((padding + splitX) / 2) : W / 2;
  const numBottom = tall ? bodyTop + Math.round((bodyBottom - bodyTop) * 0.4) : bodyBottom;
  const avail = numBottom - bodyTop - noteH - (large ? 40 : 20);
  let cS = Math.max(2, Math.floor((avail - 4) / 20));
  if (large) while (cS > 2 && size7(cS, 2).w > splitX - padding - 40) cS--; // "28" must fit the column too
  const sz = size7(cS, nD);
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const red = hol === "off" || (weekend && hol !== "work");
  const numInk = red ? Ink.Red : Ink.Black;
  // Centre by ink, not by digit cells: a 7-segment "1" only lights the right-hand
  // segments, so cell-centring would push e.g. "14" visibly to the right.
  const tmp = new Canvas(sz.w, sz.h);
  draw7Number(tmp, d, 0, 0, cS, numInk, Ink.White, nD);
  let ix0 = sz.w, ix1 = -1, iy0 = sz.h, iy1 = -1;
  for (let yy = 0; yy < sz.h; yy++) for (let xx = 0; xx < sz.w; xx++) {
    if (tmp.get(xx, yy) !== numInk) continue;
    ix0 = Math.min(ix0, xx); ix1 = Math.max(ix1, xx); iy0 = Math.min(iy0, yy); iy1 = Math.max(iy1, yy);
  }
  const inkW = ix1 - ix0 + 1, inkH = iy1 - iy0 + 1;
  const blockH = inkH + noteH;
  const nx = Math.round(cx - inkW / 2) - ix0;
  const ny = Math.round(bodyTop + (numBottom - bodyTop - blockH) / 2) - iy0;
  for (let yy = iy0; yy <= iy1; yy++) for (let xx = ix0; xx <= ix1; xx++) {
    if (tmp.get(xx, yy) === numInk) c.set(nx + xx, ny + yy, numInk);
  }
  if (note) {
    const nb = ny + iy1 + (large ? 16 : 8) + wqy12.ascent + 2;
    print(c, wqy12, note, centeredX(wqy12, note, cx), nb, Ink.Red);
  }
  const layout: DateCardLayout = { body: { y0: bodyTop, y1: bodyBottom }, cx, noteH,
                                   number: { x0: nx + ix0, y0: ny + iy0, w: inkW, h: inkH, ink: numInk }, boxes: [] };
  if (tall) {
    c.dottedH(padding, W - padding, numBottom, Ink.Black, 1, 3);
    almanacColumn(c, ctx, padding, W - padding, numBottom + 20, bodyBottom - 18, layout.boxes);
  } else if (large) {
    c.dottedV(splitX, bodyTop + 22, bodyBottom - 21, Ink.Black, 1, 3);
    almanacColumn(c, ctx, splitX + 24, W - padding, bodyTop + 20, bodyBottom - 18, layout.boxes);
  }
  layoutOut?.push(layout);
  c.rect(padding - 10, H - 68, W - (padding - 10), H - 67, Ink.Black);

  // ── Footer: 丙午马年 / 40周 (left), next solar term (right) ──
  const fy = H - 68 + 30;
  let fx = print(c, wqy12, lunar.yearGanZhi, padding, fy, Ink.Black);
  fx = print(c, wqy12, lunar.zodiac, fx, fy, Ink.Red);
  print(c, wqy12, "年", fx, fy, Ink.Black);
  print(c, wqy12, `${isoWeek(y, m, d)}周`, padding, fy + 20, Ink.Black);
  if (lunar.jieqi) {
    print(c, wqy12, lunar.jieqi, W - padding - width(wqy12, lunar.jieqi), fy, Ink.Red);
  } else {
    const next = nextSolarTerm(y, m, d);
    const lx = W - padding - width(wqy12, "离" + next.name);
    print(c, wqy12, next.name, print(c, wqy12, "离", lx, fy, Ink.Black), fy, Ink.Red);
    const rest = `还有${next.days}天`;
    print(c, wqy12, rest, W - padding - width(wqy12, rest), fy + 20, Ink.Black);
  }
  return c;
}

/** Splits `items` into lines of at most `maxW` px (items joined by two spaces). */
function wrapItems(rf: RefFont, items: string[], maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const it of items) {
    const next = cur ? `${cur}  ${it}` : it;
    if (width(rf, next) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = it;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

/** Right-hand column of the large date card, inside [x0, x1) x [top, bottom). */
function almanacColumn(c: Canvas, ctx: ScreenContext, x0: number, x1: number, top: number, bottom: number,
                       boxes: DateCardLayout["boxes"]): void {
  const { helvB18, wqy12, wqy9 } = refFonts();
  const now = ctx.now;
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const lunar = lunarOf(y, m, d);
  const alm = almanacOf(y, m, d);
  const box = (what: string, bx0: number, by0: number, bx1: number, by1: number) => boxes.push({ what, x0: bx0, y0: by0, x1: bx1, y1: by1 });
  let yy = top;

  // 1. Holiday: "国庆节假期 第2天 / 共7天", or "距 元旦 还有 91 天" (bold red number)
  const period = holidayPeriod(y, m, d);
  const base = yy + helvB18.ascent;
  if (period) {
    let x = print(c, wqy12, `${period.name}假期 `, x0, base, Ink.Red);
    x = print(c, wqy12, "第", x, base, Ink.Black);
    x = print(c, helvB18, String(period.nth), x + 2, base, Ink.Red);
    x = print(c, wqy12, `天 / 共${period.total}天`, x + 2, base, Ink.Black);
    box("holiday", x0, yy, x, base + 4);
  } else {
    const next = nextHoliday(y, m, d);
    if (next) {
      let x = print(c, wqy12, "距", x0, base, Ink.Black);
      x = print(c, wqy12, next.name, x + 4, base, Ink.Red);
      x = print(c, wqy12, "还有", x + 4, base, Ink.Black);
      x = print(c, helvB18, String(next.days), x + 4, base, Ink.Red);
      x = print(c, wqy12, "天", x + 4, base, Ink.Black);
      box("holiday", x0, yy, x, base + 4);
    }
  }
  yy = base + 14;
  c.dottedH(x0, x1, yy, Ink.Black, 1, 3);

  // 2. Lunar date + stems/branches
  yy += 12;
  const lb = yy + wqy12.ascent;
  const lunarStr = `农历${lunar.leap ? "闰" : ""}${LUNAR_MONTH[lunar.month]}${LUNAR_DATE[lunar.day]}`;
  print(c, wqy12, lunarStr, x0, lb, Ink.Black);
  const gz = `${lunar.yearGanZhi}年 ${alm.monthGanZhi}月 ${alm.dayGanZhi}日`;
  print(c, wqy9, gz, x1 - width(wqy9, gz), lb, Ink.Black);
  box("lunar", x0, yy, x1, lb + 4);
  yy = lb + 12;

  // 3. 宜 / 忌 with round badges (white character on red / black)
  const r = 11;
  const textX = x0 + 2 * r + 10;
  for (const [label, items, fill] of [["宜", alm.yi, Ink.Red], ["忌", alm.ji, Ink.Black]] as const) {
    const lines = wrapItems(wqy12, items.length ? [...items] : ["—"], x1 - textX, 2);
    const by = yy + r;
    fillCircle(c, x0 + r, by, r, fill);
    const p = centeredAt(wqy12, label, x0 + r, by);
    print(c, wqy12, label, p.x, p.baseline, Ink.White);
    // first line's text centred on the badge, further lines below
    const first = centeredAt(wqy12, "宜", 0, by).baseline;
    lines.forEach((s, i) => print(c, wqy12, s, textX, first + i * 22, Ink.Black));
    const end = Math.max(by + r, first + (lines.length - 1) * 22 + 4);
    box(label, x0, yy, x1, end);
    yy = end + 10;
  }
  c.dottedH(x0, x1, yy, Ink.Black, 1, 3);
  yy += 10;

  // 4. Today's weather, then the next three days if there is room
  const progressH = 34;
  const w = ctx.weather;
  if (w) {
    const icon = Math.max(32, Math.min(72, bottom - progressH - yy - 6));
    const desc = describeCode(w.current.code);
    drawWeatherIcon(c, desc.icon, w.current.isDay, x0, yy, icon);
    const tx = x0 + icon + 14;
    const today = w.daily[0];
    const l1 = yy + helvB18.ascent + 2;
    let x = print(c, helvB18, String(Math.round(w.current.temp)), tx, l1, Ink.Black);
    x = print(c, wqy12, "℃", x + 2, l1, Ink.Black);
    print(c, wqy12, `${desc.text}  ${w.place.name}`, x + 10, l1, Ink.Black);
    const l2 = l1 + 22;
    const range = `${Math.round(today.tmin)}～${Math.round(today.tmax)}℃` + (today.pop >= 10 ? `  降水${today.pop}%` : "");
    print(c, wqy9, range, tx, l2, Ink.Black);
    const l3 = l2 + 18;
    print(c, wqy9, `${windDirection(w.current.windDir)}${windLevel(w.current.windKmh)}级  湿度${w.current.humidity}%`, tx, l3, Ink.Black);
    const end = Math.max(yy + icon, l3 + 4);
    box("weather", x0, yy, x1, end);
    yy = end + 12;

    const rowIcon = 32;
    const rowH = rowIcon + 16 + 14;
    if (w.daily.length >= 4 && bottom - progressH - yy >= rowH) {
      const colW = (x1 - x0) / 3;
      for (let i = 1; i <= 3; i++) {
        const day = w.daily[i];
        const ccx = Math.round(x0 + (i - 0.5) * colW);
        const [dy, dm, dd] = day.date.split("-").map(Number);
        const label = i === 1 ? "明天" : i === 2 ? "后天" : `周${WEEKDAY[new Date(dy, dm - 1, dd).getDay()]}`;
        const lx = ccx - Math.round((width(wqy9, label) + 4 + rowIcon) / 2);
        const mid = yy + rowIcon / 2;
        print(c, wqy9, label, lx, centeredAt(wqy9, label, 0, mid).baseline, Ink.Black);
        drawWeatherIcon(c, describeCode(day.code).icon, true, lx + width(wqy9, label) + 4, yy, rowIcon);
        const rs = `${Math.round(day.tmin)}～${Math.round(day.tmax)}℃`;
        print(c, wqy9, rs, centeredX(wqy9, rs, ccx), yy + rowIcon + 14, Ink.Black);
        if (i > 1) c.dottedV(Math.round(x0 + (i - 1) * colW), yy, yy + rowH - 6, Ink.Black, 1, 3);
      }
      box("forecast", x0, yy, x1, yy + rowH);
    }
  } else if (ctx.weatherNote) {
    print(c, wqy9, ctx.weatherNote, x0, yy + wqy9.ascent + 4, Ink.Black);
    box("weather", x0, yy, x1, yy + 20);
  }

  // 5. Year progress (bottom of the column): "第275天  已过75%", dithered orange bar
  const start = new Date(y, 0, 1).getTime();
  const days = Math.round((new Date(y + 1, 0, 1).getTime() - start) / 86400000);
  const dayNo = Math.round((new Date(y, m - 1, d).getTime() - start) / 86400000) + 1;
  const pct = Math.round((dayNo / days) * 100);
  const barTop = bottom - 12, barBottom = bottom;
  const pb = barTop - 6;
  print(c, wqy9, `${y}年 第${dayNo}天`, x0, pb, Ink.Black);
  const ps = `已过 ${pct}%`;
  print(c, wqy9, ps, x1 - width(wqy9, ps), pb, Ink.Black);
  const fillX = x0 + Math.round(((x1 - x0) * dayNo) / days);
  for (let py = barTop; py < barBottom; py++) for (let px = x0; px < fillX; px++) {
    paintPixel(c, () => TONES.orange, px, py);
  }
  c.frame(x0, barTop, x1, barBottom, Ink.Black);
  box("progress", x0, pb - wqy9.ascent, x1, barBottom);
}

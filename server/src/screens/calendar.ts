// Month calendar, ported from the EPD-nRF5 reference (GUI/GUI.c: DrawCalendar ->
// DrawDateHeader / DrawWeekHeader / DrawMonthDays, "else" branch for heights >= 300).
// Same fonts, metrics, coordinates and drawing primitives; differences:
//  - solar terms use exact dates (the reference approximates the 2nd term as 1st + 15 days)
//  - holidays come from all bundled holiday-cn years, not only the configured one
//  - no Wi-Fi name (the server does not know it); battery shown when the device reports it
import { isLarge } from "./common.js";
import { Canvas } from "../render/canvas.js";
import { fillCircle, drawCircle, fillRoundRect, dottedLine } from "../render/gfx.js";
import { type RefFont, refFonts, height, width, inkBounds, print, centeredX, centeredAt, drawBattery } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import {
  WEEKDAY, LUNAR_MONTH, LUNAR_DATE, lunarOf, dayGanZhi, isoWeek, daysInMonth, weekdayOf,
  festivalOf, holidayOf,
} from "../data/calendar.js";
import type { ScreenContext } from "./testPattern.js";

/** Where a piece of text should be centred and where its ink actually ended up (for tests). */
export interface CenterCheck {
  what: string;
  cx: number;
  cy?: number; // omitted when only horizontal centring applies
  ink: { x0: number; x1: number; y0: number; y1: number };
  /** For pixel-level verification: the text colour and the area that contains only this text. */
  pixels?: {
    color: Ink;
    circle?: { cx: number; cy: number; r: number };
    rect?: { x0: number; y0: number; x1: number; y1: number }; // inclusive
    exclude?: { cx: number; cy: number; r: number }[];
  };
}

export interface CalendarOptions {
  /** 0 = week starts on Sunday (reference default), 1 = Monday. */
  weekStart?: number;
  /** When given, every centred element is recorded here. */
  checks?: CenterCheck[];
  /** When given, the ink box of every element in each day cell is recorded (overlap tests). */
  boxes?: { day: number; what: string; ink: CenterCheck["ink"] }[];
}

export function renderCalendar(panel: Panel, ctx: ScreenContext, opts: CalendarOptions = {}): Canvas {
  const { helvB18, helvB14, wqy12, wqy9, wqy6 } = refFonts();

  const W = panel.width;
  const H = panel.height;
  const large = isLarge(panel); // reference: large_layout = height >= 400 (the short side, so upright too)
  // An upright 4.2" has ~41 px columns: 休 / 班 go to the top of their circle (above the
  // date, where they cannot run into the cell before), and the rest of the cell moves down
  // a little to make room. The large panels upright are laid out as landscape.
  // Same for the firmware's copy.
  const tall = H > W && !large;
  const weekStart = opts.weekStart ?? 0;
  const c = new Canvas(W, H);
  const check = (what: string, rf: RefFont, s: string, x: number, baseline: number, cx: number, cy?: number,
                 pixels?: CenterCheck["pixels"]) => {
    const ink = inkBounds(rf, s, x, baseline);
    if (opts.checks && ink) opts.checks.push({ what, cx, cy, ink, pixels });
  };
  const box = (day: number, what: string, rf: RefFont, s: string, x: number, baseline: number) => {
    const ink = inkBounds(rf, s, x, baseline);
    if (opts.boxes && ink) opts.boxes.push({ day, what, ink });
  };

  const now = ctx.now;
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const today = now.getDate();
  const todayLunar = lunarOf(year, month, today);

  // ── DrawDateHeader(gfx, 10, large ? 38 : 28) ──
  {
    const x = 10;
    const y = large ? 38 : 28;
    let tx = print(c, helvB18, String(year), x, y - 2, Ink.Red);
    tx = print(c, wqy12, "年", tx, y - 2, Ink.Black);
    tx = print(c, helvB18, String(month), tx, y - 2, Ink.Red);
    tx = print(c, wqy12, "月", tx, y - 2, Ink.Black);

    let lx = tx;
    if (todayLunar.leap) lx = print(c, wqy9, " ", lx, y, Ink.Black);
    lx = print(c, wqy9, (todayLunar.leap ? "闰" : " ") + LUNAR_MONTH[todayLunar.month] + LUNAR_DATE[todayLunar.day],
               lx, y, Ink.Black);
    print(c, wqy9, ` [${isoWeek(year, month, today)}周]`, lx, y, Ink.Red);

    const gx = print(c, wqy9, ` ${todayLunar.yearGanZhi}年`, tx, y - 14, Ink.Black);
    print(c, wqy9, ` [${todayLunar.zodiac}]`, gx, y - 14, Ink.Red);

    // DrawBattery(gfx, width - 10 - 2, large ? 16 : 6, 20, voltage)
    if (ctx.batteryV !== undefined) drawBattery(c, W - 12, large ? 16 : 6, ctx.batteryV);
  }

  // ── DrawWeekHeader(gfx, 10, large ? 44 : 32) ──
  {
    const x = 10;
    const y = large ? 44 : 32;
    const font = large ? wqy12 : wqy9;
    const w = Math.floor((W - 2 * x) / 7);
    const h = large ? 32 : 24;
    const r = (W - 2 * x) % 7;
    const radius = Math.floor(h / 2);
    for (let i = 0; i < 7; i++) {
      const day = (weekStart + i) % 7;
      const bg = day === 0 || day === 6 ? Ink.Red : Ink.Black;
      const cellX = x + i * w;
      const cellW = i === 6 ? w + r : w;
      if (i === 0) {
        c.rect(cellX + radius, y, cellX + cellW, y + h, bg);
        fillCircle(c, cellX + radius, y + radius, radius - 1, bg);
      } else if (i === 6) {
        c.rect(cellX, y, cellX + cellW - radius, y + h, bg);
        fillRoundRect(c, cellX, y, cellW, h, radius, bg);
      } else {
        c.rect(cellX, y, cellX + cellW, y + h, bg);
      }
      // Centre each label on its cell by ink (the reference uses font metrics, ~1 px off).
      const cx = x + i * w + w / 2;
      const cy = y + h / 2;
      const p = centeredAt(font, WEEKDAY[day], cx, cy);
      print(c, font, WEEKDAY[day], p.x, p.baseline, Ink.White);
      check(`weekday ${WEEKDAY[day]}`, font, WEEKDAY[day], p.x, p.baseline, cx, cy,
            // Measure inside the bar only: skip the background showing around the rounded ends.
            { color: Ink.White, rect: { x0: i === 0 ? cellX + radius : cellX + 1, y0: y,
                                        x1: i === 6 ? cellX + cellW - radius - 1 : cellX + w - 1, y1: y + h - 1 } });
    }
    for (let i = 1; i < 7; i++) c.rect(x + i * w, y, x + i * w + 1, y + h, Ink.White);
  }

  // ── DrawMonthDays(gfx, 10, large ? 84 : 64) ──
  {
    const x = 10;
    const y = large ? 84 : 64;
    const firstDayWeek = weekdayOf(year, month, 1);
    const adjustedFirstDay = (firstDayWeek - weekStart + 7) % 7;
    const monthMaxDays = daysInMonth(year, month);
    const rows = 1 + Math.floor((monthMaxDays - (7 - adjustedFirstDay) + 6) / 7);
    const bw = Math.floor((W - x - 10) / 7);
    const bh = Math.floor((H - y - 10) / rows);
    if (large) {
      for (let i = 1; i < rows; i++) dottedLine(c, x, y + i * bh, x + 7 * bw - 1, y + i * bh, Ink.Black, 1, 5);
      for (let i = 1; i < 7; i++) dottedLine(c, x + i * bw, y, x + i * bw, y + rows * bh - 1, Ink.Black, 1, 5);
    }
    let todayDisc: { cx: number; cy: number; r: number; ink: CenterCheck["ink"] } | undefined;
    const badges: { cx: number; cy: number; r: number }[] = [];
    const dayFont = large ? helvB18 : helvB14;
    const lunarFont = large ? wqy12 : wqy9;
    for (let i = 0; i < monthMaxDays; i++) {
      const day = i + 1;
      const actualWeek = (firstDayWeek + i) % 7;
      const displayWeek = (adjustedFirstDay + i) % 7;
      const weekend = actualWeek === 0 || actualWeek === 6;
      const isToday = day === today;
      const lunar = lunarOf(year, month, day);
      let cr = large ? 15 : 11;
      if (rows > 5) cr -= 1;
      const bx = x + Math.floor((bw - 2 * cr) / 2) + displayWeek * bw;
      const cellTop = y + Math.floor((i + adjustedFirstDay) / 7) * bh;
      const by = cellTop + Math.floor((bh - 2 * cr) / 2) + 3 + (tall ? 5 : 0);

      // Date and lunar label: vertical positions as in the reference (rows stay aligned),
      // horizontally centred on the column by ink (the reference's width maths and its +1 px
      // label nudge leave them up to ~1 px off).
      const colCx = bx + cr;
      const dayStr = String(day);
      const dayBaseline = by - (cr - height(dayFont)) - 1;
      const dayX = centeredX(dayFont, dayStr, colCx);
      const dayInk = inkBounds(dayFont, dayStr, dayX, dayBaseline)!;

      // Festival, else solar term, else the lunar day: the solar term sits on the lunar
      // row like in printed calendars. (The reference prints it tiny at the cell's top left,
      // which neither lines up with the stem/branch column nor reads on today's red disc.)
      const festival = festivalOf(year, month, day, lunar) ?? (lunar.jieqi || undefined);
      const label = festival ?? (lunar.day === 1
        ? (lunar.leap ? "闰" : " ") + LUNAR_MONTH[lunar.month]
        : LUNAR_DATE[lunar.day]);
      const labelX = centeredX(lunarFont, label, colCx); // a leading space has no ink
      const labelBaseline = dayBaseline + height(lunarFont) + (large ? 5 : 3);

      let ink: Ink;
      if (isToday) {
        // The reference centres the circle at (bx+cr, by+cr-3), which leaves the text ~2-3 px
        // high of centre. Centre the circle on the actual ink of date + label instead.
        const a = inkBounds(dayFont, dayStr, dayX, dayBaseline)!;
        const b = inkBounds(lunarFont, label, labelX, labelBaseline);
        const x0 = Math.min(a.x0, b?.x0 ?? a.x0), x1 = Math.max(a.x1, b?.x1 ?? a.x1);
        const y0 = a.y0, y1 = b?.y1 ?? a.y1;
        const dcx = Math.round((x0 + x1) / 2), dcy = Math.round((y0 + y1) / 2);
        fillCircle(c, dcx, dcy, 2 * cr, Ink.Red);
        todayDisc = { cx: dcx, cy: dcy, r: 2 * cr, ink: { x0, x1, y0, y1 } };
        ink = Ink.White;
      } else {
        ink = weekend ? Ink.Red : Ink.Black;
      }
      print(c, dayFont, dayStr, dayX, dayBaseline, ink);
      check(`date ${day}`, dayFont, dayStr, dayX, dayBaseline, colCx);
      box(day, "date", dayFont, dayStr, dayX, dayBaseline);
      if (festival && !isToday) ink = Ink.Red;
      print(c, lunarFont, label, labelX, labelBaseline, ink);
      check(`lunar ${day} ${label}`, lunarFont, label, labelX, labelBaseline, colCx);
      box(day, "lunar", lunarFont, label, labelX, labelBaseline);

      // Day stem/branch, two tiny characters stacked at the right of the date
      const [gan, zhi] = dayGanZhi(year, month, day);
      const offset = large ? 31 : 22;
      let taxX = bx + offset;
      const leftEdge = x + displayWeek * bw;
      if (taxX < leftEdge + 2) taxX = leftEdge + 2;
      if (isToday) {
        // White badges keep the tiny labels legible on the red circle. Each character is
        // centred in its own badge; the badges are stacked one diameter apart (the
        // reference spaces badges and characters differently, so they never line up).
        const rr = large ? 9 : 7;
        // Reference x, pushed right if the badges would cover a two-digit date.
        const rx = Math.max(taxX + (large ? 36 : 27) - offset - 1, dayInk.x1 + 2 + rr);
        // Reference top badge position, moved up if the lower badge would touch the lunar
        // label (wide festival names like 国庆节 reach under the badges).
        const labelTop = inkBounds(lunarFont, label, labelX, labelBaseline)?.y0 ?? Infinity;
        const ry1 = Math.min(by - 2 - 8 - 3, labelTop - 2 - rr - (2 * rr + 1));
        const ry2 = ry1 + 2 * rr + 1;
        for (const [ch, ry] of [[gan, ry1], [zhi, ry2]] as const) {
          fillCircle(c, rx, ry, rr, Ink.White);
          drawCircle(c, rx, ry, rr, Ink.Red);
          const p = centeredAt(wqy6, ch, rx, ry);
          print(c, wqy6, ch, p.x, p.baseline, Ink.Black);
          check(`badge ${ch}`, wqy6, ch, p.x, p.baseline, rx, ry,
                { color: Ink.Black, circle: { cx: rx, cy: ry, r: rr - 1 } });
          badges.push({ cx: rx, cy: ry, r: rr + 1 });
          opts.boxes?.push({ day, what: `badge ${ch}`, ink: { x0: rx - rr, x1: rx + rr, y0: ry - rr, y1: ry + rr } });
        }
      } else {
        // Reference position, pushed right if it would touch a two-digit date.
        const gx = Math.max(taxX, dayInk.x1 + 2);
        print(c, wqy6, gan, gx, by - 9, Ink.Black);
        print(c, wqy6, zhi, gx, by + width(wqy6, "清") - 7, Ink.Black);
        box(day, "gan", wqy6, gan, gx, by - 9);
        box(day, "zhi", wqy6, zhi, gx, by + width(wqy6, "清") - 7);
      }

      // 休 / 班
      const hol = holidayOf(year, month, day);
      if (hol) {
        const text = hol === "work" ? "班" : "休";
        const holInk = hol === "work" ? Ink.Black : Ink.Red;
        // the 4.2": as small as the stem/branch characters
        const hf = large ? wqy9 : wqy6;
        {
          // On the circle round the date + lunar label (today's red disc) that runs through the
          // top stem/branch badge: that badge mirrored to the left, moved up along the circle
          // until it clears a two-digit date. Today a badge like the stem/branch ones, other
          // days the character alone, in the same place.
          const a = dayInk, b = inkBounds(lunarFont, label, labelX, labelBaseline);
          const dcx = Math.round((Math.min(a.x0, b?.x0 ?? a.x0) + Math.max(a.x1, b?.x1 ?? a.x1)) / 2);
          const dcy = Math.round((a.y0 + (b?.y1 ?? a.y1)) / 2);
          const rr = large ? 9 : 7;
          const gx = Math.max(taxX + (large ? 36 : 27) - offset - 1, dayInk.x1 + 2 + rr);
          const labelTop = b?.y0 ?? Infinity;
          const gy = Math.min(by - 2 - 8 - 3, labelTop - 2 - rr - (2 * rr + 1));
          const R = Math.hypot(gx - dcx, gy - dcy);
          // the mirror image; in the narrow upright 4.2" cells the top of the circle, which
          // stays inside the cell
          let t = tall ? -Math.PI / 2 : Math.atan2(gy - dcy, gx - dcx);
          const at = (u: number) => [Math.round(dcx - R * Math.cos(u)), Math.round(dcy + R * Math.sin(u))];
          const clear = ([px, py]: number[]) => px + rr + 1 < dayInk.x0 || py + rr + 1 < dayInk.y0;
          while (!clear(at(t)) && t > -Math.PI / 2) t -= Math.PI / 90;
          const [rx, ry] = at(t);
          if (isToday) {
            fillCircle(c, rx, ry, rr, Ink.White);
            drawCircle(c, rx, ry, rr, Ink.Red);
            badges.push({ cx: rx, cy: ry, r: rr + 1 });
            opts.boxes?.push({ day, what: `badge ${text}`, ink: { x0: rx - rr, x1: rx + rr, y0: ry - rr, y1: ry + rr } });
          }
          const p = centeredAt(hf, text, rx, ry);
          print(c, hf, text, p.x, p.baseline, holInk);
          if (isToday) check(`badge ${text}`, hf, text, p.x, p.baseline, rx, ry, { color: holInk, circle: { cx: rx, cy: ry, r: rr - 1 } });
          else box(day, text, hf, text, p.x, p.baseline);
        }
      }
    }
    if (todayDisc) {
      opts.checks?.push({ what: "today circle", cx: todayDisc.cx, cy: todayDisc.cy, ink: todayDisc.ink,
        pixels: { color: Ink.White, circle: { cx: todayDisc.cx, cy: todayDisc.cy, r: todayDisc.r - 1 }, exclude: badges } });
    }
  }
  return c;
}

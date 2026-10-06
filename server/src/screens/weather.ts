// Weather screen: current conditions (icon + big 7-segment temperature), next 3 days,
// and a 24-hour temperature curve with precipitation-probability bars.
// Small numbers use WenQuanYi (not Helvetica, which is reserved for bold calendar numbers).
import { Canvas } from "../render/canvas.js";
import { refFonts, width, print, centeredX, centeredAt, drawBattery, type RefFont } from "../render/reftext.js";
import { fonts } from "../render/fonts.js";
import { paintPixel, type Tone } from "../render/dither.js";
import { draw7Number, size7 } from "../render/sevenseg.js";
import { drawWeatherIcon } from "../render/weatherIcons.js";
import { type Panel, Ink } from "../panels.js";
import { WEEKDAY } from "../data/calendar.js";
import { type WeatherData, describeCode, windDirection, windLevel } from "../data/weather.js";
import type { ScreenContext } from "./testPattern.js";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Big temperature: 7-segment digits (+ minus bar), returns the right edge x. */
function bigTemperature(c: Canvas, t: number, x: number, y: number, cS: number): number {
  const v = Math.round(t);
  const nD = Math.abs(v) > 9 ? 2 : 1;
  const sz = size7(cS, nD);
  if (v < 0) {
    c.rect(x, y + Math.round(sz.h / 2) - cS, x + 4 * cS, y + Math.round(sz.h / 2) + cS, Ink.Black);
    x += 6 * cS;
  }
  draw7Number(c, Math.abs(v), x, y, cS, Ink.Black, Ink.White, nD);
  return x + sz.w;
}

function dayLabel(i: number, date: string): string {
  if (i === 1) return "明天";
  if (i === 2) return "后天";
  const [y, m, d] = date.split("-").map(Number);
  return `周${WEEKDAY[new Date(y, m - 1, d).getDay()]}`;
}

function message(c: Canvas, text: string): void {
  const { wqy12 } = refFonts();
  const p = centeredAt(wqy12, text, c.width / 2, c.height / 2);
  print(c, wqy12, text, p.x, p.baseline, Ink.Black);
}

export function renderWeather(panel: Panel, ctx: ScreenContext): Canvas {
  const { wqy12, wqy9 } = refFonts();
  const W = panel.width;
  const H = panel.height;
  const large = H >= 400;
  const c = new Canvas(W, H);
  const w = ctx.weather;
  const now = ctx.now;

  // ── Header ──
  const m = large ? 20 : 10;
  const titleBase = large ? 36 : 22;
  const city = w?.place.name ?? "天气";
  let tx = print(c, wqy12, city, m, titleBase, Ink.Black);
  if (w) {
    const t = new Date(w.fetchedAt);
    tx = print(c, wqy9, `  更新于 ${pad2(t.getHours())}:${pad2(t.getMinutes())}`, tx, titleBase, Ink.Black);
  }
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAY[now.getDay()]}`;
  const batteryW = ctx.batteryV !== undefined ? 60 : 0;
  print(c, wqy9, dateStr, W - m - batteryW - width(wqy9, dateStr), titleBase, Ink.Black);
  if (ctx.batteryV !== undefined) drawBattery(c, W - m, titleBase - 10, ctx.batteryV);
  const ruleY = titleBase + (large ? 12 : 8);
  c.rect(m, ruleY, W - m, ruleY + 1, Ink.Black);

  if (!w) {
    message(c, ctx.weatherNote ?? "请在管理页面设置城市");
    return c;
  }

  // ── Current conditions (left) ──
  const desc = describeCode(w.current.code);
  const iconSize = large ? 120 : 64;
  const curTop = ruleY + (large ? 14 : 8);
  drawWeatherIcon(c, desc.icon, w.current.isDay, m, curTop, iconSize);
  const cS = large ? 5 : 3;
  const tempX = m + iconSize + (large ? 16 : 8);
  const tEnd = bigTemperature(c, w.current.temp, tempX, curTop + (large ? 4 : 2), cS);
  print(c, wqy12, "℃", tEnd + 4, curTop + (large ? 4 : 2) + wqy12.ascent + 2, Ink.Black);
  const textTop = curTop + size7(cS, 1).h + (large ? 18 : 14);
  const today = w.daily[0];
  // rain chance of the coming 12 hours (the chart below), not the day's maximum, which may
  // be hours past -- e.g. rain at dawn
  const popNext = Math.max(0, ...w.hourly.slice(0, 12).map((h) => Math.round(h.pop)));
  // two columns, the second one aligned on every line
  const lines: [string, string][] = [
    [desc.text, `${Math.round(today.tmin)}～${Math.round(today.tmax)}℃`],
    [`体感 ${Math.round(w.current.feels)}℃`, `湿度 ${w.current.humidity}%`],
    [`${windDirection(w.current.windDir)} ${windLevel(w.current.windKmh)}级`, `降水 ${popNext}%`],
  ];
  const lf = large ? wqy12 : wqy9;
  const lineStep = large ? 22 : 15;
  const col2 = tempX + Math.max(...lines.map(([a]) => width(lf, a))) + (large ? 16 : 10);
  lines.forEach(([a, b], i) => {
    print(c, lf, a, tempX, textTop + i * lineStep, Ink.Black);
    print(c, lf, b, col2, textTop + i * lineStep, Ink.Black);
  });
  const currentBottom = Math.max(curTop + iconSize, textTop + (lines.length - 1) * lineStep + 4);

  // ── Next 3 days (right): columns on 3.98", rows on 4.2" (columns would be ~50 px) ──
  const fx0 = large ? 410 : 236;
  if (large) {
    const colW = Math.floor((W - m - fx0) / 3);
    const dIcon = 64;
    for (let i = 1; i <= 3 && i < w.daily.length; i++) {
      const d = w.daily[i];
      const cx = fx0 + (i - 1) * colW + colW / 2;
      const label = dayLabel(i, d.date);
      const top = curTop;
      print(c, lf, label, centeredX(lf, label, cx), top + lf.ascent + 2, Ink.Black);
      drawWeatherIcon(c, describeCode(d.code).icon, true, Math.round(cx - dIcon / 2), top + 24, dIcon);
      const range = `${Math.round(d.tmin)}～${Math.round(d.tmax)}℃`;
      const ry = top + 24 + dIcon + 22;
      print(c, wqy9, range, centeredX(wqy9, range, cx), ry, Ink.Black);
      const t = describeCode(d.code).text + (d.pop >= 10 ? ` ${d.pop}%` : "");
      print(c, wqy9, t, centeredX(wqy9, t, cx), ry + 16, Ink.Black);
      if (i > 1) c.dottedV(fx0 + (i - 1) * colW, top, top + 170, Ink.Black, 1, 3);
    }
  } else {
    const rowH = 32;
    const dIcon = 24;
    for (let i = 1; i <= 3 && i < w.daily.length; i++) {
      const d = w.daily[i];
      const top = curTop + (i - 1) * rowH;
      const mid = top + Math.floor(rowH / 2);
      const label = dayLabel(i, d.date);
      const lb = centeredAt(wqy9, label, 0, mid).baseline;
      print(c, wqy9, label, fx0, lb, Ink.Black);
      drawWeatherIcon(c, describeCode(d.code).icon, true, fx0 + 30, mid - dIcon / 2, dIcon);
      const range = `${Math.round(d.tmin)}～${Math.round(d.tmax)}℃`;
      print(c, wqy9, range, fx0 + 30 + dIcon + 6, lb, Ink.Black);
      if (d.pop >= 30) print(c, wqy9, `${d.pop}%`, W - m - width(wqy9, `${d.pop}%`), lb, Ink.Black);
      if (i > 1) c.dottedH(fx0, W - m, top, Ink.Black, 1, 3);
    }
  }

  // ── 24-hour chart (bottom) ──
  const chartTop = Math.max(currentBottom, curTop + (large ? 176 : 100)) + (large ? 16 : 6);
  c.rect(m, chartTop - (large ? 8 : 4), W - m, chartTop - (large ? 8 : 4) + 1, Ink.Black);
  drawHourlyChart(c, w, m, chartTop, W - m, H - (large ? 10 : 4), large, panel.colors >= 4);
  return c;
}

/**
 * Bar colour for a rain chance: pale yellow -> yellow -> orange -> red on B/W/Y/R panels,
 * light red -> red on B/W/R panels (dithered, see dither.ts).
 */
export function popTone(pop: number, fourColor: boolean): Tone {
  const t = Math.max(0, Math.min(1, pop / 100));
  if (!fourColor) return [[Ink.Red, 0.3 + 0.7 * t]];
  if (t < 0.5) return [[Ink.Yellow, 0.35 + 1.3 * t]];
  const red = 2 * (t - 0.5);
  return [[Ink.Red, red], [Ink.Yellow, 1 - red]];
}

function drawHourlyChart(c: Canvas, w: WeatherData, x0: number, y0: number, x1: number, y1: number,
                         large: boolean, fourColor: boolean): void {
  const { wqy9 } = refFonts();
  // rain-chance numbers: 12px on 3.98"; 10px (5 px digits) on 4.2" so every bar has one
  const numFont: RefFont = large ? wqy9 : { f: fonts().px10, ascent: 8, descent: -2 };
  const hours = w.hourly;
  if (hours.length < 2) return;
  const labelH = 14;           // hour labels at the bottom
  const valueH = 16;           // temperature labels above points
  const barsH = large ? 40 : 22; // precipitation bars
  const barsBottom = y1 - labelH - 2;
  const popTop = barsBottom - barsH - 3 - numFont.ascent; // highest a rain-chance number reaches
  const thick = large ? 2 : 1;
  const gap = large ? 6 : 4;                         // point <-> temperature label
  // room under the curve for a temperature label placed below its point
  const lineBottom = popTop - 3 - (gap + wqy9.ascent + thick);
  const legendH = large ? 18 : 14;
  const lineTop = y0 + legendH + valueH;
  const temps = hours.map((h) => h.temp);
  const tMin = Math.min(...temps), tMax = Math.max(...temps);
  const span = Math.max(4, tMax - tMin);
  const padX = large ? 20 : 12;
  const step = (x1 - x0 - 2 * padX) / (hours.length - 1);
  const px = (i: number) => Math.round(x0 + padX + i * step);
  const py = (t: number) => Math.round(lineBottom - ((t - (tMin + tMax) / 2 + span / 2) / span) * (lineBottom - lineTop));

  // Legend (top right): "── 气温(℃)   ▮ 降水概率(%)", the swatch showing the colour scale
  const lb = y0 + wqy9.ascent + 2;
  const legendText = "降水概率(%)";
  let lx = x1 - width(wqy9, legendText);
  print(c, wqy9, legendText, lx, lb, Ink.Black);
  const sw = large ? 8 : 6, sh = large ? 12 : 10;
  for (let k = 3; k >= 1; k--) { // three swatches: 33%, 66%, 100%
    lx -= sw + (k === 3 ? 4 : 0);
    for (let yy = lb - sh + 1; yy <= lb; yy++) for (let xx = lx; xx < lx + sw; xx++) paintPixel(c, () => popTone(k * 33.4, fourColor), xx, yy);
  }
  c.frame(lx, lb - sh + 1, lx + 3 * sw, lb + 1, Ink.Black);
  const tl = "气温(℃)";
  lx -= (large ? 16 : 10) + width(wqy9, tl);
  print(c, wqy9, tl, lx, lb, Ink.Black);
  const ly = lb - 4;
  c.rect(lx - (large ? 24 : 16), ly, lx - 4, ly + (large ? 2 : 1), Ink.Black);
  c.fillCircle(lx - (large ? 14 : 10), ly + (large ? 1 : 0), large ? 3 : 2, Ink.Black);

  // precipitation bars, coloured by chance, each with its number just above it
  const barW = Math.max(2, Math.floor(step) - 2);
  let lastRight = -Infinity;
  for (let i = 0; i < hours.length; i++) {
    const p = Math.round(hours[i].pop);
    const h = p > 0 ? Math.max(1, Math.round((p / 100) * barsH)) : 0;
    const bx = px(i) - Math.floor(barW / 2);
    if (h > 0) {
      for (let yy = barsBottom - h; yy < barsBottom; yy++) for (let xx = bx; xx < bx + barW; xx++) {
        paintPixel(c, () => popTone(p, fourColor), xx, yy);
      }
      c.frame(bx, barsBottom - h, bx + barW, barsBottom, Ink.Black);
    }
    // never let two numbers touch (only possible with neighbouring 100s on 4.2")
    const v = String(p);
    const nx = centeredX(numFont, v, px(i));
    if (nx <= lastRight + 1) continue;
    lastRight = print(c, numFont, v, nx, barsBottom - h - 3, Ink.Black);
  }
  c.rect(x0, barsBottom, x1, barsBottom + 1, Ink.Black);

  // temperature curve
  for (let i = 0; i + 1 < hours.length; i++) {
    const ax = px(i), ay = py(hours[i].temp), bx = px(i + 1), by = py(hours[i + 1].temp);
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(ax + ((bx - ax) * k) / n), y = Math.round(ay + ((by - ay) * k) / n);
      c.rect(x, y, x + thick, y + thick, Ink.Black);
    }
  }
  const curveY = (x: number): number | undefined => {
    const f = (x - x0 - padX) / step;
    if (f < 0 || f > hours.length - 1) return undefined;
    const k = Math.min(hours.length - 2, Math.floor(f));
    return Math.round(py(hours[k].temp) + (py(hours[k + 1].temp) - py(hours[k].temp)) * (f - k));
  };
  // points + labels every 3 hours (and the first point = now)
  const every = large ? 3 : 4;
  for (let i = 0; i < hours.length; i += every) {
    const x = px(i), y = py(hours[i].temp);
    c.fillCircle(x, y, large ? 3 : 2, i === 0 ? Ink.Red : Ink.Black);
    const v = `${Math.round(hours[i].temp)}°`;
    // Label above the point unless the curve climbs above it within the label's width
    // (the text would sit on the line): then put it below.
    const half = Math.ceil(width(wqy9, v) / 2) + 1;
    let top = y, bottom = y;
    for (let xx = x - half; xx <= x + half; xx++) {
      const yy = curveY(xx);
      if (yy !== undefined) { top = Math.min(top, yy); bottom = Math.max(bottom, yy); }
    }
    const below = y - top > (large ? 10 : 6); // a little climb is fine: lift the label over it
    const vy = below ? bottom + gap + wqy9.ascent + thick : top - gap;
    print(c, wqy9, v, centeredX(wqy9, v, x), vy, i === 0 ? Ink.Red : Ink.Black);
    const hour = Number(hours[i].time.slice(11, 13));
    const lbl = i === 0 ? "现在" : `${hour}时`;
    print(c, wqy9, lbl, centeredX(wqy9, lbl, x), y1 - 2, i === 0 ? Ink.Red : Ink.Black);
  }
}

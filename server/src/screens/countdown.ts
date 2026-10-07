// 倒数日 (TRMNL's "Days Left Until…", no. 6): the featured event with a big red day count,
// the others as a list. Dates that have passed count up ("已经 N 天"), for anniversaries.
// "下个假期" follows the official holiday schedules (updated as they are published).
import { cjkDisplay, cjkAt } from "../render/typography.js";
import { refFonts, width, print, bigRef, type RefFont } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import { WEEKDAY, lunarOf, LUNAR_MONTH, LUNAR_DATE } from "../data/calendar.js";
import { parseCountdowns, featured, type CountdownEvent } from "../data/countdown.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, ellipsize, emptyNote } from "./common.js";

const CONFIG: ConfigField[] = [
  {
    key: "events", label: "事件（每行一个）", type: "textarea",
    default: "下个假期\n2027-06-07 高考\n每年 05-20 妈妈生日\n农历 08-15 中秋\n2015-05-01 结婚纪念日",
    help: "格式：2027-06-07 名称（某一天，过了之后显示\"已经 N 天\"）｜每年 05-20 名称｜农历 08-15 名称｜每月 15 名称｜下个假期（按国家公布的放假安排自动更新）。# 开头为注释。",
  },
  {
    key: "featured", label: "大字显示", type: "select", default: "auto",
    options: [["auto", "最近的一个"], ["holiday", "下一个法定假期"]],
    dynamicOptions: (v, now) => parseCountdowns(v.events ?? "", now).events
      .filter((e) => e.kind !== "holiday").map((e) => [e.name, e.name] as [string, string]),
  },
];

interface CountdownData { events: CountdownEvent[]; featured: string }

function dateLine(e: CountdownEvent, withYear = true): string {
  const d = e.date;
  let s = `${withYear ? `${d.getFullYear()}年` : ""}${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAY[d.getDay()]}`;
  if (e.kind === "lunar") {
    const l = lunarOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
    s += ` · 农历${LUNAR_MONTH[l.month]}${LUNAR_DATE[l.day]}`;
  }
  return s;
}

/** The largest display font (not above maxPx) at which `s` fits `maxW`, else the 16 px bitmap font. */
function fitCjk(s: string, maxW: number, large: boolean, maxPx: number): RefFont {
  return cjkDisplay(large, maxPx).find((f) => width(f, s) <= maxW) ?? refFonts().wqy12;
}

export function renderCountdown(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const data = (ctx.data as CountdownData | undefined) ?? { events: parseCountdowns(CONFIG[0].default!, ctx.now).events, featured: "auto" };
  const events = data.events;
  const f = screenWithHeader(panel, ctx, "倒数日");
  const { c, W, H, large, m } = f;
  if (!events.length) { emptyNote(f, "在\"显示模式\"页面添加要倒数的日子"); return c; }
  const main = featured(events, data.featured)!;
  const rest = events.filter((e) => e !== main);

  // ── featured: name / [还有] 123 [天] / date, centred in its area ──
  // upright: the featured one in the top part, the others listed under it, full width
  const tall = H > W;
  const area = tall && rest.length
    ? { x0: m, x1: W - m, y0: f.top, y1: f.top + Math.round((H - f.top) * (large ? 0.4 : 0.42)) }
    : large && rest.length
      ? { x0: m, x1: 400, y0: f.top, y1: H }
      : { x0: m, x1: W - m, y0: f.top, y1: large || !rest.length ? H : f.top + 150 };
  const cx = Math.round((area.x0 + area.x1) / 2);
  const nameF = fitCjk(main.name, area.x1 - area.x0 - 20, large, large ? 40 : 32);
  const name = ellipsize(nameF, main.name, area.x1 - area.x0 - 20);
  const num = bigRef("barlow", large ? 96 : 56);
  const unitF = cjkAt(large, large ? 32 : 24), verbF = cjkAt(large, 24);
  const dateF = large ? wqy12 : wqy9;
  const gap1 = large ? 26 : 12, gap2 = large ? 22 : 12;
  const blockH = nameF.ascent + gap1 + num.ascent + gap2 + dateF.ascent;
  let y = Math.round(area.y0 + (area.y1 - area.y0 - blockH) / 2) + nameF.ascent;
  print(c, nameF, name, Math.round(cx - width(nameF, name) / 2), y, Ink.Black);
  y += gap1 + num.ascent;
  if (main.days === 0) {
    const t = cjkAt(large, large ? 40 : 32);
    print(c, t, "就是今天", Math.round(cx - width(t, "就是今天") / 2), y, Ink.Red);
  } else {
    const verb = main.past ? "已经" : "还有";
    const n = String(main.days);
    // the number itself on the centre line, 还有 / 天 beside it
    const wV = width(verbF, verb), wN = width(num, n);
    const nx = Math.round(cx - wN / 2);
    print(c, verbF, verb, nx - 12 - wV, y, Ink.Black);
    const x = print(c, num, n, nx, y, main.past ? Ink.Black : Ink.Red) + 10;
    print(c, unitF, "天", x, y, Ink.Black);
  }
  y += gap2 + dateF.ascent;
  const dl = dateLine(main);
  print(c, dateF, dl, Math.round(cx - width(dateF, dl) / 2), y, Ink.Black);

  if (!rest.length) return c;
  const days = bigRef("barlow", large ? 44 : 32);
  if (large || tall) {
    // ── the others: a list sharing the column's height (upright: under the featured one) ──
    if (tall) c.dottedH(m, W - m, area.y1, Ink.Black, 1, 3);
    else c.dottedV(412, f.top + 20, H - 20, Ink.Black, 1, 3);
    const x0 = tall ? m : 432, x1 = W - m;
    const top = tall ? area.y1 + (large ? 10 : 4) : f.top + 14, avail = H - top - (large ? 12 : 6);
    const rowH = large ? Math.max(52, Math.min(80, Math.floor(avail / rest.length))) : Math.max(36, Math.min(48, Math.floor(avail / rest.length)));
    const shown = Math.min(rest.length, Math.floor(avail / rowH));
    const y0 = top + Math.round((avail - shown * rowH) / 2);
    rest.slice(0, shown).forEach((e, i) => {
      const mid = y0 + i * rowH + Math.round(rowH / 2);
      const numS = String(e.days);
      const right = x1 - width(wqy12, "天") - 6 - width(days, numS);
      print(c, wqy12, ellipsize(wqy12, e.name, right - x0 - 14), x0, mid - (large ? 4 : 2), Ink.Black);
      const showYear = e.past || e.date.getFullYear() > ctx.now.getFullYear() + 1;
      print(c, wqy9, ellipsize(wqy9, (e.past ? "已经 · " : "") + dateLine(e, showYear), right - x0 - 14), x0, mid + (large ? 16 : 12), Ink.Black);
      const nb = mid + Math.round(days.ascent / 2) - 2;
      print(c, days, numS, right, nb, e.past ? Ink.Black : Ink.Red);
      print(c, wqy12, "天", x1 - width(wqy12, "天"), nb, Ink.Black);
      if (i < shown - 1) c.dottedH(x0, x1, y0 + (i + 1) * rowH, Ink.Black, 1, 3);
    });
  } else {
    // two columns of compact rows under the featured block
    const ly = area.y1 + 4;
    c.dottedH(m, W - m, ly, Ink.Black, 1, 3);
    const colW = Math.floor((W - 2 * m - 16) / 2);
    const rows = Math.max(1, Math.ceil(rest.length / 2));
    const rowH = Math.max(20, Math.min(34, Math.floor((H - ly - 6) / rows)));
    rest.slice(0, Math.floor((H - ly - 6) / rowH) * 2).forEach((e, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x0 = m + col * (colW + 16), x1 = x0 + colW;
      const base = ly + 6 + row * rowH + Math.round(rowH / 2) + 4;
      const numS = `${e.days}`;
      const nw = width(wqy12, numS) + width(wqy9, "天") + 2;
      print(c, wqy9, ellipsize(wqy9, e.name, x1 - x0 - nw - 8), x0, base, Ink.Black);
      const nx = print(c, wqy12, numS, x1 - nw, base, e.past ? Ink.Black : Ink.Red);
      print(c, wqy9, "天", nx + 2, base, Ink.Black);
    });
  }
  return c;
}

export const countdownMode: Screen = {
  name: "倒数日",
  description: "考试、生日、纪念日、下个假期……离那天还有多少天（支持农历和每年重复，可选哪个大字显示）。",
  config: CONFIG,
  render: renderCountdown,
  portrait: true,
  prepare: async (db, now) => {
    const cfg = getModeConfig(db, "countdown", CONFIG);
    return { data: { events: parseCountdowns(cfg.events, now).events, featured: cfg.featured } satisfies CountdownData };
  },
};

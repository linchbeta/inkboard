// 看板 (Timeframe / MagInkDash style, no. 10): one screen with the date and weather on the
// left, and on the right the newest message, today's remaining events and the open to-dos
// -- each taken from this screen's own 留言 / 日程 / 待办 content. Room left at the bottom
// right takes the next official holiday and a short 一言 sentence.
import { Canvas } from "../render/canvas.js";
import { cjkAt } from "../render/typography.js";
import { refFonts, width, print, centeredX, centeredAt, bigRef, drawBattery, type RefFont } from "../render/reftext.js";
import { drawWeatherIcon } from "../render/weatherIcons.js";
import { type Panel, Ink } from "../panels.js";
import { WEEKDAY, LUNAR_MONTH, LUNAR_DATE, lunarOf, festivalOf, holidayOf, nextHoliday } from "../data/calendar.js";
import { hitokoto, attribution, type Quote } from "../data/hitokoto.js";
import { getWeather, getPlace, describeCode, windDirection, windLevel, type WeatherData } from "../data/weather.js";
import { messagesFor, type Message } from "../data/messages.js";
import type { CalEvent } from "../data/ics.js";
import { currentDevice } from "../scope.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { wrapText, ellipsize, drawQuoteMark } from "./common.js";
import { agendaMode, groupByDay } from "./agenda.js";
import { todoMode, type TodoGroup } from "./todo.js";

interface DashData {
  messages: Message[];
  todo: TodoGroup[];
  events: CalEvent[];
  agenda: boolean; // 日程 has feeds or entries
  quote?: Quote;
}

interface Line { text: string; ink?: Ink; lead?: { text: string; ink: Ink }; box?: boolean }
interface Section { title: string; sub: string; lines: Line[]; cap: number }

const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

function ago(at: string, now: Date): string {
  const d = new Date(at);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  return days === 0 ? `今天 ${hm(d)}` : days === 1 ? `昨天 ${hm(d)}` : `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** The right-hand sections, with every line they could show. */
function sections(data: DashData, now: Date, font: RefFont, w: number, large: boolean): Section[] {
  const out: Section[] = [];
  const msg = data.messages[0];
  if (msg) {
    out.push({ title: "留言", sub: `${msg.from || "家人"} · ${ago(msg.at, now)}`, cap: large ? 5 : 3,
      lines: wrapText(font, msg.text, w).map((text) => ({ text })) });
  }
  if (data.agenda) {
    const [today] = groupByDay(data.events, now, 1);
    const tomorrow = today ? undefined : groupByDay(data.events, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), 1)[0];
    const g = today ?? tomorrow;
    const lines: Line[] = g ? g.events.map((e) => {
      const ongoing = !!today && !e.allDay && e.start <= now;
      return { text: e.title + (e.location ? ` @${e.location}` : ""), lead: { text: e.allDay ? "全天" : ongoing ? "现在" : hm(e.start), ink: ongoing ? Ink.Red : Ink.Black } };
    }) : [{ text: "今明两天没有日程" }];
    out.push({ title: tomorrow ? "明天" : "日程", sub: g ? `${g.events.length} 项` : "", cap: large ? 6 : 4, lines });
  }
  const open = data.todo.flatMap((g) => g.items.filter((i) => !i.done).map((i) => ({ text: i.text, group: g.name })));
  const total = data.todo.reduce((n, g) => n + g.items.length, 0);
  if (total) {
    out.push({ title: "待办", sub: open.length ? `还有 ${open.length} 项` : "", cap: 99,
      lines: open.length ? open.map((i) => ({ text: i.text, box: true, lead: i.group ? { text: i.group, ink: Ink.Red } : undefined }))
        : [{ text: "全部完成" }] });
  }
  return out;
}

export function renderDashboard(panel: Panel, ctx: ScreenContext): Canvas {
  const { wqy12, wqy9 } = refFonts();
  const W = panel.width, H = panel.height, large = H >= 400;
  const c = new Canvas(W, H);
  const data = (ctx.data as DashData | undefined) ?? { messages: [], todo: [], events: [], agenda: false };
  const now = ctx.now, y = now.getFullYear(), mo = now.getMonth() + 1, d = now.getDate();
  const pad = large ? 20 : 10;

  // ── left: the date, lunar date, weather ──
  const lw = large ? 250 : 136, cx = Math.round(lw / 2);
  const off = now.getDay() === 0 || now.getDay() === 6 ? holidayOf(y, mo, d) !== "work" : holidayOf(y, mo, d) === "off";
  const head = `${y}年${mo}月 星期${WEEKDAY[now.getDay()]}`;
  const hf = large ? wqy12 : wqy9;
  let yy = pad + hf.ascent + (large ? 4 : 2);
  print(c, hf, head, centeredX(hf, head, cx), yy, Ink.Black);
  const num = bigRef("barlow", large ? 96 : 56);
  yy += (large ? 14 : 8) + num.ascent;
  print(c, num, String(d), centeredX(num, String(d), cx), yy, off ? Ink.Red : Ink.Black);
  const l = lunarOf(y, mo, d);
  const fest = festivalOf(y, mo, d, l) ?? l.jieqi;
  const lunar = `${l.leap ? "闰" : ""}${LUNAR_MONTH[l.month]}${LUNAR_DATE[l.day]}`;
  yy += (large ? 16 : 10) + hf.ascent;
  const lx = centeredX(hf, lunar + (fest ? ` ${fest}` : ""), cx);
  const ex = print(c, hf, lunar, lx, yy, Ink.Black);
  if (fest) print(c, hf, ` ${fest}`, ex, yy, Ink.Red);
  yy += large ? 22 : 12;
  c.dottedH(pad, lw - pad, yy, Ink.Black, 1, 3);

  const w = ctx.weather;
  const wTop = yy + (large ? 18 : 8);
  if (w) {
    const desc = describeCode(w.current.code);
    const icon = large ? 72 : 40;
    const t = String(Math.round(w.current.temp));
    const tf = bigRef("barlow", large ? 56 : 32);
    const unitW = width(wqy12, "℃");
    const rowW = icon + (large ? 10 : 4) + width(tf, t) + 2 + unitW;
    const ix = Math.round(cx - rowW / 2);
    drawWeatherIcon(c, desc.icon, w.current.isDay, ix, wTop, icon);
    const tb = wTop + Math.round(icon / 2 + tf.ascent / 2);
    const tx = print(c, tf, t, ix + icon + (large ? 10 : 4), tb, Ink.Black);
    print(c, wqy12, "℃", tx + 2, tb - tf.ascent + wqy12.ascent, Ink.Black);
    const today = w.daily[0];
    const line = `${desc.text} ${Math.round(today.tmin)}～${Math.round(today.tmax)}℃`;
    const ly = wTop + icon + (large ? 14 : 8) + hf.ascent;
    print(c, hf, ellipsize(hf, line, lw - 2 * pad), centeredX(hf, ellipsize(hf, line, lw - 2 * pad), cx), ly, Ink.Black);
    // below, as many as fit (in this order of priority): the next two days, today's feel and
    // humidity, wind and rain, the third day; the room left is shared out between them, so
    // the column reaches down to the bottom instead of stopping short
    const sf = large ? wqy12 : wqy9;
    const dayH = large ? 44 : 26, lineH = large ? 26 : 16, ruleH = large ? 12 : 6;
    const sp = large ? " " : "";
    const rain = today.pop >= 30 ? `降水${sp}${today.pop}%` : "";
    const lvl = windLevel(w.current.windKmh);
    const wind = lvl <= 2 ? "微风" : `${windDirection(w.current.windDir)}${sp}${lvl}级`;
    type Item = { kind: "line"; text: string; red?: string } | { kind: "day"; i: number };
    const items: (Item & { prio: number })[] = [
      { kind: "line", text: `体感${sp}${Math.round(w.current.feels)}℃  湿度${sp}${w.current.humidity}%`, prio: 2 },
      { kind: "line", text: `${wind}${rain ? "  " : ""}`, red: rain, prio: 3 },
      ...[1, 2, 3].filter((i) => i < w.daily.length).map((i) => ({ kind: "day" as const, i, prio: i === 3 ? 4 : i - 1 })),
    ];
    const hOf = (it: Item) => (it.kind === "day" ? dayH : lineH);
    const top = ly + Math.round(hf.ascent * 0.4);
    const room = H - pad - top;
    const chosen = new Set<Item>();
    let used = 0;
    for (const it of [...items].sort((a, b) => a.prio - b.prio)) {
      const extra = hOf(it) + (it.kind === "day" && ![...chosen].some((c) => c.kind === "day") ? ruleH : 0);
      if (used + extra <= room) { chosen.add(it); used += extra; }
    }
    const shown = items.filter((it) => chosen.has(it));
    const spare = Math.min(large ? 16 : 8, Math.floor((room - used) / (shown.length + 1)));
    let fy = top + spare;
    let ruled = false;
    for (const it of shown) {
      if (it.kind === "line") {
        const t = ellipsize(sf, it.text + (it.red ?? ""), lw - 2 * pad);
        const base = centeredAt(sf, t, 0, fy + lineH / 2).baseline;
        const x = print(c, sf, it.red ? t.slice(0, it.text.length) : t, centeredX(sf, t, cx), base, Ink.Black);
        if (it.red && t.length > it.text.length) print(c, sf, t.slice(it.text.length), x, base, Ink.Red);
        fy += lineH + spare;
        continue;
      }
      if (!ruled) { c.dottedH(pad, lw - pad, fy + Math.round(ruleH / 2), Ink.Black, 1, 3); fy += ruleH; ruled = true; }
      const dd = w.daily[it.i];
      const mid = fy + Math.round(dayH / 2);
      const label = ["", "明天", "后天", "大后天"][it.i];
      print(c, sf, label, pad, centeredAt(sf, label, 0, mid).baseline, Ink.Black);
      const is = large ? 28 : 18;
      drawWeatherIcon(c, describeCode(dd.code).icon, true, pad + (large ? 56 : 38), mid - Math.round(is / 2), is);
      const r = `${Math.round(dd.tmin)}～${Math.round(dd.tmax)}℃`;
      print(c, sf, r, lw - pad - width(sf, r), centeredAt(sf, r, 0, mid).baseline, Ink.Black);
      fy += dayH + spare;
    }
  } else {
    const note = ctx.weatherNote ?? "未设置天气城市";
    wrapText(wqy9, note, lw - 2 * pad, 3).forEach((s, i) => print(c, wqy9, s, centeredX(wqy9, s, cx), wTop + 14 + i * 16, Ink.Black));
  }
  c.dottedV(lw, pad, H - pad, Ink.Black, 1, 3);

  // ── right: message, events, to-dos ──
  const x0 = lw + (large ? 22 : 10), x1 = W - pad;
  const font = large ? cjkAt(true, 24) : wqy12;
  const lh = large ? 36 : 20, headH = large ? 34 : 22, gap = large ? 14 : 6;
  const lead = (s: Section) => Math.max(0, ...s.lines.map((ln) => (ln.lead ? width(wqy9, ln.lead.text) + (large ? 12 : 6) : 0)));
  const box = large ? 16 : 10;
  // battery top right, where the other screens have it (header baseline 36 / 22, common.ts)
  const batteryW = ctx.batteryV !== undefined ? 66 : 0;
  if (ctx.batteryV !== undefined) drawBattery(c, W - pad, (large ? 36 : 22) - 10, ctx.batteryV);
  const secs = sections(data, now, font, x1 - x0, large);
  if (!secs.length) {
    const s = "在后台给这块屏留言、添加日程或待办";
    const lines = wrapText(wqy12, s, x1 - x0 - 20);
    lines.forEach((t, i) => print(c, wqy12, t, centeredX(wqy12, t, (x0 + x1) / 2), Math.round(H / 3) + i * 22, Ink.Black));
    footer(Math.round(H / 3) + lines.length * 22 + 10);
    return c;
  }
  // lines per section: one each first, then in order up to each section's cap
  let left = Math.floor((H - 2 * pad - secs.length * headH - (secs.length - 1) * gap) / lh);
  const shown = secs.map(() => 0);
  secs.forEach((s, i) => { if (left > 0 && s.lines.length) { shown[i] = 1; left--; } });
  secs.forEach((s, i) => { const more = Math.max(0, Math.min(left, Math.min(s.cap, s.lines.length) - shown[i])); shown[i] += more; left -= more; });

  let top = pad;
  secs.forEach((s, i) => {
    // red title tag, subtitle, rule
    const tf = large ? wqy12 : wqy9;
    const tw = width(tf, s.title) + (large ? 16 : 10), th = large ? 24 : 16;
    c.rect(x0, top, x0 + tw, top + th, Ink.Red);
    const p = centeredAt(tf, s.title, x0 + tw / 2, top + th / 2);
    print(c, tf, s.title, p.x, p.baseline, Ink.White);
    const sb = centeredAt(wqy9, s.sub || "·", 0, top + th / 2).baseline;
    const sx = s.sub ? print(c, wqy9, s.sub, x0 + tw + 8, sb, Ink.Black) + 8 : x0 + tw + 8;
    c.dottedH(sx, i === 0 ? x1 - batteryW : x1, top + Math.round(th / 2), Ink.Black, 1, 3);
    top += headH;
    const leadW = lead(s);
    s.lines.slice(0, shown[i]).forEach((ln, k) => {
      const mid = top + Math.round(lh / 2);
      const base = centeredAt(font, "国", 0, mid).baseline;
      let x = x0;
      if (ln.box) { const b = Math.round(mid - box / 2); c.frame(x, b, x + box, b + box, Ink.Black); x += box + (large ? 10 : 5); }
      if (ln.lead) print(c, wqy9, ln.lead.text, x, centeredAt(wqy9, ln.lead.text, 0, mid).baseline, ln.lead.ink);
      if (leadW && !ln.box) x += leadW;
      else if (ln.lead) x += width(wqy9, ln.lead.text) + (large ? 10 : 5);
      const last = k === shown[i] - 1 && shown[i] < s.lines.length;
      const text = last ? ellipsize(font, `${ln.text}…`, x1 - x) : ellipsize(font, ln.text, x1 - x);
      print(c, font, text, x, base, ln.ink ?? Ink.Black);
      top += lh;
    });
    top += gap;
  });
  footer(top);
  return c;

  // bottom right, in the room the sections left (from `from` down): the next holiday,
  // then a short sentence and its source
  function footer(from: number) {
    const bottom = H - pad;
    const qf = large ? cjkAt(true, 24) : wqy12, sf = wqy9, srcH = large ? 20 : 15;
    const q = data.quote;
    const qIndent = large ? 26 : 16;
    const qLines = q ? wrapText(qf, q.text, x1 - x0 - qIndent, 2) : [];
    const src = q ? attribution(q) : "";
    const quoteH = qLines.length ? qLines.length * lh + (src ? srcH : 0) : 0;
    const hol = nextHoliday(y, mo, d);
    const holH = hol && hol.days > 0 ? lh : 0;
    const sep = large ? 16 : 8;
    let room = bottom - from;
    const showQuote = quoteH > 0 && room >= quoteH + sep;
    if (showQuote) room -= quoteH + sep;
    const showHol = holH > 0 && room >= holH + (showQuote ? 0 : sep);
    if (!showQuote && !showHol) return;
    let yy = bottom - (showQuote ? quoteH : 0) - (showHol ? holH : 0);
    c.dottedH(x0, x1, yy - Math.round(sep / 2), Ink.Black, 1, 3);
    if (showHol && hol) {
      // 距国庆节还有 3 天 (the number in red)
      const base = centeredAt(qf, "国", 0, yy + Math.round(lh / 2)).baseline;
      let x = print(c, qf, "距", x0, base, Ink.Black);
      x = print(c, qf, hol.name, x, base, Ink.Red);
      x = print(c, qf, "还有 ", x, base, Ink.Black);
      x = print(c, qf, String(hol.days), x, base, Ink.Red);
      print(c, qf, " 天", x, base, Ink.Black);
      yy += holH;
    }
    if (showQuote && q) {
      drawQuoteMark(c, x0, yy + (large ? 6 : 3), large ? 14 : 9, Ink.Red);
      for (const l of qLines) { print(c, qf, l, x0 + qIndent, centeredAt(qf, "国", 0, yy + Math.round(lh / 2)).baseline, Ink.Black); yy += lh; }
      if (src) {
        const s = ellipsize(sf, src, x1 - x0);
        print(c, sf, s, x1 - width(sf, s), yy + srcH - (large ? 6 : 4), Ink.Black);
      }
    }
  }
}

export const dashboardMode: Screen = {
  name: "看板",
  description: "一屏看全：日期、农历、天气，加上最新留言、今天的日程和没做完的待办（取自这块屏的留言、日程、待办内容）；下方空余时显示下个假期和一句一言。",
  render: renderDashboard,
  prepare: async (db, now, params) => {
    const [weather, agenda, todo, quote] = await Promise.all([
      getWeather(db, now).catch(() => undefined),
      agendaMode.prepare!(db, now),
      todoMode.prepare!(db, now),
      hitokoto(db, { categories: "dik", length: "0-24", advance: params?.advance === "1", key: "quote:dashboard" }),
    ]);
    const a = agenda.data as { events: CalEvent[]; configured: boolean };
    const data: DashData = {
      messages: messagesFor(db, currentDevice()),
      todo: (todo.data as { groups: TodoGroup[] }).groups,
      events: a.events,
      agenda: a.configured,
      quote,
    };
    return {
      data, weather: weather as WeatherData | undefined,
      weatherNote: weather ? undefined : getPlace(db) ? "天气暂时无法获取" : "在\"内容\"里设置天气城市",
    };
  },
};

// 日程 (TRMNL's Google / Apple / Outlook Calendar, nos. 2, 5 and 9): the coming days'
// events from ICS subscription links and hand-written lines, grouped by day. Today's
// events that are over are left out.
import { refFonts, width, print, centeredAt } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import { WEEKDAY } from "../data/calendar.js";
import { parseIcs, fetchIcs, type CalEvent } from "../data/ics.js";
import { parseLocalEvents, canonicalLines, checkLines } from "../data/localEvents.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, ellipsize, emptyNote } from "./common.js";

const CONFIG: ConfigField[] = [
  { key: "feeds", label: "日历订阅链接（每行一个）", type: "textarea", default: "",
    placeholder: "家庭|https://calendar.google.com/calendar/ical/…/basic.ics",
    help: "可选\"名称|\"前缀。Google 日历：设置 → 日历的\"iCal 格式的私密地址\"；iPhone/iCloud：共享日历 → 公开日历链接；Outlook：发布日历 → ICS 链接；飞书/钉钉/企业微信日历也可导出订阅链接。" },
  { key: "local", label: "手动添加的日程", type: "textarea", default: "",
    placeholder: "2026-10-14 矿产资源竞赛 @大足\n10月20日 下午2点-4点 家长会 @学校\n明天 9:30 牙医\n10-24~10-26 出差 @成都\n每周一三五 07:50 升旗仪式\n每月15号 还信用卡\n每年5月20日 纪念日",
    help: "每行一条：日期，可选时间，内容，可选 @地点。日期可写 2026-10-14、10/14、10月14日、明天、周五、下周三，几天的用 10-24~10-26；重复的写 每天、工作日、每周一三五、每月15号、每年5月20日。时间可写 14:00、14:00-16:00、下午2点、2点半，不写就是全天。明天、周五这类写法保存时换成具体日期。下面列出每行的识别结果。",
    normalize: canonicalLines,
    check: (v, now, cfg) => checkLines(v, now, Number(cfg.days || 7)) },
  { key: "days", label: "显示范围", type: "select", default: "7", options: [["3", "今天和之后 3 天"], ["7", "今天和之后 7 天"], ["14", "今天和之后 14 天"], ["30", "今天和之后 30 天"]] },
];

interface AgendaData { events: CalEvent[]; errors: string[]; configured: boolean; /** Days after today shown. */ days?: number }

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

function dayLabel(d: Date, today: Date): string {
  const n = Math.round((midnight(d).getTime() - midnight(today).getTime()) / 86_400_000);
  const base = `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY[d.getDay()]}`;
  return n === 0 ? `今天 ${base}` : n === 1 ? `明天 ${base}` : n === 2 ? `后天 ${base}` : base;
}

/** Events per day (all-day events on every day they cover), today's finished ones dropped. */
export function groupByDay(events: CalEvent[], now: Date, days: number): { day: Date; events: CalEvent[] }[] {
  const out: { day: Date; events: CalEvent[] }[] = [];
  for (let k = 0; k < days; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const evs = events.filter((e) => e.allDay ? e.start < next && e.end > day : e.start >= day && e.start < next)
      .filter((e) => k > 0 || e.allDay || e.end > now || (e.end.getTime() === e.start.getTime() && e.start >= now))
      .sort((a, b) => (a.allDay === b.allDay ? a.start.getTime() - b.start.getTime() : a.allDay ? -1 : 1));
    if (evs.length) out.push({ day, events: evs });
  }
  return out;
}

export function renderAgenda(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const data = (ctx.data as AgendaData | undefined) ?? { events: [], errors: [], configured: false };
  // every day of the range with something on (what does not fit is counted below)
  const days = groupByDay(data.events, ctx.now, (data.days ?? 7) + 1);
  const total = days.reduce((n, d) => n + d.events.length, 0);
  const f = screenWithHeader(panel, ctx, "日程", total ? `接下来 ${total} 项` : "");
  const { c, W, H, large, m } = f;
  if (!data.configured) { emptyNote(f, "在\"显示模式\"页面添加日历订阅链接，或手动写下日程"); return c; }
  if (!days.length) emptyNote(f, data.errors.length ? `日历获取失败：${data.errors[0]}` : "接下来几天没有日程，好好休息");

  const font = large ? wqy12 : wqy9;
  const rowH = large ? 26 : 17, headH = large ? 32 : 22, timeW = width(font, "00:00") + (large ? 14 : 8);
  const cols = large ? 2 : 1, gap = 28;
  const colW = Math.floor((W - 2 * m - (cols - 1) * gap) / cols);
  const colY = Array.from({ length: cols }, () => f.top + (large ? 14 : 8));
  const bottom = H - (large ? 22 : 16); // room for "还有 N 项未显示"
  let hidden = 0;
  for (const g of days) {
    // a day goes to the column that has room, left one first (reading order)
    let col = colY.findIndex((y) => y + headH + rowH <= bottom);
    if (col < 0) { hidden += g.events.length; continue; }
    const x0 = m + col * (colW + gap), x1 = x0 + colW;
    let y = colY[col];
    const isToday = midnight(g.day).getTime() === midnight(ctx.now).getTime();
    const label = dayLabel(g.day, ctx.now);
    const lb = y + (large ? 18 : 13);
    const lx = print(c, font, label, x0, lb, isToday ? Ink.Red : Ink.Black);
    c.dottedH(lx + 8, x1, lb - Math.round(font.ascent / 2), Ink.Black, 1, 3);
    y += headH;
    for (const e of g.events) {
      if (y + rowH > bottom) {
        const next = colY.findIndex((cy, i) => i > col && cy + rowH <= bottom);
        if (next < 0) { hidden++; continue; }
        colY[col] = y; col = next; y = colY[col];
      }
      const cx0 = m + col * (colW + gap), cx1 = cx0 + colW;
      const base = y + (large ? 18 : 12);
      if (e.allDay) {
        // yellow "全天" tag (red on B/W/R)
        const tw = width(wqy9, "全天") + 8, th = large ? 18 : 14;
        c.rect(cx0, base - th + 3, cx0 + tw, base + 3, Ink.Yellow);
        const p = centeredAt(wqy9, "全天", cx0 + tw / 2, base - th / 2 + 3);
        print(c, wqy9, "全天", p.x, p.baseline, panel.colors >= 4 ? Ink.Black : Ink.White);
      } else {
        const ongoing = isToday && e.start <= ctx.now;
        print(c, font, ongoing ? "现在" : hm(e.start), cx0, base, ongoing ? Ink.Red : Ink.Black);
      }
      const tx = cx0 + timeW + (large ? 10 : 6);
      const loc = e.location ? ` @${e.location}` : "";
      const tw = cx1 - tx;
      const title = ellipsize(font, e.title, tw);
      const ex = print(c, font, title, tx, base, Ink.Black);
      if (loc && ex + 12 + 30 < cx1) print(c, wqy9, ellipsize(wqy9, loc.trim(), cx1 - ex - 12), ex + 12, base, Ink.Black);
      y += rowH;
    }
    colY[col] = y + (large ? 10 : 6);
  }
  if (hidden) {
    const s = `还有 ${hidden} 项未显示`;
    print(c, wqy9, s, W - m - width(wqy9, s), H - 3, Ink.Black);
  }
  return c;
}

export const agendaMode: Screen = {
  name: "日程",
  description: "接下来几天的日程：订阅 Google / iCloud / Outlook / 飞书等日历（ICS 链接），或手动添加。",
  config: CONFIG,
  render: renderAgenda,
  prepare: async (db, now) => {
    const cfg = getModeConfig(db, "agenda", CONFIG);
    // today and the next `days` days, the last one included
    const n = Number(cfg.days || 7);
    const from = midnight(now), to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + n + 1);
    const events: CalEvent[] = [], errors: string[] = [];
    const feeds = cfg.feeds.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    await Promise.all(feeds.map(async (line) => {
      const [name, url] = line.includes("|") ? line.split("|", 2).map((s) => s.trim()) : ["", line];
      try { events.push(...parseIcs(await fetchIcs(url), from, to, name)); }
      catch (e) { errors.push(`${name || url.slice(0, 30)}：${e instanceof Error ? e.message : e}`); }
    }));
    events.push(...parseLocalEvents(cfg.local, from, to));
    return { data: { events, errors, configured: feeds.length > 0 || cfg.local.trim() !== "", days: n } satisfies AgendaData };
  },
};

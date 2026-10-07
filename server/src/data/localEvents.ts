// Hand-written events for 日程, one per line, written the way people write them:
//
//   2026-10-14 矿产资源竞赛 @大足        10月14日 14:00-16:00 家长会 @学校
//   明天 下午3点 牙医                    下周三 2点半 钢琴课
//   10-14~10-16 出差 @成都               每周一三五 07:50 升旗
//   每天 21:00 刷牙    每月15号 还信用卡    每年5月20日 结婚纪念日
//
// A line is a date (or a rule), an optional time or time range, the title and an optional
// "@place". Full-width digits and punctuation are fine. Dates relative to today (明天, 周五,
// a date without the year) are made absolute when the settings are saved (canonicalLines),
// so they do not move on with the days. checkLines says how each line was understood (or
// why not), for the settings page.
import type { CalEvent } from "./ics.js";

const DAY = 86_400_000;
const WD = "日一二三四五六";

type Days = { kind: "dates"; first: Date; last: Date } | { kind: "rule"; test: (d: Date) => boolean; label: string };

export interface LocalEvent {
  days: Days;
  /** Minutes after midnight; none: all day. */
  start?: number;
  end?: number;
  title: string;
  location: string;
}

interface Parsed { event?: LocalEvent; error?: string; /** The date part as written, and as an absolute date when it was relative. */ dateText?: string; absolute?: string }

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Full-width digits / letters / punctuation to ASCII, the usual dashes and tildes unified. */
function normalize(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, " ").replace(/[〜～]/g, "~").replace(/[—–－﹣]/g, "-").replace(/\s+/g, " ").trim();
}

/** A real calendar date (rejects 2-30). */
function date(y: number, m: number, d: number): Date | undefined {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? t : undefined;
}

const weekdays = (s: string) => [...s.replace(/天/g, "日")].map((c) => WD.indexOf(c)).filter((i) => i >= 0);

const DATE = String.raw`(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?`;

/** The date part at the start of `s`: the days and how many characters it took. */
function parseDate(s: string, now: Date): { days: Days; len: number; relative: boolean } | { error: string } | undefined {
  const today = midnight(now);
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^每天/))) return { days: { kind: "rule", test: () => true, label: "每天" }, len: m[0].length, relative: false };
  if ((m = s.match(/^(?:每个?)?工作日/))) return { days: { kind: "rule", test: (d) => d.getDay() >= 1 && d.getDay() <= 5, label: "工作日" }, len: m[0].length, relative: false };
  if ((m = s.match(/^每个?周末/))) return { days: { kind: "rule", test: (d) => d.getDay() === 0 || d.getDay() === 6, label: "每周末" }, len: m[0].length, relative: false };
  if ((m = s.match(/^每(?:个)?(?:周|星期|礼拜)\s*([日天一二三四五六、,，和及 ]*[日天一二三四五六])/))) {
    const set = new Set(weekdays(m[1]));
    return { days: { kind: "rule", test: (d) => set.has(d.getDay()), label: `每周${[...set].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((i) => WD[i]).join("")}` }, len: m[0].length, relative: false };
  }
  if ((m = s.match(/^每个?月\s*(\d{1,2})\s*[号日]/))) {
    const n = +m[1];
    if (n < 1 || n > 31) return { error: `每月 ${n} 号不存在` };
    return { days: { kind: "rule", test: (d) => d.getDate() === n, label: `每月${n}号` }, len: m[0].length, relative: false };
  }
  if ((m = s.match(/^每年\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/))) {
    const mo = +m[1], dd = +m[2];
    if (!date(2024, mo, dd)) return { error: `${mo}月${dd}日不存在` };
    return { days: { kind: "rule", test: (d) => d.getMonth() + 1 === mo && d.getDate() === dd, label: `每年${mo}月${dd}日` }, len: m[0].length, relative: false };
  }
  const rel: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 };
  if ((m = s.match(/^(大后天|今天|明天|后天)/))) {
    const d = addDays(today, rel[m[1]]);
    return { days: { kind: "dates", first: d, last: d }, len: m[0].length, relative: true };
  }
  if ((m = s.match(/^(下下|下)?(?:个)?(?:周|星期|礼拜)\s*([日天一二三四五六])/))) {
    const wd = weekdays(m[2])[0];
    let d: Date;
    if (m[1]) {
      // 下周三: that day of next week (weeks from Monday)
      const monday = addDays(today, -((today.getDay() + 6) % 7));
      d = addDays(monday, (m[1] === "下下" ? 14 : 7) + (wd + 6) % 7);
    } else {
      d = addDays(today, (wd - today.getDay() + 7) % 7);  // 周三: the coming one (today if it is one)
    }
    return { days: { kind: "dates", first: d, last: d }, len: m[0].length, relative: true };
  }
  if ((m = s.match(new RegExp(`^${DATE}`)))) {
    const y = m[1] ? +m[1] : undefined;
    let first = date(y ?? today.getFullYear(), +m[2], +m[3]);
    if (!first) return { error: `${+m[2]}月${+m[3]}日不存在` };
    // no year: this year's, or next year's if that is past
    if (y === undefined && first < today) first = date(today.getFullYear() + 1, +m[2], +m[3]) ?? first;
    let last = first, len = m[0].length;
    // a span: 10-14~10-16, 10月14日至16日
    const r = s.slice(len).match(new RegExp(String.raw`^\s*(?:~|至|到)\s*(?:${DATE}|(\d{1,2})\s*[日号])`));
    if (r) {
      const l = r[3] ? date(r[1] ? +r[1] : first.getFullYear(), +r[2], +r[3]) : date(first.getFullYear(), first.getMonth() + 1, +r[4]);
      if (!l) return { error: "结束日期不存在" };
      last = l < first ? date(l.getFullYear() + 1, l.getMonth() + 1, l.getDate()) ?? l : l;
      if ((last.getTime() - first.getTime()) / DAY > 366) return { error: "日期范围超过一年" };
      len += r[0].length;
    }
    return { days: { kind: "dates", first, last }, len, relative: y === undefined };
  }
  return undefined;
}

const TIME = String.raw`(上午|早上|早晨|中午|下午|傍晚|晚上|今晚|夜里)?\s*(\d{1,2})(?:\s*:\s*(\d{2})|\s*点\s*(?:(半)|(\d{1,2})\s*分?)?|\s*时)`;
/** A range's end may also be a bare hour: 9:30-11. */
const TIME_END = String.raw`(上午|早上|早晨|中午|下午|傍晚|晚上|今晚|夜里)?\s*(\d{1,2})(?:\s*:\s*(\d{2})|\s*点\s*(?:(半)|(\d{1,2})\s*分?)?|\s*时)?(?=\s|$)`;

function clock(pre: string | undefined, h: number, mi: number, half: boolean): number | undefined {
  if (half) mi = 30;
  if (pre && /下午|傍晚|晚上|今晚|夜里/.test(pre) && h < 12) h += 12;
  if (pre === "中午" && h < 11) h += 12;
  return h > 24 || mi > 59 ? undefined : Math.min(h * 60 + mi, 24 * 60 - 1);
}

/** One line; `now` resolves 明天, 周五 and dates without a year. */
export function parseLine(raw: string, now: Date): Parsed {
  const s = normalize(raw);
  const d = parseDate(s, now);
  if (!d) return { error: "看不懂开头的日期（例：2026-10-14、10月14日、明天、周五、每周一）" };
  if ("error" in d) return { error: d.error };
  let rest = s.slice(d.len).trim();
  let start: number | undefined, end: number | undefined;
  let m: RegExpMatchArray | null;
  if ((m = rest.match(/^全天\s*/))) rest = rest.slice(m[0].length);
  else if ((m = rest.match(new RegExp(`^${TIME}(?:\\s*(?:-|~|到|至)\\s*${TIME_END})?`)))) {
    start = clock(m[1], +m[2], m[3] ? +m[3] : m[5] ? +m[5] : 0, !!m[4]);
    if (start === undefined) return { error: "时间不对" };
    if (m[7] !== undefined) {
      // a range: the end takes the start's 下午 etc. unless it says otherwise
      end = clock(m[6] ?? m[1], +m[7], m[8] ? +m[8] : m[10] ? +m[10] : 0, !!m[9]);
      if (end === undefined) return { error: "结束时间不对" };
      if (end < start && end + 12 * 60 > start) end += 12 * 60;
      if (end < start) return { error: "结束时间早于开始时间" };
    }
    rest = rest.slice(m[0].length).trim();
  }
  const at = rest.match(/^(.*?)\s*@\s*(.*)$/);
  const title = (at ? at[1] : rest).trim();
  const location = at ? at[2].trim() : "";
  if (!title) return { error: "缺少日程内容" };
  const dateText = s.slice(0, d.len).trim();
  const absolute = d.relative && d.days.kind === "dates"
    ? ymd(d.days.first) + (d.days.last > d.days.first ? `~${ymd(d.days.last)}` : "") : undefined;
  return { event: { days: d.days, start, end, title, location }, dateText, absolute };
}

/** The lines with 明天 / 周五 / dates without a year written out as dates (on save). */
export function canonicalLines(text: string, now: Date): string {
  return text.replace(/\r\n/g, "\n").split("\n").map((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return raw;
    const p = parseLine(line, now);
    if (!p.event || !p.absolute) return raw;
    const s = normalize(line);
    return `${p.absolute} ${s.slice(s.indexOf(p.dateText!) + p.dateText!.length).trim()}`;
  }).join("\n");
}

/** The events between `from` and `to`; unreadable lines are skipped (see checkLines). */
export function parseLocalEvents(text: string, from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const e = parseLine(line, from).event;
    if (!e) continue;
    const at = (d: Date, min: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(min / 60), min % 60);
    const push = (start: Date, end: Date, allDay: boolean) => {
      if ((end <= from && !(end.getTime() === start.getTime() && start >= from)) || start >= to) return;
      out.push({ start, end, allDay, title: e.title, location: e.location, source: "" });
    };
    if (e.days.kind === "dates" && e.start === undefined) {
      push(e.days.first, addDays(e.days.last, 1), true);  // one all-day event, however many days
      continue;
    }
    const first = e.days.kind === "dates" ? e.days.first : midnight(from);
    const last = e.days.kind === "dates" ? e.days.last : addDays(midnight(to), -1);
    for (let d = first; d <= last && d < to; d = addDays(d, 1)) {
      if (e.days.kind === "rule" && !e.days.test(d)) continue;
      if (e.start === undefined) push(d, addDays(d, 1), true);
      else push(at(d, e.start), at(d, e.end ?? e.start), false);
    }
  }
  return out;
}

/** How each line was understood, for the settings page: ok lines and the reason for others. */
export function checkLines(text: string, now: Date, days: number): { ok: boolean; text: string }[] {
  const today = midnight(now);
  const out: { ok: boolean; text: string }[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const p = parseLine(line, now);
    if (!p.event) { out.push({ ok: false, text: `第 ${i + 1} 行「${line}」：${p.error}` }); return; }
    const e = p.event;
    const when = e.start === undefined ? "全天" : e.end !== undefined && e.end !== e.start ? `${hm(e.start)}-${hm(e.end)}` : hm(e.start);
    let day: string;
    if (e.days.kind === "rule") day = e.days.label;
    else {
      const f = e.days.first, l = e.days.last;
      const fmt = (d: Date) => `${d.getFullYear() !== today.getFullYear() ? `${d.getFullYear()}年` : ""}${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}`;
      day = l > f ? `${fmt(f)} ~ ${fmt(l)}` : fmt(f);
      const n = Math.round((f.getTime() - today.getTime()) / DAY);
      const nl = Math.round((l.getTime() - today.getTime()) / DAY);
      day += nl < 0 ? "（已过去）" : n <= 0 ? "（今天）" : n === 1 ? "（明天）" : n > days ? `（${n} 天后，到时出现）` : `（${n} 天后）`;
    }
    out.push({ ok: true, text: `${day} · ${when} · ${e.title}${e.location ? ` @${e.location}` : ""}` });
  });
  return out;
}

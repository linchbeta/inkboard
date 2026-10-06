// 课程表 (InkSight's timetable, no. 9), primary school to university: the week as a grid,
// or one day as a list. The day shown is today while there are lessons left, else the next
// school day (after weekends, official holidays, dates marked off). The lesson going on
// now, or the next one, is in red.
//  - Schools: one line per weekday with the courses in period order ("周一 语文 数学 …");
//    the same course in neighbouring periods (no long break between) is one block.
//  - Universities: one line per course with its periods, room and weeks
//    ("周一 1-2 高等数学 @教A101 1-16周", "单周" / "双周"); with the term's start date the
//    header shows the week number and each week shows only its courses.
//  - The timetable of periods (times, 早读 / 晚自习 labels, long breaks) comes from a preset
//    per stage unless written out.
import { cjkDisplay } from "../render/typography.js";
import { refFonts, width, print, centeredAt, type RefFont } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import { WEEKDAY, holidayOf } from "../data/calendar.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, ellipsize, emptyNote, wrapText } from "./common.js";

/** Typical timetables of periods per stage (blank line: a long break). */
export const PRESETS: Record<string, string> = {
  primary: "08:00-08:40\n08:50-09:30\n10:00-10:40\n10:50-11:30\n\n14:00-14:40\n14:50-15:30\n15:40-16:20",
  junior: "08:00-08:45\n08:55-09:40\n10:00-10:45\n10:55-11:40\n\n14:00-14:45\n14:55-15:40\n15:50-16:35\n16:45-17:30",
  senior: "07:20-07:50 早读\n08:00-08:45\n08:55-09:40\n10:00-10:45\n10:55-11:40\n11:50-12:35\n\n14:10-14:55\n15:05-15:50\n16:00-16:45\n16:55-17:40\n\n19:00-19:50 晚自习\n20:00-20:50 晚自习",
  university: "08:00-08:45\n08:55-09:40\n10:00-10:45\n10:55-11:40\n\n14:00-14:45\n14:55-15:40\n16:00-16:45\n16:55-17:40\n\n19:00-19:45\n19:55-20:40\n20:50-21:35",
};

const CONFIG: ConfigField[] = [
  {
    key: "stage", label: "学段", type: "select", default: "primary",
    options: [["primary", "小学"], ["junior", "初中"], ["senior", "高中"], ["university", "大学"]],
    help: "决定默认的作息时间（下面的作息时间留空时使用）。",
  },
  {
    key: "courses", label: "课程", type: "textarea",
    default: "周一 语文 数学 英语 体育 科学 音乐 班会\n周二 数学 语文 美术 英语 道法 体育 书法\n周三 语文 英语 数学 音乐 科学 劳动 阅读\n周四 数学 语文 体育 英语 美术 道法 信息\n周五 英语 语文 数学 科学 体育 音乐 社团",
    placeholder: "周一 1-2 高等数学 @教A101 1-16周\n周一 3-4 大学英语 @外语楼203 单周\n周三 5-6 线性代数 @教B205",
    help: "中小学：每天一行，\"周几 + 各节课\"（空格隔开，\"-\" 表示这节没课；有早读、晚自习的按作息顺序一起写）。"
      + "大学：每门课一行，\"周几 第几节 课程 @教室 周次\"，如 \"周一 1-2 高等数学 @教A101 1-16周\"，周次可写 1-8,10-16周、单周、双周，可省略。"
      + "调休、停课单独一行：2026-10-10 按周五、2026-10-12 休。法定假日自动跳过。",
  },
  {
    key: "periods", label: "作息时间（可空）", type: "textarea", default: "",
    placeholder: "08:00-08:45\n08:55-09:40\n\n14:00-14:45\n19:00-19:50 晚自习",
    help: "每节一行，可在时间后写名称（早读、晚自习）；空一行表示中间是午休等长休息。留空按学段的常见作息。",
  },
  {
    key: "start", label: "开学日期（可空）", type: "text", default: "", placeholder: "2026-09-07",
    help: "第 1 周的任意一天。填了会显示\"第几周\"，并按课程的周次、单双周显示。",
  },
  {
    key: "view", label: "显示方式", type: "select", default: "week",
    options: [["week", "整周课表"], ["day", "只显示一天（大字）"]],
  },
];

export interface Period { start: number; end: number; breakBefore: boolean; label: string } // minutes after midnight
export interface Lesson {
  day: number;       // 0 = Sunday
  row: number;       // first period (index into the periods)
  span: number;      // periods it takes
  name: string;
  place: string;
  /** Weeks of the term it is held in (none: every week). */
  weeks?: { ranges: [number, number][]; parity?: 0 | 1 };
}
export interface Timetable {
  periods: Period[];
  lessons: Lesson[];
  /** "YYYY-MM-DD" -> the weekday whose lessons that day has, or "off". */
  overrides: Map<string, number | "off">;
  /** Monday of the term's first week. */
  termStart?: Date;
}

const DAY_CHARS = "日一二三四五六";
const dayIndex = (ch: string) => (ch === "天" ? 0 : DAY_CHARS.indexOf(ch));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

export function parsePeriods(text: string): Period[] {
  const out: Period[] = [];
  let gap = false;
  for (const raw of text.split("\n")) {
    const t = raw.trim().match(/^(\d{1,2})[:：](\d{2})\s*[-~～–—至到]\s*(\d{1,2})[:：](\d{2})\s*(.*)$/);
    if (!t) { if (out.length) gap = true; continue; }
    out.push({ start: +t[1] * 60 + +t[2], end: +t[3] * 60 + +t[4], breakBefore: gap, label: t[5].trim().slice(0, 4) });
    gap = false;
  }
  return out;
}

/** "1-16周", "1-8,10-16周", "3周", "单周", "双周", "1-16周(单)" -> week rule, or undefined if not one. */
function parseWeeks(tok: string): Lesson["weeks"] | undefined {
  const parity = /单/.test(tok) ? 1 : /双/.test(tok) ? 0 : undefined;
  const nums = tok.replace(/[（(]?[单双][)）]?/g, "").replace(/周$/, "");
  if (!/周/.test(tok) && parity === undefined) return undefined;
  const ranges: [number, number][] = [];
  if (nums) {
    for (const part of nums.split(/[,，、]/)) {
      const m = part.match(/^(\d+)(?:\s*[-~～到]\s*(\d+))?$/);
      if (!m) return undefined;
      ranges.push([+m[1], +(m[2] ?? m[1])]);
    }
  }
  return { ranges, parity };
}

export function parseTimetable(courses: string, periodsText: string, start = ""): Timetable {
  const periods = parsePeriods(periodsText);
  const lessons: Lesson[] = [];
  const overrides = new Map<string, number | "off">();
  // numbered periods ("第3节") skip labelled ones (早读, 晚自习)
  const numbered = periods.map((p, i) => ({ p, i })).filter(({ p }) => !p.label).map(({ i }) => i);
  const rowOf = (n: number) => (numbered.length ? numbered[n - 1] ?? periods.length + (n - numbered.length) - 1 : n - 1);
  for (const raw of courses.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const date = line.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(.*)$/);
    if (date) {
      const key = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
      const as = date[4].match(/(?:周|星期|礼拜)([一二三四五六日天])/);
      if (as) overrides.set(key, dayIndex(as[1]));
      else if (/休|放假|停课|不上/.test(date[4])) overrides.set(key, "off");
      continue;
    }
    const m = line.match(/^(?:周|星期|礼拜)([一二三四五六日天])[\s:：]*(.*)$/);
    if (!m) continue;
    const day = dayIndex(m[1]), rest = m[2];
    // one course with its periods: "1-2 高等数学 @教A101 1-16周"
    const one = rest.match(/^第?\s*(\d+)(?:\s*[-~～到,，]\s*(\d+))?\s*节?\s+(.+)$/);
    if (one) {
      const from = +one[1], to = Math.max(from, +(one[2] ?? one[1]));
      let name = "", place = "", weeks: Lesson["weeks"], atPlace = false;
      for (const tok of one[3].split(/\s+/)) {
        const w = parseWeeks(tok);
        if (w) weeks = w;
        else if (tok.startsWith("@") || tok.startsWith("＠")) { place = tok.slice(1); atPlace = true; }
        else if (atPlace) place += ` ${tok}`;
        else name = name ? `${name} ${tok}` : tok;
      }
      if (name) lessons.push({ day, row: rowOf(from), span: rowOf(to) - rowOf(from) + 1, name, place, weeks });
      continue;
    }
    // a day's courses in period order; the same course in neighbouring periods is one block
    const names = rest.split(/[\s,，、;；|]+/).filter(Boolean).map((c) => (/^[-—–无空]$/.test(c) ? "" : c));
    names.forEach((name, row) => {
      if (!name) return;
      const prev = lessons[lessons.length - 1];
      if (prev && prev.day === day && prev.name === name && prev.row + prev.span === row && !periods[row]?.breakBefore) prev.span++;
      else lessons.push({ day, row, span: 1, name, place: "" });
    });
  }
  const s = start.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  const termStart = s ? mondayOf(new Date(+s[1], +s[2] - 1, +s[3])) : undefined;
  return { periods, lessons, overrides, termStart };
}

/** The term week of `d` (1 = the first), or undefined without a start date. */
export function weekOf(tt: Timetable, d: Date): number | undefined {
  if (!tt.termStart) return undefined;
  return Math.floor(Math.round((mondayOf(d).getTime() - tt.termStart.getTime()) / 86_400_000) / 7) + 1;
}

function heldIn(l: Lesson, week: number | undefined): boolean {
  if (!l.weeks || week === undefined) return true;
  if (l.weeks.parity !== undefined && week % 2 !== l.weeks.parity) return false;
  return !l.weeks.ranges.length || l.weeks.ranges.some(([a, b]) => week >= a && week <= b);
}

/** The lessons on `d` in order, or undefined when there is no school that day. */
export function lessonsOn(tt: Timetable, d: Date): Lesson[] | undefined {
  const ov = tt.overrides.get(ymd(d));
  if (ov === "off") return undefined;
  if (ov === undefined && holidayOf(d.getFullYear(), d.getMonth() + 1, d.getDate()) === "off") return undefined;
  const day = ov ?? d.getDay(), week = weekOf(tt, d);
  if (week !== undefined && week < 1) return undefined;  // before the term
  const list = tt.lessons.filter((l) => l.day === day && heldIn(l, week)).sort((a, b) => a.row - b.row);
  return list.length ? list : undefined;
}

export interface SchoolDay {
  day: Date;
  /** Days from today (0 = today). */
  offset: number;
  lessons: Lesson[];
  /** The lesson going on now, or the next one today (when offset is 0). */
  current?: Lesson;
  next?: Lesson;
  week?: number;
}

const startOf = (tt: Timetable, l: Lesson) => tt.periods[l.row]?.start;
const endOf = (tt: Timetable, l: Lesson) => tt.periods[l.row + l.span - 1]?.end;

/** Today while lessons are left, else the next school day within two weeks. */
export function schoolDay(tt: Timetable, now: Date): SchoolDay | undefined {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let k = 0; k < 15; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
    const lessons = lessonsOn(tt, day);
    if (!lessons) continue;
    const base = { day, offset: k, lessons, week: weekOf(tt, day) };
    const timed = lessons.filter((l) => startOf(tt, l) !== undefined && endOf(tt, l) !== undefined);
    if (k > 0 || !timed.length) return base;
    if (nowMin >= Math.max(...timed.map((l) => endOf(tt, l)!))) continue; // school is over today
    const cur = timed.find((l) => startOf(tt, l)! <= nowMin && nowMin < endOf(tt, l)!);
    if (cur) return { ...base, current: cur };
    return { ...base, next: timed.filter((l) => startOf(tt, l)! > nowMin).sort((a, b) => startOf(tt, a)! - startOf(tt, b)!)[0] };
  }
  return undefined;
}

function dayName(sd: SchoolDay): string {
  const d = sd.day, wd = `周${WEEKDAY[d.getDay()]}`;
  const w = sd.week !== undefined ? `  第${sd.week}周` : "";
  if (sd.offset === 0) return `今天 ${wd}${w}`;
  if (sd.offset === 1) return `明天 ${wd}${w}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${wd}${w}`;
}

/** The label of period row r: its name (早读), "第N节" counting numbered periods, or the time. */
function periodLabel(tt: Timetable, r: number): string {
  const p = tt.periods[r];
  if (p?.label) return p.label;
  const n = tt.periods.slice(0, r + 1).filter((x) => !x.label).length;
  return `第${p ? n : r + 1}节`;
}

/** The largest of `fonts` whose glyphs fit `h` px and every string fits `w` px (the last one otherwise). */
function fitFont(fonts: RefFont[], strings: string[], w: number, h: number): RefFont {
  return fonts.find((f) => f.ascent - f.descent <= h && strings.every((s) => width(f, s) <= w)) ?? fonts[fonts.length - 1];
}

export function renderTimetable(panel: Panel, ctx: ScreenContext) {
  const data = (ctx.data as { tt: Timetable; view: string } | undefined)
    ?? { tt: parseTimetable(CONFIG[1].default!, PRESETS.primary), view: "week" };
  const { tt } = data;
  const sd = schoolDay(tt, ctx.now);
  const f = screenWithHeader(panel, ctx, "课程表", sd ? dayName(sd) : "");
  if (!tt.lessons.length) { emptyNote(f, "在后台这块屏的\"内容\"里填写课程"); return f.c; }
  if (!sd) { emptyNote(f, "接下来两周没有课"); return f.c; }
  return data.view === "day" ? drawDay(f, tt, sd) : drawWeek(f, tt, sd);
}

/** The week of the school day: one column per weekday with lessons, a block per lesson. */
function drawWeek(f: ReturnType<typeof screenWithHeader>, tt: Timetable, sd: SchoolDay) {
  const { wqy12, wqy9 } = refFonts();
  const { c, W, H, large, m } = f;
  const cols = [1, 2, 3, 4, 5, 6, 0].filter((wd) => (wd >= 1 && wd <= 5) || tt.lessons.some((l) => l.day === wd));
  const monday = mondayOf(sd.day);
  const dates = cols.map((wd) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + (wd + 6) % 7));
  const lists = dates.map((d) => lessonsOn(tt, d));
  const rows = Math.max(tt.periods.length, ...tt.lessons.map((l) => l.row + l.span));
  const many = rows > 9;

  const labelW = Math.max(0, ...tt.periods.map((p) => width(wqy9, p.label)));
  const timeW = Math.max(large ? (many ? 84 : 96) : (many ? 38 : 44), labelW + (large ? 14 : 8));
  const headH = large ? (many ? 40 : 46) : (many ? 24 : 30);
  const top = f.top + (large ? 10 : 4), bottom = H - (large ? 12 : 4);
  const rowH = Math.min(large ? 64 : 40, Math.floor((bottom - top - headH) / rows));
  const x0 = m + timeW, colW = Math.floor((W - m - x0) / cols.length);
  const gridTop = top + headH;
  // sizes up to what a one-period block holds, so longer blocks do not get bigger type
  const oneRow = rowH - (large ? 8 : 4);
  const all = large ? [...cjkDisplay(true, 32), wqy12, wqy9] : [wqy12, wqy9];
  const fonts = all.filter((rf) => rf.ascent - rf.descent <= oneRow).concat(all.slice(-1));
  const col = cols.indexOf(sd.day.getDay());

  // header: weekday (and date when there is room); the school day's in a red tag
  cols.forEach((wd, i) => {
    const cx = x0 + i * colW + colW / 2;
    const name = `周${WEEKDAY[wd]}`;
    const sub = `${dates[i].getMonth() + 1}/${dates[i].getDate()}`;
    const ink = i === col ? Ink.White : Ink.Black;
    if (i === col) c.rect(x0 + i * colW + 2, top, x0 + (i + 1) * colW - 2, gridTop - 4, Ink.Red);
    if (large) {
      const nameY = top + 4 + wqy12.ascent;
      print(c, wqy12, name, Math.round(cx - width(wqy12, name) / 2), nameY, ink);
      print(c, wqy9, sub, Math.round(cx - width(wqy9, sub) / 2), nameY + (many ? 4 : 6) + wqy9.ascent, ink);
    } else {
      const p = centeredAt(wqy12, name, cx, top + (headH - 4) / 2);
      print(c, wqy12, name, p.x, p.baseline, ink);
    }
  });
  c.rect(m, gridTop - 1, W - m, gridTop, Ink.Black);

  // rows: period labels and times, separators (solid before a long break)
  for (let r = 0; r < rows; r++) {
    const y = gridTop + r * rowH, mid = y + rowH / 2;
    const p = tt.periods[r];
    if (r > 0) {
      if (p?.breakBefore) c.rect(m, y, W - m, y + 1, Ink.Black);
      else c.dottedH(m, W - m, y, Ink.Black, 1, 3);
    }
    if (large && p && rowH >= 34) {
      print(c, wqy12, periodLabel(tt, r), m, Math.round(mid - 2), Ink.Black);
      print(c, wqy9, `${hm(p.start)}-${hm(p.end)}`, m, Math.round(mid + 4 + wqy9.ascent), Ink.Black);
    } else {
      const s = p ? (large ? `${periodLabel(tt, r)} ${hm(p.start)}` : p.label || hm(p.start)) : periodLabel(tt, r);
      print(c, wqy9, s, m, centeredAt(wqy9, s, 0, mid).baseline, Ink.Black);
    }
  }
  c.dottedV(x0 - (large ? 8 : 3), gridTop + 2, gridTop + rows * rowH - 2, Ink.Black, 1, 3);

  // lessons: a block over their periods (covering the dotted lines inside it)
  const placeF = wqy9;
  lists.forEach((list, i) => {
    for (const l of list ?? []) {
      const bx0 = x0 + i * colW + 2, bx1 = x0 + (i + 1) * colW - 2;
      const by0 = gridTop + l.row * rowH + 2, by1 = gridTop + (l.row + l.span) * rowH - 1;
      const lit = i === col && (sd.current === l || sd.next === l);
      c.rect(bx0, by0, bx1, by1, lit ? Ink.Red : Ink.White);
      if (!lit) c.rect(bx0, by0 + 1, bx0 + (large ? 3 : 2), by1 - 1, Ink.Black);  // a bar marks the block
      const ink = lit ? Ink.White : Ink.Black;
      // the largest size at which the name (wrapped) and, if there is room, the place fit
      const bw = bx1 - bx0 - (large ? 10 : 6), bh = by1 - by0 - (large ? 6 : 2);
      const placeH = placeF.ascent - placeF.descent + 4;
      const lhOf = (rf: RefFont) => Math.round((rf.ascent - rf.descent) * 1.2);
      const h = (rf: RefFont) => rf.ascent - rf.descent;
      const fits = (rf: RefFont, withPlace: boolean, oneLine: boolean) => {
        const n = oneLine ? (width(rf, l.name) <= bw ? 1 : 99) : wrapText(rf, l.name, bw).length;
        return (n - 1) * lhOf(rf) + h(rf) + (withPlace ? placeH : 0) <= bh;
      };
      // one line if any size allows, the place too if it fits; else wrapped
      const font = fonts.find((rf) => fits(rf, !!l.place, true)) ?? fonts.find((rf) => fits(rf, false, true))
        ?? fonts.find((rf) => fits(rf, false, false)) ?? fonts[fonts.length - 1];
      const lh = lhOf(font);
      const showPlace = !!l.place && fits(font, true, false);
      const maxLines = Math.max(1, Math.floor((bh - (showPlace ? placeH : 0) - h(font)) / lh) + 1);
      const lines = wrapText(font, l.name, bw, maxLines);
      const blockH = (lines.length - 1) * lh + h(font) + (showPlace ? placeH : 0);
      const cx = (bx0 + bx1) / 2 + (lit ? 0 : 1);
      let y = Math.round((by0 + by1) / 2 - blockH / 2 + h(font) / 2);
      for (const s of lines) {
        const q = centeredAt(font, s, cx, y);
        print(c, font, s, q.x, q.baseline, ink);
        y += lh;
      }
      if (showPlace) {
        const s = ellipsize(placeF, l.place, bw);
        const q = centeredAt(placeF, s, cx, y - lh + h(font) / 2 + 4 + placeH / 2);
        print(c, placeF, s, q.x, q.baseline, ink);
      }
    }
  });
  // a day off inside the week (holiday): "休" over its column
  lists.forEach((list, i) => {
    if (list || !tt.lessons.some((l) => l.day === cols[i])) return;
    const q = centeredAt(wqy12, "休", x0 + i * colW + colW / 2, gridTop + (rows * rowH) / 2);
    print(c, wqy12, "休", q.x, q.baseline, Ink.Red);
  });
  return c;
}

/** One day as a list of lessons: time on the left, the course large, its room; "现在" / "下一节". */
function drawDay(f: ReturnType<typeof screenWithHeader>, tt: Timetable, sd: SchoolDay) {
  const { wqy12, wqy9 } = refFonts();
  const { c, W, H, large, m } = f;
  const ls = sd.lessons;
  // a long break between two lessons: a solid line and some room
  const breakBefore = ls.map((l, i) => i > 0 && tt.periods.slice(ls[i - 1].row + ls[i - 1].span, l.row + 1).some((p) => p.breakBefore));
  const breaks = breakBefore.filter(Boolean).length;
  const gapH = large ? 14 : 6;
  const top = f.top + (large ? 12 : 4), bottom = H - (large ? 12 : 4);
  const rowH = Math.min(large ? 88 : 56, Math.floor((bottom - top - breaks * gapH) / ls.length));
  const tf = large ? wqy12 : wqy9;
  const timeW = width(tf, "00:00-00:00") + (large ? 24 : 12);
  const tagF = large ? wqy12 : wqy9;
  const tag = (s: string) => width(tagF, s) + (large ? 20 : 10);
  const textW = W - 2 * m - timeW - tag("下一节") - 16;
  const font = fitFont([...cjkDisplay(large, 40), wqy12], ls.map((l) => l.name), textW, rowH - (large ? 16 : 10));
  let y = top;
  ls.forEach((l, i) => {
    if (breakBefore[i]) { c.rect(m, y + gapH / 2, W - m, y + gapH / 2 + 1, Ink.Black); y += gapH; }
    else if (i > 0) c.dottedH(m, W - m, y, Ink.Black, 1, 3);
    const mid = y + rowH / 2;
    const lit = sd.current === l ? "现在" : sd.next === l ? "下一节" : "";
    const s = startOf(tt, l), e = endOf(tt, l);
    const ts = s !== undefined && e !== undefined ? `${hm(s)}-${hm(e)}` : periodLabel(tt, l.row);
    // time; on the 3.98" the periods under it ("第1-2节")
    const sub = l.span > 1 ? `${periodLabel(tt, l.row)}-${periodLabel(tt, l.row + l.span - 1).replace(/^第/, "")}` : periodLabel(tt, l.row);
    if (large && rowH >= 50) {
      print(c, tf, ts, m, Math.round(mid - 3), lit ? Ink.Red : Ink.Black);
      print(c, wqy9, sub, m, Math.round(mid + 5 + wqy9.ascent), Ink.Black);
    } else {
      print(c, tf, ts, m, centeredAt(tf, ts, 0, mid).baseline, lit ? Ink.Red : Ink.Black);
    }
    // course, then its room in small type
    const name = ellipsize(font, l.name, textW);
    const nx = print(c, font, name, m + timeW, centeredAt(font, name, 0, mid).baseline, lit ? Ink.Red : Ink.Black);
    if (l.place && nx + 16 < m + timeW + textW) {
      const p = ellipsize(tf, l.place, m + timeW + textW - nx - 12);
      print(c, tf, p, nx + 12, centeredAt(font, name, 0, mid).baseline, Ink.Black);
    }
    if (lit) {
      const tw = tag(lit), th = large ? 28 : 16;
      const tx = W - m - tw, ty = Math.round(mid - th / 2);
      c.rect(tx, ty, tx + tw, ty + th, Ink.Red);
      const lq = centeredAt(tagF, lit, tx + tw / 2, ty + th / 2);
      print(c, tagF, lit, lq.x, lq.baseline, Ink.White);
    }
    y += rowH;
  });
  return c;
}

export const timetableMode: Screen = {
  name: "课程表",
  description: "小学到大学的课程表：整周或当天，正在上和下一节课用红色标出；大学可按周次、单双周排课；周末、放假时显示下一个上学日。",
  config: CONFIG,
  render: renderTimetable,
  prepare: async (db) => {
    const cfg = getModeConfig(db, "timetable", CONFIG);
    const periods = cfg.periods.trim() ? cfg.periods : PRESETS[cfg.stage] ?? PRESETS.primary;
    return { data: { tt: parseTimetable(cfg.courses, periods, cfg.start), view: cfg.view } };
  },
};


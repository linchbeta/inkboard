// Calendar data: lunar dates (lunar-javascript), festivals and labels as in the EPD-nRF5
// reference (GUI/GUI.c, GUI/Lunar.c), day stem/branch, ISO week, official holidays.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import lunarPkg from "lunar-javascript";

const { Solar } = lunarPkg;

export const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
export const LUNAR_MONTH = ["", "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
export const LUNAR_DATE = ["", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
export const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
export const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

export interface LunarDay {
  month: number;   // 1..12
  day: number;     // 1..30
  leap: boolean;
  /** Year stem+branch (changes at the Spring Festival), e.g. "丙午". */
  yearGanZhi: string;
  zodiac: string;
  /** Solar term starting on this day, or "". */
  jieqi: string;
}

export function lunarOf(year: number, month: number, day: number): LunarDay {
  const l = Solar.fromYmd(year, month, day).getLunar();
  const m = l.getMonth();
  return {
    month: Math.abs(m),
    day: l.getDay(),
    leap: m < 0,
    yearGanZhi: l.getYearInGanZhi(),
    zodiac: l.getYearShengXiao(),
    jieqi: l.getJieQi(),
  };
}

/** Next solar term after the given day and how many days away it is (1.. ). */
export function nextSolarTerm(year: number, month: number, day: number): { name: string; days: number } {
  const n = Solar.fromYmd(year, month, day).getLunar().getNextJieQi(true);
  const s = n.getSolar();
  const days = Math.round((Date.UTC(s.getYear(), s.getMonth() - 1, s.getDay()) - Date.UTC(year, month - 1, day)) / 86400000);
  return { name: n.getName(), days };
}

/** Day stem/branch index 0..59 (reference GetRiGanZhi: Julian day number based). */
export function dayGanZhiIndex(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100)
    + Math.floor(y / 400) - 32045;
  return (jd - 11 + 60000000) % 60;
}

export function dayGanZhi(year: number, month: number, day: number): [string, string] {
  const i = dayGanZhiIndex(year, month, day);
  return [GAN[i % 10], ZHI[i % 12]];
}

/** ISO-8601 week number (what the reference prints with strftime %V). */
export function isoWeek(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 0 = Sunday. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

const SOLAR_FESTIVALS: [number, number, string][] = [
  [1, 1, "元旦节"], [2, 14, "情人节"], [3, 8, "妇女节"], [3, 12, "植树节"], [4, 1, "愚人节"],
  [5, 1, "劳动节"], [5, 4, "青年节"], [6, 1, "儿童节"], [7, 1, "建党节"], [8, 1, "建军节"],
  [9, 10, "教师节"], [10, 1, "国庆节"], [11, 1, "万圣节"], [12, 24, "平安夜"], [12, 25, "圣诞节"],
];
const LUNAR_FESTIVALS: [number, number, string][] = [
  [1, 1, "春节"], [1, 15, "元宵节"], [2, 2, "龙抬头"], [5, 5, "端午节"], [7, 7, "七夕节"], [7, 15, "中元节"],
  [8, 15, "中秋节"], [9, 9, "重阳节"], [10, 1, "寒衣节"], [12, 8, "腊八节"], [12, 30, "除夕"],
];

/** Festival label for the day, same precedence as the reference's GetFestival(). */
export function festivalOf(year: number, month: number, day: number, lunar: LunarDay): string | undefined {
  if (!lunar.leap) {
    const f = LUNAR_FESTIVALS.find(([m, d]) => m === lunar.month && d === lunar.day);
    if (f) return f[2];
    // 除夕 in a year whose 12th month has 29 days: the day before the Spring Festival.
    if (lunar.month === 12 && lunar.day === 29) {
      const next = new Date(year, month - 1, day + 1);
      const nl = lunarOf(next.getFullYear(), next.getMonth() + 1, next.getDate());
      if (nl.month === 1 && nl.day === 1 && !nl.leap) return "除夕";
    }
  }
  const wd = weekdayOf(year, month, day);
  if (month === 5 && wd === 0 && day >= 8 && day <= 14) return "母亲节";
  if (month === 6 && wd === 0 && day >= 15 && day <= 21) return "父亲节";
  if (month === 11 && wd === 4 && day >= 22 && day <= 28) return "感恩节";
  const s = SOLAR_FESTIVALS.find(([m, d]) => m === month && d === day);
  if (s) return s[2];
  if (lunar.jieqi === "清明") return "清明节";
  return undefined;
}

// ── Official holidays (holiday-cn data, github.com/NateScarlet/holiday-cn) ──
// Key "YYYY-MM-DD" -> off: true = day off (休), false = make-up work day (班); src: the
// year file it came from. A year's file can include the December before it (2019.json
// has 2018-12-29..31), so dates are replaced per file, not per calendar year.
type HolidayEntry = { off: boolean; name: string; src: number };
let holidays: Map<string, HolidayEntry> | undefined;
/** Years whose official schedule is published (holiday-cn has an empty file until then). */
const holidayYears = new Set<number>();
type HolidayFile = { year?: number; days: { name: string; date: string; isOffDay: boolean }[] };

function addHolidayYear(data: HolidayFile, year: number): void {
  if (!holidays || !data.days?.length) return;
  for (const [k, v] of holidays) if (v.src === year) holidays.delete(k);
  for (const d of data.days) holidays.set(d.date, { off: d.isOffDay, name: d.name, src: year });
  holidayYears.add(year);
}

function holidayTable(): Map<string, HolidayEntry> {
  if (!holidays) {
    holidays = new Map();
    const dir = fileURLToPath(new URL("../../assets/holidays/", import.meta.url));
    for (const f of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort()) {
      addHolidayYear(JSON.parse(readFileSync(dir + f, "utf8")) as HolidayFile, Number(f.slice(0, 4)));
    }
    for (const [y, data] of fetched) addHolidayYear(data, y);
  }
  return holidays;
}

// Newer schedules fetched at run time (the State Council publishes next year's every
// autumn); they replace the bundled files once they have days.
const fetched = new Map<number, HolidayFile>();

/** Years whose official holiday schedule is loaded. */
export function loadedHolidayYears(): number[] {
  holidayTable();
  return [...holidayYears];
}

/** Adds a year's schedule (holiday-cn format); returns true if it had days. */
export function useHolidayData(year: number, data: HolidayFile): boolean {
  if (!data?.days?.length) return false;
  fetched.set(year, data);
  addHolidayYear(data, year);
  return true;
}

/** Downloads this year's and next year's schedule from holiday-cn (via jsDelivr). */
export async function fetchHolidayData(year: number): Promise<HolidayFile | undefined> {
  const r = await fetch(`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return undefined;
  const data = await r.json() as HolidayFile;
  return Array.isArray(data.days) ? data : undefined;
}

const ymd = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

export function holidayOf(year: number, month: number, day: number): "off" | "work" | undefined {
  const v = holidayTable().get(ymd(new Date(year, month - 1, day)));
  return v === undefined ? undefined : v.off ? "off" : "work";
}

/** If the day is inside an official holiday block: its name, which day it is and the block length. */
export function holidayPeriod(year: number, month: number, day: number): { name: string; nth: number; total: number } | undefined {
  const t = holidayTable();
  const at = (k: number) => t.get(ymd(new Date(year, month - 1, day + k)));
  const today = at(0);
  if (!today?.off) return undefined;
  let a = 0, b = 0;
  while (at(a - 1)?.off && at(a - 1)?.name === today.name) a--;
  while (at(b + 1)?.off && at(b + 1)?.name === today.name) b++;
  return { name: today.name, nth: 1 - a, total: b - a + 1 };
}

/** Statutory holidays by date, for years whose official schedule is not out yet. */
function statutoryHoliday(dt: Date): string | undefined {
  const m = dt.getMonth() + 1, d = dt.getDate();
  if (m === 1 && d === 1) return "元旦";
  if (m === 5 && d === 1) return "劳动节";
  if (m === 10 && d === 1) return "国庆节";
  const l = Solar.fromYmd(dt.getFullYear(), m, d).getLunar();
  if (l.getJieQi() === "清明") return "清明节";
  if (l.getMonth() === 1 && l.getDay() === 1) return "春节";
  if (l.getMonth() === 5 && l.getDay() === 5) return "端午节";
  if (l.getMonth() === 8 && l.getDay() === 15) return "中秋节";
  return undefined;
}

/**
 * The next official holiday block starting after the given day. Uses the published
 * schedule where available, else the statutory holiday dates.
 */
export function nextHoliday(year: number, month: number, day: number): { name: string; days: number; date: string } | undefined {
  const t = holidayTable();
  for (let k = 1; k <= 400; k++) {
    const dt = new Date(year, month - 1, day + k);
    if (!holidayYears.has(dt.getFullYear())) {
      const name = statutoryHoliday(dt);
      if (name) return { name, days: k, date: ymd(dt) };
      continue;
    }
    const v = t.get(ymd(dt));
    if (!v?.off) continue;
    const prev = t.get(ymd(new Date(year, month - 1, day + k - 1)));
    if (prev?.off && prev.name === v.name) continue; // middle of a block that started earlier
    return { name: v.name, days: k, date: ymd(dt) };
  }
  return undefined;
}

/** Fortune-almanac (黄历) suggestions for the day: 宜 / 忌 lists. */
export function almanacOf(year: number, month: number, day: number): { yi: string[]; ji: string[]; monthGanZhi: string; dayGanZhi: string } {
  const l = Solar.fromYmd(year, month, day).getLunar();
  return { yi: l.getDayYi(), ji: l.getDayJi(), monthGanZhi: l.getMonthInGanZhi(), dayGanZhi: l.getDayInGanZhi() };
}

// Single-cell Li-ion/LiPo resting voltage (mV) -> charge %, linearly interpolated.
// (The reference's batt_cal is for 3 V coin cells, where 3.0 V already means full.)
const LIION_CURVE: [number, number][] = [
  [3300, 0], [3610, 5], [3690, 10], [3730, 20], [3770, 30], [3800, 40],
  [3840, 50], [3870, 60], [3950, 70], [4020, 80], [4110, 90], [4200, 100],
];

/** Battery percentage from millivolts (single Li-ion cell). */
export function batteryLevel(mv: number): number {
  if (mv <= LIION_CURVE[0][0]) return 0;
  for (let i = 1; i < LIION_CURVE.length; i++) {
    const [v1, p1] = LIION_CURVE[i];
    if (mv <= v1) {
      const [v0, p0] = LIION_CURVE[i - 1];
      return Math.round(p0 + ((mv - v0) * (p1 - p0)) / (v1 - v0));
    }
  }
  return 100;
}

// Countdown events ("倒数日"), one per line:
//   2027-06-07 高考            one date; once it has passed it counts up ("已经 N 天")
//   每年 05-20 妈妈生日         every year on that date
//   农历 08-15 中秋            every year on that lunar date
//   每月 15 还信用卡            every month on that day
//   下个假期                    the next official holiday (follows the published schedules)
// A leading "*" pins the event as the featured one; "#" starts a comment.
import lunarPkg from "lunar-javascript";
import { nextHoliday } from "./calendar.js";

const { Lunar } = lunarPkg;
const DAY = 86_400_000;

export interface CountdownEvent { name: string; date: Date; days: number; kind: "once" | "yearly" | "lunar" | "monthly" | "holiday"; pinned: boolean; past: boolean }

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const diffDays = (a: Date, b: Date) => Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY);

function lunarToSolar(y: number, m: number, d: number): Date | undefined {
  for (let dd = d; dd >= Math.min(d, 28); dd--) { // 30th in a 29-day month: use the month's last day
    try {
      const s = Lunar.fromYmd(y, m, dd).getSolar();
      return new Date(s.getYear(), s.getMonth() - 1, s.getDay());
    } catch { /* try the day before */ }
  }
  return undefined;
}

export function parseCountdowns(text: string, now: Date): { events: CountdownEvent[]; errors: string[] } {
  const today = midnight(now);
  const events: CountdownEvent[] = [];
  const errors: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const pinned = line.startsWith("*");
    if (pinned) line = line.slice(1).trim();
    let m: RegExpMatchArray | null;
    let date: Date | undefined, kind: CountdownEvent["kind"], name: string;
    if (/^下一?个假期$/.test(line)) {
      const h = nextHoliday(today.getFullYear(), today.getMonth() + 1, today.getDate());
      if (!h) continue;
      const [hy, hm, hd] = h.date.split("-").map(Number);
      kind = "holiday"; name = h.name; date = new Date(hy, hm - 1, hd);
    } else if ((m = line.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(.+)$/))) {
      kind = "once"; name = m[4];
      date = new Date(+m[1], +m[2] - 1, +m[3]);
      if (date.getMonth() !== +m[2] - 1) date = undefined;
    } else if ((m = line.match(/^每年\s*(\d{1,2})[-/.](\d{1,2})\s+(.+)$/))) {
      kind = "yearly"; name = m[3];
      const mo = +m[1] - 1, d = +m[2];
      for (let y = today.getFullYear(); !date || date < today; y++) {
        date = new Date(y, mo, d);
        if (date.getMonth() !== mo) date = new Date(y, mo + 1, 0); // 02-29 in other years: 02-28
        if (y > today.getFullYear() + 1) break;
      }
    } else if ((m = line.match(/^农历\s*(闰)?(\d{1,2})[-/.](\d{1,2})\s+(.+)$/))) {
      kind = "lunar"; name = m[4];
      const lm = +m[2], ld = +m[3];
      const ly = lunarPkg.Solar.fromYmd(today.getFullYear(), today.getMonth() + 1, today.getDate()).getLunar().getYear();
      for (let y = ly - 1; y <= ly + 1 && (!date || date < today); y++) date = lunarToSolar(y, lm, ld);
      if (date && date < today) date = undefined;
    } else if ((m = line.match(/^每月\s*(\d{1,2})\s+(.+)$/))) {
      kind = "monthly"; name = m[2];
      const d = +m[1];
      const at = (y: number, mo: number) => new Date(y, mo, Math.min(d, new Date(y, mo + 1, 0).getDate()));
      date = at(today.getFullYear(), today.getMonth());
      if (date < today) date = at(today.getFullYear(), today.getMonth() + 1);
    } else {
      errors.push(raw.trim());
      continue;
    }
    if (!date || !name) { errors.push(raw.trim()); continue; }
    const days = diffDays(today, date);
    events.push({ name: name.trim().slice(0, 30), date, days: Math.abs(days), kind, pinned, past: days < 0 });
  }
  // upcoming first (soonest first), then anniversaries (most recent first)
  events.sort((a, b) => (a.past === b.past ? (a.past ? a.days - b.days : a.days - b.days) : a.past ? 1 : -1));
  return { events, errors };
}

/**
 * The featured event. choice: "auto" (the "*" one, else the soonest upcoming), "holiday"
 * (the next official holiday), or an event's name.
 */
export function featured(ev: CountdownEvent[], choice = "auto"): CountdownEvent | undefined {
  if (choice === "holiday") return ev.find((e) => e.kind === "holiday") ?? featured(ev);
  if (choice !== "auto") { const e = ev.find((x) => x.name === choice); if (e) return e; }
  return ev.find((e) => e.pinned) ?? ev.find((e) => !e.past) ?? ev[0];
}

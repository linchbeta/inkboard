// Calendar events from iCalendar (ICS) subscription links (Google, iCloud, Outlook, 飞书,
// 钉钉 … all export one) and from hand-written lines. Recurring events are expanded for the
// days shown: RRULE FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY;
// EXDATE; moved instances (RECURRENCE-ID). TZID times are converted via Intl.

export interface CalEvent { start: Date; end: Date; allDay: boolean; title: string; location: string; source: string }

const DAY = 86_400_000;

/** Offset (ms) of `tz` from UTC at instant `t`. */
function tzOffset(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
}

/** Wall-clock time in `tz` -> Date. Unknown zones (e.g. Windows names) count as server-local. */
function zoned(y: number, mo: number, d: number, h: number, mi: number, s: number, tz?: string): Date {
  if (tz) {
    try {
      const guess = Date.UTC(y, mo, d, h, mi, s);
      let t = guess - tzOffset(guess, tz);
      t = guess - tzOffset(t, tz); // second pass settles DST edges
      return new Date(t);
    } catch { /* fall through */ }
  }
  return new Date(y, mo, d, h, mi, s);
}

interface Prop { value: string; params: Record<string, string> }

/** Wall-clock time in a zone: "UTC" (…Z), "local" (floating / all-day) or an IANA TZID. */
interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number; tz: string }

const toInstant = (w: Wall): Date =>
  w.tz === "UTC" ? new Date(Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s))
    : w.tz === "local" ? new Date(w.y, w.mo, w.d, w.h, w.mi, w.s)
      : zoned(w.y, w.mo, w.d, w.h, w.mi, w.s, w.tz);

function parseWall(p: Prop): { wall: Wall; allDay: boolean } | undefined {
  const m = p.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return undefined;
  const allDay = !m[4] || p.params.VALUE === "DATE";
  return {
    allDay,
    wall: { y: +m[1], mo: +m[2] - 1, d: +m[3], h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5], s: allDay ? 0 : +m[6],
            tz: allDay ? "local" : m[7] ? "UTC" : p.params.TZID || "local" },
  };
}

function parseDate(p: Prop): { date: Date; allDay: boolean } | undefined {
  const w = parseWall(p);
  return w && { date: toInstant(w.wall), allDay: w.allDay };
}

const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function parseDuration(s: string): number {
  const m = s.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const v = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + ((+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === "-" ? -v : v;
}

const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Occurrences in [from, to). The rule is applied to wall-clock dates in the event's own
 * zone (BYDAY=MO means Monday there), then each occurrence becomes an instant.
 */
function expand(start: Wall, rrule: string | undefined, exdates: Set<number>, from: Date, to: Date): Date[] {
  const first = toInstant(start);
  if (!rrule) return first < to ? [first] : [];
  const r: Record<string, string> = {};
  for (const kv of rrule.split(";")) { const [k, v] = kv.split("="); if (k && v) r[k.toUpperCase()] = v; }
  const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDate({ value: r.UNTIL, params: start.tz !== "UTC" && start.tz !== "local" ? { TZID: start.tz } : {} })?.date : undefined;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => WD[x.slice(-2)]).filter((x) => x !== undefined).sort() : undefined;
  // calendar maths on a UTC Date holding the wall-clock date
  const cal = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo, d));
  const s0 = cal(start.y, start.mo, start.d);
  const at = (c: Date): Date => toInstant({ ...start, y: c.getUTCFullYear(), mo: c.getUTCMonth(), d: c.getUTCDate() });
  const out: Date[] = [];
  let n = 0;
  const push = (c: Date): boolean => { // false once the rule has ended
    const t = at(c);
    if (c < s0) return true;
    if (n >= count || (until && t > until)) return false;
    n++;
    if (t >= from && t < to && !exdates.has(t.getTime())) out.push(t);
    return true;
  };
  for (let k = 0; k < 5000; k++) {
    if (freq === "WEEKLY") {
      const wk = cal(start.y, start.mo, start.d - s0.getUTCDay() + k * 7 * interval);
      if (at(wk) >= to) break;
      let go = true;
      for (const wd of byday?.length ? byday : [s0.getUTCDay()]) go = push(cal(wk.getUTCFullYear(), wk.getUTCMonth(), wk.getUTCDate() + wd)) && go;
      if (!go) break;
      continue;
    }
    let c: Date;
    if (freq === "DAILY") c = cal(start.y, start.mo, start.d + k * interval);
    else if (freq === "MONTHLY") c = cal(start.y, start.mo + k * interval, start.d);
    else if (freq === "YEARLY") c = cal(start.y + k * interval, start.mo, start.d);
    else return first < to ? [first] : [];
    if (at(c) >= to) break;
    if ((freq === "MONTHLY" && c.getUTCDate() !== start.d) || (freq === "YEARLY" && c.getUTCMonth() !== start.mo)) continue; // 31st / 29 Feb
    if (!push(c)) break;
  }
  return out;
}

/** Events of an ICS document overlapping [from, to). */
export function parseIcs(text: string, from: Date, to: Date, source = ""): CalEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: CalEvent[] = [];
  const moved = new Map<string, Set<number>>(); // UID -> original starts replaced by RECURRENCE-ID instances
  const blocks: Map<string, Prop[]>[] = [];
  let cur: Map<string, Prop[]> | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = new Map(); continue; }
    if (line === "END:VEVENT") { if (cur) blocks.push(cur); cur = undefined; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(";");
    const params: Record<string, string> = {};
    for (const p of ps) { const [k, v] = p.split("="); if (k) params[k.toUpperCase()] = (v ?? "").replace(/^"|"$/g, ""); }
    const key = name.toUpperCase();
    cur.set(key, [...(cur.get(key) ?? []), { value: line.slice(i + 1), params }]);
  }
  for (const b of blocks) {
    const rid = b.get("RECURRENCE-ID")?.[0];
    const uid = b.get("UID")?.[0]?.value ?? "";
    if (rid) {
      const d = parseDate(rid);
      if (d) moved.set(uid, (moved.get(uid) ?? new Set()).add(d.date.getTime()));
    }
  }
  for (const b of blocks) {
    if ((b.get("STATUS")?.[0]?.value ?? "").toUpperCase() === "CANCELLED") continue;
    const ds = b.get("DTSTART")?.[0];
    const sw = ds && parseWall(ds);
    if (!sw) continue;
    const st = { date: toInstant(sw.wall), allDay: sw.allDay };
    const de = b.get("DTEND")?.[0];
    const en = de && parseDate(de);
    const dur = en ? en.date.getTime() - st.date.getTime()
      : b.get("DURATION") ? parseDuration(b.get("DURATION")![0].value) : st.allDay ? DAY : 0;
    const ex = new Set<number>();
    for (const p of b.get("EXDATE") ?? []) for (const v of p.value.split(",")) { const d = parseDate({ value: v, params: p.params }); if (d) ex.add(d.date.getTime()); }
    const uid = b.get("UID")?.[0]?.value ?? "";
    if (!b.get("RECURRENCE-ID")) for (const t of moved.get(uid) ?? []) ex.add(t);
    const rrule = b.get("RECURRENCE-ID") ? undefined : b.get("RRULE")?.[0]?.value;
    // occurrences that start before `from` but are still running count too
    for (const s of expand(sw.wall, rrule, ex, new Date(from.getTime() - Math.max(0, dur)), to)) {
      const e = new Date(s.getTime() + dur);
      if (e <= from && !(dur === 0 && s >= from)) continue;
      events.push({
        start: s, end: e, allDay: st.allDay,
        title: unescape(b.get("SUMMARY")?.[0]?.value ?? "（无标题）"),
        location: unescape(b.get("LOCATION")?.[0]?.value ?? ""),
        source,
      });
    }
  }
  return events;
}

/**
 * Hand-written events, one per line:
 *   2026-10-05 14:00 家长会 @学校     2026-10-05 14:00-15:30 …     2026-10-05 秋游 (all day)
 *   每周一 07:50 升旗仪式             每天 21:00 刷牙洗脸
 */
// hand-written lines: see localEvents.ts
export { parseLocalEvents } from "./localEvents.js";

// ── fetching, with a 30-minute cache that also serves stale data when offline ──
const cache = new Map<string, { at: number; text: string }>();

export async function fetchIcs(url: string, now = Date.now()): Promise<string> {
  const hit = cache.get(url);
  if (hit && now - hit.at < 30 * 60_000) return hit.text;
  try {
    const r = await fetch(url.replace(/^webcal:/i, "https:"), { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("不是日历文件");
    cache.set(url, { at: now, text });
    return text;
  } catch (e) {
    if (hit) return hit.text;
    throw e;
  }
}

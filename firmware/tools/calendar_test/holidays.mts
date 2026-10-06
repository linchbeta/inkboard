// Server side of the holiday consistency check (see holidays.cpp). Adds made-up 2027 and
// 2028 schedules that start blocks in the previous December, then writes
//  - holidays_<year>.txt: what GET /api/holidays/<year> returns (published years only)
//  - holidays_expected.txt: the server's 休/班 for every day 2024-12-01 .. 2028-12-31
//  - holidays_frames.txt: frame hashes of the calendar around both year ends (both panels)
// Run from server/: npx tsx ../firmware/tools/calendar_test/holidays.mts <out dir>
import { writeFileSync } from "node:fs";
import { openDb } from "../../../server/src/db.js";
import { createApp } from "../../../server/src/app.js";
import { useHolidayData, holidayOf } from "../../../server/src/data/calendar.js";
import { PANELS } from "../../../server/src/panels.js";
import { buildFrame } from "../../../server/src/frames.js";

const out = process.argv[2] ?? ".";
// 2027 reaches into 2026, which the firmware has bundled: the download must win there
useHolidayData(2027, { year: 2027, days: [
  { name: "元旦", date: "2026-12-31", isOffDay: true }, { name: "元旦", date: "2027-01-01", isOffDay: true },
  { name: "元旦", date: "2027-01-02", isOffDay: true }, { name: "元旦", date: "2026-12-27", isOffDay: false },
  { name: "春节", date: "2027-02-06", isOffDay: true }, { name: "春节", date: "2027-02-14", isOffDay: false },
] });
useHolidayData(2028, { year: 2028, days: [
  { name: "元旦", date: "2027-12-31", isOffDay: true }, { name: "元旦", date: "2028-01-01", isOffDay: true },
  { name: "元旦", date: "2028-01-02", isOffDay: true }, { name: "元旦", date: "2028-01-08", isOffDay: false },
  { name: "国庆节", date: "2028-10-01", isOffDay: true }, { name: "国庆节", date: "2028-10-07", isOffDay: true },
  { name: "国庆节", date: "2028-10-08", isOffDay: false },
] });
const app = createApp(openDb(":memory:"), { testUser: true });
for (let y = 2024; y <= 2029; y++) {
  const r = await app.request(`/api/holidays/${y}`);
  if (r.status === 200) writeFileSync(`${out}/holidays_${y}.txt`, await r.text());
  console.log(`/api/holidays/${y}: ${r.status}`);
}
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const lines: string[] = [];
for (let d = new Date(2024, 11, 1); d <= new Date(2028, 11, 31); d.setDate(d.getDate() + 1)) {
  const h = holidayOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  lines.push(`${ymd(d)} ${h === "off" ? 1 : h === "work" ? 2 : 0}`);
}
writeFileSync(`${out}/holidays_expected.txt`, lines.join("\n") + "\n");
const fnv = (b: Uint8Array) => { let h = 0xcbf29ce484222325n; for (const x of b) h = BigInt.asUintN(64, (h ^ BigInt(x)) * 0x100000001b3n); return h.toString(16).padStart(16, "0"); };
const frames: string[] = [];
for (let d = new Date(2026, 11, 1); d <= new Date(2028, 0, 31); d.setDate(d.getDate() + 1)) {
  if (d.getMonth() > 0 && d.getMonth() < 11) continue; // the two year ends
  for (const p of [PANELS.se0398, PANELS.hink42_bwr]) {
    frames.push(`${ymd(d)} ${p.id} ${fnv(buildFrame(p, { now: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9) }, true, "calendar").body)}`);
  }
}
writeFileSync(`${out}/holidays_frames.txt`, frames.join("\n") + "\n");

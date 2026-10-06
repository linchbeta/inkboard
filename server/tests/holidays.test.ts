// The holiday chain end to end: holiday-cn (stubbed) -> daily sync -> saved copy -> merged
// table -> the server's calendar and the devices' /api/holidays. Its own file: it changes
// the process-wide holiday table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb, getSetting } from "../src/db.js";
import { createApp } from "../src/app.js";
import { syncHolidays, loadSavedHolidays } from "../src/data/holidaySync.js";
import { holidayOf, useHolidayData, loadedHolidayYears } from "../src/data/calendar.js";

const bundled = (y: number) => JSON.parse(readFileSync(new URL(`../assets/holidays/${y}.json`, import.meta.url), "utf8"));
// like holiday-cn's 2019.json (which starts with 2018-12-29..31): a block from the December before
const FILE_2027 = { year: 2027, days: [
  { name: "元旦", date: "2026-12-31", isOffDay: true }, { name: "元旦", date: "2027-01-01", isOffDay: true },
  { name: "元旦", date: "2027-01-02", isOffDay: true }, { name: "春节", date: "2027-02-14", isOffDay: false },
] };

test("holiday-cn sync: saved, merged by date, served to devices; a previous-December block survives re-syncs", async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    asked.push(u);
    const y = Number(/(\d{4})\.json$/.exec(u)?.[1]);
    const body = y === 2027 ? FILE_2027 : y === 2026 ? bundled(2026) : { year: y, days: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const db = openDb(":memory:");
    await syncHolidays(db);
    const year = new Date().getFullYear();
    assert.ok(asked.some((u) => u.includes("holiday-cn") && u.endsWith(`/${year}.json`)), asked.join(" "));
    assert.ok(asked.some((u) => u.endsWith(`/${year + 1}.json`)));
    if (year !== 2026) return; // the rest assumes the stubbed files are this year and next

    // saved for restarts, merged by date (the 2027 file's 2026-12-31 is a 2026 day)
    assert.ok(getSetting(db, "holidays:2027", "").includes("2026-12-31"));
    assert.ok(loadedHolidayYears().includes(2027));
    assert.equal(holidayOf(2026, 12, 31), "off");
    assert.equal(holidayOf(2027, 2, 14), "work");
    assert.equal(holidayOf(2026, 10, 1), "off");

    // re-applying 2026 alone (as the next day's sync does first) keeps 2027's December day
    useHolidayData(2026, bundled(2026));
    assert.equal(holidayOf(2026, 12, 31), "off");
    assert.equal(holidayOf(2026, 10, 1), "off");

    // the devices' endpoint: the year and the December before, full dates
    const app = createApp(db, { testUser: true });
    const text = await (await app.request("/api/holidays/2027")).text();
    assert.deepEqual(text.trim().split("\n"), ["20261231 1", "20270101 1", "20270102 1", "20270214 2"]);
    assert.ok((await (await app.request("/api/holidays/2026")).text()).includes("20261001 1"));

    // a restart: the saved copies are loaded again
    loadSavedHolidays(db);
    assert.equal(holidayOf(2026, 12, 31), "off");
  } finally {
    globalThis.fetch = realFetch;
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcs, parseLocalEvents } from "../src/data/ics.js";
import { parseCountdowns } from "../src/data/countdown.js";
import { parseTodo } from "../src/screens/todo.js";
import { wrapText, wrapItems } from "../src/screens/common.js";
import { refFonts, width } from "../src/render/reftext.js";
import { moonPhase, phaseName } from "../src/screens/almanac.js";
import { poemOfDay, POEMS } from "../src/data/poems.js";
import { WORDS, wordIndex } from "../src/data/words.js";
import { progressRows } from "../src/screens/yearProgress.js";
import { fonts } from "../src/render/fonts.js";
import { glyphFor } from "../src/render/bdf.js";
import { runAs } from "../src/scope.js";
// per-screen content, read as the test user's (id 1) screen
const SCREEN = "12:34:56:AB:CD:01";
const me = <T>(f: () => T): T => runAs(1, f, SCREEN);
/** Gives the test user a screen (content belongs to screens). */
function addScreen(db: { prepare(sql: string): { run(...a: unknown[]): unknown } }): void {
  db.prepare("INSERT INTO device (mac, key, status, created_at, owner_id) VALUES (?, 'k', 'active', '2026-01-01T00:00:00Z', 1)").run(SCREEN);
}

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART;TZID=Asia/Shanghai:20261005T140000
DTEND;TZID=Asia/Shanghai:20261005T153000
SUMMARY:家长会
LOCATION:学校\\, 三楼
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART:20260928T233000Z
DURATION:PT1H
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6
EXDATE:20261005T233000Z
SUMMARY:钢琴课
END:VEVENT
BEGIN:VEVENT
UID:c
DTSTART;VALUE=DATE:20261004
DTEND;VALUE=DATE:20261005
SUMMARY:秋游
END:VEVENT
BEGIN:VEVENT
UID:d
DTSTART;TZID=America/New_York:20261003T090000
DTEND;TZID=America/New_York:20261003T100000
SUMMARY:纽约会议
END:VEVENT
BEGIN:VEVENT
UID:b
RECURRENCE-ID:20260930T233000Z
DTSTART:20261001T010000Z
DURATION:PT1H
SUMMARY:钢琴课（改期）
END:VEVENT
BEGIN:VEVENT
UID:e
DTSTART:20261003T000000Z
STATUS:CANCELLED
SUMMARY:取消了
END:VEVENT
END:VCALENDAR`;

test("ICS: timezones, all-day, weekly BYDAY + COUNT + EXDATE, moved instance, cancelled", () => {
  // these tests assume the server runs on China time, like the NAS (TZ=Asia/Shanghai)
  if (new Date(2026, 9, 1).getTimezoneOffset() !== -480) return;
  const ev = parseIcs(ICS.replace(/\n/g, "\r\n"), new Date(2026, 8, 28), new Date(2026, 9, 12));
  const s = ev.map((e) => `${e.start.getMonth() + 1}/${e.start.getDate()} ${e.allDay ? "全天" : `${e.start.getHours()}:${String(e.start.getMinutes()).padStart(2, "0")}`} ${e.title}`).sort();
  // BYDAY=MO,WE applies in UTC (DTSTART is …Z): Mon/Wed 23:30Z = Tue/Thu 07:30 in China.
  // 9/29, 10/1 (moved to 9:00), 10/6 (EXDATE), 10/8; 10/13 is past the window.
  assert.deepEqual(s, [
    "10/1 9:00 钢琴课（改期）",
    "10/3 21:00 纽约会议",         // 09:00 EDT = 21:00 China
    "10/4 全天 秋游",
    "10/5 14:00 家长会",
    "10/8 7:30 钢琴课",
    "9/29 7:30 钢琴课",
  ].sort());
  // COUNT=6 ends the series: 9/29, 10/1, 10/6, 10/8, 10/13, 10/15
  const later = parseIcs(ICS, new Date(2026, 9, 12), new Date(2026, 10, 30)).filter((e) => e.title === "钢琴课");
  assert.deepEqual(later.map((e) => e.start.getDate()), [13, 15]);
  assert.equal(ev.find((e) => e.title === "家长会")!.location, "学校, 三楼");
  assert.ok(!ev.some((e) => e.title === "取消了"));
});

test("hand-written events: dated, all-day, weekly, daily", () => {
  const ev = parseLocalEvents("2026-10-05 14:00-15:30 家长会 @学校\n2026-10-04 秋游\n每周一 07:50 升旗仪式\n每天 21:00 刷牙\n乱写", new Date(2026, 9, 3), new Date(2026, 9, 10));
  assert.equal(ev.filter((e) => e.title === "刷牙").length, 7);
  assert.equal(ev.filter((e) => e.title === "升旗仪式").length, 1);
  const pm = ev.find((e) => e.title === "家长会")!;
  assert.deepEqual([pm.start.getHours(), pm.end.getHours(), pm.end.getMinutes(), pm.location], [14, 15, 30, "学校"]);
  assert.ok(ev.find((e) => e.title === "秋游")!.allDay);
});

test("countdowns: yearly, lunar, monthly, past one-off counts up, bad lines reported", () => {
  const { events, errors } = parseCountdowns("2027-06-07 高考\n每年 05-20 生日\n农历 08-15 中秋\n每月 15 还款\n2015-05-01 纪念日\n*每年 10-01 国庆\nxx", new Date(2026, 9, 3, 9));
  const by = (n: string) => events.find((e) => e.name === n)!;
  assert.equal(by("中秋").date.toDateString(), new Date(2027, 8, 15).toDateString());
  assert.equal(by("还款").days, 12);
  assert.ok(by("纪念日").past);
  assert.ok(by("国庆").pinned);
  assert.deepEqual(errors, ["xx"]);
});

test("todo parsing", () => {
  assert.deepEqual(parseTodo("## 小明\n- [ ] a\n- [x] b\nplain\n【家务】\n* [ ] e").map((g) => [g.name, g.items.map((i) => `${i.done ? "x" : " "}${i.text}`).join(",")]),
    [["小明", " a,xb, plain"], ["家务", " e"]]);
});

test("wrapping: Latin words stay whole, closing punctuation never starts a line, items never split", () => {
  const { wqy12 } = refFonts();
  const lines = wrapText(wqy12, "We learn something new every day，好好学习。", 120);
  for (const l of lines) {
    assert.ok(!/^[，。]/.test(l), l);
    assert.ok(width(wqy12, l) <= 120 + 8, l);
  }
  assert.ok(lines.join(" ").includes("something"));
  assert.deepEqual(wrapItems(wqy12, ["嫁娶", "动土", "祭祀"], width(wqy12, "嫁娶  动土") + 1), ["嫁娶  动土", "祭祀"]);
});

test("moon phase: known full and new moons", () => {
  assert.ok(moonPhase(new Date(Date.UTC(2026, 9, 26, 4, 12))).lit > 0.98); // full moon 2026-10-26
  assert.ok(moonPhase(new Date(Date.UTC(2026, 9, 10, 15, 50))).lit < 0.02); // new moon 2026-10-10
  assert.equal(phaseName(0.2), "新月");
  assert.equal(phaseName(14.8), "满月");
});

test("poems and words: glyphs present, festival and seasonal picks", () => {
  const f = fonts().wqy16;
  for (const p of POEMS) for (const ch of [p.title, p.author, ...p.lines].join("")) assert.ok(glyphFor(f, ch.codePointAt(0)!), `${p.title}: ${ch}`);
  for (const w of WORDS) for (const ch of Object.values(w).join("")) assert.ok(glyphFor(f, ch.codePointAt(0)!), `${w.word}: ${ch}`);
  assert.equal(poemOfDay(new Date(2026, 8, 25), "中秋节").title, "十五夜望月");
  const spring = poemOfDay(new Date(2026, 3, 10));
  assert.ok(!spring.season || spring.season === "春");
  assert.notEqual(poemOfDay(new Date(2026, 3, 10)).title + poemOfDay(new Date(2026, 3, 11)).title, "");
  assert.notEqual(wordIndex(new Date(2026, 9, 3), WORDS.length), wordIndex(new Date(2026, 9, 4), WORDS.length));
});

test("year progress rows", () => {
  const r = progressRows(new Date(2026, 9, 3, 12));
  assert.equal(r[0].note, "还剩 89 天");
  assert.ok(Math.abs(r[4].value - 0.5) < 1e-9);
  assert.equal(r[3].note, "还剩 1 天"); // Saturday: Sunday left
});

test("every mode renders on both panels (no data, and on a festival day)", async () => {
  const { SCREENS } = await import("../src/frames.js");
  const { PANELS } = await import("../src/panels.js");
  for (const [id, s] of Object.entries(SCREENS)) {
    for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
      for (const now of [new Date(2026, 9, 3, 9, 30), new Date(2027, 1, 6, 23, 59)]) {
        const c = s.render(panel, { now, batteryV: 3.9 });
        assert.equal(c.px.length, panel.width * panel.height, `${id} ${panel.id}`);
      }
    }
  }
});

test("modes page: settings saved per mode, messages added and deleted, screen switch returns to the page", async () => {
  const { openDb } = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  const { getModeConfig } = await import("../src/data/modeConfig.js");
  const { listMessages } = await import("../src/data/messages.js");
  const { SCREENS } = await import("../src/frames.js");
  const db = openDb(":memory:");
  const app = createApp(db, { testUser: true, now: () => new Date(2026, 9, 3, 9) });
  addScreen(db);
  const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    app.request(path, { method: "POST", body: new URLSearchParams(body), headers });
  assert.equal((await app.request("/modes")).status, 200);
  await post("/admin/modes/countdown", { dev: SCREEN, events: "2027-01-01 元旦" });
  assert.equal(me(() => getModeConfig(db, "countdown", SCREENS.countdown.config)).events, "2027-01-01 元旦");
  await post("/admin/modes/words", { dev: SCREEN, use: "evil" });
  assert.equal(me(() => getModeConfig(db, "words", SCREENS.words.config)).use, "builtin");
  assert.equal((await post("/admin/modes/nope", {})).status, 404);
  await post("/admin/messages", { from: "妈妈", text: "早点睡" });
  await post("/admin/messages", { from: "", text: "   " }); // blank: ignored
  const msgs = me(() => listMessages(db));
  assert.deepEqual(msgs.map((m) => m.text), ["早点睡"]);
  await post(`/admin/messages/${msgs[0].id}/delete`, {});
  assert.equal(me(() => listMessages(db)).length, 0);
  assert.match((await post("/admin/modes/poetry/push", { mac: SCREEN, for: "once" })).headers.get("location") ?? "", /^\/modes\?flash=.*#poetry$/);
});

test("poems: every character in every WenKai size; every poem fits whole on both panels", async () => {
  const { bigFont, BIG_SIZES } = await import("../src/render/fonts.js");
  const { plan } = await import("../src/screens/poetry.js");
  const chars = new Set(POEMS.flatMap((p) => [...[p.title, p.author, p.dynasty, ...p.lines].join("")]));
  for (const [fam, sizes] of [["wenkai", BIG_SIZES.wenkai], ["wenkai-poems", BIG_SIZES["wenkai-poems"]], ["sans", BIG_SIZES.sans]] as const) {
    for (const px of sizes) {
      const f = bigFont(fam, px);
      const missing = [...chars].filter((ch) => ch !== "·" && !f.glyphs.has(ch.codePointAt(0)!));
      assert.deepEqual(missing, [], `${fam} ${px}px`);
    }
  }
  for (const p of POEMS) {
    // the same bounds renderPoetry uses: 3.98" 768x552 (header 49, pad 28), 4.2" 400x300 (header 31, pad 6)
    assert.ok(plan(p, true, 768 - 40 - 56, 552 - 49 - 56).fits, `3.98 ${p.title}`);
    assert.ok(plan(p, false, 400 - 20 - 12, 300 - 31 - 12).fits, `4.2 ${p.title}`);
  }
});

test("poetry: '换一首' moves on, a fixed poem can be chosen", async () => {
  const { openDb } = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  const { prepareScreen } = await import("../src/frames.js");
  const db = openDb(":memory:");
  const now = new Date(2026, 9, 3, 9);
  const app = createApp(db, { testUser: true, now: () => now });
  addScreen(db);
  const dev = () => new URLSearchParams({ dev: SCREEN });
  const title = async () => ((await me(() => prepareScreen(db, "poetry", now))).data as { title: string }).title;
  const first = await title();
  const r = await app.request("/admin/modes/poetry/action/next", { method: "POST", body: dev() });
  assert.equal(r.headers.get("location"), `/devices/${SCREEN}?tab=content#c-poetry`);
  assert.notEqual(await title(), first);
  await app.request("/admin/modes/poetry", { method: "POST", body: new URLSearchParams({ dev: SCREEN, pick: "poem:静夜思|李白" }) });
  assert.equal(await title(), "静夜思");
  await app.request("/admin/modes/poetry/action/next", { method: "POST", body: dev() });
  assert.notEqual(await title(), "静夜思"); // back to the daily choice
  assert.equal((await app.request("/admin/modes/poetry/action/nope", { method: "POST", body: dev() })).status, 404);
  assert.match(await (await app.request("/modes")).text(), /古诗词/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimetable, schoolDay, lessonsOn, weekOf, PRESETS } from "../src/screens/timetable.js";
import { renderDashboard } from "../src/screens/dashboard.js";
import { renderScreen } from "../src/frames.js";
import { parseTodo } from "../src/screens/todo.js";
import { PANELS, Ink } from "../src/panels.js";

const tt = parseTimetable(
  "周一 语文 数学 英语\n周二：数学、语文、-\n星期五 英语 语文 体育\n2026-10-10 按周五\n2026-10-16 休\n乱写的一行",
  "08:00-08:40\n08:50～09:30\n\n10:00-10:40",
);
const names = (d: Date, t = tt) => lessonsOn(t, d)?.map((l) => `${l.name}${l.span > 1 ? `x${l.span}` : ""}`);

test("timetable: school lines, periods, date overrides", () => {
  assert.deepEqual(names(new Date(2026, 9, 12)), ["语文", "数学", "英语"]);
  assert.deepEqual(names(new Date(2026, 9, 13)), ["数学", "语文"]);
  assert.deepEqual(tt.periods.map((p) => [p.start, p.end, p.breakBefore]), [[480, 520, false], [530, 570, false], [600, 640, true]]);
  assert.deepEqual(names(new Date(2026, 9, 10)), ["英语", "语文", "体育"]); // Saturday, as Friday
  assert.equal(lessonsOn(tt, new Date(2026, 9, 16)), undefined);              // a Friday marked off
  assert.equal(lessonsOn(tt, new Date(2026, 9, 5)), undefined);               // National Day holiday (Monday)
  // the same course in neighbouring periods is one block -- not across a long break
  const dbl = parseTimetable("周一 数学 数学 数学 语文", "08:00-08:40\n08:50-09:30\n\n10:00-10:40\n10:50-11:30");
  assert.deepEqual(names(new Date(2026, 9, 12), dbl), ["数学x2", "数学", "语文"]);
});

test("timetable: today while lessons are left, then the next school day; now / next", () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
  let sd = schoolDay(tt, at(12, 8, 10)); // Monday, 1st lesson
  assert.deepEqual([sd?.offset, sd?.current?.name, sd?.next], [0, "语文", undefined]);
  sd = schoolDay(tt, at(12, 9, 40));     // break before the 3rd
  assert.deepEqual([sd?.offset, sd?.current, sd?.next?.name], [0, undefined, "英语"]);
  sd = schoolDay(tt, at(13, 9, 40));     // Tuesday: no 3rd lesson, so school is over
  assert.equal(sd?.day.getDate(), 19);   // Fri 16 is off -> Mon 19
  sd = schoolDay(tt, at(9, 18));         // Friday evening -> Saturday 10 (as Friday)
  assert.deepEqual([sd?.day.getDate(), sd?.offset], [10, 1]);
});

test("timetable: senior school (早读 / 晚自习) and university (periods, rooms, weeks)", () => {
  const senior = parseTimetable("周一 语文 数学 数学 英语 物理 化学 - 生物 体育 地理 自习 自习", PRESETS.senior);
  assert.equal(senior.periods[0].label, "早读");
  assert.deepEqual(names(new Date(2026, 9, 12), senior), ["语文", "数学x2", "英语", "物理", "化学", "生物", "体育", "地理", "自习x2"]);

  const uni = parseTimetable(
    "周一 1-2 高等数学 @教A101 1-16周\n周一 3-4 大学英语 @外语楼 203 单周\n周一 3-4 体育 双周\n周三 第5节 线性代数\n周一 9-11 选修课 9-12周",
    PRESETS.university, "2026-09-09");
  assert.equal(weekOf(uni, new Date(2026, 8, 7)), 1);
  assert.equal(weekOf(uni, new Date(2026, 9, 12)), 6);
  const mon = (d: number) => lessonsOn(uni, new Date(2026, 8, d))!;
  // week 1 (odd): maths, English; week 2: maths, PE; week 10: plus the elective (periods 9-11, evening)
  assert.deepEqual(mon(7).map((l) => l.name), ["高等数学", "大学英语"]);
  assert.deepEqual(mon(14).map((l) => l.name), ["高等数学", "体育"]);
  const w10 = lessonsOn(uni, new Date(2026, 10, 9))!;
  assert.deepEqual(w10.map((l) => [l.name, l.row, l.span]), [["高等数学", 0, 2], ["体育", 2, 2], ["选修课", 8, 3]]);
  assert.equal(mon(7)[1].place, "外语楼 203");
  assert.equal(lessonsOn(uni, new Date(2026, 8, 2)), undefined); // before the term
  const sd = schoolDay(uni, new Date(2026, 8, 7, 8, 30));
  assert.deepEqual([sd?.current?.name, sd?.week], ["高等数学", 1]);
});

test("timetable and dashboard render on both panels, with and without content", () => {
  const now = new Date(2026, 9, 9, 10, 15);
  const uni = parseTimetable("周一 1-2 高等数学 @教A101\n周三 9-11 选修课程名字很长很长 @图书馆报告厅\n周五 5-6 物理实验 双周", PRESETS.university);
  const senior = parseTimetable("周五 语文 数学 数学 英语 物理 化学 - 生物 体育 地理 自习 自习", PRESETS.senior);
  for (const p of Object.values(PANELS)) {
    for (const t of [tt, uni, senior]) for (const view of ["week", "day"]) {
      const c = renderScreen(p, { now, data: { tt: t, view } }, "timetable");
      assert.equal(c.width, p.width);
    }
    renderScreen(p, { now, data: { tt: parseTimetable("", ""), view: "week" } }, "timetable");
    renderDashboard(p, { now, data: { messages: [], todo: [], events: [], agenda: false } });
    const c = renderDashboard(p, {
      now, batteryV: 4.1, data: {
        messages: [{ id: 1, from: "妈妈", text: "晚上加班，冰箱里有饺子。", at: now.toISOString() }],
        todo: parseTodo("## 小明\n- [ ] 数学\n- [x] 语文"),
        events: [{ title: "家长会", start: new Date(2026, 9, 9, 16), end: new Date(2026, 9, 9, 17), allDay: false }],
        agenda: true,
      },
    });
    let red = 0;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (c.get(x, y) === Ink.Red) red++;
    assert.ok(red > 100, "section tags are red");
  }
});

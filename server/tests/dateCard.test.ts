import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDateCard, type DateCardLayout } from "../src/screens/dateCard.js";
import { PANELS, Ink } from "../src/panels.js";
import { nextSolarTerm, holidayPeriod, nextHoliday, almanacOf } from "../src/data/calendar.js";
import { parseForecast } from "../src/data/weather.js";
import { refFonts } from "../src/render/reftext.js";
import { glyphFor } from "../src/render/bdf.js";

test("date card: big day number centred (pixels) for every day, both panels", () => {
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    for (let d = 1; d <= 31; d++) {
      const now = new Date(2026, 9, d); // October: has 休, 班, festivals, weekends
      const layout: DateCardLayout[] = [];
      const c = renderDateCard(panel, { now, batteryV: 3.9 }, layout);
      const { number: n, body, noteH } = layout[0];
      let x0 = Infinity, x1 = -Infinity;
      for (let y = n.y0; y < n.y0 + n.h; y++) for (let x = Math.max(0, n.x0 - 10); x < Math.min(c.width, n.x0 + n.w + 10); x++) {
        if (c.get(x, y) === n.ink) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      }
      const { cx } = layout[0];
      // (scan around the number only: the large card has more ink in its right column)
      assert.ok(Math.abs((x0 + x1) / 2 - cx) <= 1, `${panel.id} day ${d}: number centre ${(x0 + x1) / 2} vs ${cx}`);
      // number + festival line form one block centred between the two rules
      const blockMid = n.y0 + (n.h + noteH) / 2;
      assert.ok(Math.abs(blockMid - (body.y0 + body.y1) / 2) <= 1, `${panel.id} day ${d}: block not centred`);
      // weekends and days off are red, make-up work days black
      if (d === 1 || d === 3 || d === 4) assert.equal(n.ink, Ink.Red);
      if (d === 10) assert.equal(n.ink, Ink.Black); // 班 on a Saturday
      if (d === 14) assert.equal(n.ink, Ink.Black);
    }
  }
});

test("next solar term", () => {
  assert.deepEqual(nextSolarTerm(2026, 10, 2), { name: "寒露", days: 6 });
  assert.deepEqual(nextSolarTerm(2026, 10, 8), { name: "霜降", days: 15 });
  assert.deepEqual(nextSolarTerm(2026, 12, 31), { name: "小寒", days: 5 });
});

test("holiday period and countdown", () => {
  assert.deepEqual(holidayPeriod(2026, 10, 2), { name: "国庆节", nth: 2, total: 7 });
  assert.equal(holidayPeriod(2026, 10, 10), undefined); // 班
  assert.equal(nextHoliday(2026, 5, 1)?.name, "端午节"); // inside 劳动节 -> the next block
  assert.deepEqual(nextHoliday(2026, 10, 14), { name: "元旦", days: 79, date: "2027-01-01" }); // 2027 not published: statutory date
});

test("every 宜/忌 character of 2026-2027 is in the 16px font", () => {
  const f = refFonts().wqy12.f;
  const missing = new Set<string>();
  for (let t = new Date(2026, 0, 1); t.getFullYear() < 2028; t.setDate(t.getDate() + 1)) {
    const a = almanacOf(t.getFullYear(), t.getMonth() + 1, t.getDate());
    for (const ch of [...a.yi, ...a.ji, a.monthGanZhi, a.dayGanZhi].join("")) {
      if (!glyphFor(f, ch.codePointAt(0)!)) missing.add(ch);
    }
  }
  assert.deepEqual([...missing], []);
});

test("large date card: right column items never overlap and stay inside the body", () => {
  const panel = PANELS.se0398;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const time: string[] = [];
  for (let h = 0; h < 120; h++) time.push(`2026-10-${pad2(2 + Math.floor(h / 24))}T${pad2(h % 24)}:00`);
  const weather = parseForecast({ name: "乌鲁木齐", lat: 43.8, lon: 87.6, timezone: "Asia/Shanghai" }, {
    current: { time: "2026-10-02T09:00", temperature_2m: -12, relative_humidity_2m: 100, apparent_temperature: -20,
               is_day: 1, weather_code: 95, wind_speed_10m: 80, wind_direction_10m: 200 },
    hourly: { time, temperature_2m: time.map(() => -12), precipitation_probability: time.map(() => 100), weather_code: time.map(() => 95) },
    daily: { time: ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"], weather_code: [95, 71, 0, 3],
             temperature_2m_max: [-10, -11, -12, -13], temperature_2m_min: [-20, -21, -22, -23], precipitation_probability_max: [100, 100, 100, 100] },
  }, new Date(2026, 9, 2, 9));
  for (let t = new Date(2026, 0, 1); t.getFullYear() < 2027; t.setDate(t.getDate() + 1)) {
    const layout: DateCardLayout[] = [];
    renderDateCard(panel, { now: new Date(t), batteryV: 3.9, weather }, layout);
    const { boxes, body } = layout[0];
    assert.ok(boxes.length >= 5, `${t.toDateString()}: only ${boxes.map((b) => b.what)}`);
    for (const b of boxes) {
      assert.ok(b.y0 >= body.y0 && b.y1 <= body.y1 && b.x1 <= panel.width - 40, `${t.toDateString()}: ${b.what} outside`);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      assert.ok(!overlap, `${t.toDateString()}: ${a.what} overlaps ${b.what}`);
    }
  }
});

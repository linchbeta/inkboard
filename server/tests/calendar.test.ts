import { test } from "node:test";
import assert from "node:assert/strict";
import lunarPkg from "lunar-javascript";
import { fonts } from "../src/render/fonts.js";
import {
  lunarOf, dayGanZhi, isoWeek, festivalOf, holidayOf, batteryLevel,
  WEEKDAY, LUNAR_MONTH, LUNAR_DATE, GAN, ZHI,
} from "../src/data/calendar.js";
import { renderCalendar, type CenterCheck } from "../src/screens/calendar.js";
import { PANELS, Ink } from "../src/panels.js";

test("every bundled text font covers printable ASCII (incl. space)", () => {
  const F = fonts();
  for (const [name, f] of Object.entries({ px12: F.px12, px10: F.px10, wqy12: F.wqy12, wqy16: F.wqy16 })) {
    for (let cp = 0x20; cp <= 0x7e; cp++) assert.ok(f.glyphs.has(cp), `${name} missing U+${cp.toString(16)}`);
  }
  for (const f of [F.helv15, F.helv20, F.helv25]) {
    for (const ch of "0123456789") assert.ok(f.glyphs.has(ch.codePointAt(0)!));
  }
});

test("calendar fonts contain every character the calendar can draw", () => {
  const F = fonts();
  const SOLAR_TERMS = "小寒大寒立春雨水惊蛰春分清明谷雨立夏小满芒种夏至小暑大暑立秋处暑白露秋分寒露霜降立冬小雪大雪冬至";
  for (const ch of GAN.join("") + ZHI.join("") + SOLAR_TERMS) {
    assert.ok(F.tiny9.glyphs.has(ch.codePointAt(0)!), `9px tiny font missing ${ch}`);
  }
  const FESTIVALS = "元旦节情人节妇女节植树节愚人节劳动节青年节儿童节建党节建军节教师节国庆节万圣节平安夜圣诞节"
    + "春节元宵节龙抬头端午节七夕节中元节中秋节重阳节寒衣节腊八节除夕母亲节父亲节感恩节清明节";
  const ZODIAC = "鼠牛虎兔龙蛇马羊猴鸡狗猪";
  const text = WEEKDAY.join("") + LUNAR_MONTH.join("") + LUNAR_DATE.join("") + FESTIVALS + ZODIAC
    + "年月周休班闰 []V.0123456789";
  for (const f of [F.wqy12, F.wqy16]) {
    for (const ch of text) assert.ok(f.glyphs.has(ch.codePointAt(0)!), `WenQuanYi missing ${ch}`);
  }
});

test("lunar dates, solar terms and year stem/branch", () => {
  assert.deepEqual(lunarOf(2026, 2, 17), { month: 1, day: 1, leap: false, yearGanZhi: "丙午", zodiac: "马", jieqi: "" });
  assert.equal(lunarOf(2026, 10, 2).day, 22);           // 八月廿二
  assert.equal(lunarOf(2026, 10, 8).jieqi, "寒露");
  assert.equal(lunarOf(2025, 7, 25).leap, true);        // 闰六月初一
  assert.equal(lunarOf(2026, 2, 16).yearGanZhi, "乙巳"); // year changes at the Spring Festival
});

test("day stem/branch formula (from the reference) matches lunar-javascript for 2024-2027", () => {
  const { Solar } = lunarPkg;
  for (let d = new Date(2024, 0, 1); d.getFullYear() < 2028; d.setDate(d.getDate() + 1)) {
    const [y, m, day] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    assert.equal(dayGanZhi(y, m, day).join(""), Solar.fromYmd(y, m, day).getLunar().getDayInGanZhi(), `${y}-${m}-${day}`);
  }
});

test("festivals follow the reference's rules", () => {
  const f = (y: number, m: number, d: number) => festivalOf(y, m, d, lunarOf(y, m, d));
  assert.equal(f(2026, 2, 16), "除夕");    // 12th month has 29 days in 2025/26
  assert.equal(f(2026, 2, 17), "春节");
  assert.equal(f(2026, 4, 5), "清明节");
  assert.equal(f(2026, 5, 10), "母亲节");  // 2nd Sunday of May
  assert.equal(f(2026, 9, 25), "中秋节");
  assert.equal(f(2026, 10, 1), "国庆节");
  assert.equal(f(2026, 10, 2), undefined);
});

test("holidays (holiday-cn) and ISO week", () => {
  assert.equal(holidayOf(2026, 10, 1), "off");
  assert.equal(holidayOf(2026, 10, 10), "work");
  assert.equal(holidayOf(2026, 10, 12), undefined);
  assert.equal(isoWeek(2026, 10, 2), 40);
  assert.equal(isoWeek(2027, 1, 1), 53);  // ISO week of the previous year
});

test("battery level curve", () => {
  assert.equal(batteryLevel(4200), 100);
  assert.equal(batteryLevel(3000), 0);
  assert.ok(batteryLevel(3800) > 30 && batteryLevel(3800) < 100);
});

test("centred text is centred: today circle, badges, weekday labels, dates, lunar labels", () => {
  const days = [...Array.from({ length: 12 }, (_, m) => new Date(2026, m, 15)),
    new Date(2026, 9, 1), new Date(2026, 9, 2), new Date(2026, 9, 10), new Date(2026, 1, 16),
    new Date(2026, 9, 28), new Date(2026, 4, 31)];
  let n = 0;
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    for (const now of days) {
      const checks: CenterCheck[] = [];
      const canvas = renderCalendar(panel, { now }, { checks });
      for (const k of checks) {
        if (k.pixels) {
          // Independent of the layout maths: find the text's pixels on the canvas itself.
          const { color, circle, rect, exclude = [] } = k.pixels;
          const area = rect ?? { x0: circle!.cx - circle!.r, x1: circle!.cx + circle!.r,
                                 y0: circle!.cy - circle!.r, y1: circle!.cy + circle!.r };
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let y = area.y0; y <= area.y1; y++) for (let x = area.x0; x <= area.x1; x++) {
            if (circle && (x - circle.cx) ** 2 + (y - circle.cy) ** 2 > circle.r ** 2) continue;
            if (exclude.some((e) => (x - e.cx) ** 2 + (y - e.cy) ** 2 <= e.r ** 2)) continue;
            if (canvas.get(x, y) !== color) continue;
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
          assert.ok(x1 >= x0, `${panel.id} ${k.what}: no text pixels found`);
          const pcx = (x0 + x1) / 2, pcy = (y0 + y1) / 2;
          assert.ok(Math.abs(pcx - k.cx) <= 1, `${panel.id} ${now.toDateString()} ${k.what}: pixel x centre ${pcx} vs ${k.cx}`);
          assert.ok(Math.abs(pcy - k.cy!) <= 1, `${panel.id} ${now.toDateString()} ${k.what}: pixel y centre ${pcy} vs ${k.cy}`);
        }
        const icx = (k.ink.x0 + k.ink.x1) / 2;
        assert.ok(Math.abs(icx - k.cx) <= 1, `${panel.id} ${now.toDateString()} ${k.what}: x ink centre ${icx} vs ${k.cx}`);
        if (k.cy !== undefined) {
          const icy = (k.ink.y0 + k.ink.y1) / 2;
          assert.ok(Math.abs(icy - k.cy) <= 1, `${panel.id} ${now.toDateString()} ${k.what}: y ink centre ${icy} vs ${k.cy}`);
        }
        n++;
      }
      assert.ok(checks.some((k) => k.what === "today circle" && k.pixels), "today circle recorded");
      // Badges must not cover today's date digits.
      const date = checks.find((k) => k.what === `date ${now.getDate()}`)!;
      for (const b of checks.filter((k) => k.what.startsWith("badge"))) {
        const { cx, cy, r } = b.pixels!.circle!;
        const nx = Math.max(date.ink.x0, Math.min(cx, date.ink.x1));
        const ny = Math.max(date.ink.y0, Math.min(cy, date.ink.y1));
        assert.ok((cx - nx) ** 2 + (cy - ny) ** 2 > (r + 1) ** 2,
                  `${panel.id} ${now.toDateString()} ${b.what} overlaps the date digits`);
      }
      assert.equal(checks.filter((k) => k.what.startsWith("badge")).length >= 2, true, "stem/branch badges recorded");
    }
  }
  assert.ok(n > 1000, `checked ${n} elements`);
});

test("no two elements of a day cell overlap (date, lunar, stem/branch, 休/班, solar term, badges)", () => {
  let n = 0;
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    for (let m = 0; m < 12; m++) {
      for (const today of [1, 8, 16, 28]) {
        const now = new Date(2026, m, today);
        const boxes: { day: number; what: string; ink: CenterCheck["ink"] }[] = [];
        renderCalendar(panel, { now }, { boxes });
        const byDay = new Map<number, typeof boxes>();
        for (const b of boxes) byDay.set(b.day, [...(byDay.get(b.day) ?? []), b]);
        for (const [day, list] of byDay) {
          for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const a = list[i].ink, b = list[j].ink;
            const overlap = a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
            assert.ok(!overlap, `${panel.id} ${now.toDateString()} day ${day}: ${list[i].what} overlaps ${list[j].what}`);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n > 5000, `checked ${n} pairs`);
});

test("calendar renders every month of 2026 on both panels; today is circled in red", () => {
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    for (let m = 0; m < 12; m++) {
      const c = renderCalendar(panel, { now: new Date(2026, m, 15), batteryV: 3.9 });
      assert.equal(c.width, panel.width);
      assert.ok(c.px.includes(Ink.Red), "red ink present (weekend header, today)");
      assert.ok(c.px.includes(Ink.Black));
    }
  }
});

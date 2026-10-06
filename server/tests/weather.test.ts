import { test } from "node:test";
import assert from "node:assert/strict";
import { parseForecast, describeCode, windDirection, windLevel, type Place, type IconKind } from "../src/data/weather.js";
import { drawWeatherIcon } from "../src/render/weatherIcons.js";
import { renderWeather } from "../src/screens/weather.js";
import { Canvas } from "../src/render/canvas.js";
import { PANELS, Ink } from "../src/panels.js";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { getPlace } from "../src/data/weather.js";
import { runAs } from "../src/scope.js";
// per-screen content, read as the test user's (id 1) screen
const SCREEN = "12:34:56:AB:CD:01";
const me = <T>(f: () => T): T => runAs(1, f, SCREEN);
/** Gives the test user a screen (content belongs to screens). */
function addScreen(db: { prepare(sql: string): { run(...a: unknown[]): unknown } }): void {
  db.prepare("INSERT INTO device (mac, key, status, created_at, owner_id) VALUES (?, 'k', 'active', '2026-01-01T00:00:00Z', 1)").run(SCREEN);
}

const PLACE: Place = { name: "上海", lat: 31.22, lon: 121.46, timezone: "Asia/Shanghai" };
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Open-Meteo-shaped response: 5 days of hourly data, current time 2026-10-02 20:15. */
function forecast(tempAt: (h: number) => number = (h) => 20 + 4 * Math.sin(h / 4)) {
  const time: string[] = [], temperature_2m: number[] = [], pop: (number | null)[] = [], code: number[] = [];
  for (let h = 0; h < 120; h++) {
    const day = 2 + Math.floor(h / 24);
    time.push(`2026-10-${pad2(day)}T${pad2(h % 24)}:00`);
    temperature_2m.push(tempAt(h));
    pop.push(h % 7 === 0 ? null : (h * 13) % 100);
    code.push(3);
  }
  return {
    current: { time: "2026-10-02T20:15", temperature_2m: tempAt(20), relative_humidity_2m: 69, apparent_temperature: 22,
               is_day: 0, weather_code: 3, wind_speed_10m: 9, wind_direction_10m: 40 },
    hourly: { time, temperature_2m, precipitation_probability: pop, weather_code: code },
    daily: { time: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"],
             weather_code: [0, 3, 53, 61, 95, 71], temperature_2m_max: [25, 23, 24, 22, 22, 9],
             temperature_2m_min: [18, 20, 19, 21, 16, 2], precipitation_probability_max: [0, 16, 39, null, 94, 50] },
  };
}

test("parseForecast: hourly starts at the current hour, daily at today, null pop -> 0", () => {
  const w = parseForecast(PLACE, forecast(), new Date(2026, 9, 2, 20, 16));
  assert.equal(w.hourly.length, 24);
  assert.equal(w.hourly[0].time, "2026-10-02T20:00");
  assert.equal(w.hourly[23].time, "2026-10-03T19:00");
  assert.deepEqual(w.daily.map((d) => d.date), ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.equal(w.daily[2].pop, 0);
  assert.equal(w.current.isDay, false);
  assert.ok(w.hourly.every((h) => Number.isFinite(h.pop)));
});

test("describeCode: every WMO code Open-Meteo returns has a Chinese description", () => {
  const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  for (const c of codes) assert.notEqual(describeCode(c).text, "未知", `code ${c}`);
  assert.equal(describeCode(0).icon, "clear");
  assert.equal(describeCode(63).icon, "rain");
  assert.equal(describeCode(99).icon, "thunder");
});

test("wind: direction (where it comes from) and Beaufort level", () => {
  assert.equal(windDirection(0), "北风");
  assert.equal(windDirection(40), "东北风");
  assert.equal(windDirection(-90), "西风");
  assert.equal(windDirection(359), "北风");
  assert.equal(windLevel(0), 0);
  assert.equal(windLevel(9), 2);
  assert.equal(windLevel(40), 6);
  assert.equal(windLevel(200), 12);
});

test("weather icons stay inside their square at every size", () => {
  const kinds: IconKind[] = ["clear", "partly", "cloudy", "fog", "rain", "snow", "thunder"];
  for (const size of [16, 24, 32, 64, 120]) for (const kind of kinds) for (const isDay of [true, false]) {
    const c = new Canvas(size + 40, size + 40);
    drawWeatherIcon(c, kind, isDay, 20, 20, size);
    let ink = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (c.get(x, y) === Ink.White) continue;
      ink++;
      const inside = x >= 20 && x < 20 + size && y >= 20 && y < 20 + size;
      assert.ok(inside, `${kind}/${isDay ? "day" : "night"}@${size}: pixel at ${x - 20},${y - 20}`);
    }
    assert.ok(ink > 0, `${kind}@${size} drew nothing`);
  }
});

test("weather screen renders on both panels (incl. negative and two-digit negative temps)", () => {
  const curves = [(h: number) => 20 + 4 * Math.sin(h / 4), (h: number) => -3 + 2 * Math.cos(h / 3), (h: number) => -15 + h / 10];
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) for (const f of curves) {
    const weather = parseForecast(PLACE, forecast(f), new Date(2026, 9, 2, 20, 16));
    const c = renderWeather(panel, { now: new Date(2026, 9, 2, 20, 16), batteryV: 3.9, weather });
    let black = 0;
    for (const v of c.px) if (v === Ink.Black) black++;
    assert.ok(black > 1000, `${panel.id}: too little ink`);
  }
});

test("weather screen without data shows the note instead of crashing", () => {
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    const c = renderWeather(panel, { now: new Date(2026, 9, 2), weatherNote: "请在管理页面设置城市" });
    assert.ok(c.px.some((v) => v === Ink.Black));
  }
});

test("admin: set and clear the weather place; malformed input is ignored", async () => {
  const db = openDb(":memory:");
  const app = createApp(db, { testUser: true, now: () => new Date(2026, 9, 2, 10) });
  addScreen(db);
  const post = (place: string) => app.request("/admin/place", { method: "POST", body: new URLSearchParams({ dev: SCREEN, place }) });
  assert.equal((await post(JSON.stringify(PLACE))).status, 302);
  assert.equal(me(() => getPlace(db))?.name, "上海");
  await post("{not json");
  await post(JSON.stringify({ name: "x", lat: "a", lon: 1, timezone: "UTC" }));
  assert.equal(me(() => getPlace(db))?.name, "上海");
  await post("");
  assert.equal(me(() => getPlace(db)), undefined);
});

test("rain-chance bar colour: more red with higher chance, never black", async () => {
  const { popTone } = await import("../src/screens/weather.js");
  for (const four of [true, false]) {
    let prevRed = -1, prevInk = -1;
    for (let p = 0; p <= 100; p += 5) {
      const t = popTone(p, four);
      const red = t.find(([i]) => i === Ink.Red)?.[1] ?? 0;
      const ink = t.reduce((a, [, w]) => a + w, 0);
      assert.ok(red >= prevRed - 1e-9 && ink >= prevInk - 1e-9, `${four} ${p}`);
      assert.ok(ink <= 1 + 1e-9 && !t.some(([i]) => i === Ink.Black));
      prevRed = red; prevInk = ink;
    }
  }
});

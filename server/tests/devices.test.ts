import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, getDevice, registerDevice, touchDevice } from "../src/db.js";
import { createApp } from "../src/app.js";
import { getSettings, saveSettings, sanitizeSettings, pickMode, activeItems, itemActive, pinUntil } from "../src/data/devices.js";

const MAC = "12:34:56:AB:CD:01";
const at = (h: number, m = 0, day = 5) => new Date(2026, 9, day, h, m); // 2026-10-05 is a Monday

function setup() {
  const db = openDb(":memory:");
  registerDevice(db, MAC);
  touchDevice(db, MAC, { panel: "se0398", width: 768, height: 552, colors: 4 });
  const dev = () => getDevice(db, MAC)!;
  const set = (patch: Parameters<typeof sanitizeSettings>[0]) => saveSettings(db, MAC, sanitizeSettings(patch, getSettings(db, dev())));
  return { db, dev, set };
}

test("time windows (incl. past midnight) and day filters", () => {
  assert.ok(itemActive({ mode: "a", from: "07:00", to: "08:30" }, at(7, 59)));
  assert.ok(!itemActive({ mode: "a", from: "07:00", to: "08:30" }, at(8, 30)));
  assert.ok(itemActive({ mode: "a", from: "22:00", to: "06:00" }, at(23)));
  assert.ok(itemActive({ mode: "a", from: "22:00", to: "06:00" }, at(5)));
  assert.ok(!itemActive({ mode: "a", from: "22:00", to: "06:00" }, at(12)));
  assert.ok(!itemActive({ mode: "a", days: "weekend" }, at(12)));          // Monday
  assert.ok(itemActive({ mode: "a", days: "weekend" }, at(12, 0, 4)));     // Sunday
});

test("playlist: windowed items win while open, untimed ones rotate on every refresh", () => {
  const { db, dev, set } = setup();
  set({ playlist: [{ mode: "weather" }, { mode: "calendar" }, { mode: "agenda", from: "07:00", to: "08:00" }], rotate: "refresh" });
  assert.deepEqual(activeItems(getSettings(db, dev()), at(7, 30)).map((i) => i.mode), ["agenda"]);
  assert.equal(pickMode(db, dev(), at(7, 30), true).mode, "agenda");
  const seq = [0, 1, 2, 3].map(() => pickMode(db, dev(), at(12), true).mode);
  assert.deepEqual(seq, ["weather", "calendar", "weather", "calendar"]);
  // previews do not move the rotation
  const before = pickMode(db, dev(), at(12), false).mode;
  assert.equal(pickMode(db, dev(), at(12), false).mode, before);
});

test("playlist: rotation every N minutes follows the clock", () => {
  const { db, dev, set } = setup();
  set({ playlist: [{ mode: "weather" }, { mode: "calendar" }], rotate: 60 });
  assert.notEqual(pickMode(db, dev(), at(10, 5), true).mode, pickMode(db, dev(), at(11, 5), true).mode);
  assert.equal(pickMode(db, dev(), at(10, 5), true).mode, pickMode(db, dev(), at(10, 55), true).mode);
});

test("pins: once is used up by a real request, timed ones expire", () => {
  const { db, dev, set } = setup();
  set({ playlist: [{ mode: "weather" }] });
  saveSettings(db, MAC, { ...getSettings(db, dev()), pin: { mode: "messages", ...pinUntil("once", at(9)) } });
  assert.equal(pickMode(db, dev(), at(9), false).mode, "messages"); // preview: still pinned
  assert.equal(pickMode(db, dev(), at(9), true).mode, "messages");
  assert.equal(pickMode(db, dev(), at(9, 15), true).mode, "weather");
  saveSettings(db, MAC, { ...getSettings(db, dev()), pin: { mode: "poetry", ...pinUntil("1h", at(9)) } });
  assert.equal(pickMode(db, dev(), at(9, 30), true).mode, "poetry");
  assert.equal(pickMode(db, dev(), at(10, 30), true).mode, "weather");
  assert.equal(getSettings(db, dev()).pin, undefined);
});

test("settings are sanitised: bad times, unknown fonts, schedule bounds", () => {
  const { db, dev, set } = setup();
  set({ name: "  客厅  ", playlist: [{ mode: "weather", from: "25:00", to: "08:00" }], font: "comic" as never,
        schedule: { dayStartHour: 22, dayEndHour: 7, dayMinutes: 1, nightMinutes: 99999 } });
  const s = getSettings(db, dev());
  assert.equal(s.name, "客厅");
  assert.deepEqual(s.playlist, [{ mode: "weather" }]);
  assert.equal(s.font, "wenkai");
  assert.deepEqual(s.schedule, { dayStartHour: 22, dayEndHour: 23, dayMinutes: 10, nightMinutes: 1440 });
});

test("admin: device page saves the playlist form; push, unpin, previews, dashboard", async () => {
  const { db, dev } = setup();
  const now = () => at(12);
  const app = createApp(db, { testUser: true, now });
  const form = new URLSearchParams();
  for (const [m, f, t] of [["weather", "", ""], ["agenda", "07:00", "08:00"], ["nope", "", ""]]) {
    form.append("mode", m); form.append("from", f); form.append("to", t); form.append("days", "all");
  }
  for (const [k, v] of Object.entries({ rotate: "60", dayStartHour: "6", dayEndHour: "23", dayMinutes: "20", nightMinutes: "180" })) form.append(k, v);
  assert.equal((await app.request(`/admin/devices/${MAC}`, { method: "POST", body: form })).status, 302);
  await app.request(`/admin/devices/${MAC}/display`, { method: "POST", body: new URLSearchParams({ name: "书房", font: "sans", live: "on" }) });
  const s = getSettings(db, dev());
  assert.deepEqual(s.playlist.map((i) => i.mode), ["weather", "agenda"]); // unknown mode dropped
  assert.deepEqual([s.rotate, s.name, s.font, s.live, s.schedule.dayMinutes], [60, "书房", "sans", true, 20]);
  // compat config reports live mode
  assert.deepEqual(await (await app.request(`/api/config/${MAC}`)).json(), { is_focus_listening: false, is_always_active: true });

  await app.request("/admin/modes/poetry/push", { method: "POST", body: new URLSearchParams({ mac: MAC, for: "forever" }) });
  assert.equal(getSettings(db, dev()).pin?.mode, "poetry");
  await app.request(`/admin/devices/${MAC}/unpin`, { method: "POST" });
  assert.equal(getSettings(db, dev()).pin, undefined);

  const png = await app.request(`/preview/device/${MAC}.png`);
  assert.equal(png.headers.get("content-type"), "image/png");
  for (const path of ["/", `/devices/${MAC}`, `/devices/${MAC}?tab=content`, `/devices/${MAC}?tab=device`, "/modes", "/photos", "/messages", "/todo", "/settings"]) {
    const r = await app.request(path);
    assert.equal(r.status, 200, path);
    assert.match(await r.text(), /<nav>/, path);
  }
  assert.match(await (await app.request("/")).text(), /书房/);

  // quick message from the dashboard pins the message board on every device
  await app.request("/admin/messages", { method: "POST", body: new URLSearchParams({ text: "早点回家", from: "妈妈", push: "on" }) });
  assert.equal(getSettings(db, dev()).pin?.mode, "messages");
});

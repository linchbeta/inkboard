// What a screen shows is its own: each layout's content is per screen, screens can be
// synced per layout, messages go to chosen screens, photos are picked per screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, registerDevice, touchDevice, getDevice, rawSetting, getSetting, setSetting } from "../src/db.js";
import { createApp } from "../src/app.js";
import { prepareScreen, SCREENS } from "../src/frames.js";
import { getModeConfig } from "../src/data/modeConfig.js";
import { asDevice } from "../src/data/content.js";
import { getSettings, pickMode, saveSettings, sanitizeSettings } from "../src/data/devices.js";
import { runAs } from "../src/scope.js";
import type { TodoGroup } from "../src/screens/todo.js";
import type { Message } from "../src/data/messages.js";

const A = "12:34:56:AB:CD:01", B = "12:34:56:AB:CD:02", C = "12:34:56:AB:CD:03";
const now = new Date(2026, 9, 3, 9);

function setup() {
  const db = openDb(":memory:");
  const app = createApp(db, { testUser: true, now: () => now }); // user 1 owns the screens
  for (const [mac, panel, w, h, c] of [[A, "se0398", 768, 552, 4], [B, "hink42_bwr", 400, 300, 3], [C, "se0398", 768, 552, 4]] as const) {
    registerDevice(db, mac);
    touchDevice(db, mac, { panel, width: w, height: h, colors: c });
    db.prepare("UPDATE device SET owner_id = 1 WHERE mac = ?").run(mac);
  }
  const post = (path: string, body: Record<string, string | string[]>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) for (const x of ([] as string[]).concat(v)) p.append(k, x);
    return app.request(path, { method: "POST", body: p });
  };
  const json = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  /** What a screen's layout gets to show. */
  const data = <T>(mac: string, mode: string) => runAs(1, () => asDevice(mac, async () => (await prepareScreen(db, mode, now)).data as T));
  const title = async (mac: string) => (await data<{ title: string }>(mac, "todo")).title;
  return { db, app, post, json, data, title };
}

test("each screen has its own content; editing one changes no other", async () => {
  const { db, post, json, title } = setup();
  await json("/admin/todo", { dev: A, title: "客厅", groups: [{ name: "家务", items: [{ text: "扫地" }] }] });
  await json("/admin/todo", { dev: B, title: "小明", groups: [] });
  assert.deepEqual([await title(A), await title(B), await title(C)], ["客厅", "小明", "待办"]);
  assert.equal((await json("/admin/todo", { title: "x", groups: [] })).status, 404); // a screen must be named

  await post("/admin/modes/countdown", { dev: A, events: "2027-01-01 元旦" });
  const events = (mac: string) => runAs(1, () => asDevice(mac, () => getModeConfig(db, "countdown", SCREENS.countdown.config).events));
  assert.equal(events(A), "2027-01-01 元旦");
  assert.notEqual(events(B), "2027-01-01 元旦");
  assert.equal((await post("/admin/modes/countdown", { events: "x" })).status, 404);
  assert.equal((await post("/admin/modes/countdown", { dev: "11:22:33:44:55:66", events: "x" })).status, 404);
});

test("sync: screens share a layout's content until unsynced; others keep theirs", async () => {
  const { db, app, post, json, title } = setup();
  await json("/admin/todo", { dev: A, title: "客厅", groups: [] });
  await json("/admin/todo", { dev: C, title: "书房", groups: [] });
  // A syncs with B: B takes A's list; C is untouched
  const r = await post(`/admin/devices/${A}/sync/todo`, { with: [B] });
  assert.match(r.headers.get("location") ?? "", /tab=content/);
  assert.deepEqual([await title(A), await title(B), await title(C)], ["客厅", "客厅", "书房"]);
  // an edit on either side reaches both
  await json("/admin/todo", { dev: B, title: "家里", groups: [] });
  assert.deepEqual([await title(A), await title(B), await title(C)], ["家里", "家里", "书房"]);
  const page = await (await app.request(`/todo?dev=${A}`)).text();
  assert.match(page, /同步/);
  // B leaves (from A's page): keeps its copy, edits no longer travel
  await post(`/admin/devices/${A}/sync/todo`, {});
  await json("/admin/todo", { dev: A, title: "只改A", groups: [] });
  assert.deepEqual([await title(A), await title(B)], ["只改A", "家里"]);

  // poetry: 换一首 on synced screens moves both, not the third
  await post(`/admin/devices/${A}/sync/poetry`, { with: [C] });
  const poem = (mac: string) => runAs(1, () => asDevice(mac, async () => ((await prepareScreen(db, "poetry", now)).data as { title: string }).title));
  const [a0, b0] = [await poem(A), await poem(B)];
  await post("/admin/modes/poetry/action/next", { dev: C });
  assert.notEqual(await poem(A), a0);
  assert.equal(await poem(A), await poem(C));
  assert.equal(await poem(B), b0);

  // the weather city: 日期牌 and 天气 share it per screen
  const place = JSON.stringify({ name: "上海", lat: 31.2, lon: 121.5, timezone: "Asia/Shanghai" });
  await post("/admin/place", { dev: A, place });
  const city = (mac: string) => runAs(1, () => asDevice(mac, () => getSetting(db, "weather_place", "")));
  assert.match(city(A), /上海/);
  assert.equal(city(B), "");
  await post(`/admin/devices/${A}/sync/datecard`, { with: [B] });
  assert.match(city(B), /上海/);

  // unbinding takes a screen out of its content
  await post(`/admin/devices/${C}/delete`, {});
  assert.equal(rawSetting(db, `d:${C}:mode:poetry`), undefined);
  await post("/admin/modes/poetry/action/next", { dev: A }); // writes only to owned screens
  assert.equal(rawSetting(db, `d:${C}:mode:poetry`), undefined);
});

test("content tab shows each playlist layout with its editor and sync choices", async () => {
  const { db, app, post } = setup();
  const d = getDevice(db, A)!;
  saveSettings(db, A, sanitizeSettings({ playlist: [{ mode: "todo" }, { mode: "countdown" }, { mode: "weather" }, { mode: "messages" }, { mode: "photo" }, { mode: "calendar" }] }, getSettings(db, d)));
  await post(`/admin/devices/${A}/sync/countdown`, { with: [B] });
  const html = await (await app.request(`/devices/${A}?tab=content`)).text();
  for (const m of ["todo", "countdown", "weather", "messages", "photo", "calendar"]) assert.match(html, new RegExp(`id="c-${m}"`));
  assert.match(html, /与 4\.2 寸屏 同步/);
  assert.match(html, /多屏同步/);
  assert.doesNotMatch(html, /本屏专用|所有屏共用/);
  // the layout library adds a layout to several screens at once
  await post("/admin/modes/agenda/add", { mac: [A, B] });
  assert.ok(getSettings(db, getDevice(db, B)!).playlist.some((i) => i.mode === "agenda"));
  assert.ok(getSettings(db, getDevice(db, A)!).playlist.some((i) => i.mode === "agenda"));
  // a playlist applied to other screens too
  const form = { mode: ["news", "words"], from: ["", ""], to: ["", ""], days: ["all", "all"], order: "random", rotate: "60",
    dayStartHour: "7", dayEndHour: "22", dayMinutes: "30", nightMinutes: "120", also: [C] };
  await post(`/admin/devices/${A}`, form);
  assert.deepEqual(getSettings(db, getDevice(db, C)!).playlist.map((i) => i.mode), ["news", "words"]);
  assert.equal(getSettings(db, getDevice(db, C)!).order, "random");
});

test("playlist order: sequence, random (never the same twice in a row), single", () => {
  const { db } = setup();
  const set = (order: "sequence" | "random" | "single", rotate: "refresh" | number) =>
    saveSettings(db, A, sanitizeSettings({ playlist: [{ mode: "news" }, { mode: "words" }, { mode: "poetry" }], order, rotate }, getSettings(db, getDevice(db, A)!)));
  const run = (k: number, advance = true) => Array.from({ length: k }, (_, i) => pickMode(db, getDevice(db, A)!, new Date(2026, 9, 3, 9, i * 60), advance).mode);
  set("sequence", "refresh");
  assert.deepEqual(run(4), ["news", "words", "poetry", "news"]);
  set("single", "refresh");
  assert.deepEqual(run(3), ["news", "news", "news"]);
  set("random", "refresh");
  const r = run(60);
  for (let i = 1; i < r.length; i++) assert.notEqual(r[i], r[i - 1]);
  assert.equal(new Set(r).size, 3);
  set("random", 60); // one per hour, repeatable
  const h = run(48, false);
  assert.deepEqual(h, run(48, false));
  for (let i = 1; i < h.length; i++) assert.notEqual(h[i], h[i - 1]);
});

test("messages to any screens", async () => {
  const { post, data, app } = setup();
  await post("/admin/messages", { text: "大家好", targets: "1", to: [A, B, C] }); // all ticked: everyone
  await post("/admin/messages", { text: "给两块屏", targets: "1", to: [A, B], push: "on" });
  await post("/admin/messages", { text: "给C", targets: "1", to: [C] });
  const r = await post("/admin/messages", { text: "没选", targets: "1" });
  assert.match(decodeURIComponent(r.headers.get("location") ?? ""), /至少选择/);
  const texts = async (mac: string) => (await data<Message[]>(mac, "messages")).map((m) => m.text);
  assert.deepEqual(await texts(A), ["给两块屏", "大家好"]);
  assert.deepEqual(await texts(C), ["给C", "大家好"]);
  assert.doesNotMatch(await (await app.request(`/messages?to=${encodeURIComponent(C)}`)).text(), /给两块屏/);
  assert.match(await (await app.request("/")).text(), new RegExp(A)); // the full MAC on the dashboard
});

test("photos are picked per screen; old per-user photo settings still apply", async () => {
  const { db, app, post } = setup();
  const { rgbPng } = await import("../src/render/pack.js");
  const { addPhoto, currentPhotoId, getPlayback } = await import("../src/data/photos.js");
  const png = rgbPng({ width: 8, height: 6, rgb: new Uint8Array(8 * 6 * 3).fill(128) });
  const [p1, p2, p3] = runAs(1, () => [addPhoto(db, png, "一"), addPhoto(db, png, "二"), addPhoto(db, png, "三")].map((p) => p.id));
  const seen = (mac: string) => new Set([0, 1, 2, 3, 4, 5].map((h) => runAs(1, () => asDevice(mac, () => currentPhotoId(db, new Date(2026, 9, 3, h))))));

  // settings saved before photos were per screen still apply to every screen
  runAs(1, () => { setSetting(db, "photo_mode", "fixed"); setSetting(db, "photo_current", String(p3)); setSetting(db, "photo_style", "full"); });
  assert.deepEqual([...seen(A)], [p3]);
  assert.equal(runAs(1, () => asDevice(B, () => getPlayback(db).style)), "full");

  await post("/admin/photo-settings", { dev: A, style: "frame", order: "sequence", interval: "60", sel: "some", pick: [String(p2)] });
  await post("/admin/photo-settings", { dev: B, style: "full", order: "sequence", interval: "60", sel: "all" });
  assert.deepEqual([...seen(A)], [p2]);
  assert.deepEqual([...seen(B)].sort(), [p1, p2, p3]);
  assert.deepEqual([...seen(C)], [p3]); // untouched
  assert.equal((await post("/admin/photo-settings", { sel: "all" })).status, 404);

  saveSettings(db, A, sanitizeSettings({ playlist: [{ mode: "photo" }] }, getSettings(db, getDevice(db, A)!)));
  const html = await (await app.request(`/devices/${A}?tab=content`)).text();
  assert.match(html, new RegExp(`name="pick" value="${p2}" checked`));
  assert.match(await (await app.request("/photos")).text(), /在 3\.98 寸屏 1 播放/);
  assert.equal((await app.request(`/photos/${p1}/source.png?thumb=1`)).status, 200);
});

test("poems and words: a new one on every device refresh, previews leave it", async () => {
  const { cycleIndex } = await import("../src/data/rotation.js");
  for (let n = 1; n <= 300; n++) {
    const seen = new Set(Array.from({ length: n }, (_, c) => cycleIndex(c, n, 5)));
    assert.equal(seen.size, n, `permutation of ${n}`);
  }
  const { db, app } = setup();
  const key = getDevice(db, A)!.key;
  saveSettings(db, A, sanitizeSettings({ playlist: [{ mode: "poetry" }] }, getSettings(db, getDevice(db, A)!)));
  const render = () => app.request(`/api/render?mac=${A}&w=768&h=552&colors=4&bpp=2`, { headers: { "X-Device-Token": key } });
  const poem = () => runAs(1, () => asDevice(A, async () => ((await prepareScreen(db, "poetry", now)).data as { title: string }).title));
  const titles: string[] = [];
  for (let i = 0; i < 5; i++) { await render(); titles.push(await poem()); }
  assert.equal(new Set(titles).size, 5);
  assert.equal(rawSetting(db, `d:${A}:counter:poetry`), "5");
  await app.request(`/preview/device/${A}.png`); // a preview does not move it on
  assert.equal(rawSetting(db, `d:${A}:counter:poetry`), "5");
  // "每天一首" keeps the day's poem
  runAs(1, () => asDevice(A, () => setSetting(db, "mode:poetry", JSON.stringify({ pick: "daily" }))));
  const d0 = await poem();
  await render(); await render();
  assert.equal(await poem(), d0);
});

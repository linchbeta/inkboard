// Accounts: first-run setup adopts the existing data, login, pairing a device by the code
// on its screen, and isolation between users (devices, photos, messages, settings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, registerDevice, touchDevice, getDevice, setSetting, getSetting } from "../src/db.js";
import { createApp } from "../src/app.js";
import { createUser } from "../src/data/users.js";
import { addMessage, listMessages } from "../src/data/messages.js";
import { getModeConfig } from "../src/data/modeConfig.js";
import { parseTodo } from "../src/screens/todo.js";
import { SCREENS } from "../src/frames.js";
import { runAs } from "../src/scope.js";

const A = "12:34:56:AB:CD:01", B = "12:34:56:AB:CD:02";
const now = () => new Date(2026, 9, 3, 9);

function device(db: ReturnType<typeof openDb>, mac: string) {
  registerDevice(db, mac);
  touchDevice(db, mac, { panel: "se0398", width: 768, height: 552, colors: 4 });
  return getDevice(db, mac)!.key;
}
const render = (app: ReturnType<typeof createApp>, mac: string, key: string) =>
  app.request(`/api/render?mac=${mac}&w=768&h=552&colors=4&bpp=2`, { headers: { "X-Device-Token": key } });

/** A browser session: keeps the cookie, follows nothing. */
function browser(app: ReturnType<typeof createApp>) {
  let cookie = "";
  const req = async (path: string, init: RequestInit = {}) => {
    const r = await app.request(path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) } });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const post = (path: string, body: Record<string, string>) => req(path, { method: "POST", body: new URLSearchParams(body) });
  return { req, post };
}

test("setup: the first account adopts the data that existed before accounts", async () => {
  const db = openDb(":memory:");
  const key = device(db, A);
  addMessage(db, "妈妈", "旧留言", now());
  setSetting(db, "mode:countdown", JSON.stringify({ events: "2027-01-01 元旦" }));
  const app = createApp(db, { now });
  const b = browser(app);
  assert.equal((await b.req("/")).headers.get("location"), "/setup");
  assert.equal((await b.req("/healthz")).status, 200);
  // before any account a device shows the setup hint, not someone's data
  assert.equal((await render(app, A, key)).headers.get("x-mode-id"), "PAIR");

  assert.equal((await b.post("/setup", { name: "admin", password: "secret1" })).headers.get("location"), "/");
  assert.equal((await b.req("/")).status, 200);
  assert.match(await (await b.req("/messages")).text(), /旧留言/);
  assert.equal(runAs(1, () => getModeConfig(db, "countdown", SCREENS.countdown.config).events), "2027-01-01 元旦");
  assert.match(await (await b.req("/")).text(), /3\.98 寸屏/); // adopted device, named without its MAC
  assert.notEqual((await render(app, A, key)).headers.get("x-mode-id"), "PAIR");
  assert.equal((await b.req("/setup")).headers.get("location"), "/login"); // only once
});

test("login, logout and protected pages", async () => {
  const db = openDb(":memory:");
  createUser(db, "admin", "secret1");
  const app = createApp(db, { now });
  const b = browser(app);
  assert.match((await b.req("/settings")).headers.get("location") ?? "", /^\/login\?next=%2Fsettings/);
  assert.equal((await b.post("/admin/messages", { text: "x" })).status, 401);
  assert.match((await b.post("/login", { name: "admin", password: "wrong!!", next: "/" })).headers.get("location") ?? "", /err=1/);
  assert.equal((await b.post("/login", { name: "ADMIN", password: "secret1", next: "/settings" })).headers.get("location"), "/settings");
  assert.equal((await b.req("/settings")).status, 200);
  assert.equal((await b.post("/login", { name: "admin", password: "secret1", next: "//evil.example" })).headers.get("location"), "/");
  await b.post("/logout", {});
  assert.equal((await b.req("/settings")).status, 302);
});

test("two users: pairing by code, and each sees only their own devices and data", async () => {
  const db = openDb(":memory:");
  const app = createApp(db, { now });
  const admin = browser(app), kid = browser(app);
  await admin.post("/setup", { name: "admin", password: "secret1" });
  await admin.post("/admin/users", { name: "小明", password: "secret2" });
  await kid.post("/login", { name: "小明", password: "secret2", next: "/" });

  // two new screens: with two accounts nobody gets them automatically, they show a code
  const ka = device(db, A), kb = device(db, B);
  const ra = await render(app, A, ka);
  assert.equal(ra.headers.get("x-mode-id"), "PAIR");
  const codeA = getDevice(db, A)!.pair_code!, codeB = (await render(app, B, kb), getDevice(db, B)!.pair_code!);
  assert.match(codeA, /^\d{6}$/);

  assert.match((await admin.post("/admin/pair", { code: "000000" })).headers.get("location") ?? "", /flash=/);
  assert.equal((await admin.post("/admin/pair", { code: codeA })).headers.get("location")?.split("?")[0], `/devices/${A}`);
  await kid.post("/admin/pair", { code: codeB.slice(0, 3) + " " + codeB.slice(3) }); // spaces are fine
  assert.equal(getDevice(db, A)!.owner_id, 1);
  assert.equal(getDevice(db, B)!.owner_id, 2);
  assert.match((await admin.post("/admin/pair", { code: codeB })).headers.get("location") ?? "", /^\/\?flash=/); // already taken

  // devices
  assert.equal((await admin.req(`/devices/${A}`)).status, 200);
  assert.equal((await admin.req(`/devices/${B}`)).status, 404);
  assert.equal((await kid.req(`/devices/${A}`)).status, 404);
  assert.equal((await kid.req(`/preview/device/${A}.png`)).status, 404);
  await kid.post(`/admin/devices/${A}/pin`, { mode: "poetry", for: "forever" });
  await kid.post(`/admin/devices/${A}/delete`, {});
  assert.equal(getDevice(db, A)!.owner_id, 1); // untouched
  await kid.post("/admin/modes/poetry/push", { mac: A, for: "forever" });
  assert.equal(JSON.parse(getDevice(db, A)!.settings ?? "{}").pin, undefined);

  // data: messages, mode settings
  await admin.post("/admin/messages", { from: "妈妈", text: "给大人看的" });
  await kid.post("/admin/modes/countdown", { dev: B, events: "2027-02-01 小明生日" });
  assert.equal((await kid.post("/admin/modes/countdown", { dev: A, events: "x" })).status, 404); // not the kid's screen
  assert.doesNotMatch(await (await kid.req("/messages")).text(), /给大人看的/);
  assert.match(await (await admin.req("/messages")).text(), /给大人看的/);
  assert.deepEqual([runAs(1, () => listMessages(db).length), runAs(2, () => listMessages(db).length)], [1, 0]);
  assert.notEqual(runAs(1, () => getModeConfig(db, "countdown", SCREENS.countdown.config).events), "2027-02-01 小明生日");
  assert.equal(getSetting(db, `d:${B}:mode:countdown`, "").includes("小明生日"), true);

  // each screen renders for its owner: the kid's message board shows nothing of the admin's
  await admin.post(`/admin/devices/${A}/pin`, { mode: "messages", for: "forever" });
  await kid.post(`/admin/devices/${B}/pin`, { mode: "messages", for: "forever" });
  assert.equal((await render(app, A, ka)).headers.get("x-mode-id"), (await render(app, B, kb)).headers.get("x-mode-id"));

  // only the administrator manages users
  assert.equal((await kid.post("/admin/users", { name: "x", password: "secret3" })).status, 403);
  assert.equal((await kid.post("/admin/users/1/delete", {})).status, 403);
  assert.doesNotMatch(await (await kid.req("/settings")).text(), /id="users"/);
  assert.match(await (await admin.req("/settings")).text(), /小明/);

  // unbinding gives the device back to pairing, with its key (no re-registration)
  await kid.post(`/admin/devices/${B}/delete`, {});
  assert.equal(getDevice(db, B)!.owner_id, null);
  assert.equal((await render(app, B, kb)).headers.get("x-mode-id"), "PAIR");
});

test("todo editor: title, groups and items saved from JSON, junk dropped", async () => {
  const db = openDb(":memory:");
  const app = createApp(db, { testUser: true, now });
  device(db, A);
  db.prepare("UPDATE device SET owner_id = 1").run();
  const save = (body: unknown) => app.request("/admin/todo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const r = await save({ dev: A, title: "作业", groups: [
    { name: "## 小明", items: [{ text: "数学", done: true }, { text: "  " }, { text: "语文\n背诵", done: "yes" }] },
    { name: "", items: [] }, "junk",
    { name: "家务", items: [{ text: "# 扫地" }] },
  ] });
  assert.equal(r.status, 200);
  const cfg = runAs(1, () => getModeConfig(db, "todo", SCREENS.todo.config), A);
  assert.equal(cfg.title, "作业");
  assert.deepEqual(parseTodo(cfg.list), [
    { name: "小明", items: [{ text: "数学", done: true }, { text: "语文 背诵", done: false }] },
    { name: "家务", items: [{ text: "扫地", done: false }] },
  ]);
  assert.equal((await app.request("/admin/todo", { method: "POST", body: "nope", headers: { "Content-Type": "application/json" } })).status, 400);
  const page = await (await app.request("/todo")).text();
  assert.match(page, /id="data">\[\{"name":"小明"/);
  const png = await app.request(`/preview/se0398.png?screen=todo&dev=${A}`);
  assert.equal(png.status, 200);
});

// End-to-end API tests against an in-memory database, replaying what the current
// InkSight firmware sends (see firmware/src/network.cpp) and the v1 protocol.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { sleepSeconds, refreshMinutes, nextWakeUnix } from "../src/schedule.js";

const MAC = "12:34:56:AB:CD:02";
const fixedNow = () => new Date(2026, 9, 2, 10, 7, 30); // 2026-10-02 10:07:30 local

function setup() {
  const app = createApp(openDb(":memory:"), { testUser: true, now: fixedNow });
  const req = (path: string, init: RequestInit = {}) => app.request(path, init);
  return { app, req };
}

test("compat: full firmware sequence (token, pair, heartbeat, config, render)", async () => {
  const { req } = setup();

  const tok = await (await req(`/api/device/${MAC}/token`, { method: "POST", body: "{}" })).json() as { token: string };
  assert.match(tok.token, /^[0-9a-f]{32}$/);
  const auth = { "X-Device-Token": tok.token };

  // Pair code must be echoed back exactly, or the firmware retries 3x on every wake
  const pair = await (await req(`/api/device/${MAC}/claim-token`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ pair_code: "346736" }),
  })).json() as { pair_code: string };
  assert.equal(pair.pair_code, "346736");

  const hb = await req(`/api/device/${MAC}/heartbeat`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ battery_voltage: 4.13, wifi_rssi: -42 }),
  });
  assert.equal(hb.status, 200);

  const cfg = await (await req(`/api/config/${MAC}`, { headers: auth })).json() as Record<string, boolean>;
  assert.equal(cfg.is_focus_listening, false);
  assert.equal(cfg.is_always_active, false);

  const state = await (await req(`/api/device/${MAC}/state`, { headers: auth })).json() as Record<string, unknown>;
  assert.equal(state.runtime_mode, "interval");

  // 3.98" B/W/Y/R: raw 2bpp, exactly W*H/4 bytes
  const r398 = await req(`/api/render?v=4.13&mac=${MAC}&rssi=-42&refresh_min=10&w=768&h=552&bpp=2&colors=4`, { headers: auth });
  assert.equal(r398.status, 200);
  assert.equal((await r398.arrayBuffer()).byteLength, 105984);
  const refresh = Number(r398.headers.get("X-Refresh-Minutes"));
  assert.ok(refresh >= 10 && refresh <= 1440, `X-Refresh-Minutes ${refresh}`);
  // 10:07:30 -> the 10:15 boundary
  assert.equal(r398.headers.get("X-Next-Wake"), String(new Date(2026, 9, 2, 10, 15).getTime() / 1000));
  assert.equal(r398.headers.get("X-Mode-Id"), "DATECARD"); // a new device's default playlist

  // the same frame again with its ETag: 304, no body (no download, no refresh)
  const etag = r398.headers.get("ETag")!;
  assert.match(etag, /^"[0-9a-f]+"$/);
  const again = await req(`/api/render?v=4.13&mac=${MAC}&rssi=-42&refresh_min=10&w=768&h=552&bpp=2&colors=4`,
    { headers: { ...auth, "If-None-Match": etag } });
  assert.equal(again.status, 304);
  assert.equal((await again.arrayBuffer()).byteLength, 0);
  assert.equal(again.headers.get("X-Mode-Id"), "DATECARD");
  assert.ok(Number(again.headers.get("X-Refresh-Minutes")) >= 10);
  assert.equal(again.headers.get("X-Next-Wake"), r398.headers.get("X-Next-Wake"));
  const changed = await req(`/api/render?v=4.13&mac=${MAC}&rssi=-42&refresh_min=10&w=768&h=552&bpp=2&colors=4`,
    { headers: { ...auth, "If-None-Match": '"stale"' } });
  assert.equal(changed.status, 200);

  // 4.2" B/W/R: raw 2bpp, 30000 bytes, never code 10 (yellow)
  const r42 = await req(`/api/render?v=4.1&mac=${MAC}&rssi=-40&refresh_min=10&w=400&h=300&bpp=2&colors=3`, { headers: auth });
  const b42 = new Uint8Array(await r42.arrayBuffer());
  assert.equal(b42.length, 30000);
  for (const byte of b42) for (let s = 0; s < 8; s += 2) assert.notEqual((byte >> s) & 3, 0b10);

  // Unknown resolution, B/W firmware: 1-bit BMP
  const rbw = await req(`/api/render?mac=${MAC}&w=296&h=128&bpp=1&colors=2`, { headers: auth });
  const bbw = new Uint8Array(await rbw.arrayBuffer());
  assert.equal(String.fromCharCode(bbw[0], bbw[1]), "BM");
  assert.equal(bbw.length, 62 + 40 * 128);
});

test("compat: wrong or missing token -> 401 (firmware then re-registers)", async () => {
  const { req } = setup();
  await req(`/api/device/${MAC}/token`, { method: "POST" });
  const r = await req(`/api/render?mac=${MAC}&w=400&h=300&bpp=2&colors=3`, { headers: { "X-Device-Token": "nope" } });
  assert.equal(r.status, 401);
});

test("v1: register, frame with ETag, 304 when unchanged, sleep seconds", async () => {
  const { req } = setup();
  const reg = await (await req("/api/v1/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mac: MAC, panel: "se0398_a0", fw: "c3lite-0.1" }),
  })).json() as { device_key: string; status: string };
  assert.equal(reg.status, "active");
  const h = { "X-Device-Id": MAC, "X-Device-Key": reg.device_key, "X-Panel": "se0398_a0",
              "X-Battery-mV": "3987", "X-RSSI": "-61", "X-FW": "c3lite-0.1" };

  const first = await req("/api/v1/frame", { headers: h });
  assert.equal(first.status, 200);
  assert.equal((await first.arrayBuffer()).byteLength, 105984);
  const etag = first.headers.get("ETag")!;
  assert.match(etag, /^"[0-9a-f]{16}"$/);
  assert.equal(first.headers.get("X-Sleep-Seconds"), String(sleepSeconds(fixedNow())));

  const again = await req("/api/v1/frame", { headers: { ...h, "If-None-Match": etag } });
  assert.equal(again.status, 304);
  assert.equal((await again.arrayBuffer()).byteLength, 0);

  const bad = await req("/api/v1/frame", { headers: { ...h, "X-Device-Key": "x" } });
  assert.equal(bad.status, 401);
});

test("schedule: day every 15 min aligned, night 120 min, never past day start", () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 9, 2, h, m, s);
  assert.equal(sleepSeconds(at(10, 7, 30)), (7 * 60 + 30) + 5);  // -> 10:15:05
  assert.equal(sleepSeconds(at(21, 50)), 10 * 60 + 5);           // -> 22:00 (day end)
  assert.equal(sleepSeconds(at(23, 0)), 60 * 60 + 5);            // night step -> 00:00
  assert.equal(sleepSeconds(at(6, 30)), 30 * 60 + 5);            // -> 07:00 day start
  assert.equal(refreshMinutes(at(10, 14, 30)), 10);              // firmware minimum
  assert.equal(nextWakeUnix(at(21, 50)), at(22, 0).getTime() / 1000);
  assert.equal(nextWakeUnix(at(10, 14, 30)), at(10, 15).getTime() / 1000);
});

test("test date: screens draw that day as today; clearing restores the real date", async () => {
  const { req } = setup();
  const form = (date: string) => ({ method: "POST", body: new URLSearchParams({ date }) });
  assert.equal((await req("/admin/test-date", form("2026-02-16"))).status, 302);
  assert.match(await (await req("/settings")).text(), /当前按 <b>2026-02-16<\/b>/);
  await req("/admin/test-date", form(""));
  assert.match(await (await req("/settings")).text(), /当前使用真实日期/);
  await req("/admin/test-date", form("not-a-date"));
  assert.match(await (await req("/settings")).text(), /当前使用真实日期/);
});

test("holidays for the device's offline calendar: published years only", async () => {
  const { req } = setup();
  const r = await req("/api/holidays/2026");
  assert.equal(r.status, 200);
  const lines = (await r.text()).trim().split("\n");
  assert.ok(lines.includes("20261001 1"), "国庆 off");
  assert.ok(lines.includes("20261010 2"), "work day");
  assert.ok(lines.every((l) => /^(2025120[1-9]|202512[1-3]\d|2026\d{4}) [12]$/.test(l)), "the year and the December before");
  assert.equal((await req("/api/holidays/2099")).status, 404);
});

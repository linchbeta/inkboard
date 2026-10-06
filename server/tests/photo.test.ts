import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { decodePng } from "../src/render/png.js";
import { coverResize, ditherImage, testChart, rotate, crop } from "../src/render/image.js";
import { Canvas } from "../src/render/canvas.js";
import { PANELS, Ink } from "../src/panels.js";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { listPhotos, currentPhotoId, sanitizeEdits, setPlayback, addPhoto, updatePhoto, getPhotoInfo } from "../src/data/photos.js";
import { DatabaseSync } from "node:sqlite";
import { renderPhoto } from "../src/screens/photo.js";
import { runAs } from "../src/scope.js";
// per-screen content, read as the test user's (id 1) screen
const SCREEN = "12:34:56:AB:CD:01";
const me = <T>(f: () => T): T => runAs(1, f, SCREEN);
/** Gives the test user a screen (content belongs to screens). */
function addScreen(db: { prepare(sql: string): { run(...a: unknown[]): unknown } }): void {
  db.prepare("INSERT INTO device (mac, key, status, created_at, owner_id) VALUES (?, 'k', 'active', '2026-01-01T00:00:00Z', 1)").run(SCREEN);
}

/** RGBA PNG whose rows use filter types 0..4 in turn (as browsers' encoders do). */
function filteredPng(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const bpp = 4, stride = w * bpp;
  const rows: Buffer[] = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) Buffer.from(px(x, y)).copy(cur, x * bpp);
    const f = y % 5;
    const out = Buffer.alloc(stride + 1);
    out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i + 1] = (cur[i] - pred) & 0xff;
    }
    rows.push(out);
    prev = cur;
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]); // CRC not checked
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const sample = (x: number, y: number): [number, number, number, number] => [(x * 37) & 255, (y * 59) & 255, (x * y) & 255, 255];

test("decodePng: all five row filters, alpha composited onto white", () => {
  const img = decodePng(filteredPng(23, 11, sample));
  assert.equal(img.width, 23);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 23; x++) {
    assert.deepEqual([...img.rgb.slice((y * 23 + x) * 3, (y * 23 + x) * 3 + 3)], sample(x, y).slice(0, 3), `${x},${y}`);
  }
  const clear = decodePng(filteredPng(2, 1, () => [0, 0, 0, 0]));
  assert.deepEqual([...clear.rgb], [255, 255, 255, 255, 255, 255]);
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])));
});

test("coverResize: centre crop to the target aspect, box-averaged", () => {
  // 4x2 source: left half black, right half white -> 1x1 target averages the centre square
  const src = { width: 4, height: 2, rgb: new Uint8Array([0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255]) };
  const out = coverResize(src, 1, 1);
  assert.deepEqual([...out.rgb], [127, 127, 127]);
  assert.equal(coverResize(testChart(300, 200), 768, 552).rgb.length, 768 * 552 * 3);
});

test("ditherImage: clean white and black, mid grey ~half black, never yellow on B/W/R", () => {
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    const solid = (v: number) => ({ width: 40, height: 40, rgb: new Uint8Array(40 * 40 * 3).fill(v) });
    const count = (img: ReturnType<typeof solid>, ink: Ink) => {
      const c = new Canvas(40, 40);
      ditherImage(c, img, 0, 0, panel, { saturation: 1, contrast: 1 });
      return c.px.filter((v) => v === ink).length / 1600;
    };
    assert.equal(count(solid(255), Ink.White), 1);
    assert.equal(count(solid(0), Ink.Black), 1);
    const g = count(solid(128), Ink.Black);
    assert.ok(g > 0.35 && g < 0.65, `${panel.id} grey: ${g}`);
    if (panel.colors === 3) {
      const c = new Canvas(200, 120);
      ditherImage(c, coverResize(testChart(), 200, 120), 0, 0, panel);
      assert.ok(!c.px.includes(Ink.Yellow));
    }
  }
});

test("photo screen: test chart without photos; caption stays inside the panel", () => {
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    const c = renderPhoto(panel, { now: new Date(), photo: { title: "一个很长很长很长很长很长很长很长很长很长很长很长的标题", date: new Date(2026, 9, 2), image: testChart(64, 48), style: "frame" } });
    assert.equal(c.width, panel.width);
    const full = renderPhoto(panel, { now: new Date(), photo: { title: "", image: testChart(64, 48), style: "full" } });
    // full bleed: the corners are photo pixels, not the white mat + keyline
    assert.notEqual([full.get(0, 0), full.get(1, 1)].join(), [Ink.Black, Ink.White].join());
  }
});

test("admin: upload, preview, pin, rotate, delete; non-PNG rejected", async () => {
  const db = openDb(":memory:");
  const app = createApp(db, { testUser: true, now: () => new Date(2026, 9, 2, 10) });
  addScreen(db);
  const playback = (b: Record<string, string>) => app.request("/admin/photo-settings", { method: "POST",
    body: new URLSearchParams({ dev: SCREEN, style: "frame", interval: "60", sel: "all", ...b }) });
  const upload = (bytes: Uint8Array, title: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: "image/png" }), "p.png");
    fd.append("title", title);
    return app.request("/admin/photos", { method: "POST", body: fd });
  };
  const r1 = await upload(filteredPng(64, 48, sample), "海边");
  assert.equal(r1.status, 200);
  const { id } = await r1.json() as { id: number };
  await upload(filteredPng(30, 30, sample), "第二张");
  assert.equal((await upload(new TextEncoder().encode("not a png"), "x")).status, 400);
  assert.deepEqual(me(() => listPhotos(db)).map((p) => p.title), ["海边", "第二张"]);

  const pv = await app.request(`/preview/hink42_bwr.png?screen=photo&photo=${id}`);
  assert.equal(pv.status, 200);
  assert.equal(pv.headers.get("content-type"), "image/png");

  await playback({ order: "fixed", current: String(id) });
  assert.equal(me(() => currentPhotoId(db, new Date(0))), id);
  assert.equal(me(() => currentPhotoId(db, new Date(3_600_000))), id);
  await playback({ order: "sequence" });
  assert.notEqual(me(() => currentPhotoId(db, new Date(0))), me(() => currentPhotoId(db, new Date(3_600_000)))); // hourly rotation

  await app.request(`/admin/photos/${id}/delete`, { method: "POST" });
  assert.deepEqual(me(() => listPhotos(db)).map((p) => p.title), ["第二张"]);
});

test("rotate and crop", () => {
  // 3x2: pixel value = index
  const img = { width: 3, height: 2, rgb: new Uint8Array(18).map((_, i) => Math.floor(i / 3)) };
  const v = (m: { width: number; rgb: Uint8Array }, x: number, y: number) => m.rgb[(y * m.width + x) * 3];
  const r1 = rotate(img, 1); // clockwise: bottom-left (0,1)=3 goes to the top-left
  assert.deepEqual([r1.width, r1.height], [2, 3]);
  assert.deepEqual([v(r1, 0, 0), v(r1, 1, 0), v(r1, 0, 2), v(r1, 1, 2)], [3, 0, 5, 2]);
  assert.deepEqual([...rotate(rotate(img, 1), 3).rgb], [...img.rgb]);
  assert.deepEqual([...rotate(img, 2).rgb].filter((_, i) => i % 3 === 0), [5, 4, 3, 2, 1, 0]);
  const c = crop(img, { x: 1 / 3, y: 0.5, w: 2 / 3, h: 0.5 });
  assert.deepEqual([c.width, c.height, v(c, 0, 0), v(c, 1, 0)], [2, 1, 4, 5]);
  // zoomed out: the box reaches past the image, the outside is white paper
  const z = crop(img, { x: -1 / 3, y: -0.5, w: 5 / 3, h: 2 });
  assert.deepEqual([z.width, z.height], [5, 4]);
  assert.deepEqual([v(z, 0, 0), v(z, 1, 1), v(z, 3, 2), v(z, 4, 3)], [255, 0, 5, 255]);
});

test("sanitizeEdits clamps everything", () => {
  const e = sanitizeEdits({ saturation: 99, contrast: "x", rotate: 7, crop: { x: 0.9, y: -1, w: 5, h: 0 }, evil: 1 });
  assert.equal(e.saturation, 3);
  assert.equal(e.contrast, 1.1);
  assert.equal(e.rotate, 3);
  assert.ok(e.crop.w === 4 && e.crop.y === 0.01 - 0.01 && e.crop.h === 0.01 && e.crop.x === 0.9);
  assert.equal((e as unknown as Record<string, unknown>).evil, undefined);
  assert.deepEqual(sanitizeEdits(null), sanitizeEdits({}));
});

test("playback: sequence order, shuffle plays each photo once per round, never twice in a row", () => {
  const db = openDb(":memory:");
  for (let i = 0; i < 5; i++) addPhoto(db, filteredPng(4, 4, sample), `p${i}`);
  setPlayback(db, { photos: [1, 2, 4, 5] }); // photo 3 not picked
  // a time whose local-time hour slot is `slot` (Date(0)'s offset: China has no DST)
  const at = (slot: number) => currentPhotoId(db, new Date(slot * 3_600_000 + new Date(0).getTimezoneOffset() * 60_000));
  setPlayback(db, { mode: "sequence", intervalMin: 60 });
  const seq = Array.from({ length: 8 }, (_, k) => at(k));
  assert.ok(!seq.includes(3), "a photo not picked must not play");
  assert.equal(new Set(seq.slice(0, 4)).size, 4);
  setPlayback(db, { mode: "random" });
  const rnd = Array.from({ length: 400 }, (_, k) => at(k));
  assert.ok(!rnd.includes(3));
  for (let k = 1; k < rnd.length; k++) assert.notEqual(rnd[k], rnd[k - 1], `repeat at ${k}`);
  // shuffle play: every window of 4 aligned to a round holds all four photos
  const first = rnd.findIndex((_, k) => new Set(rnd.slice(k, k + 4)).size === 4);
  assert.ok(first >= 0 && first < 4);
  for (let k = first; k + 4 <= rnd.length; k += 4) assert.equal(new Set(rnd.slice(k, k + 4)).size, 4);
  assert.notDeepEqual(rnd.slice(first, first + 4), rnd.slice(first + 4, first + 8)); // order changes per round (overwhelmingly likely)
  setPlayback(db, { mode: "fixed", current: 2 });
  assert.equal(at(0), 2);
  assert.equal(at(77), 2);
});

test("edits: saved via API, used by the preview; editor and source pages load", async () => {
  const db = openDb(":memory:");
  const app = createApp(db, { testUser: true, now: () => new Date(2026, 9, 2, 10) });
  const { id } = me(() => addPhoto(db, filteredPng(60, 40, sample), "旧标题"));
  const r = await app.request(`/admin/photos/${id}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "新标题", enabled: false, edits: { rotate: 1, saturation: 2, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } }) });
  assert.equal(r.status, 200);
  const info = me(() => getPhotoInfo(db, id))!;
  assert.deepEqual([info.title, info.enabled, info.edits.rotate, info.edits.saturation], ["新标题", false, 1, 2]);
  const png = async (q: string) => new Uint8Array(await (await app.request(`/preview/se0398.png?screen=photo&photo=${id}${q}`)).arrayBuffer());
  const saved = await png("");
  const unsaved = await png(`&edits=${encodeURIComponent(JSON.stringify({ rotate: 0 }))}`);
  assert.notDeepEqual(saved, unsaved);
  assert.equal((await app.request(`/photos/${id}/edit`)).status, 200);
  const src = await app.request(`/photos/${id}/source.png?rotate=1`);
  assert.equal(src.status, 200);
  const dec = decodePng(new Uint8Array(await src.arrayBuffer()));
  assert.deepEqual([dec.width, dec.height], [40, 60]);
  assert.equal((await app.request("/photos/999/edit")).status, 404);
});

test("database migration adds the photo edit columns to an existing table", () => {
  const path = `${process.env.TEMP ?? "/tmp"}/inkboard-migrate-${process.pid}.db`;
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE photo (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, png BLOB NOT NULL)");
  old.prepare("INSERT INTO photo (title, created_at, width, height, png) VALUES ('a', 'x', 4, 4, ?)").run(filteredPng(4, 4, sample));
  old.close();
  const db = openDb(path);
  const p = listPhotos(db)[0];
  assert.equal(p.enabled, true);
  assert.equal(p.edits.rotate, 0);
  db.close();
});

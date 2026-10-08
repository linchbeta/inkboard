import { test } from "node:test";
import assert from "node:assert/strict";
import { PANELS, matchPanel } from "../src/panels.js";
import { SCREENS, renderScreen, genericPanel } from "../src/frames.js";
import { panelById } from "../src/deviceFrame.js";

test("panels: a device's report picks the panel with its colours; B/W ones get none", () => {
  assert.equal(matchPanel(400, 300, 3)?.id, "hink42_bwr");
  assert.equal(matchPanel(400, 300, 4)?.id, "bwry42");
  assert.equal(matchPanel(768, 552, 4)?.id, "se0398");
  assert.equal(matchPanel(648, 480, 3)?.id, "bwr583");
  assert.equal(matchPanel(800, 480, 3)?.id, "bwr75");
  assert.equal(matchPanel(800, 480, 4)?.id, "bwry75");
  assert.equal(matchPanel(648, 480, 4)?.id, "bwry583");
  assert.equal(matchPanel(880, 528, 3)?.id, "bwr75hd");
  assert.equal(matchPanel(880, 528, 2), undefined);
  assert.equal(matchPanel(960, 672, 3)?.id, "bwr97");
  assert.equal(matchPanel(600, 448, 4)?.id, "color565");
  assert.equal(matchPanel(640, 384, 3)?.id, "bwr75v1");
  assert.equal(matchPanel(640, 384, 2), undefined);
  assert.equal(matchPanel(600, 448, 3)?.id, "bwr583v1");
  assert.equal(matchPanel(600, 448, 2), undefined);
  assert.equal(matchPanel(400, 300, 2), undefined);
  assert.equal(matchPanel(296, 128, 2), undefined);
  assert.equal(panelById("generic_296x128")?.width, 296);
  assert.equal(panelById("bwr583")?.height, 480);
});

test("every screen renders on every panel size without throwing", () => {
  const now = new Date(2026, 9, 9, 10, 15);
  const panels = [...Object.values(PANELS), genericPanel(296, 128), genericPanel(400, 300), genericPanel(648, 480), genericPanel(800, 480), genericPanel(640, 384), genericPanel(600, 448), genericPanel(880, 528)];
  for (const p of panels) {
    for (const id of Object.keys(SCREENS)) {
      const c = renderScreen(p, { now }, id);
      assert.equal(c.width, p.width, `${id} on ${p.id}`);
    }
  }
});

test("orientation: upright canvases turned into the panel's own, each way round", async () => {
  const { Canvas } = await import("../src/render/canvas.js");
  const { toNative } = await import("../src/render/orient.js");
  const { orientedPanel, PANELS, Ink } = await import("../src/panels.js");
  // a mark at the upright top-left corner, seen where it lands on the panel (W x H = 8 x 4)
  const at = (o: "landscape" | "portrait" | "landscape-flip" | "portrait-flip") => {
    const portrait = o.startsWith("portrait");
    const up = new Canvas(portrait ? 4 : 8, portrait ? 8 : 4);
    up.set(0, 0, Ink.Red);
    const n = toNative(up, o);
    assert.deepEqual([n.width, n.height], [8, 4]);
    const i = n.px.indexOf(Ink.Red);
    return [i % 8, Math.floor(i / 8)];
  };
  assert.deepEqual(at("landscape"), [0, 0]);
  assert.deepEqual(at("landscape-flip"), [7, 3]);
  assert.deepEqual(at("portrait"), [7, 0]);       // turned counter-clockwise: the panel's top-right is the top-left
  assert.deepEqual(at("portrait-flip"), [0, 3]);
  const p = orientedPanel(PANELS.se0398, "portrait");
  assert.deepEqual([p.width, p.height, PANELS.se0398.width], [552, 768, 768]);
});

test("orientation: an upright screen gets a native frame; layouts without an upright version say so", async () => {
  const { buildFrame, renderScreen } = await import("../src/frames.js");
  const { orientedPanel, PANELS } = await import("../src/panels.js");
  const now = new Date(2026, 9, 7, 10);
  for (const p of Object.values(PANELS)) {
    const f = buildFrame(p, { now }, true, "calendar", "portrait");
    assert.equal(f.body.length, p.colors >= 3 ? p.width * p.height / 4 : f.body.length);
    const up = renderScreen(orientedPanel(p, "portrait"), { now }, "calendar");
    assert.deepEqual([up.width, up.height], [p.height, p.width]);
  }
  // the same frame turned half way round differs, turned back it is the same
  const a = buildFrame(PANELS.se0398, { now }, true, "test", "landscape");
  const b = buildFrame(PANELS.se0398, { now }, true, "test", "landscape-flip");
  assert.notEqual(a.etag, b.etag);
});

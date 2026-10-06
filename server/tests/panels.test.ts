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
  assert.equal(matchPanel(400, 300, 2), undefined);
  assert.equal(matchPanel(296, 128, 2), undefined);
  assert.equal(panelById("generic_296x128")?.width, 296);
  assert.equal(panelById("bwr583")?.height, 480);
});

test("every screen renders on every panel size without throwing", () => {
  const now = new Date(2026, 9, 9, 10, 15);
  const panels = [...Object.values(PANELS), genericPanel(296, 128), genericPanel(400, 300), genericPanel(648, 480), genericPanel(800, 480)];
  for (const p of panels) {
    for (const id of Object.keys(SCREENS)) {
      const c = renderScreen(p, { now }, id);
      assert.equal(c.width, p.width, `${id} on ${p.id}`);
    }
  }
});

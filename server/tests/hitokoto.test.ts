import { test } from "node:test";
import assert from "node:assert/strict";
import { attribution } from "../src/data/hitokoto.js";
import { renderScreen } from "../src/frames.js";
import { PANELS } from "../src/panels.js";

test("hitokoto: source line, however much of it there is", () => {
  assert.equal(attribution({ text: "x", from: "道德经", who: "老子", type: "k" }), "—— 老子《道德经》");
  assert.equal(attribution({ text: "x", from: "道德经", who: "", type: "k" }), "—— 《道德经》");
  assert.equal(attribution({ text: "x", from: "「网络」", who: "", type: "f" }), "—— 「网络」");
  assert.equal(attribution({ text: "x", from: "", who: "", type: "f" }), "");
});

test("hitokoto renders short and very long sentences and sources on both panels", () => {
  const now = new Date(2026, 9, 9, 10);
  const long = { text: "长".repeat(200), from: "出".repeat(120), who: "某人", type: "d" };
  for (const p of Object.values(PANELS)) {
    for (const q of [{ text: "知足者富。", from: "道德经", who: "老子", type: "k" }, long]) {
      assert.equal(renderScreen(p, { now, data: q }, "hitokoto").width, p.width);
    }
  }
});

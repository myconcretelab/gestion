import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_APPEARANCE, normalizeAppearance } from "../src/utils/appearance";

test("invalid stored appearance falls back safely", () => {
  for (const value of [null, [], "retro", { template: "unknown", wood: "90", copper: Infinity }]) {
    assert.deepEqual(normalizeAppearance(value), DEFAULT_APPEARANCE);
  }
});
test("retro settings clamp finite values and preserve valid choices", () => {
  assert.deepEqual(normalizeAppearance({ template: "retro", wood: -20, copper: 150 }), { template: "retro", wood: 0, copper: 100 });
  assert.deepEqual(normalizeAppearance({ template: "retro", wood: 45.4, copper: 72 }), { template: "retro", wood: 45, copper: 72 });
});

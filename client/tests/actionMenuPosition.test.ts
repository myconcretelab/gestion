import assert from "node:assert/strict";
import { test } from "node:test";
import { actionMenuPosition } from "../src/pages/shared/actionMenuPosition.ts";

test("le menu s’aligne au bouton et reste dans l’écran sur mobile", () => {
  const desktop = actionMenuPosition(
    { top: 30, bottom: 66, left: 900, right: 1000 },
    { width: 1024, height: 768 },
    280,
  );
  assert.equal(desktop.left + desktop.width, 1000);
  assert.equal(desktop.top, 74);
  assert.equal(desktop.placement, "below");
  for (const width of [280, 320, 390]) {
    for (const right of [90, width - 4]) {
      const menu = actionMenuPosition(
        { top: 30, bottom: 72, left: right - 80, right },
        { width, height: 844 },
        400,
      );
      assert.ok(menu.left >= 12);
      assert.ok(menu.left + menu.width <= width - 12);
    }
  }
});

test("la dernière ligne ouvre son menu vers le haut sans masquer ses actions", () => {
  const menu = actionMenuPosition(
    { top: 700, bottom: 742, left: 300, right: 380 },
    { width: 390, height: 800 },
    600,
  );
  assert.equal(menu.placement, "above");
  assert.equal(menu.maxHeight, 448);
  assert.equal(menu.top + menu.maxHeight, 692);
  assert.ok(menu.top >= 12);
});

test("un petit écran conserve une zone défilable à l’intérieur du menu", () => {
  const menu = actionMenuPosition(
    { top: 100, bottom: 142, left: 250, right: 360 },
    { width: 390, height: 280 },
    650,
  );
  assert.equal(menu.placement, "below");
  assert.ok(menu.maxHeight < 200);
  assert.ok(menu.maxHeight > 0);
  assert.ok(menu.top + menu.maxHeight <= 268);
});

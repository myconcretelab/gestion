import assert from "node:assert/strict";
import { test } from "node:test";
import { actionMenuPosition } from "../src/pages/shared/actionMenuPosition.ts";

test("le popover de règlement utilise une largeur adaptée sans déborder de l’écran", () => {
  for (const width of [320, 768, 1440]) {
    const result = actionMenuPosition({ top: 200, bottom: 240, left: width - 140, right: width - 40 },
      { width, height: 800 }, 500, 400);
    assert.equal(result.width, Math.min(400, width - 24));
    assert.ok(result.left >= 12);
    assert.ok(result.left + result.width <= width - 12);
  }
});

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
  assert.equal(menu.maxHeight, 600);
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

test("un menu long préfère le haut quand toutes les actions y tiennent", () => {
  const menu = actionMenuPosition(
    { top: 510, bottom: 546, left: 300, right: 336 },
    { width: 390, height: 850 },
    420,
  );
  assert.equal(menu.placement, "above");
  assert.equal(menu.top, 82);
  assert.ok(menu.maxHeight >= 420);
});

test("un menu long s’ouvre à côté du bouton pour utiliser toute la hauteur", () => {
  for (const [left, placement] of [
    [800, "left"],
    [40, "right"],
  ] as const) {
    const anchor = { top: 280, bottom: 316, left, right: left + 36 };
    const menu = actionMenuPosition(anchor, { width: 900, height: 600 }, 620);
    assert.equal(menu.placement, placement);
    assert.equal(menu.maxHeight, 576);
    assert.ok(menu.top >= 12);
    assert.ok(menu.top + menu.maxHeight <= 588);
    if (placement === "left")
      assert.equal(menu.left + menu.width, anchor.left - 8);
    else assert.equal(menu.left, anchor.right + 8);
  }
});

test("le menu reste sous le bouton lorsque ses actions y tiennent déjà", () => {
  const menu = actionMenuPosition(
    { top: 40, bottom: 76, left: 800, right: 836 },
    { width: 900, height: 600 },
    300,
  );
  assert.equal(menu.placement, "below");
  assert.equal(menu.top, 84);
});

test("le placement suit la partie visible de l’écran lors d’un zoom", () => {
  const viewport = { left: 250, top: 150, width: 390, height: 280 };
  const menu = actionMenuPosition(
    { top: 250, bottom: 292, left: 550, right: 586 },
    viewport,
    650,
  );
  assert.ok(menu.left >= 262);
  assert.ok(menu.left + menu.width <= 628);
  assert.ok(menu.top >= 162);
  assert.ok(menu.top + menu.maxHeight <= 418);
});

import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkMinutes, parseWorkHours, getWorkerInitials } from "../src/utils/intervenantHours.ts";

test("les durées libres sont converties en minutes sans arrondi silencieux", () => {
  assert.equal(parseWorkHours("1,5"), 90);
  assert.equal(parseWorkHours("0.5"), 30);
  assert.equal(parseWorkHours("2"), 120);
  assert.equal(parseWorkHours("24"), 1440);
  assert.equal(parseWorkHours(String(1 / 60)), 1);
  for (const invalid of ["", "0", "-2", "25", "1,234", "Infinity", "1e2", "2h"]) {
    assert.equal(parseWorkHours(invalid), null);
  }
});

test("les compteurs affichent des heures et minutes lisibles", () => {
  assert.equal(formatWorkMinutes(0), "0 h");
  assert.equal(formatWorkMinutes(30), "30 min");
  assert.equal(formatWorkMinutes(120), "2 h");
  assert.equal(formatWorkMinutes(90), "1 h 30");
  assert.equal(getWorkerInitials("Christine"), "C");
  assert.equal(getWorkerInitials("  Christine Martin "), "CM");
});

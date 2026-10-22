import assert from "node:assert/strict";
import test from "node:test";
import {
  nextUrgencyLevel,
  reminderFrequency,
  type TaskReminderSettings,
} from "../src/pages/tasks/taskUrgency.ts";

test("le sélecteur part sans urgence et suit le cycle 0 → 1 → 2 → 0", () => {
  assert.equal(nextUrgencyLevel(0), 1);
  assert.equal(nextUrgencyLevel(1), 2);
  assert.equal(nextUrgencyLevel(2), 0);
  const settings = {
    enabled: true,
    level_1_enabled: false,
    level_2_enabled: true,
  } as TaskReminderSettings;
  assert.equal(nextUrgencyLevel(0, settings), 2);
  assert.equal(nextUrgencyLevel(2, settings), 0);
  assert.equal(nextUrgencyLevel(2, { ...settings, enabled: false }), 0);
  assert.equal(reminderFrequency(60), "toutes les heures");
  assert.equal(reminderFrequency(120), "toutes les 2 heures");
});

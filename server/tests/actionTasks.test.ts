import assert from "node:assert/strict";
import test from "node:test";
import { actionWindow } from "../src/services/actionTasks.js";
import { parseRotationAssignees, rotationAssigneeAt } from "../src/services/assignmentRules.js";

test("une action peut être prévue la veille d'une arrivée en heure de Paris", () => {
  const window = actionWindow("2026-10-25", {
    starts_offset_days: -1, due_offset_days: 0, start_time: "09:00", due_time: "16:00",
  });
  assert.equal(window.startsAt.toISOString(), "2026-10-24T07:00:00.000Z");
  assert.equal(window.dueAt.toISOString(), "2026-10-25T15:00:00.000Z");
});

test("le tour de rôle suit l'ordre défini et revient au début", () => {
  const pool = parseRotationAssignees('["a","b","a","c"]');
  assert.deepEqual(pool, ["a", "b", "c"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((cursor) => rotationAssigneeAt(pool, cursor)), ["a", "b", "c", "a", "b"]);
  assert.equal(rotationAssigneeAt([], 1), null);
});

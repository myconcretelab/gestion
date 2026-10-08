import assert from "node:assert/strict";
import test from "node:test";
import { isMissedCleaningTask } from "../src/pages/cleaningTaskStatus.ts";

const arrivalAt = "2026-10-08T15:00:00.000Z";

test("un ménage encore faisable avant l’arrivée reste dans les tâches à faire", () => {
  assert.equal(isMissedCleaningTask({ status: "planned", arrival_at: arrivalAt }, new Date("2026-10-08T14:59:00.000Z")), false);
});

test("un ménage non confirmé passe dans l’historique à l’heure d’arrivée", () => {
  assert.equal(isMissedCleaningTask({ status: "in_progress", arrival_at: arrivalAt }, new Date(arrivalAt)), true);
  assert.equal(isMissedCleaningTask({ status: "done", arrival_at: arrivalAt }, new Date(arrivalAt)), true);
});

test("un ménage validé ou sans prochaine arrivée ne devient pas manqué", () => {
  assert.equal(isMissedCleaningTask({ status: "verified", arrival_at: arrivalAt }, new Date("2026-10-09T00:00:00.000Z")), false);
  assert.equal(isMissedCleaningTask({ status: "planned", arrival_at: null }, new Date("2026-10-09T00:00:00.000Z")), false);
});

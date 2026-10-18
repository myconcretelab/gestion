import assert from "node:assert/strict";
import test from "node:test";
import {
  isCleaningReadinessLate,
  isCleaningReadinessVisible,
  isMissedCleaningTask,
} from "../src/pages/cleaningTaskStatus.ts";

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

const readiness = {
  departure_date: "2026-10-08",
  next_arrival_date: "2026-10-10",
  next_arrival_at: "2026-10-10T15:00:00.000Z",
};

test("le bouton Aujourd’hui reste disponible après l’arrivée jusqu’à minuit", () => {
  assert.equal(isCleaningReadinessVisible(readiness, new Date("2026-10-10T14:59:00.000Z")), true);
  assert.equal(isCleaningReadinessVisible(readiness, new Date("2026-10-10T15:00:00.000Z")), true);
  assert.equal(isCleaningReadinessVisible(readiness, new Date("2026-10-10T21:59:59.000Z")), true);
  assert.equal(isCleaningReadinessLate(readiness, new Date("2026-10-10T15:00:00.000Z")), true);
});

test("le bouton Aujourd’hui disparaît le lendemain de l’arrivée", () => {
  assert.equal(isCleaningReadinessVisible(readiness, new Date("2026-10-10T22:00:00.000Z")), false);
});

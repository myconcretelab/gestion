import assert from "node:assert/strict";
import test from "node:test";
import { cleaningWindow, parisWallTime, serializeCleaningTask } from "../src/services/cleaningTasks.js";

test("un ménage peut être prévu la veille de l’arrivée sans commencer avant le départ", () => {
  const window = cleaningWindow({
    departureDate: "2026-10-21", departureTime: "10:00",
    arrivalDate: "2026-10-25", arrivalTime: "17:00",
    scheduleMode: "day_before_arrival", bufferMinutes: 0,
  });
  assert.equal(window.startsAt.toISOString(), "2026-10-24T06:00:00.000Z");
  assert.equal(window.dueAt?.toISOString(), "2026-10-25T16:00:00.000Z");
  assert.equal(window.impossibleWindow, false);
});

test("une rotation le même jour avance la tâche au départ réel", () => {
  const window = cleaningWindow({
    departureDate: "2026-10-25", departureTime: "10:00",
    arrivalDate: "2026-10-25", arrivalTime: "17:00",
    scheduleMode: "day_before_arrival", bufferMinutes: 60,
  });
  assert.equal(window.startsAt.toISOString(), "2026-10-25T09:00:00.000Z");
  assert.equal(window.dueAt?.toISOString(), "2026-10-25T15:00:00.000Z");
});

test("une marge impossible est signalée pour une arrivée trop proche du départ", () => {
  const window = cleaningWindow({
    departureDate: "2026-10-25", departureTime: "10:00",
    arrivalDate: "2026-10-25", arrivalTime: "10:30",
    scheduleMode: "after_departure", bufferMinutes: 60,
  });
  assert.equal(window.impossibleWindow, true);
});

test("la tâche expose l’arrivée réelle pour sortir les ménages manqués de la liste active", () => {
  const task = serializeCleaningTask({
    id: "cleaning-1", gite_id: "gite-1", departure_reservation_id: "departure-1",
    arrival_reservation_id: "arrival-1", assignee_id: null, status: "planned",
    starts_at: new Date("2026-10-08T09:00:00.000Z"), due_at: new Date("2026-10-08T15:00:00.000Z"),
    completed_at: null, checked_at: null, note: "",
  }, { arrivalAt: parisWallTime("2026-10-08", "18:00") }, true);
  assert.equal(task.arrival_at, "2026-10-08T16:00:00.000Z");
  assert.equal(task.due_at, "2026-10-08T15:00:00.000Z");
});

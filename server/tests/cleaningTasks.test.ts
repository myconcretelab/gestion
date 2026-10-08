import assert from "node:assert/strict";
import test from "node:test";
import { cleaningWindow } from "../src/services/cleaningTasks.js";

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

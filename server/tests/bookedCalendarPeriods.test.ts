import assert from "node:assert/strict";
import test from "node:test";
import { buildBookedCalendarPeriods } from "../src/services/bookedCalendarPeriods.ts";

test("buildBookedCalendarPeriods expose les ponts hors vacances scolaires", () => {
  const periods = buildBookedCalendarPeriods({
    from: "2026-05-13",
    to: "2026-05-18",
    holidays: [
      {
        zone: "B",
        start: "2026-05-13",
        end: "2026-05-17",
        description: "Pont de l'Ascension",
        anneeScolaire: "2025-2026",
        population: "",
      },
    ],
  });

  assert.deepEqual(periods, [
    { start: "2026-05-14", end: "2026-05-17", type: "bridge", label: "Pont Ascension" },
  ]);
});

test("buildBookedCalendarPeriods donne priorité aux vacances sur les ponts", () => {
  const periods = buildBookedCalendarPeriods({
    from: "2026-12-24",
    to: "2026-12-31",
    holidays: [
      {
        zone: "B",
        start: "2026-12-19",
        end: "2027-01-04",
        description: "Vacances de Noël",
        anneeScolaire: "2026-2027",
        population: "",
      },
    ],
  });

  assert.deepEqual(periods, [
    { start: "2026-12-24", end: "2026-12-31", type: "school_holiday", label: "Vacances de Noël" },
  ]);
});

test("buildBookedCalendarPeriods donne priorité à juillet août sur les vacances scolaires", () => {
  const periods = buildBookedCalendarPeriods({
    from: "2026-07-01",
    to: "2026-08-01",
    holidays: [
      {
        zone: "B",
        start: "2026-07-04",
        end: "2026-08-31",
        description: "Vacances d'été",
        anneeScolaire: "2025-2026",
        population: "",
      },
    ],
  });

  assert.deepEqual(periods, [
    { start: "2026-07-01", end: "2026-08-01", type: "july_august", label: "Juillet / août" },
  ]);
});

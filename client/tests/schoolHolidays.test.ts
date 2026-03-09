import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSchoolHolidayDateSet,
  computeReservationHolidayNightCount,
  getReservationDateRange,
  getSchoolHolidaySegmentsForMonth,
} from "../src/utils/schoolHolidays.ts";

test("buildSchoolHolidayDateSet inclut toutes les dates de la plage", () => {
  const dates = buildSchoolHolidayDateSet([
    {
      zone: "B",
      start: "2026-02-07",
      end: "2026-02-09",
      description: "Vacances d'hiver",
      anneeScolaire: "2025-2026",
      population: "",
    },
  ]);

  assert.deepEqual([...dates], ["2026-02-07", "2026-02-08", "2026-02-09"]);
});

test("computeReservationHolidayNightCount compte uniquement les nuits recouvertes", () => {
  const holidayDates = buildSchoolHolidayDateSet([
    {
      zone: "B",
      start: "2026-02-07",
      end: "2026-02-09",
      description: "Vacances d'hiver",
      anneeScolaire: "2025-2026",
      population: "",
    },
  ]);

  assert.equal(
    computeReservationHolidayNightCount(
      {
        date_entree: "2026-02-06T00:00:00.000Z",
        date_sortie: "2026-02-10T00:00:00.000Z",
      } as const,
      holidayDates
    ),
    3
  );
});

test("getReservationDateRange couvre les bornes min et max de la liste", () => {
  const range = getReservationDateRange([
    {
      date_entree: "2026-12-30T00:00:00.000Z",
      date_sortie: "2027-01-02T00:00:00.000Z",
    },
    {
      date_entree: "2026-02-06T00:00:00.000Z",
      date_sortie: "2026-02-10T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(range, {
    from: "2026-02-06",
    to: "2027-01-02",
    key: "2026-02-06:2027-01-02",
  });
});

test("getSchoolHolidaySegmentsForMonth tronque les vacances au mois affiche", () => {
  const segments = getSchoolHolidaySegmentsForMonth(
    [
      {
        zone: "B",
        start: "2026-02-07",
        end: "2026-03-09",
        description: "Vacances d'hiver",
        anneeScolaire: "2025-2026",
        population: "",
      },
    ],
    2026,
    3
  );

  assert.deepEqual(segments, [
    {
      key: "2026-02-07:2026-03-09:Vacances d'hiver:2026-03-01:2026-03-09",
      name: "Vacances d'hiver",
      start: "2026-03-01",
      end: "2026-03-09",
      label: "Vacances d'hiver · 01/03 au 09/03",
    },
  ]);
});

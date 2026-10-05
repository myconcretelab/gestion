import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTodayRevenueComparison,
  getComparableNetRevenue,
  getUtcDaysInMonth,
} from "../src/services/todayRevenueComparison.ts";

test("compare le mois précédent au même mois de l'année précédente", () => {
  assert.deepEqual(
    buildTodayRevenueComparison({
      currentNetRevenue: 1_800,
      referenceMonthNetRevenue: 1_500,
      referenceLabel: "Septembre 2025",
      today: new Date("2026-10-05T00:00:00.000Z"),
      prorateReference: false,
    }),
    {
      reference_label: "Septembre 2025",
      reference_net_revenue: 1_500,
      difference: 300,
      prorated: false,
      elapsed_days: null,
      days_in_month: null,
    }
  );
});

test("proratise les deux mois sur les jours écoulés du mois courant", () => {
  assert.deepEqual(
    buildTodayRevenueComparison({
      currentNetRevenue: 3_100,
      referenceMonthNetRevenue: 3_100,
      referenceLabel: "Octobre 2025",
      today: new Date("2026-10-05T00:00:00.000Z"),
      prorateReference: true,
    }),
    {
      reference_label: "Octobre 2025",
      reference_net_revenue: 500,
      difference: 0,
      prorated: true,
      elapsed_days: 5,
      days_in_month: 31,
    }
  );
});

test("compare le net sans laisser les frais personnels récurrents fausser l'écart", () => {
  assert.equal(getComparableNetRevenue(-555.81, 3_277.58), 2_721.77);
});

test("gère correctement février lors d'une année bissextile", () => {
  assert.equal(getUtcDaysInMonth(new Date("2028-02-12T00:00:00.000Z")), 29);
});

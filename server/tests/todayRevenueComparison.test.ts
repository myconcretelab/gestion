import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTodayRevenueComparison,
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

test("proratise le mois de référence sur les jours écoulés du mois courant", () => {
  assert.deepEqual(
    buildTodayRevenueComparison({
      currentNetRevenue: 500,
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

test("gère correctement février lors d'une année bissextile", () => {
  assert.equal(getUtcDaysInMonth(new Date("2028-02-12T00:00:00.000Z")), 29);
});

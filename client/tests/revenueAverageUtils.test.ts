import assert from "node:assert/strict";
import test from "node:test";
import {
  getNetAverageMonthlyRevenue,
  getRevenueAveragePeriod,
} from "../src/pages/statistics/revenueAverageUtils.ts";
import type {
  ParsedStatisticsEntry,
  ParsedStatisticsPayload,
} from "../src/pages/statistics/statisticsUtils.ts";

const makeEntry = (
  reservationId: string,
  debut: string,
  revenus: number,
  fraisOptionnelsTotal = 0,
  paiement = "Airbnb"
): ParsedStatisticsEntry => ({
  reservationId,
  giteId: "gite-1",
  debut,
  debutDate: new Date(`${debut}T00:00:00.000Z`),
  fin: debut,
  mois: Number(debut.slice(5, 7)),
  nuits: 1,
  adultes: 2,
  prixNuit: revenus,
  revenus,
  fraisOptionnelsTotal,
  fraisOptionnelsDeclares: fraisOptionnelsTotal,
  paiement,
  proprietaires: "Propriétaire",
});

const dataset: ParsedStatisticsPayload = {
  gites: [],
  availableYears: [2026, 2025],
  expenseSettings: { categories: [], dynamic_expenses: [] },
  entriesByGite: {
    "gite-1": [
      makeEntry("previous-year", "2025-06-01", 12_000, 1_200),
      makeEntry("completed-current-month", "2026-07-01", 7_000),
      makeEntry("current-month", "2026-08-01", 5_000),
      makeEntry("exchange", "2026-06-01", 1_000, 0, "HomeExchange"),
    ],
  },
};

test("calcule la période sur l'année précédente et les mois terminés de l'année courante", () => {
  assert.deepEqual(getRevenueAveragePeriod(new Date("2026-08-07T12:00:00.000Z")), {
    previousYear: 2025,
    currentYear: 2026,
    completedCurrentYearMonths: 7,
    monthCount: 19,
  });
});

test("inclut les revenus des 19 mois et exclut le mois courant et HomeExchange", () => {
  const result = getNetAverageMonthlyRevenue(
    dataset,
    "gite-1",
    100,
    [{ enabled: true, rate: 0.06 }],
    new Date("2026-08-07T12:00:00.000Z")
  );

  assert.equal(result.monthCount, 19);
  assert.equal(result.grossRevenue, 20_200);
  assert.equal(result.expenses, 3_112);
  assert.equal(result.netAverage, 17_088 / 19);
});

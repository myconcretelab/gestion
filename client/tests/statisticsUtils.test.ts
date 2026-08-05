import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAverageCA,
  computeAveragePrice,
  computeExpenseReport,
  computeGiteStats,
  computeGlobalStats,
  getEntryGrossCA,
  getEntryUrssafBase,
  getMonthlyCAByYear,
  parseStatisticsPayload,
  type StatisticsPayload,
} from "../src/pages/statistics/statisticsUtils.ts";

const payload: StatisticsPayload = {
  gites: [
    {
      id: "g1",
      nom: "La Grée",
      ordre: 1,
      prefixe_contrat: "LG",
      proprietaires_noms: "Proprio",
    },
  ],
  entriesByGite: {
    g1: [
      {
        reservationId: "res-options",
        giteId: "g1",
        debut: "2026-05-10",
        fin: "2026-05-12",
        mois: 5,
        nuits: 2,
        adultes: 2,
        prixNuit: 100,
        revenus: 200,
        fraisOptionnelsTotal: 50,
        fraisOptionnelsDeclares: 20,
        paiement: "Airbnb",
        proprietaires: "Proprio",
      },
      {
        reservationId: "res-homeexchange",
        giteId: "g1",
        debut: "2026-05-14",
        fin: "2026-05-16",
        mois: 5,
        nuits: 2,
        adultes: 2,
        prixNuit: 100,
        revenus: 200,
        fraisOptionnelsTotal: 50,
        fraisOptionnelsDeclares: 0,
        paiement: "HomeExchange",
        proprietaires: "Proprio",
      },
    ],
  },
  availableYears: [2026],
};

test("les stats de CA brut incluent les options et excluent HomeExchange", () => {
  const parsed = parseStatisticsPayload(payload);
  const entries = parsed.entriesByGite.g1;

  assert.equal(getEntryGrossCA(entries[0]), 250);
  assert.deepEqual(computeGlobalStats(parsed.entriesByGite, 2026, 5), {
    totalReservations: 1,
    totalNights: 2,
    totalCA: 250,
  });

  const giteStats = computeGiteStats(entries, 2026, 5);
  assert.equal(giteStats.totalCA, 250);
  assert.equal(giteStats.meanPrice, 125);
  assert.deepEqual(giteStats.payments, { Airbnb: 250 });
  assert.equal(computeAverageCA(entries, "all", 5), 250);
  assert.equal(computeAveragePrice(entries, "all", 5), 125);
  assert.equal(getMonthlyCAByYear(parsed.entriesByGite)[2026].months[4].ca, 250);
});

test("l'assiette Urssaf inclut uniquement les revenus et options déclarés des sources éligibles", () => {
  const parsed = parseStatisticsPayload(payload);
  const [airbnb, homeExchange] = parsed.entriesByGite.g1;

  assert.equal(getEntryUrssafBase(airbnb), 220);
  assert.equal(getEntryUrssafBase(homeExchange), 0);
});

test("le rapport de frais consolide les charges fixes, dynamiques et le résultat par gîte", () => {
  const expensePayload: StatisticsPayload = {
    ...payload,
    gites: payload.gites.map((gite) => ({
      ...gite,
      frais_gestion: {
        version: 1,
        expenses: [
          {
            id: "electricite",
            label: "Électricité",
            category_id: "energie",
            monthly_amount: 100,
            annual_amount: 1200,
          },
        ],
      },
    })),
    expenseSettings: {
      categories: [
        { id: "energie", name: "Énergie", color: "#2D8CFF" },
        { id: "taxes", name: "Taxes", color: "#F5A623" },
      ],
      dynamic_expenses: [
        {
          id: "urssaf",
          label: "Urssaf",
          category_id: "taxes",
          basis: "urssaf_revenue",
          rate: 0.06,
          enabled: true,
        },
      ],
    },
  };
  const parsed = parseStatisticsPayload(expensePayload);
  const annual = computeExpenseReport({
    ...parsed,
    selectedYear: 2026,
    selectedMonth: "",
  });

  assert.equal(annual.fixed, 1200);
  assert.equal(annual.dynamic, 13.2);
  assert.equal(annual.expenses, 1213.2);
  assert.equal(annual.revenue, 250);
  assert.equal(annual.net, -963.2);
  assert.equal(annual.monthlyAverage, 101.1);
  assert.equal(annual.rowsByGite[0].expenses, 1213.2);
  assert.deepEqual(
    annual.rowsByCategory.map((category) => [category.id, category.amount]),
    [["energie", 1200], ["taxes", 13.2]]
  );

  const monthly = computeExpenseReport({
    ...parsed,
    selectedYear: 2026,
    selectedMonth: 5,
  });
  assert.equal(monthly.fixed, 100);
  assert.equal(monthly.expenses, 113.2);
  assert.equal(monthly.monthlyAverage, 113.2);
});

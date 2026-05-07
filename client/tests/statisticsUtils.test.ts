import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAverageCA,
  computeAveragePrice,
  computeGiteStats,
  computeGlobalStats,
  getEntryGrossCA,
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

test("les stats de CA brut incluent les frais optionnels et excluent HomeExchange", () => {
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

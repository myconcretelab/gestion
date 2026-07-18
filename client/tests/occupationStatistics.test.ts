import assert from "node:assert/strict";
import test from "node:test";
import {
  computeOccupation,
  type ParsedStatisticsEntry,
} from "../src/pages/statistics/statisticsUtils.ts";

const entry = (debut: string, nuits: number): ParsedStatisticsEntry => ({
  reservationId: `${debut}-${nuits}`,
  giteId: "gite-1",
  debut,
  fin: debut,
  mois: Number(debut.slice(5, 7)),
  nuits,
  adultes: 2,
  prixNuit: 100,
  revenus: nuits * 100,
  fraisOptionnelsTotal: 0,
  fraisOptionnelsDeclares: 0,
  paiement: "Virement",
  proprietaires: "Propriétaire",
  debutDate: new Date(`${debut}T00:00:00.000Z`),
});

test("le taux annuel courant exclut les nuits futures du numérateur", () => {
  const entries = [
    entry("2026-01-01", 100),
    entry("2026-09-01", 100),
  ];

  const occupation = computeOccupation(entries, 2026, "", new Date("2026-07-18T12:00:00.000Z"));

  assert.equal(occupation, 100 / 199);
});

test("le taux mensuel conserve toutes les nuits réservées du mois", () => {
  const entries = [
    entry("2026-07-01", 10),
    entry("2026-07-20", 10),
  ];

  const occupation = computeOccupation(entries, 2026, 7, new Date("2026-07-18T12:00:00.000Z"));

  assert.equal(occupation, 20 / 31);
});

test("le taux annuel historique compte toute l'année", () => {
  const entries = [
    entry("2025-01-01", 100),
    entry("2025-09-01", 100),
  ];

  const occupation = computeOccupation(entries, 2025, "", new Date("2026-07-18T12:00:00.000Z"));

  assert.equal(occupation, 200 / 365);
});

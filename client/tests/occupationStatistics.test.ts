import assert from "node:assert/strict";
import test from "node:test";
import {
  computeOccupation,
  getOccupationPerYear,
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

  const occupation = computeOccupation(entries, 2026, "", null, new Date("2026-07-18T12:00:00.000Z"));

  assert.equal(occupation, 100 / 199);
});

test("le taux mensuel conserve toutes les nuits réservées du mois", () => {
  const entries = [
    entry("2026-07-01", 10),
    entry("2026-07-20", 10),
  ];

  const occupation = computeOccupation(entries, 2026, 7, null, new Date("2026-07-18T12:00:00.000Z"));

  assert.equal(occupation, 20 / 31);
});

test("le taux annuel historique compte toute l'année", () => {
  const entries = [
    entry("2025-01-01", 100),
    entry("2025-09-01", 100),
  ];

  const occupation = computeOccupation(entries, 2025, "", null, new Date("2026-07-18T12:00:00.000Z"));

  assert.equal(occupation, 200 / 365);
});

test("la première année est proratisée depuis le début d'activité", () => {
  const entries = [entry("2021-03-25", 115)];

  const occupation = computeOccupation(entries, 2021, "", "2021-03-25");

  assert.equal(occupation, 115 / 282);
});

test("les périodes antérieures au début d'activité ne sont pas affichées", () => {
  const occupations = getOccupationPerYear(
    [entry("2021-03-25", 10)],
    [2022, 2021, 2020],
    "",
    "2021-03-25"
  );

  assert.deepEqual(
    occupations.map(({ year }) => year),
    [2022, 2021]
  );
});

test("le premier mois est proratisé quand l'activité commence en cours de mois", () => {
  const entries = [entry("2021-03-25", 7)];

  const occupation = computeOccupation(entries, 2021, 3, "2021-03-25");

  assert.equal(occupation, 1);
});

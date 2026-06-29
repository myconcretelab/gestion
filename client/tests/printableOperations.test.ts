import assert from "node:assert/strict";
import test from "node:test";
import { enumerateIsoDates, getOperationsForDate, reservationOverlapsPeriod } from "../src/utils/printableOperations";
import type { Reservation } from "../src/utils/types";

const reservation = {
  id: "reservation-1",
  hote_nom: "Martin",
  date_entree: "2026-07-10",
  date_sortie: "2026-07-13",
  nb_nuits: 3,
  nb_adultes: 2,
  nb_enfants_2_17: 0,
  prix_par_nuit: 100,
  prix_total: 300,
  remise_montant: 0,
  commission_channel_value: 0,
  frais_optionnels_montant: 0,
  frais_optionnels_declares: false,
  energy_consumption_kwh: 0,
  energy_cost_eur: 0,
  options: {
    draps: { enabled: true, nb_lits: 2 },
    linge_toilette: { enabled: true, nb_personnes: 3 },
    menage: { enabled: true },
    depart_tardif: { enabled: true },
  },
} as Reservation;

test("énumère la période avec ses deux bornes", () => {
  assert.deepEqual(enumerateIsoDates("2026-07-10", "2026-07-12"), ["2026-07-10", "2026-07-11", "2026-07-12"]);
});

test("décrit les préparations à l'entrée", () => {
  assert.deepEqual(getOperationsForDate(reservation, "2026-07-10").map((item) => item.label), [
    "Entrée",
    "Draps · 2 lits",
    "Serviettes · 3 pers.",
  ]);
});

test("décrit le ménage et le départ tardif à la sortie", () => {
  assert.deepEqual(getOperationsForDate(reservation, "2026-07-13").map((item) => item.label), [
    "Sortie",
    "Ménage",
    "Départ tardif",
  ]);
});

test("n'affiche pas de ménage à la sortie quand l'option n'est pas activée", () => {
  const withoutCleaning = {
    ...reservation,
    options: {
      ...reservation.options,
      menage: { enabled: false },
    },
  };

  assert.deepEqual(getOperationsForDate(withoutCleaning, "2026-07-13").map((item) => item.label), [
    "Sortie",
    "Départ tardif",
  ]);
});

test("conserve un séjour qui chevauche la période", () => {
  assert.equal(reservationOverlapsPeriod(reservation, "2026-07-12", "2026-07-15"), true);
  assert.equal(reservationOverlapsPeriod(reservation, "2026-07-14", "2026-07-15"), false);
});

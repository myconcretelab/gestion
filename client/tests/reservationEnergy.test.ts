import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEuroPerDay,
  getReservationEnergyAverageDailyCost,
} from "../src/utils/reservationEnergy.ts";
import type { Reservation } from "../src/utils/types.ts";

const baseReservation: Reservation = {
  id: "res-1",
  hote_nom: "Client test",
  date_entree: "2026-04-01T00:00:00.000Z",
  date_sortie: "2026-04-05T00:00:00.000Z",
  nb_nuits: 4,
  nb_adultes: 2,
  prix_par_nuit: 100,
  prix_total: 400,
  remise_montant: 0,
  commission_channel_value: 0,
  frais_optionnels_montant: 0,
  frais_optionnels_declares: false,
  energy_consumption_kwh: 37.24,
  energy_cost_eur: 0,
  gite: {
    id: "g1",
    nom: "Gite test",
    prefixe_contrat: "GT",
    ordre: 1,
    heure_arrivee_defaut: "17:00",
    heure_depart_defaut: "12:00",
  },
};

test("getReservationEnergyAverageDailyCost utilise les horodatages du suivi ferme", () => {
  const reservation: Reservation = {
    ...baseReservation,
    energy_cost_eur: 8.08,
    energy_tracking: [
      {
        session_id: "s1",
        device_id: "d1",
        device_name: "Compteur",
        status: "closed",
        started_at: "2026-04-01T17:00:00.000Z",
        ended_at: "2026-04-05T17:00:00.000Z",
        started_total_kwh: 0,
        ended_total_kwh: 0,
        total_kwh: 0,
        total_cost_eur: 8.08,
        stay_total_kwh: 0,
        stay_total_cost_eur: 8.08,
        allocation_ratio: 1,
      },
    ],
  };

  assert.equal(getReservationEnergyAverageDailyCost(reservation, "saved"), 2.02);
});

test("getReservationEnergyAverageDailyCost utilise les horodatages live des sessions ouvertes", () => {
  const reservation: Reservation = {
    ...baseReservation,
    energy_live_cost_eur: 6.06,
    energy_live_recorded_at: "2026-04-04T17:00:00.000Z",
    energy_tracking: [
      {
        session_id: "s1",
        device_id: "d1",
        device_name: "Compteur",
        status: "open",
        started_at: "2026-04-01T17:00:00.000Z",
        ended_at: null,
        started_total_kwh: 0,
        ended_total_kwh: null,
        total_kwh: null,
        total_cost_eur: null,
        stay_total_kwh: null,
        stay_total_cost_eur: null,
        allocation_ratio: 1,
      },
    ],
  };

  assert.equal(getReservationEnergyAverageDailyCost(reservation, "live"), 2.02);
});

test("getReservationEnergyAverageDailyCost retombe sur les heures de sejour quand il n'y a pas de tracking", () => {
  const durationDays = (91 / 24);
  const reservation: Reservation = {
    ...baseReservation,
    energy_cost_eur: durationDays * 2.02,
    linked_contract: {
      id: "c1",
      numero_contrat: "GT-001",
      heure_arrivee: "17:00",
      heure_depart: "12:00",
      statut_paiement_arrhes: "non_recu",
      statut_paiement_solde: "non_regle",
      solde_montant: 0,
    },
  };

  assert.equal(getReservationEnergyAverageDailyCost(reservation, "saved"), 2.02);
});

test("formatEuroPerDay formate le montant journalier", () => {
  assert.equal(formatEuroPerDay(2.02), "2,02€/j");
});

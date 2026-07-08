import assert from "node:assert/strict";
import test from "node:test";
import { buildReservationDocumentPrefill } from "../src/pages/shared/documentFormShared";
import { clampDocumentAdults } from "../src/pages/shared/rentalForm";

test("buildReservationDocumentPrefill reprend les enfants depuis la réservation", () => {
  const prefill = buildReservationDocumentPrefill({
    id: "r1",
    gite_id: "g1",
    hote_nom: "Client",
    telephone: "0600000000",
    email: "client@example.com",
    date_entree: "2026-09-10",
    date_sortie: "2026-09-14",
    nb_nuits: 4,
    nb_adultes: 2,
    nb_enfants_2_17: 3,
    prix_par_nuit: 100,
    prix_total: 400,
    remise_montant: 0,
    commission_channel_value: 0,
    frais_optionnels_montant: 0,
    frais_optionnels_declares: false,
    energy_consumption_kwh: 0,
    energy_cost_eur: 0,
    options: {},
  } as any);

  assert.equal(prefill.nbEnfants, 3);
});

test("buildReservationDocumentPrefill conserve une réservation à 0 adulte", () => {
  const prefill = buildReservationDocumentPrefill({
    id: "r1",
    gite_id: "g1",
    hote_nom: "Client",
    telephone: "0600000000",
    email: "client@example.com",
    date_entree: "2026-09-10",
    date_sortie: "2026-09-14",
    nb_nuits: 4,
    nb_adultes: 0,
    nb_enfants_2_17: 2,
    prix_par_nuit: 100,
    prix_total: 400,
    remise_montant: 0,
    commission_channel_value: 0,
    frais_optionnels_montant: 0,
    frais_optionnels_declares: false,
    energy_consumption_kwh: 0,
    energy_cost_eur: 0,
    options: {},
  } as any);

  assert.equal(prefill.nbAdultes, 0);
});

test("clampDocumentAdults autorise 0 pour les contrats", () => {
  assert.equal(clampDocumentAdults(0), 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildReservationDocumentPrefill } from "../src/pages/shared/documentFormShared";

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

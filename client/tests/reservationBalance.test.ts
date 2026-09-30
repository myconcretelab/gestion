import assert from "node:assert/strict";
import test from "node:test";
import { getReservationRemainingDueAmount } from "../src/utils/reservationBalance";

test("inclut les options de la réservation dans le restant dû", () => {
  assert.equal(
    getReservationRemainingDueAmount(
      {
        prix_total: 1_050,
        remise_montant: 0,
        frais_optionnels_montant: 370,
      },
      {
        arrhes_montant: 210,
        solde_montant: 840,
        statut_paiement_solde: "non_regle",
      },
    ),
    1_210,
  );
});

test("affiche zéro quand le solde est réglé", () => {
  assert.equal(
    getReservationRemainingDueAmount(
      { prix_total: 1_050, frais_optionnels_montant: 370 },
      { arrhes_montant: 210, solde_montant: 840, statut_paiement_solde: "regle" },
    ),
    0,
  );
});

test("retombe sur le solde du contrat quand la réservation n'a pas de tarif", () => {
  assert.equal(
    getReservationRemainingDueAmount(
      { prix_total: 0, frais_optionnels_montant: 0 },
      { arrhes_montant: 210, solde_montant: 840, statut_paiement_solde: "non_regle" },
    ),
    840,
  );
});

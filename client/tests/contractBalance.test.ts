import assert from "node:assert/strict";
import test from "node:test";
import { getContractRemainingDueAmount } from "../src/utils/contractBalance";

test("le restant dû ne déduit que les arrhes et le solde effectivement payés", () => {
  const contract = { arrhes_montant: 140, solde_montant: 610 };
  assert.equal(getContractRemainingDueAmount({ ...contract, statut_paiement_arrhes: "non_recu", statut_paiement_solde: "non_regle" }), 750);
  assert.equal(getContractRemainingDueAmount({ ...contract, statut_paiement_arrhes: "recu", statut_paiement_solde: "non_regle" }), 610);
  assert.equal(getContractRemainingDueAmount({ ...contract, statut_paiement_arrhes: "non_recu", statut_paiement_solde: "regle" }), 140);
  assert.equal(getContractRemainingDueAmount({ ...contract, statut_paiement_arrhes: "recu", statut_paiement_solde: "regle" }), 0);
});

test("le restant dû conserve les centimes et accepte un contrat sans arrhes", () => {
  assert.equal(getContractRemainingDueAmount({ arrhes_montant: 0.1, solde_montant: 0.2, statut_paiement_arrhes: "non_recu", statut_paiement_solde: "non_regle" }), 0.3);
  assert.equal(getContractRemainingDueAmount({ arrhes_montant: 0, solde_montant: 750, statut_paiement_arrhes: "non_recu", statut_paiement_solde: "non_regle" }), 750);
});

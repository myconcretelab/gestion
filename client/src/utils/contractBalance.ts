import type { Contrat } from "./types";

type ContractBalanceInput = Pick<Contrat,
  "arrhes_montant" | "solde_montant" | "statut_paiement_arrhes" | "statut_paiement_solde"
>;

export const getContractRemainingDueAmount = (contract: ContractBalanceInput) => {
  const deposit = contract.statut_paiement_arrhes === "recu" ? 0 : Math.max(0, contract.arrhes_montant);
  const balance = contract.statut_paiement_solde === "regle" ? 0 : Math.max(0, contract.solde_montant);
  return Math.round((deposit + balance) * 100) / 100;
};

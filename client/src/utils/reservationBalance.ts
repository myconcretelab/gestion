export type ReservationBalanceInput = {
  prix_total?: number | null;
  remise_montant?: number | null;
  frais_optionnels_montant?: number | null;
};

export type LinkedContractBalanceInput = {
  arrhes_montant?: number | null;
  solde_montant?: number | null;
  statut_paiement_solde?: string | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export const getReservationRemainingDueAmount = (
  reservation: ReservationBalanceInput,
  linkedContract: LinkedContractBalanceInput,
) => {
  if (linkedContract.statut_paiement_solde === "regle") return 0;

  const stayAmount = Number(reservation.prix_total ?? 0);
  const discountAmount = Number(reservation.remise_montant ?? 0);
  const optionalFeesAmount = Number(reservation.frais_optionnels_montant ?? 0);
  const depositAmount = Number(linkedContract.arrhes_montant ?? 0);
  const currentStayTotal = round2(stayAmount - discountAmount + optionalFeesAmount);

  if (currentStayTotal <= 0) {
    return round2(Math.max(0, Number(linkedContract.solde_montant ?? 0)));
  }

  return round2(Math.max(0, currentStayTotal - depositAmount));
};

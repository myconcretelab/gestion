export const cents = (amount: number) => {
  const value = Math.round(amount * 100);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Montant de réservation invalide.");
  return value;
};

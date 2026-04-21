import { round2 } from "../utils/money.js";

export const sanitizeReservationAmount = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return round2(Math.max(0, numeric));
};

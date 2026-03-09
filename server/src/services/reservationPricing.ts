import { round2 } from "../utils/money.js";

export type ReservationCommissionMode = "euro" | "percent";

export const normalizeReservationCommissionMode = (value: unknown): ReservationCommissionMode =>
  value === "percent" ? "percent" : "euro";

export const sanitizeReservationAmount = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return round2(Math.max(0, numeric));
};

export const sanitizeReservationCommissionValue = (value: unknown, mode: ReservationCommissionMode) => {
  const sanitized = sanitizeReservationAmount(value);
  if (mode === "percent") return Math.min(99.99, sanitized);
  return sanitized;
};

export const computeReservationCommissionAmount = (
  grossTotal: number,
  mode: ReservationCommissionMode,
  value: number
) => {
  const sanitizedTotal = sanitizeReservationAmount(grossTotal);
  const sanitizedValue = sanitizeReservationCommissionValue(value, mode);
  if (mode === "percent") {
    return round2((sanitizedTotal * sanitizedValue) / 100);
  }
  return round2(Math.min(sanitizedTotal, sanitizedValue));
};

export const computeReservationNetStayTotalFromGross = (params: {
  grossStayTotal: number;
  optionsTotal: number;
  commissionMode?: ReservationCommissionMode | null;
  commissionValue?: number;
  remiseMontant?: number;
}) => {
  const grossStayTotal = sanitizeReservationAmount(params.grossStayTotal);
  const optionsTotal = sanitizeReservationAmount(params.optionsTotal);
  const commissionMode = normalizeReservationCommissionMode(params.commissionMode);
  const commissionValue = sanitizeReservationCommissionValue(params.commissionValue ?? 0, commissionMode);
  const remiseMontant = sanitizeReservationAmount(params.remiseMontant ?? 0);
  const grossTotal = round2(grossStayTotal + optionsTotal);
  const commissionAmount = computeReservationCommissionAmount(grossTotal, commissionMode, commissionValue);
  return round2(Math.max(0, grossStayTotal - commissionAmount - remiseMontant));
};

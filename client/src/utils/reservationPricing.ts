export type ReservationCommissionMode = "euro" | "percent";

export type ReservationPricingPreview = {
  baseStayTotal: number;
  baseTotal: number;
  commissionAmount: number;
  totalAdjustments: number;
  adjustedStayTotal: number;
  adjustedTotal: number;
  adjustedNightlyPrice: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

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
  totalBeforeAdjustments: number,
  mode: ReservationCommissionMode,
  value: number
) => {
  const sanitizedTotal = sanitizeReservationAmount(totalBeforeAdjustments);
  const sanitizedValue = sanitizeReservationCommissionValue(value, mode);
  if (mode === "percent") {
    return round2((sanitizedTotal * sanitizedValue) / 100);
  }
  return round2(Math.min(sanitizedTotal, sanitizedValue));
};

export const computeReservationBaseTotalFromAdjustedTotal = (params: {
  adjustedTotal: number;
  commissionMode?: ReservationCommissionMode | null;
  commissionValue?: number;
  remiseMontant?: number;
}) => {
  const commissionMode = normalizeReservationCommissionMode(params.commissionMode);
  const commissionValue = sanitizeReservationCommissionValue(params.commissionValue ?? 0, commissionMode);
  const remiseMontant = sanitizeReservationAmount(params.remiseMontant ?? 0);
  const adjustedTotal = sanitizeReservationAmount(params.adjustedTotal);

  if (commissionMode === "percent") {
    const ratio = 1 - commissionValue / 100;
    if (ratio <= 0) return round2(adjustedTotal + remiseMontant);
    return round2((adjustedTotal + remiseMontant) / ratio);
  }

  return round2(adjustedTotal + commissionValue + remiseMontant);
};

export const computeReservationBaseStayTotalFromAdjustedStay = (params: {
  adjustedStayTotal: number;
  previewOptionsTotal?: number;
  commissionMode?: ReservationCommissionMode | null;
  commissionValue?: number;
  remiseMontant?: number;
}) => {
  const adjustedStayTotal = sanitizeReservationAmount(params.adjustedStayTotal);
  const previewOptionsTotal = sanitizeReservationAmount(params.previewOptionsTotal);
  const baseTotal = computeReservationBaseTotalFromAdjustedTotal({
    adjustedTotal: round2(adjustedStayTotal + previewOptionsTotal),
    commissionMode: params.commissionMode,
    commissionValue: params.commissionValue,
    remiseMontant: params.remiseMontant,
  });

  return round2(Math.max(0, baseTotal - previewOptionsTotal));
};

export const computeReservationPricingPreview = (params: {
  baseStayTotal: number;
  nights?: number;
  previewOptionsTotal?: number;
  commissionMode?: ReservationCommissionMode | null;
  commissionValue?: number;
  remiseMontant?: number;
}): ReservationPricingPreview => {
  const commissionMode = normalizeReservationCommissionMode(params.commissionMode);
  const commissionValue = sanitizeReservationCommissionValue(params.commissionValue ?? 0, commissionMode);
  const remiseMontant = sanitizeReservationAmount(params.remiseMontant ?? 0);
  const nights = Math.max(0, Number(params.nights ?? 0));
  const previewOptionsTotal = sanitizeReservationAmount(params.previewOptionsTotal);
  const baseStayTotal = sanitizeReservationAmount(params.baseStayTotal);
  const baseTotal = round2(baseStayTotal + previewOptionsTotal);
  const commissionAmount = computeReservationCommissionAmount(baseTotal, commissionMode, commissionValue);
  const totalAdjustments = round2(commissionAmount + remiseMontant);
  const adjustedTotal = round2(Math.max(0, baseTotal - totalAdjustments));
  const adjustedStayTotal = round2(Math.max(0, adjustedTotal - previewOptionsTotal));
  const adjustedNightlyPrice = nights > 0 ? round2(adjustedStayTotal / nights) : 0;

  return {
    baseStayTotal,
    baseTotal,
    commissionAmount,
    totalAdjustments,
    adjustedStayTotal,
    adjustedTotal,
    adjustedNightlyPrice,
  };
};

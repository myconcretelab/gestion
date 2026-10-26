export const BOOKING_SOURCES = [
  "Direct",
  "Airbnb",
  "Abritel",
  "Gites de France",
  "HomeExchange",
  "Autre",
  "À préciser",
] as const;
export const RESERVATION_PAYMENT_METHODS = [
  "Chèque",
  "Virement",
  "Espèces",
  "Carte",
  "Versement plateforme",
  "Autre",
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export const AUTOMATIC_PAYMENT_PLATFORMS = [
  "Airbnb",
  "Abritel",
  "Gites de France",
] as const;
export type ReservationPaymentSettings = {
  platform_payments_received_automatically: boolean;
};
export type ReservationPaymentMethod =
  (typeof RESERVATION_PAYMENT_METHODS)[number];
export const legacyPaymentMethod = (
  value?: string | null,
): ReservationPaymentMethod | null =>
  RESERVATION_PAYMENT_METHODS.find((method) => method === value) ?? null;
export const getBookingSource = (reservation: {
  booking_source?: string | null;
  source_paiement?: string | null;
}) =>
  reservation.booking_source ||
  (["Airbnb", "Abritel", "Gites de France", "HomeExchange"].includes(
    reservation.source_paiement || "",
  )
    ? reservation.source_paiement!
    : "Direct");

export type ReservationPaymentEntry = {
  id: string;
  amount: number;
  method: string | null;
  purpose: string;
  paid_on: string | null;
  note: string | null;
  origin: "manual" | "legacy" | "stripe" | "platform";
  voided_at: string | null;
  refunded_amount?: number;
};
export type ReservationPaymentTracking = {
  managed: boolean;
  total: number;
  deposit: number;
  received: number;
  remaining: number;
  overpaid: number;
  requires_review: boolean;
  entries: ReservationPaymentEntry[];
  platform?: {
    source: string;
    automatic: boolean;
    accommodation: number;
    expected: number;
    extras_remaining: number;
  };
};

export const isReservationPaymentTracking = (
  value: unknown,
): value is ReservationPaymentTracking => {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    ["total", "received", "remaining", "deposit", "overpaid"].every(
      (key) => typeof data[key] === "number" && Number.isFinite(data[key]),
    ) &&
    typeof data.managed === "boolean" &&
    typeof data.requires_review === "boolean" &&
    Array.isArray(data.entries)
  );
};

export const getContractReceiptStatus = (
  tracking: ReservationPaymentTracking,
  deposit: number,
  total: number,
) => {
  const depositCents = Math.round(deposit * 100);
  const depositPaid =
    !tracking.requires_review &&
    Math.round(tracking.received * 100) >= depositCents;
  const entries = tracking.entries
    .filter((entry) => !entry.voided_at && entry.amount > 0)
    .sort(
      (left, right) =>
        (left.paid_on?.slice(0, 10) || "").localeCompare(
          right.paid_on?.slice(0, 10) || "",
        ) ||
        Number(right.purpose === "deposit") -
          Number(left.purpose === "deposit") ||
        left.id.localeCompare(right.id),
    );
  const contributors: ReservationPaymentEntry[] = [];
  let allocated = 0;
  for (const entry of entries) {
    if (allocated >= depositCents) break;
    contributors.push(entry);
    allocated += Math.round(entry.amount * 100);
  }
  const methods = new Set(
    contributors.map((entry) =>
      entry.origin === "stripe" ? "Stripe" : entry.method,
    ),
  );
  const date =
    contributors.length && contributors.every((entry) => entry.paid_on)
      ? contributors[contributors.length - 1].paid_on
      : null;
  return {
    statut_paiement_arrhes: depositPaid
      ? ("recu" as const)
      : ("non_recu" as const),
    statut_paiement_solde:
      !tracking.requires_review &&
      total > 0 &&
      Math.round(tracking.received * 100) >= Math.round(total * 100)
        ? ("regle" as const)
        : ("non_regle" as const),
    date_paiement_arrhes: depositPaid ? date : null,
    mode_paiement_arrhes:
      depositPaid && methods.size === 1 ? [...methods][0] : null,
  };
};

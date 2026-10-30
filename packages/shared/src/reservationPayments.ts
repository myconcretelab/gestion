export const BOOKING_SOURCES = [
  "Direct",
  "Airbnb",
  "Abritel",
  "Booking.com",
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
  first_payment_default: "full" | "deposit";
  shortcuts: ReservationPaymentShortcut[];
  platforms?: import("./ota.js").OtaChannel[];
};
export type ReservationPaymentMethod =
  (typeof RESERVATION_PAYMENT_METHODS)[number];
export type ReservationPaymentShortcut = {
  id: string;
  label: string;
  target: "remaining" | "deposit";
  method: ReservationPaymentMethod;
  color: string;
};
export const DEFAULT_RESERVATION_PAYMENT_SHORTCUTS: ReservationPaymentShortcut[] =
  [
    {
      id: "balance-cheque",
      label: "Chq.",
      target: "remaining",
      method: "Chèque",
      color: "#2563EB",
    },
    {
      id: "balance-cash",
      label: "Esp.",
      target: "remaining",
      method: "Espèces",
      color: "#15803D",
    },
    {
      id: "balance-transfer",
      label: "Vir.",
      target: "remaining",
      method: "Virement",
      color: "#7C3AED",
    },
  ];
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
  reservation_id?: string;
  ota?: import("./ota.js").OtaAmounts;
};
export type ReservationPaymentTracking = {
  first_payment_default?: ReservationPaymentSettings["first_payment_default"];
  payment_shortcuts?: ReservationPaymentShortcut[];
  payment_channels?: string[];
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

export const getReservationPaymentShortcutValue = (
  tracking: ReservationPaymentTracking,
  shortcut: Pick<ReservationPaymentShortcut, "target">,
) => {
  const remaining = Math.max(0, Math.round(tracking.remaining * 100));
  const depositDue = tracking.platform
    ? 0
    : Math.max(
        0,
        Math.min(
          remaining,
          Math.round(tracking.deposit * 100) -
            Math.round(tracking.received * 100),
        ),
      );
  return {
    purpose:
      shortcut.target === "deposit"
        ? ("deposit" as const)
        : tracking.received > 0 || tracking.platform
          ? ("balance" as const)
          : ("full" as const),
    amount: (shortcut.target === "deposit" ? depositDue : remaining) / 100,
  };
};

export const getSuggestedReservationPayment = (
  tracking: ReservationPaymentTracking,
) => {
  const depositDue = Math.max(
    0,
    Math.min(tracking.remaining, tracking.deposit - tracking.received),
  );
  if (tracking.platform || tracking.received > 0)
    return { purpose: "balance" as const, amount: tracking.remaining };
  if (tracking.first_payment_default === "deposit" && depositDue > 0)
    return { purpose: "deposit" as const, amount: depositDue };
  return { purpose: "full" as const, amount: tracking.remaining };
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

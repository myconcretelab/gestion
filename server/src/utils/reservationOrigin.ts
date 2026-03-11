import { randomBytes } from "node:crypto";

export const RESERVATION_ORIGIN_SYSTEMS = ["app", "what-today", "ical", "pump", "har", "csv", "legacy"] as const;

export type ReservationOriginSystem = (typeof RESERVATION_ORIGIN_SYSTEMS)[number];

type ReservationOriginLike = {
  origin_system?: string | null;
  export_to_ical?: boolean | null;
  commentaire?: string | null;
  source_paiement?: string | null;
  prix_total?: number | string | null;
  prix_par_nuit?: number | string | null;
};

const EXPORTABLE_ORIGINS = new Set<ReservationOriginSystem>(["app", "what-today"]);
const ICAL_TO_VERIFY_MARKER = "[ICAL_TO_VERIFY]";
const LEGACY_IMPORTED_SOURCES = new Set(["", "airbnb", "a definir", "adefinir", "abritel", "gitesdefrance", "homeexchange"]);

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const toFiniteNumber = (value: number | string | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const generateIcalExportToken = () => randomBytes(24).toString("base64url");

export const normalizeReservationOriginSystem = (value: string | null | undefined): ReservationOriginSystem | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return RESERVATION_ORIGIN_SYSTEMS.find((item) => item === normalized) ?? null;
};

export const inferLegacyReservationOriginSystem = (reservation: ReservationOriginLike): ReservationOriginSystem => {
  const comment = typeof reservation.commentaire === "string" ? reservation.commentaire : "";
  if (comment.includes(ICAL_TO_VERIFY_MARKER)) {
    return "ical";
  }

  const total = toFiniteNumber(reservation.prix_total);
  const nightly = toFiniteNumber(reservation.prix_par_nuit);
  const normalizedSource = normalizeTextKey(String(reservation.source_paiement ?? ""));
  if (total <= 0 && nightly <= 0 && LEGACY_IMPORTED_SOURCES.has(normalizedSource)) {
    return "ical";
  }

  return "app";
};

export const getReservationOriginSystem = (reservation: ReservationOriginLike): ReservationOriginSystem => {
  return normalizeReservationOriginSystem(reservation.origin_system) ?? inferLegacyReservationOriginSystem(reservation);
};

export const shouldExportReservationToIcal = (reservation: ReservationOriginLike) => {
  if (typeof reservation.export_to_ical === "boolean") {
    return reservation.export_to_ical;
  }

  return EXPORTABLE_ORIGINS.has(getReservationOriginSystem(reservation));
};

export const buildReservationOriginData = (params: {
  originSystem: ReservationOriginSystem;
  originReference?: string | null;
  exportToIcal: boolean;
}) => ({
  origin_system: params.originSystem,
  origin_reference: params.originReference?.trim() || null,
  export_to_ical: params.exportToIcal,
});

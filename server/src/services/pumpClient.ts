import { env } from "../config/env.js";
import type { ParsedImportedReservation } from "./reservationImports.js";
import { normalizeImportedComment, normalizeImportedHostName } from "../utils/reservationText.js";
import {
  getLocalPumpLatestReservations,
  getLocalPumpRefreshStatus,
  triggerLocalPumpRefresh,
} from "./pumpAutomation.js";

type PumpLatestReservation = {
  id?: string;
  listingId?: string | null;
  listing_id?: string | null;
  type?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  nights?: number | null;
  guestName?: string | null;
  guest_name?: string | null;
  name?: string | null;
  payout?: number | null;
  comment?: string | null;
  commentaire?: string | null;
  note?: string | null;
};

export type PumpStatusResponse = {
  sessionId: string | null;
  status: string;
  updatedAt?: string | null;
  reservationCount?: number;
  errors?: Array<{ message?: string | null }>;
  results?: Record<string, unknown> | null;
};

export type PumpLatestResponse = {
  sessionId: string | null;
  status: string;
  updatedAt?: string | null;
  reservationCount: number;
  reservations: PumpLatestReservation[];
  stats?: {
    inspectedResponses: number;
    matchedResponses: number;
  };
};

const describePumpFetchCause = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;

  const cause = value as {
    message?: unknown;
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    hostname?: unknown;
    host?: unknown;
    port?: unknown;
    address?: unknown;
    cause?: unknown;
  };

  const details = [
    typeof cause.message === "string" ? cause.message.trim() : null,
    typeof cause.code === "string" ? `code=${cause.code}` : null,
    typeof cause.errno === "string" ? `errno=${cause.errno}` : null,
    typeof cause.syscall === "string" ? `syscall=${cause.syscall}` : null,
    typeof cause.hostname === "string" ? `hostname=${cause.hostname}` : null,
    typeof cause.host === "string" ? `host=${cause.host}` : null,
    typeof cause.address === "string" ? `address=${cause.address}` : null,
    typeof cause.port === "number" ? `port=${cause.port}` : null,
  ].filter(Boolean);

  if (details.length > 0) {
    return details.join(", ");
  }

  return describePumpFetchCause(cause.cause);
};

export const buildPumpFetchErrorMessage = (url: string, error: unknown) => {
  const defaultHint = "Vérifiez PUMP_API_BASE_URL, l'accessibilité réseau entre les services et le certificat TLS si l'URL est en HTTPS.";

  if (!(error instanceof Error)) {
    return `Échec de connexion à Pump (${url}). ${defaultHint}`;
  }

  const causeDetails = describePumpFetchCause(error.cause);

  if (error.message.trim().toLowerCase() === "fetch failed") {
    return `Échec de connexion à Pump (${url}). ${causeDetails ? `Cause: ${causeDetails}. ` : ""}${defaultHint}`;
  }

  return `Erreur Pump lors de l'appel ${url}: ${error.message}${causeDetails ? ` | Cause: ${causeDetails}` : ""}`;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizePumpReservation = (reservation: PumpLatestReservation): ParsedImportedReservation => {
  const listingId = normalizeString(reservation.listingId ?? reservation.listing_id) ?? "";
  const checkIn = normalizeString(reservation.checkIn ?? reservation.check_in) ?? "";
  const checkOut = normalizeString(reservation.checkOut ?? reservation.check_out) ?? "";
  const nights = Number.isFinite(Number(reservation.nights)) ? Number(reservation.nights) : 0;
  const normalizedName = normalizeImportedHostName(
    reservation.guestName ?? reservation.guest_name ?? reservation.name
  );
  const normalizedComment = normalizeImportedComment(
    reservation.comment ?? reservation.commentaire ?? reservation.note
  );

  return {
    id:
      normalizeString(reservation.id) ??
      ["pump", listingId, checkIn, checkOut, normalizedName, normalizedComment]
        .map((part) => String(part ?? ""))
        .join("|"),
    listingId,
    type: reservation.type === "airbnb" ? "airbnb" : "personal",
    checkIn,
    checkOut,
    nights,
    name: normalizedName,
    payout: typeof reservation.payout === "number" && Number.isFinite(reservation.payout) ? reservation.payout : null,
    comment: normalizedComment,
  };
};

export const getPumpLatestReservations = async () => {
  const latest = await getLocalPumpLatestReservations();
  return {
    ...latest,
    reservations: latest.reservations as PumpLatestReservation[],
  } satisfies PumpLatestResponse;
};

export const getPumpRefreshStatus = (): Promise<PumpStatusResponse> => getLocalPumpRefreshStatus();

export const triggerPumpRefresh = () => triggerLocalPumpRefresh();

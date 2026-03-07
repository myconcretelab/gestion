import { env } from "../config/env.js";
import type { ParsedHarReservation } from "./harParser.js";
import { normalizeImportedComment, normalizeImportedHostName } from "../utils/reservationText.js";

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
};

export type PumpLatestResponse = {
  sessionId: string | null;
  status: string;
  updatedAt?: string | null;
  reservationCount: number;
  reservations: PumpLatestReservation[];
};

const getPumpBaseUrl = () => String(env.PUMP_API_BASE_URL || "").trim().replace(/\/+$/, "");

const getPumpHeaders = () => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (env.PUMP_API_KEY) {
    headers["x-api-key"] = env.PUMP_API_KEY;
  }

  return headers;
};

const pumpFetch = async <T>(path: string, init: RequestInit = {}) => {
  const baseUrl = getPumpBaseUrl();
  if (!baseUrl) {
    throw new Error("PUMP_API_BASE_URL n'est pas configurée.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...getPumpHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Erreur Pump (${response.status})`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizePumpReservation = (reservation: PumpLatestReservation): ParsedHarReservation => {
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

export const getPumpLatestReservations = () => pumpFetch<PumpLatestResponse>("/latest");

export const getPumpRefreshStatus = () => pumpFetch<PumpStatusResponse>("/status");

export const triggerPumpRefresh = () =>
  pumpFetch<{ success: boolean; sessionId: string; status: string; message?: string }>("/refresh", {
    method: "POST",
  });

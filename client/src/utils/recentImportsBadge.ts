export const RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT = "recent-imported-reservations-created";
export const RECENT_IMPORTED_RESERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const RECENT_IMPORTED_RESERVATION_ORIGINS = new Set(["ical", "pump"]);

type RecentImportedReservationsCreatedDetail = {
  createdCount: number;
};

type RecentImportedReservationLike = {
  origin_system?: string | null;
  createdAt?: string | null;
};

export const isRecentImportedReservation = (
  reservation: RecentImportedReservationLike | null | undefined,
  nowMs = Date.now()
) => {
  if (!reservation) return false;
  if (!RECENT_IMPORTED_RESERVATION_ORIGINS.has(String(reservation.origin_system ?? "").trim().toLowerCase())) {
    return false;
  }

  const createdAtMs = reservation.createdAt ? new Date(reservation.createdAt).getTime() : Number.NaN;
  if (!Number.isFinite(createdAtMs)) return false;

  return createdAtMs >= nowMs - RECENT_IMPORTED_RESERVATION_WINDOW_MS && createdAtMs <= nowMs;
};

export const dispatchRecentImportedReservationsCreated = (createdCount: number) => {
  const normalizedCount = Math.max(0, Math.trunc(createdCount));
  if (normalizedCount <= 0 || typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<RecentImportedReservationsCreatedDetail>(RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT, {
      detail: { createdCount: normalizedCount },
    })
  );
};

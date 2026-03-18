export const RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT = "recent-imported-reservations-created";

type RecentImportedReservationsCreatedDetail = {
  createdCount: number;
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

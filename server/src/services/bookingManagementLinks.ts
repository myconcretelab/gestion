import { env } from "../config/env.js";

export type BookingManagementTarget = {
  id: string;
  date_entree: Date | string;
  gite: { id?: string };
};

export const buildBookingManagementAction = (
  payload: BookingManagementTarget,
  reservationId?: string | null,
) => {
  try {
    const url = new URL(env.APP_PUBLIC_URL);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    url.search = "";
    url.hash = "";
    const basePath = url.pathname.replace(/\/$/, "");
    if (reservationId) {
      const arrival = new Date(payload.date_entree);
      if (!Number.isFinite(arrival.getTime())) return;
      url.pathname = basePath + "/reservations";
      url.searchParams.set("year", String(arrival.getUTCFullYear()));
      url.searchParams.set("month", String(arrival.getUTCMonth() + 1));
      if (payload.gite.id) url.searchParams.set("tab", payload.gite.id);
      url.searchParams.set("focus", reservationId);
      return { label: "Voir la réservation", url: url.href };
    }
    url.pathname = basePath + "/demandes/" + encodeURIComponent(payload.id);
    return { label: "Voir la demande", url: url.href };
  } catch {
    return;
  }
};

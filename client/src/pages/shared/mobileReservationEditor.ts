export const MOBILE_RESERVATION_EDITOR_PATH = "/reservations/mobile";

type MobileReservationEditorCreateParams = {
  mode: "create";
  origin: "today" | "calendar";
  backHref: string;
  giteId: string;
  entry: string;
  exit: string;
};

type MobileReservationEditorEditParams = {
  mode: "edit";
  origin: "today" | "calendar";
  backHref: string;
  reservationId: string;
};

type MobileReservationEditorHrefParams =
  | MobileReservationEditorCreateParams
  | MobileReservationEditorEditParams;

export const sanitizeMobileReservationBackHref = (value: string | null | undefined, fallback = "/aujourdhui") => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  return trimmed;
};

export const buildCalendarReservationReturnHref = (params: {
  giteId: string;
  year: number;
  month: number;
}) => {
  const query = new URLSearchParams();
  if (params.giteId) query.set("gite", params.giteId);
  if (Number.isFinite(params.year)) query.set("year", String(params.year));
  if (Number.isFinite(params.month)) query.set("month", String(params.month));
  const search = query.toString();
  return search ? `/calendrier?${search}` : "/calendrier";
};

export const buildMobileReservationEditorHref = (params: MobileReservationEditorHrefParams) => {
  const query = new URLSearchParams();
  query.set("mode", params.mode);
  query.set("origin", params.origin);
  query.set("back", sanitizeMobileReservationBackHref(params.backHref));

  if (params.mode === "edit") {
    query.set("reservationId", params.reservationId);
  } else {
    query.set("giteId", params.giteId);
    query.set("entry", params.entry);
    query.set("exit", params.exit);
  }

  return `${MOBILE_RESERVATION_EDITOR_PATH}?${query.toString()}`;
};

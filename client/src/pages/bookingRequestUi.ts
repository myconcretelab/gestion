import type { BookingRequest, BookingRequestStatus } from "../utils/types";

export const getBookingRequestOptionLines = (request: BookingRequest) => {
  const options = request.options;
  const prices = request.pricing_snapshot.options_detail;
  return [
    { enabled: options.draps?.enabled, label: `Draps (${options.draps?.nb_lits ?? 0} lit(s))`, amount: prices?.draps },
    { enabled: options.linge_toilette?.enabled, label: `Linge de toilette (${options.linge_toilette?.nb_personnes ?? 0} personne(s))`, amount: prices?.linge },
    { enabled: options.menage?.enabled, label: "Ménage", amount: prices?.menage },
    { enabled: options.depart_tardif?.enabled, label: "Départ tardif", amount: prices?.depart_tardif },
    { enabled: options.chiens?.enabled, label: `Chiens (${options.chiens?.nb ?? 0})`, amount: prices?.chiens },
  ].filter((line) => line.enabled);
};

export const requestStatusLabels: Record<BookingRequestStatus, string> = {
  pending: "À traiter",
  approved: "Approuvée",
  rejected: "Refusée",
  expired: "Expirée",
};

export const requestStatusDetail: Record<
  BookingRequestStatus,
  { title: string; description: string }
> = {
  pending: {
    title: "Demande en attente",
    description: "Aucune réservation n'a encore été créée pour cette demande.",
  },
  approved: {
    title: "Demande approuvée",
    description: "La demande est clôturée et la réservation correspondante a été créée.",
  },
  rejected: {
    title: "Demande refusée",
    description: "La demande est clôturée sans création de réservation.",
  },
  expired: {
    title: "Demande expirée",
    description: "Le blocage temporaire est terminé sans validation.",
  },
};

const calendarDayNumber = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;

export const formatBookingRequestCreatedAt = (value?: string, now = new Date()) => {
  if (!value) return "Date inconnue";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const daysAgo = calendarDayNumber(now) - calendarDayNumber(date);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  if (daysAgo === 0) return `Aujourd’hui, ${time}`;
  if (daysAgo === 1) return `Hier, ${time}`;
  if (daysAgo === 2) return `Avant-hier, ${time}`;

  return date.toLocaleDateString("fr-FR");
};

export const getRequestTimelineLabel = (request: BookingRequest) => {
  if (request.status === "pending") return "Blocage jusqu’au";
  if (request.status === "expired") return "Expiration";
  return "Décision";
};

export const getRequestTimelineValue = (request: BookingRequest) =>
  new Date(request.decided_at ?? request.hold_expires_at).toLocaleString("fr-FR");

export const buildApprovedReservationHref = (request: BookingRequest) => {
  const reservationId = request.approved_reservation?.id ?? request.approved_reservation_id;
  if (!reservationId) return "/reservations";

  const params = new URLSearchParams({ focus: reservationId });
  if (request.gite_id) params.set("tab", request.gite_id);
  const dateEntree = request.approved_reservation?.date_entree ?? request.date_entree;
  const year = Number.parseInt(String(dateEntree ?? "").slice(0, 4), 10);
  if (Number.isFinite(year) && year > 0) params.set("year", String(year));

  return `/reservations?${params.toString()}#reservation-${encodeURIComponent(reservationId)}`;
};

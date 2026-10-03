import prisma from "../db/prisma.js";

export const CLEANING_CHECK_START_MINUTES = 8 * 60 + 30;

type ReadinessGite = {
  id: string;
  nom: string;
  prefixe_contrat: string;
  ordre: number;
};

type ReadinessReservation = {
  id: string;
  gite_id: string | null;
  date_entree: Date;
  date_sortie: Date;
  departure_cleaning_checked_at: Date | null;
};

export type GiteCleaningReadiness = {
  gite_id: string;
  gite_name: string;
  gite_prefix: string;
  gite_order: number;
  departure_reservation_id: string;
  departure_date: string;
  next_arrival_reservation_id: string | null;
  next_arrival_date: string | null;
  checked_at: Date | null;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

export const getParisClock = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateIso: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
};

export const isCleaningCheckAvailable = (readiness: Pick<GiteCleaningReadiness, "departure_date">, now: Date) => {
  const clock = getParisClock(now);
  return readiness.departure_date < clock.dateIso
    || (readiness.departure_date === clock.dateIso && clock.minutes >= CLEANING_CHECK_START_MINUTES);
};

export const buildGiteCleaningReadiness = (
  gites: ReadinessGite[],
  reservations: ReadinessReservation[],
  now: Date,
): GiteCleaningReadiness[] => {
  const { dateIso: todayIso } = getParisClock(now);

  return gites.flatMap((gite) => {
    const rows = reservations.filter((reservation) => reservation.gite_id === gite.id);
    const lastDeparture = rows
      .filter((reservation) => toIsoDate(reservation.date_sortie) <= todayIso)
      .sort((left, right) => right.date_sortie.getTime() - left.date_sortie.getTime())[0];
    if (!lastDeparture) return [];

    const nextArrival = rows
      .filter((reservation) =>
        reservation.id !== lastDeparture.id
        && reservation.date_entree.getTime() >= lastDeparture.date_sortie.getTime()
      )
      .sort((left, right) => left.date_entree.getTime() - right.date_entree.getTime())[0] ?? null;

    // Once a later stay has started on a previous day, this preparation window
    // is consumed and must not leak into the following occupied stay.
    if (nextArrival && toIsoDate(nextArrival.date_entree) < todayIso) return [];

    return [{
      gite_id: gite.id,
      gite_name: gite.nom,
      gite_prefix: gite.prefixe_contrat,
      gite_order: gite.ordre,
      departure_reservation_id: lastDeparture.id,
      departure_date: toIsoDate(lastDeparture.date_sortie),
      next_arrival_reservation_id: nextArrival?.id ?? null,
      next_arrival_date: nextArrival ? toIsoDate(nextArrival.date_entree) : null,
      checked_at: lastDeparture.departure_cleaning_checked_at,
    }];
  }).sort((left, right) => left.gite_order - right.gite_order || left.gite_name.localeCompare(right.gite_name, "fr"));
};

export const loadGiteCleaningReadiness = async (gites: ReadinessGite[], now = new Date()) => {
  if (gites.length === 0) return [];
  const reservations = await prisma.reservation.findMany({
    where: { gite_id: { in: gites.map((gite) => gite.id) } },
    select: {
      id: true,
      gite_id: true,
      date_entree: true,
      date_sortie: true,
      departure_cleaning_checked_at: true,
    },
  });
  return buildGiteCleaningReadiness(gites, reservations, now);
};

export const updateGiteCleaningReadiness = async (
  readiness: GiteCleaningReadiness,
  checked: boolean,
  checkedAt = new Date(),
) => {
  const value = checked ? readiness.checked_at ?? checkedAt : null;
  await prisma.$transaction([
    prisma.reservation.update({
      where: { id: readiness.departure_reservation_id },
      data: { departure_cleaning_checked_at: value },
    }),
    ...(readiness.next_arrival_reservation_id ? [
      prisma.reservation.update({
        where: { id: readiness.next_arrival_reservation_id },
        data: { arrival_cleaning_checked_at: value },
      }),
    ] : []),
  ]);
  return value;
};

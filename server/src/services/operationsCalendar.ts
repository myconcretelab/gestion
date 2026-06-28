import prisma from "../db/prisma.js";
import { hasValidOperationsCalendarToken } from "./operationsCalendarSettings.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_DURATION_MINUTES = 30;

const escapeIcalText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

const formatUtcTimestamp = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const formatLocalDateTime = (date: Date, time: string, minuteOffset = 0) => {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  const localWallTime = new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
  localWallTime.setUTCMinutes(
    (match ? Number(match[1]) * 60 + Number(match[2]) : 0) + minuteOffset,
  );
  return localWallTime.toISOString().slice(0, 19).replace(/[-:]/g, "");
};

const foldIcalLine = (line: string) => {
  if (Buffer.byteLength(line, "utf8") <= 74) return line;
  const chunks: string[] = [];
  let current = "";
  for (const character of line) {
    const candidate = `${current}${character}`;
    if (Buffer.byteLength(candidate, "utf8") > 74) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join("\r\n");
};

type OperationsReservation = {
  id: string;
  date_entree: Date;
  date_sortie: Date;
  updatedAt: Date;
  gite: {
    nom: string;
    heure_arrivee_defaut: string;
    heure_depart_defaut: string;
  };
  heure_arrivee?: string | null;
  heure_depart?: string | null;
};

export const buildOperationsCalendarIcs = (reservations: OperationsReservation[], now = new Date()) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//contrats//programme-gites//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Programme des gîtes",
    "X-WR-TIMEZONE:Europe/Paris",
  ];

  const pushEvent = (reservation: OperationsReservation, kind: "arrival" | "departure") => {
    const isArrival = kind === "arrival";
    const date = isArrival ? reservation.date_entree : reservation.date_sortie;
    const time = (isArrival ? reservation.heure_arrivee : reservation.heure_depart)
      || (isArrival ? reservation.gite.heure_arrivee_defaut : reservation.gite.heure_depart_defaut);
    const summary = isArrival
      ? `Arrivée au gîte ${reservation.gite.nom}`
      : `Départ du gîte ${reservation.gite.nom}`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${kind}-${reservation.id}@contrats`);
    lines.push(`DTSTAMP:${formatUtcTimestamp(reservation.updatedAt || now)}`);
    lines.push(`DTSTART;TZID=Europe/Paris:${formatLocalDateTime(date, time)}`);
    lines.push(`DTEND;TZID=Europe/Paris:${formatLocalDateTime(date, time, EVENT_DURATION_MINUTES)}`);
    lines.push(foldIcalLine(`SUMMARY:${escapeIcalText(summary)}`));
    lines.push(foldIcalLine(`DESCRIPTION:${escapeIcalText(`${summary}.`)}`));
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  };

  for (const reservation of reservations) {
    pushEvent(reservation, "departure");
    pushEvent(reservation, "arrival");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
};

export const getOperationsCalendar = async (token: string) => {
  if (!token || !hasValidOperationsCalendarToken(token)) return null;

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const from = new Date(todayUtc.getTime() - DAY_MS);
  const reservations = await prisma.reservation.findMany({
    where: {
      gite_id: { not: null },
      date_sortie: { gte: from },
    },
    select: {
      id: true,
      date_entree: true,
      date_sortie: true,
      updatedAt: true,
      gite: {
        select: {
          nom: true,
          heure_arrivee_defaut: true,
          heure_depart_defaut: true,
        },
      },
    },
    orderBy: [{ date_entree: "asc" }, { gite: { ordre: "asc" } }, { id: "asc" }],
  });

  const reservationIds = reservations.map((reservation) => reservation.id);
  const contracts = reservationIds.length > 0
    ? await prisma.contrat.findMany({
        where: { reservation_id: { in: reservationIds } },
        select: { reservation_id: true, heure_arrivee: true, heure_depart: true },
        orderBy: { date_derniere_modif: "desc" },
      })
    : [];
  const timesByReservationId = new Map<string, { heure_arrivee: string; heure_depart: string }>();
  for (const contract of contracts) {
    if (contract.reservation_id && !timesByReservationId.has(contract.reservation_id)) {
      timesByReservationId.set(contract.reservation_id, contract);
    }
  }

  const hydrated = reservations
    .filter((reservation): reservation is typeof reservation & { gite: NonNullable<typeof reservation.gite> } => Boolean(reservation.gite))
    .map((reservation) => ({ ...reservation, ...timesByReservationId.get(reservation.id) }));

  return {
    filename: "programme-gites.ics",
    body: buildOperationsCalendarIcs(hydrated),
    reservationCount: hydrated.length,
    eventCount: hydrated.length * 2,
  };
};

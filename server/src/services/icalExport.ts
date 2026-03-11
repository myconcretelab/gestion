import prisma from "../db/prisma.js";
import { shouldExportReservationToIcal } from "../utils/reservationOrigin.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const escapeIcalText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

const formatUtcTimestamp = (value: Date) => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
};

const formatDateValue = (value: Date) => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const foldIcalLine = (line: string) => {
  if (line.length <= 74) return line;

  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += 74) {
    chunks.push(index === 0 ? line.slice(index, index + 74) : ` ${line.slice(index, index + 74)}`);
  }

  return chunks.join("\r\n");
};

const buildReservationUid = (reservation: {
  id: string;
  origin_system?: string | null;
  origin_reference?: string | null;
  date_entree: Date;
  date_sortie: Date;
}) => {
  if (reservation.origin_system && reservation.origin_reference) {
    return `${reservation.origin_system}-${reservation.origin_reference}-${formatDateValue(reservation.date_entree)}-${formatDateValue(reservation.date_sortie)}@contrats`;
  }

  return `${reservation.id}@contrats`;
};

export const buildReservationsIcs = (params: {
  giteName: string;
  reservations: Array<{
    id: string;
    hote_nom: string;
    date_entree: Date;
    date_sortie: Date;
    source_paiement?: string | null;
    commentaire?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    origin_system?: string | null;
    origin_reference?: string | null;
  }>;
}) => {
  const stamp = formatUtcTimestamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//contrats//reservations//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldIcalLine(`X-WR-CALNAME:${escapeIcalText(`Disponibilites ${params.giteName}`)}`),
  ];

  for (const reservation of params.reservations) {
    const updatedAt = reservation.updatedAt ?? reservation.createdAt ?? new Date();
    const summary = reservation.hote_nom.trim() ? `Reserve - ${reservation.hote_nom.trim()}` : "Reserve";
    const descriptionParts = [
      reservation.source_paiement?.trim() ? `Source: ${reservation.source_paiement.trim()}` : null,
      reservation.commentaire?.trim() ? `Note: ${reservation.commentaire.trim()}` : null,
    ].filter(Boolean) as string[];

    lines.push("BEGIN:VEVENT");
    lines.push(foldIcalLine(`UID:${escapeIcalText(buildReservationUid(reservation))}`));
    lines.push(`DTSTAMP:${formatUtcTimestamp(updatedAt)}`);
    lines.push(`DTSTART;VALUE=DATE:${formatDateValue(reservation.date_entree)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateValue(reservation.date_sortie)}`);
    lines.push(foldIcalLine(`SUMMARY:${escapeIcalText(summary)}`));
    if (descriptionParts.length > 0) {
      lines.push(foldIcalLine(`DESCRIPTION:${escapeIcalText(descriptionParts.join("\n"))}`));
    }
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
};

export const getGiteIcalExport = async (params: { giteId: string; token: string }) => {
  const gite = await prisma.gite.findUnique({
    where: { id: params.giteId },
    select: {
      id: true,
      nom: true,
      prefixe_contrat: true,
      ical_export_token: true,
    },
  });

  if (!gite || !gite.ical_export_token || gite.ical_export_token !== params.token) {
    return null;
  }

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const from = new Date(todayUtc.getTime() - DAY_MS);

  const rows = await prisma.reservation.findMany({
    where: {
      gite_id: gite.id,
      date_sortie: { gte: from },
    },
    select: {
      id: true,
      hote_nom: true,
      date_entree: true,
      date_sortie: true,
      source_paiement: true,
      commentaire: true,
      createdAt: true,
      updatedAt: true,
      origin_system: true,
      origin_reference: true,
      export_to_ical: true,
      prix_total: true,
      prix_par_nuit: true,
    },
    orderBy: [{ date_entree: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
  });

  const reservations = rows.filter((reservation) => shouldExportReservationToIcal(reservation));
  const body = buildReservationsIcs({
    giteName: gite.nom,
    reservations,
  });

  return {
    filename: `${gite.prefixe_contrat || gite.id}-reservations.ics`,
    body,
    reservationCount: reservations.length,
    gite,
  };
};

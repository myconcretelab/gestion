import prisma from "../db/prisma.js";
import { formatEuro } from "../utils/money.js";
import { getSmtpConfigIssues, sendSmtpMail } from "./mailer.js";
import {
  listOpenIcalConflictRecords,
  type IcalConflictRecord,
  type IcalConflictType,
} from "./icalConflicts.js";
import {
  buildDefaultDailyReservationEmailConfig,
  mergeDailyReservationEmailConfig,
  readDailyReservationEmailConfig,
  writeDailyReservationEmailConfig,
  type DailyReservationEmailConfig,
  type DailyReservationEmailRecipientConfig,
} from "./dailyReservationEmailSettings.js";
import {
  buildDefaultDailyReservationEmailRunState,
  readDailyReservationEmailRunState,
  updateDailyReservationEmailRunState,
  type DailyReservationEmailGiteTotal,
  type DailyReservationEmailRunSummary,
  type DailyReservationEmailRunStatus,
} from "./dailyReservationEmailRunState.js";

export type DailyReservationDigestReservation = {
  id: string;
  gite_id: string | null;
  gite_nom: string;
  hote_nom: string;
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  prix_total: number;
  source_paiement: string | null;
  created_at: string;
};

type DailyReservationDigestIcalConflict = {
  id: string;
  type: IcalConflictType;
  detected_at: string;
  gite_nom: string;
  current_hote_nom: string | null;
  current_date_entree: string;
  current_date_sortie: string;
  current_source: string | null;
  incoming_hote_nom: string | null;
  incoming_date_entree: string | null;
  incoming_date_sortie: string | null;
  incoming_source: string | null;
  diff_labels: string[];
};

type DailyReservationDigestMessageInput = {
  generatedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  monthStart: Date;
  reservations: DailyReservationDigestReservation[];
  icalConflicts?: DailyReservationDigestIcalConflict[];
  totalsByGite: DailyReservationEmailGiteTotal[];
  totalAmount: number;
  totalReservationsCount: number;
};

export type DailyReservationEmailState = {
  config: DailyReservationEmailConfig;
  scheduler: "internal";
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_email_sent_at: string | null;
  last_status: DailyReservationEmailRunStatus;
  last_error: string | null;
  last_result: DailyReservationEmailRunSummary | null;
  smtp_configured: boolean;
  smtp_issues: string[];
};

let cronTimer: NodeJS.Timeout | null = null;
let cronRunning = false;
let cronNextRunAt: Date | null = null;
let cronConfig = readDailyReservationEmailConfig(
  buildDefaultDailyReservationEmailConfig(),
);
let activeRunPromise: Promise<DailyReservationEmailRunSummary> | null = null;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatDateOnly = (value: string | Date) => {
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatDateTime = (value: Date | string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatRunLabel = (value: Date | string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const buildDigestSubject = (
  reservationsCount: number,
  generatedAt: Date,
) => {
  const dateLabel = formatRunLabel(generatedAt);
  if (reservationsCount > 0) {
    return `Nouvelles réservations du ${dateLabel}`;
  }
  return `Point quotidien réservations du ${dateLabel}`;
};

const formatWindowLabel = (windowStart: Date, windowEnd: Date) =>
  `${formatDateTime(windowStart)} au ${formatDateTime(windowEnd)}`;

const formatMonthLabel = (monthStart: Date) =>
  monthStart.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

const getIcalConflictTypeLabel = (type: IcalConflictType) =>
  type === "modified" ? "Modification détectée" : "Suppression détectée";

const getIcalConflictIntro = (type: IcalConflictType) =>
  type === "modified"
    ? "La réservation existe encore dans le flux iCal, mais ses informations ont changé. Rien n'a été appliqué automatiquement."
    : "La réservation a disparu du flux iCal. Rien n'a été supprimé automatiquement.";

const getConflictCurrentSnapshot = (conflict: IcalConflictRecord) => ({
  gite_nom: conflict.reservation_snapshot.gite_nom,
  hote_nom: conflict.reservation_snapshot.hote_nom,
  date_entree: conflict.reservation_snapshot.date_entree,
  date_sortie: conflict.reservation_snapshot.date_sortie,
  source_paiement: conflict.reservation_snapshot.source_paiement,
  airbnb_url: conflict.reservation_snapshot.airbnb_url,
});

const getIcalConflictDiffLabels = (conflict: IcalConflictRecord) => {
  if (conflict.type === "deleted" || !conflict.incoming_snapshot) {
    return ["Absent du flux"];
  }

  const current = getConflictCurrentSnapshot(conflict);
  const next = conflict.incoming_snapshot;
  const labels: string[] = [];
  if (current.date_entree !== next.date_entree || current.date_sortie !== next.date_sortie) labels.push("Dates");
  if ((current.hote_nom ?? "") !== (next.hote_nom ?? "")) labels.push("Nom");
  if ((current.source_paiement ?? "") !== (next.final_source ?? next.source_paiement ?? "")) labels.push("Source");
  if ((current.airbnb_url ?? "") !== (next.airbnb_url ?? "")) labels.push("Lien Airbnb");
  return labels.length > 0 ? labels : ["Métadonnées"];
};

const buildPlainTextDigest = (input: DailyReservationDigestMessageInput) => {
  const monthLabel = formatMonthLabel(input.monthStart);
  const icalConflicts = input.icalConflicts ?? [];
  const lines = [
    `Point quotidien des réservations`,
    `Période analysée : ${formatWindowLabel(input.windowStart, input.windowEnd)}`,
    `Mois de référence : ${monthLabel}`,
    `Nouvelles réservations : ${input.reservations.length}`,
    `Montant total du mois : ${formatEuro(input.totalAmount)}`,
    `Nombre de réservations du mois : ${input.totalReservationsCount}`,
    "",
  ];

  if (input.reservations.length > 0) {
    lines.push("Nouvelles réservations :");
    for (const reservation of input.reservations) {
      lines.push(
        `- ${reservation.gite_nom} | ${reservation.hote_nom} | ${formatDateOnly(reservation.date_entree)} -> ${formatDateOnly(reservation.date_sortie)} | ${reservation.nb_nuits} nuit${reservation.nb_nuits > 1 ? "s" : ""} | ${formatEuro(reservation.prix_total)}${reservation.source_paiement ? ` | ${reservation.source_paiement}` : ""}`,
      );
    }
    lines.push("");
  } else {
    lines.push("Aucune nouvelle réservation créée sur les dernières 24 heures.");
    lines.push("");
  }

  lines.push("Totaux du mois par gîte :");
  for (const total of input.totalsByGite) {
    lines.push(
      `- ${total.gite_nom}: ${formatEuro(total.total_amount)} (${total.reservations_count} réservation${total.reservations_count > 1 ? "s" : ""})`,
    );
  }

  if (icalConflicts.length > 0) {
    lines.push("");
    lines.push("Conflits iCal en attente :");
    for (const conflict of icalConflicts) {
      lines.push(
        `- ${conflict.gite_nom} | ${getIcalConflictTypeLabel(conflict.type)} | ${conflict.diff_labels.join(", ")} | actuelle : ${conflict.current_hote_nom || "Réservation"} (${formatDateOnly(conflict.current_date_entree)} -> ${formatDateOnly(conflict.current_date_sortie)})${
          conflict.type === "modified" && conflict.incoming_date_entree && conflict.incoming_date_sortie
            ? ` | iCal : ${conflict.incoming_hote_nom || "Événement iCal"} (${formatDateOnly(conflict.incoming_date_entree)} -> ${formatDateOnly(conflict.incoming_date_sortie)})`
            : ""
        }`,
      );
    }
  }

  return lines.join("\n");
};

const renderMetricCardHtml = (label: string, value: string, tone = "#1d1d1f") =>
  `<td style="padding:0 8px 12px 0;vertical-align:top;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;min-width:180px;border-collapse:separate;background:#ffffff;border:1px solid #ece7e2;border-radius:18px;">
      <tr>
        <td style="padding:18px 18px 16px;">
          <div style="font-size:12px;letter-spacing:0.02em;text-transform:uppercase;color:#716a63;">${escapeHtml(label)}</div>
          <div style="margin-top:8px;font-size:24px;line-height:1.2;font-weight:700;color:${tone};">${escapeHtml(value)}</div>
        </td>
      </tr>
    </table>
  </td>`;

const buildHtmlDigest = (input: DailyReservationDigestMessageInput) => {
  const monthLabel = formatMonthLabel(input.monthStart);
  const icalConflicts = input.icalConflicts ?? [];
  const reservationCardsHtml =
    input.reservations.length > 0
      ? input.reservations
          .map(
            (reservation) => `<tr>
              <td style="padding:0 0 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;background:#ffffff;border:1px solid #ece7e2;border-radius:24px;">
                  <tr>
                    <td style="padding:20px 22px 18px;">
                      <div style="font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:#ff385c;font-weight:700;">${escapeHtml(reservation.gite_nom)}</div>
                      <div style="margin-top:8px;font-size:22px;line-height:1.25;color:#1d1d1f;font-weight:700;">${escapeHtml(reservation.hote_nom)}</div>
                      <div style="margin-top:10px;font-size:14px;line-height:1.6;color:#48423d;">
                        ${escapeHtml(formatDateOnly(reservation.date_entree))} -> ${escapeHtml(formatDateOnly(reservation.date_sortie))}<br />
                        ${escapeHtml(`${reservation.nb_nuits} nuit${reservation.nb_nuits > 1 ? "s" : ""}`)}
                        ${reservation.source_paiement ? ` • ${escapeHtml(reservation.source_paiement)}` : ""}
                      </div>
                      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:18px;border-collapse:collapse;">
                        <tr>
                          <td style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#8d857d;">Créée le</td>
                          <td style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#8d857d;text-align:right;">Montant</td>
                        </tr>
                        <tr>
                          <td style="padding-top:6px;font-size:15px;font-weight:600;color:#1d1d1f;">${escapeHtml(formatDateTime(reservation.created_at))}</td>
                          <td style="padding-top:6px;font-size:22px;font-weight:700;color:#1d1d1f;text-align:right;">${escapeHtml(formatEuro(reservation.prix_total))}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`,
          )
          .join("")
      : `<tr>
          <td style="padding:0 0 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;background:#ffffff;border:1px dashed #d8d1ca;border-radius:24px;">
              <tr>
                <td style="padding:24px 22px;font-size:15px;line-height:1.7;color:#5f5852;">
                  Aucune nouvelle réservation n'a été créée sur les dernières 24 heures.
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

  const totalsRowsHtml = input.totalsByGite
    .map(
      (total) => `<tr>
        <td style="padding:14px 0;border-bottom:1px solid #f1ece7;font-size:15px;color:#1d1d1f;font-weight:600;">${escapeHtml(total.gite_nom)}</td>
        <td style="padding:14px 0;border-bottom:1px solid #f1ece7;font-size:14px;color:#6d665f;text-align:right;">${escapeHtml(`${total.reservations_count} réservation${total.reservations_count > 1 ? "s" : ""}`)}</td>
        <td style="padding:14px 0;border-bottom:1px solid #f1ece7;font-size:16px;color:#1d1d1f;font-weight:700;text-align:right;">${escapeHtml(formatEuro(total.total_amount))}</td>
      </tr>`,
    )
    .join("");

  const icalConflictsHtml =
    icalConflicts.length > 0
      ? `<tr>
          <td style="padding:28px 0 10px;font-size:20px;line-height:1.3;font-weight:700;color:#1d1d1f;">Conflits iCal en attente</td>
        </tr>
        ${icalConflicts
          .map(
            (conflict) => `<tr>
              <td style="padding:0 0 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;background:#ffffff;border:1px solid #ece7e2;border-radius:24px;">
                  <tr>
                    <td style="padding:20px 22px 18px;">
                      <div style="font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:#ff385c;font-weight:700;">${escapeHtml(conflict.gite_nom)}</div>
                      <div style="margin-top:8px;font-size:20px;line-height:1.3;color:#1d1d1f;font-weight:700;">${escapeHtml(getIcalConflictTypeLabel(conflict.type))}</div>
                      <div style="margin-top:10px;font-size:14px;line-height:1.7;color:#48423d;">
                        ${escapeHtml(getIcalConflictIntro(conflict.type))}
                      </div>
                      <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#8d857d;text-transform:uppercase;letter-spacing:0.04em;">
                        ${escapeHtml(conflict.diff_labels.join(" • "))}
                      </div>
                      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:18px;border-collapse:collapse;">
                        <tr>
                          <td style="padding:0 12px 0 0;vertical-align:top;width:50%;">
                            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#8d857d;">Réservation actuelle</div>
                            <div style="margin-top:6px;font-size:15px;font-weight:600;color:#1d1d1f;">${escapeHtml(conflict.current_hote_nom || "Réservation")}</div>
                            <div style="margin-top:4px;font-size:14px;line-height:1.6;color:#48423d;">${escapeHtml(`${formatDateOnly(conflict.current_date_entree)} -> ${formatDateOnly(conflict.current_date_sortie)}`)}</div>
                            ${
                              conflict.current_source
                                ? `<div style="margin-top:4px;font-size:13px;line-height:1.5;color:#6d665f;">${escapeHtml(conflict.current_source)}</div>`
                                : ""
                            }
                          </td>
                          <td style="padding:0;vertical-align:top;width:50%;">
                            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#8d857d;">Version iCal</div>
                            ${
                              conflict.type === "modified" && conflict.incoming_date_entree && conflict.incoming_date_sortie
                                ? `<div style="margin-top:6px;font-size:15px;font-weight:600;color:#1d1d1f;">${escapeHtml(conflict.incoming_hote_nom || "Événement iCal")}</div>
                                   <div style="margin-top:4px;font-size:14px;line-height:1.6;color:#48423d;">${escapeHtml(`${formatDateOnly(conflict.incoming_date_entree)} -> ${formatDateOnly(conflict.incoming_date_sortie)}`)}</div>
                                   ${
                                     conflict.incoming_source
                                       ? `<div style="margin-top:4px;font-size:13px;line-height:1.5;color:#6d665f;">${escapeHtml(conflict.incoming_source)}</div>`
                                       : ""
                                   }`
                                : `<div style="margin-top:6px;font-size:15px;font-weight:600;color:#1d1d1f;">Absente du flux iCal</div>`
                            }
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`,
          )
          .join("")}`
      : "";

  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f7f3ef;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f7f3ef;">
      <tr>
        <td align="center" style="padding:28px 16px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:760px;border-collapse:collapse;">
            <tr>
              <td style="padding:0 0 18px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;background:linear-gradient(135deg,#ff385c 0%,#ff6b57 100%);border-radius:28px;">
                  <tr>
                    <td style="padding:28px 28px 30px;color:#ffffff;">
                      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;opacity:0.9;">Résumé quotidien</div>
                      <div style="margin-top:12px;font-size:34px;line-height:1.12;font-weight:700;">Réservations des dernières 24h</div>
                      <div style="margin-top:10px;font-size:15px;line-height:1.7;max-width:520px;opacity:0.95;">
                        Période analysée : ${escapeHtml(formatWindowLabel(input.windowStart, input.windowEnd))}
                      </div>
                      <div style="margin-top:4px;font-size:15px;line-height:1.7;max-width:520px;opacity:0.95;">
                        Mois de référence : ${escapeHtml(monthLabel)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                  <tr>
                    ${renderMetricCardHtml("Nouvelles réservations", String(input.reservations.length), "#ff385c")}
                    ${renderMetricCardHtml("Montant total du mois", formatEuro(input.totalAmount))}
                    ${renderMetricCardHtml("Réservations du mois", String(input.totalReservationsCount))}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0 10px;font-size:20px;line-height:1.3;font-weight:700;color:#1d1d1f;">Nouvelles réservations</td>
            </tr>
            ${reservationCardsHtml}
            <tr>
              <td style="padding:8px 0 10px;font-size:20px;line-height:1.3;font-weight:700;color:#1d1d1f;">Totaux du mois par gîte</td>
            </tr>
            <tr>
              <td>
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;background:#ffffff;border:1px solid #ece7e2;border-radius:24px;">
                  <tr>
                    <td style="padding:10px 22px 8px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                        ${totalsRowsHtml}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ${icalConflictsHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

export const buildDailyReservationEmailMessage = (
  input: DailyReservationDigestMessageInput,
) => ({
  subject: buildDigestSubject(input.reservations.length, input.generatedAt),
  text: buildPlainTextDigest(input),
  html: buildHtmlDigest(input),
});

const computeNextRunDate = (hour: number, minute: number) => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
};

const computeCurrentSlotDate = (
  now: Date,
  config: DailyReservationEmailConfig,
) => {
  const slot = new Date(now);
  slot.setHours(config.hour, config.minute, 0, 0);
  if (slot.getTime() > now.getTime()) {
    slot.setDate(slot.getDate() - 1);
  }
  return slot;
};

const scheduleNextRun = (config: DailyReservationEmailConfig) => {
  cronNextRunAt = computeNextRunDate(config.hour, config.minute);
  const waitMs = Math.max(5_000, cronNextRunAt.getTime() - Date.now());

  cronTimer = setTimeout(async () => {
    cronRunning = true;
    try {
      await runDailyReservationEmail({ triggered_by: "scheduler" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur inconnue lors de l'envoi quotidien.";
      // eslint-disable-next-line no-console
      console.error("[daily-reservation-email] scheduled run failed:", message);
    } finally {
      cronRunning = false;
      if (cronConfig.enabled) {
        scheduleNextRun(cronConfig);
      }
    }
  }, waitMs);
};

const applyCronConfig = (config: DailyReservationEmailConfig) => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;

  if (config.enabled) {
    scheduleNextRun(config);
  }
};

const getMonthBoundaries = (referenceDate: Date) => {
  const monthStart = new Date(referenceDate);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  return { monthStart, monthEnd };
};

const buildTotalsByGite = async (monthStart: Date, monthEnd: Date) => {
  const reservations = await prisma.reservation.findMany({
    where: {
      date_entree: {
        gte: monthStart,
        lt: monthEnd,
      },
    },
    select: {
      gite_id: true,
      prix_total: true,
      gite: {
        select: {
          id: true,
          nom: true,
          ordre: true,
        },
      },
    },
  });

  const totalsByKey = new Map<
    string,
    DailyReservationEmailGiteTotal & { ordre: number }
  >();

  for (const reservation of reservations) {
    const giteId = reservation.gite?.id ?? reservation.gite_id ?? null;
    const key = giteId ?? "unassigned";
    const existing = totalsByKey.get(key);
    const giteNom = reservation.gite?.nom ?? "Sans gîte assigné";
    const ordre = reservation.gite?.ordre ?? Number.MAX_SAFE_INTEGER;

    if (existing) {
      existing.total_amount += Number(reservation.prix_total ?? 0);
      existing.reservations_count += 1;
      continue;
    }

    totalsByKey.set(key, {
      gite_id: giteId,
      gite_nom: giteNom,
      total_amount: Number(reservation.prix_total ?? 0),
      reservations_count: 1,
      ordre,
    });
  }

  return [...totalsByKey.values()]
    .sort((left, right) => {
      if (left.ordre !== right.ordre) return left.ordre - right.ordre;
      return left.gite_nom.localeCompare(right.gite_nom, "fr", {
        sensitivity: "base",
      });
    })
    .map(({ ordre: _ordre, ...item }) => item);
};

export const buildNewReservations = async (windowStart: Date, windowEnd: Date) => {
  const rows = await prisma.reservation.findMany({
    where: {
      createdAt: {
        gte: windowStart,
        lt: windowEnd,
      },
    },
    select: {
      id: true,
      gite_id: true,
      hote_nom: true,
      date_entree: true,
      date_sortie: true,
      nb_nuits: true,
      prix_total: true,
      source_paiement: true,
      createdAt: true,
      gite: {
        select: {
          nom: true,
          ordre: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { date_entree: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    gite_id: row.gite_id ?? null,
    gite_nom: row.gite?.nom ?? "Sans gîte assigné",
    hote_nom: row.hote_nom,
    date_entree: row.date_entree.toISOString().slice(0, 10),
    date_sortie: row.date_sortie.toISOString().slice(0, 10),
    nb_nuits: row.nb_nuits,
    prix_total: Number(row.prix_total ?? 0),
    source_paiement: row.source_paiement ?? null,
    created_at: row.createdAt.toISOString(),
  }));
};

const buildRunSummary = (params: {
  slotAt: Date;
  windowStart: Date;
  windowEnd: Date;
  reservationsCount: number;
  emailSent: boolean;
  skippedReason: DailyReservationEmailRunSummary["skipped_reason"];
  recipientsCount: number;
  totalAmount: number;
  totalReservationsCount: number;
  totalsByGite: DailyReservationEmailGiteTotal[];
}): DailyReservationEmailRunSummary => ({
  slot_at: params.slotAt.toISOString(),
  window_start_at: params.windowStart.toISOString(),
  window_end_at: params.windowEnd.toISOString(),
  new_reservations_count: params.reservationsCount,
  email_sent: params.emailSent,
  skipped_reason: params.skippedReason,
  recipients_count: params.recipientsCount,
  total_amount: params.totalAmount,
  total_reservations_count: params.totalReservationsCount,
  totals_by_gite: params.totalsByGite,
});

const getActiveRecipients = (
  recipients: DailyReservationEmailRecipientConfig[],
) => recipients.filter((recipient) => recipient.enabled);

const getRecipientsForCurrentDigest = (
  recipients: DailyReservationEmailRecipientConfig[],
  reservationsCount: number,
  icalConflictsCount: number,
  force: boolean,
) => {
  const activeRecipients = getActiveRecipients(recipients);
  if (force || reservationsCount > 0 || icalConflictsCount > 0) {
    return activeRecipients;
  }
  return activeRecipients.filter((recipient) => recipient.send_if_empty);
};

const buildOpenIcalConflicts = async (): Promise<
  DailyReservationDigestIcalConflict[]
> => {
  const conflicts = listOpenIcalConflictRecords();
  return conflicts.map((conflict) => ({
    id: conflict.id,
    type: conflict.type,
    detected_at: conflict.detected_at,
    gite_nom: conflict.reservation_snapshot.gite_nom ?? "Sans gîte",
    current_hote_nom: conflict.reservation_snapshot.hote_nom,
    current_date_entree: conflict.reservation_snapshot.date_entree,
    current_date_sortie: conflict.reservation_snapshot.date_sortie,
    current_source: conflict.reservation_snapshot.source_paiement,
    incoming_hote_nom: conflict.incoming_snapshot?.hote_nom ?? conflict.incoming_snapshot?.summary ?? null,
    incoming_date_entree: conflict.incoming_snapshot?.date_entree ?? null,
    incoming_date_sortie: conflict.incoming_snapshot?.date_sortie ?? null,
    incoming_source:
      conflict.incoming_snapshot?.final_source ??
      conflict.incoming_snapshot?.source_paiement ??
      conflict.incoming_snapshot?.source_type ??
      null,
    diff_labels: getIcalConflictDiffLabels(conflict),
  }));
};

export const runDailyReservationEmail = async (options?: {
  force?: boolean;
  triggered_by?: "manual" | "scheduler" | "http";
  now?: Date;
}): Promise<DailyReservationEmailRunSummary> => {
  if (activeRunPromise) return activeRunPromise;

  activeRunPromise = (async () => {
    const now = options?.now ?? new Date();
    const state = readDailyReservationEmailRunState();
    const currentConfig = readDailyReservationEmailConfig(
      buildDefaultDailyReservationEmailConfig(),
    );
    cronConfig = currentConfig;

    const slotAt = computeCurrentSlotDate(now, currentConfig);
    const slotAtIso = slotAt.toISOString();
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    if (!currentConfig.enabled && !options?.force) {
      const activeRecipientsCount = getActiveRecipients(
        currentConfig.recipients,
      ).length;
      const summary = buildRunSummary({
        slotAt,
        windowStart,
        windowEnd,
        reservationsCount: 0,
        emailSent: false,
        skippedReason: "disabled",
        recipientsCount: activeRecipientsCount,
        totalAmount: state.last_result?.total_amount ?? 0,
        totalReservationsCount: state.last_result?.total_reservations_count ?? 0,
        totalsByGite: state.last_result?.totals_by_gite ?? [],
      });

      updateDailyReservationEmailRunState({
        running: false,
        last_run_at: now.toISOString(),
        last_slot_at: slotAtIso,
        last_status: "skipped",
        last_error: null,
        last_result: summary,
      });

      return summary;
    }

    if (!options?.force && state.last_slot_at === slotAtIso && state.last_result) {
      const reusedSummary: DailyReservationEmailRunSummary = {
        ...state.last_result,
        skipped_reason: "already-ran-for-slot",
      };
      return reusedSummary;
    }

    updateDailyReservationEmailRunState({
      running: true,
      last_started_at: now.toISOString(),
      last_slot_at: slotAtIso,
      last_status: "running",
      last_error: null,
    });

    try {
      const { monthStart, monthEnd } = getMonthBoundaries(now);
      const [reservations, totalsByGite, icalConflicts] = await Promise.all([
        buildNewReservations(windowStart, windowEnd),
        buildTotalsByGite(monthStart, monthEnd),
        buildOpenIcalConflicts(),
      ]);

      const totalAmount = totalsByGite.reduce(
        (sum, item) => sum + item.total_amount,
        0,
      );
      const totalReservationsCount = totalsByGite.reduce(
        (sum, item) => sum + item.reservations_count,
        0,
      );
      const recipientTargets = getRecipientsForCurrentDigest(
        currentConfig.recipients,
        reservations.length,
        icalConflicts.length,
        Boolean(options?.force),
      );

      if (recipientTargets.length === 0) {
        const summary = buildRunSummary({
          slotAt,
          windowStart,
          windowEnd,
          reservationsCount: 0,
          emailSent: false,
          skippedReason: "no-new-reservations",
          recipientsCount: 0,
          totalAmount,
          totalReservationsCount,
          totalsByGite,
        });

        updateDailyReservationEmailRunState({
          running: false,
          last_run_at: now.toISOString(),
          last_slot_at: slotAtIso,
          last_status: "skipped",
          last_error: null,
          last_result: summary,
        });

        return summary;
      }

      const smtpIssues = getSmtpConfigIssues();
      if (smtpIssues.length > 0) {
        throw new Error(
          `SMTP non configuré. Variables manquantes: ${smtpIssues.join(", ")}.`,
        );
      }

      if (getActiveRecipients(currentConfig.recipients).length === 0) {
        throw new Error(
          "Aucun destinataire n'est configuré pour le résumé quotidien.",
        );
      }

      const message = buildDailyReservationEmailMessage({
        generatedAt: now,
        windowStart,
        windowEnd,
        monthStart,
        reservations,
        icalConflicts,
        totalsByGite,
        totalAmount,
        totalReservationsCount,
      });

      await sendSmtpMail({
        to: recipientTargets.map((recipient) => recipient.email),
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      const summary = buildRunSummary({
        slotAt,
        windowStart,
        windowEnd,
        reservationsCount: reservations.length,
        emailSent: true,
        skippedReason: null,
        recipientsCount: recipientTargets.length,
        totalAmount,
        totalReservationsCount,
        totalsByGite,
      });

      updateDailyReservationEmailRunState({
        running: false,
        last_run_at: now.toISOString(),
        last_success_at: now.toISOString(),
        last_email_sent_at: now.toISOString(),
        last_slot_at: slotAtIso,
        last_status: "success",
        last_error: null,
        last_result: summary,
      });

      return summary;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur inconnue lors de l'envoi quotidien.";

      updateDailyReservationEmailRunState({
        running: false,
        last_run_at: now.toISOString(),
        last_slot_at: slotAtIso,
        last_status: "error",
        last_error: message,
      });

      throw error;
    }
  })().finally(() => {
    activeRunPromise = null;
  });

  return activeRunPromise;
};

export const updateDailyReservationEmailConfig = async (
  patch: Partial<DailyReservationEmailConfig>,
) => {
  cronConfig = mergeDailyReservationEmailConfig(cronConfig, patch);
  writeDailyReservationEmailConfig(cronConfig);
  applyCronConfig(cronConfig);
  return cronConfig;
};

export const getDailyReservationEmailState = (): DailyReservationEmailState => {
  const state = readDailyReservationEmailRunState();
  const smtpIssues = getSmtpConfigIssues();

  return {
    config: cronConfig,
    scheduler: "internal",
    running: cronRunning || Boolean(activeRunPromise) || state.running,
    next_run_at: cronNextRunAt ? cronNextRunAt.toISOString() : null,
    last_run_at: state.last_run_at,
    last_success_at: state.last_success_at,
    last_email_sent_at: state.last_email_sent_at,
    last_status: state.last_status,
    last_error: state.last_error,
    last_result: state.last_result,
    smtp_configured: smtpIssues.length === 0,
    smtp_issues: smtpIssues,
  };
};

export const startDailyReservationEmailCron = () => {
  const persisted = readDailyReservationEmailRunState();
  if (persisted.running) {
    updateDailyReservationEmailRunState({
      ...buildDefaultDailyReservationEmailRunState(),
      last_started_at: persisted.last_started_at,
      last_run_at: persisted.last_run_at,
      last_success_at: persisted.last_success_at,
      last_email_sent_at: persisted.last_email_sent_at,
      last_slot_at: persisted.last_slot_at,
      last_status: persisted.last_status === "running" ? "idle" : persisted.last_status,
      last_error: persisted.last_error,
      last_result: persisted.last_result,
    });
  }
  applyCronConfig(cronConfig);
};

export const stopDailyReservationEmailCron = () => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;
};

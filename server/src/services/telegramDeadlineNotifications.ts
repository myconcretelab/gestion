import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import {
  readTelegramNotificationConfig,
} from "./telegramNotifications.js";
import { sendMessage } from "./messageChannels/index.js";
import { loadGiteCleaningReadiness } from "./giteCleaningReadiness.js";

type DeadlineDocument = {
  id: string;
  number: string;
  guestName: string;
  giteName: string;
  deadline: Date;
};

type NotificationState = {
  notified: Record<string, string>;
};

const STATE_FILE = path.join(env.DATA_DIR, "telegram-deadline-notifications-state.json");
const CHECK_INTERVAL_MS = 60 * 1000;
const CLEANING_REMINDER_LEAD_MS = 60 * 60 * 1000;
const CLEANING_LINK_VALIDITY_MS = 24 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let activeRun: Promise<TelegramDeadlineNotificationResult> | null = null;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatDate = (date: Date) =>
  date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const documentUrl = (kind: "contrats" | "factures", id: string) => {
  const origin = env.CLIENT_ORIGIN.trim().replace(/\/$/, "");
  return origin ? `${origin}/${kind}/${encodeURIComponent(id)}` : "";
};

export const buildContractReturnOverdueMessage = (document: DeadlineDocument) =>
  [
    "<b>Contrat non rendu dans les délais</b>",
    "",
    `<b>Contrat</b>: ${escapeHtml(document.number)}`,
    `<b>Client</b>: ${escapeHtml(document.guestName)}`,
    `<b>Gîte</b>: ${escapeHtml(document.giteName)}`,
    `<b>Date limite</b>: ${escapeHtml(formatDate(document.deadline))}`,
    `<a href="${escapeHtml(documentUrl("contrats", document.id))}">Ouvrir le contrat</a>`,
  ].join("\n");

export const buildInvoicePaymentOverdueMessage = (document: DeadlineDocument) =>
  [
    "<b>Facture impayée après l'échéance</b>",
    "",
    `<b>Facture</b>: ${escapeHtml(document.number)}`,
    `<b>Client</b>: ${escapeHtml(document.guestName)}`,
    `<b>Gîte</b>: ${escapeHtml(document.giteName)}`,
    `<b>Date limite</b>: ${escapeHtml(formatDate(document.deadline))}`,
    `<a href="${escapeHtml(documentUrl("factures", document.id))}">Ouvrir la facture</a>`,
  ].join("\n");

const readState = (): NotificationState => {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<NotificationState>;
    return {
      notified:
        parsed.notified && typeof parsed.notified === "object"
          ? parsed.notified
          : {},
    };
  } catch {
    return { notified: {} };
  }
};

const writeState = (state: NotificationState) => {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  const temporaryFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporaryFile, STATE_FILE);
};

const alertKey = (type: "contract" | "invoice", document: DeadlineDocument) =>
  `${type}:${document.id}:${document.deadline.toISOString()}`;

export const startOfTodayInParisAsUtc = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Paris",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
};

export type TelegramDeadlineNotificationResult = {
  checked_count: number;
  sent_count: number;
  failed_count: number;
};

type CleaningCheckTokenPayload = {
  departureReservationId: string;
  arrivalReservationId: string;
  expiresAt: number;
};

const tokenSignature = (encodedPayload: string, secret: string) =>
  crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");

export const buildCleaningCheckToken = (payload: CleaningCheckTokenPayload, secret: string) => {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${tokenSignature(encodedPayload, secret)}`;
};

export const parseCleaningCheckToken = (
  token: string,
  secret: string,
  now = new Date(),
): CleaningCheckTokenPayload | null => {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra || !secret) return null;
  const expected = tokenSignature(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<CleaningCheckTokenPayload>;
    if (
      typeof payload.departureReservationId !== "string" ||
      typeof payload.arrivalReservationId !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < now.getTime()
    ) return null;
    return payload as CleaningCheckTokenPayload;
  } catch {
    return null;
  }
};

export const parisDateTime = (dateIso: string, time: string) => {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = desiredWallTime;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const representedWallTime = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    instant += desiredWallTime - representedWallTime;
  }
  return new Date(instant);
};

export const buildCleaningCheckReminderMessage = (params: {
  giteName: string;
  guestName: string;
  arrivalAt: Date;
}) => [
  "🧹 <b>Rappel : contrôle ménage à valider</b>",
  "",
  `<b>Gîte</b>: ${escapeHtml(params.giteName)}`,
  `<b>Locataire</b>: ${escapeHtml(params.guestName)}`,
  `<b>Arrivée</b>: ${escapeHtml(params.arrivalAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }))}`,
  "Le contrôle n'a pas encore été validé.",
].join("\n");

const sendCleaningCheckReminders = async (
  now: Date,
  config: ReturnType<typeof readTelegramNotificationConfig>,
  state: NotificationState,
) => {
  if (!config.notify_cleaning_check_reminder) return { checked: 0, sent: 0, failed: 0 };
  const gites = await prisma.gite.findMany({
    select: { id: true, nom: true, prefixe_contrat: true, ordre: true, heure_arrivee_defaut: true },
  });
  const readinessRows = (await loadGiteCleaningReadiness(gites, now))
    .filter((row) => row.next_arrival_reservation_id && !row.checked_at);
  if (!readinessRows.length) return { checked: 0, sent: 0, failed: 0 };

  const arrivalIds = readinessRows.map((row) => row.next_arrival_reservation_id as string);
  const [arrivals, contracts] = await Promise.all([
    prisma.reservation.findMany({
      where: { id: { in: arrivalIds } },
      select: { id: true, hote_nom: true, date_entree: true, gite_id: true },
    }),
    prisma.contrat.findMany({
      where: { reservation_id: { in: arrivalIds } },
      select: { reservation_id: true, heure_arrivee: true },
      orderBy: [{ date_creation: "desc" }, { id: "desc" }],
    }),
  ]);
  const arrivalsById = new Map(arrivals.map((row) => [row.id, row]));
  const contractTimeByReservationId = new Map<string, string>();
  for (const contract of contracts) {
    if (contract.reservation_id && !contractTimeByReservationId.has(contract.reservation_id)) {
      contractTimeByReservationId.set(contract.reservation_id, contract.heure_arrivee);
    }
  }
  const gitesById = new Map(gites.map((gite) => [gite.id, gite]));
  let sent = 0;
  let failed = 0;

  for (const readiness of readinessRows) {
    const arrivalId = readiness.next_arrival_reservation_id as string;
    const arrival = arrivalsById.get(arrivalId);
    const gite = gitesById.get(readiness.gite_id);
    if (!arrival || !gite) continue;
    const configuredTime = contractTimeByReservationId.get(arrivalId) || gite.heure_arrivee_defaut || "17:00";
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(configuredTime) ? configuredTime : "17:00";
    const arrivalAt = parisDateTime(arrival.date_entree.toISOString().slice(0, 10), time);
    const reminderAt = new Date(arrivalAt.getTime() - CLEANING_REMINDER_LEAD_MS);
    if (now < reminderAt || now >= arrivalAt) continue;
    const key = `cleaning:${arrivalId}:${arrivalAt.toISOString()}`;
    if (state.notified[key]) continue;

    const token = buildCleaningCheckToken({
      departureReservationId: readiness.departure_reservation_id,
      arrivalReservationId: arrivalId,
      expiresAt: arrivalAt.getTime() + CLEANING_LINK_VALIDITY_MS,
    }, config.bot_token);
    const origin = env.CLIENT_ORIGIN.trim().replace(/\/$/, "");
    const confirmationUrl = origin
      ? `${origin}/api/public/cleaning-check/confirm?token=${encodeURIComponent(token)}`
      : "";
    try {
      const result = await sendMessage("telegram", {
        message: buildCleaningCheckReminderMessage({
          giteName: gite.nom,
          guestName: arrival.hote_nom,
          arrivalAt,
        }),
        options: {
          ...config,
          ...(confirmationUrl ? {
            reply_markup: { inline_keyboard: [[{ text: "✅ C'est fait !", url: confirmationUrl }]] },
          } : {}),
        },
      });
      if (result.sent_count > 0) {
        state.notified[key] = now.toISOString();
        writeState(state);
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`Échec du rappel Telegram ${key}:`, error);
    }
  }
  return { checked: readinessRows.length, sent, failed };
};

export const runTelegramDeadlineNotifications = async (
  now = new Date(),
): Promise<TelegramDeadlineNotificationResult> => {
  if (activeRun) return activeRun;

  activeRun = (async () => {
    const config = readTelegramNotificationConfig();
    if (
      !config.enabled ||
      (!config.notify_contract_return_overdue &&
        !config.notify_invoice_payment_overdue &&
        !config.notify_cleaning_check_reminder)
    ) {
      return { checked_count: 0, sent_count: 0, failed_count: 0 };
    }

    const deadlineBefore = startOfTodayInParisAsUtc(now);
    const [contracts, invoices] = await Promise.all([
      config.notify_contract_return_overdue
        ? prisma.contrat.findMany({
            where: {
              statut_reception_contrat: "non_recu",
              date_envoi_email: { not: null },
              arrhes_date_limite: { lt: deadlineBefore },
            },
            include: { gite: { select: { nom: true } } },
          })
        : [],
      config.notify_invoice_payment_overdue
        ? prisma.facture.findMany({
            where: {
              statut_paiement: "non_reglee",
              date_envoi_email: { not: null },
              arrhes_date_limite: { lt: deadlineBefore },
            },
            include: { gite: { select: { nom: true } } },
          })
        : [],
    ]);

    const state = readState();
    let sentCount = 0;
    let failedCount = 0;

    const send = async (
      type: "contract" | "invoice",
      document: DeadlineDocument,
      message: string,
    ) => {
      const key = alertKey(type, document);
      if (state.notified[key]) return;
      try {
        const result = await sendMessage("telegram", {
          message,
          options: config,
        });
        if (result.sent_count > 0) {
          state.notified[key] = now.toISOString();
          writeState(state);
          sentCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        console.error(`Échec de l'alerte Telegram ${key}:`, error);
      }
    };

    for (const contract of contracts) {
      const document = {
        id: contract.id,
        number: contract.numero_contrat,
        guestName: contract.locataire_nom,
        giteName: contract.gite.nom,
        deadline: contract.arrhes_date_limite,
      };
      await send("contract", document, buildContractReturnOverdueMessage(document));
    }

    for (const invoice of invoices) {
      const document = {
        id: invoice.id,
        number: invoice.numero_facture,
        guestName: invoice.locataire_nom,
        giteName: invoice.gite.nom,
        deadline: invoice.arrhes_date_limite,
      };
      await send("invoice", document, buildInvoicePaymentOverdueMessage(document));
    }

    const cleaningReminders = await sendCleaningCheckReminders(now, config, state);

    return {
      checked_count: contracts.length + invoices.length + cleaningReminders.checked,
      sent_count: sentCount + cleaningReminders.sent,
      failed_count: failedCount + cleaningReminders.failed,
    };
  })().finally(() => {
    activeRun = null;
  });

  return activeRun;
};

export const startTelegramDeadlineNotificationCron = () => {
  if (timer) clearInterval(timer);
  void runTelegramDeadlineNotifications().catch((error) => {
    console.error("Échec de la vérification des échéances Telegram:", error);
  });
  timer = setInterval(() => {
    void runTelegramDeadlineNotifications().catch((error) => {
      console.error("Échec de la vérification des échéances Telegram:", error);
    });
  }, CHECK_INTERVAL_MS);
  timer.unref();
};

export const stopTelegramDeadlineNotificationCron = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

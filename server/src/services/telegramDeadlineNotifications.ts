import fs from "node:fs";
import path from "node:path";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import {
  readTelegramNotificationConfig,
  sendTelegramMessage,
} from "./telegramNotifications.js";

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
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

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

export const runTelegramDeadlineNotifications = async (
  now = new Date(),
): Promise<TelegramDeadlineNotificationResult> => {
  if (activeRun) return activeRun;

  activeRun = (async () => {
    const config = readTelegramNotificationConfig();
    if (
      !config.enabled ||
      (!config.notify_contract_return_overdue &&
        !config.notify_invoice_payment_overdue)
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
        const result = await sendTelegramMessage(message, config);
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

    return {
      checked_count: contracts.length + invoices.length,
      sent_count: sentCount,
      failed_count: failedCount,
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

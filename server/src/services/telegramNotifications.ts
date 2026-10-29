import fs from "node:fs";
import { buildBookingRequestOptionsTemplateValues } from "@contrats/shared";
import { buildBookingManagementAction } from "./bookingManagementLinks.js";
import type { BookingPaymentEmailInfo } from "./bookingRequestEmail.js";
import { env } from "../config/env.js";
import { formatBookedDateInput, type BookingQuote } from "./booked.js";
import { telegramMessageChannel } from "./messageChannels/telegram.js";
import prisma from "../db/prisma.js";
import type { OptionsInput } from "./contractCalculator.js";
import { organizationDataPath } from "./organizationFiles.js";

export type TelegramNotificationConfig = {
  enabled: boolean;
  bot_token: string;
  chat_ids: string[];
  recipient_user_ids: string[];
  notify_gite_checked: boolean;
  gite_check_mentions: string[];
  notify_booking_request_created: boolean;
  notify_booking_request_approved: boolean;
  notify_contract_return_overdue: boolean;
  notify_invoice_payment_overdue: boolean;
  notify_cleaning_check_reminder: boolean;
};

export type TelegramNotificationPublicState = {
  config: Omit<TelegramNotificationConfig, "bot_token"> & {
    bot_token: "";
  };
  bot_configured: boolean;
};

type BookingRequestTelegramPayload = {
  id: string;
  approved_reservation_id?: string | null;
  hote_nom: string;
  telephone?: string | null;
  email?: string | null;
  date_entree: Date | string;
  date_sortie: Date | string;
  nb_adultes: number;
  nb_enfants_2_17: number;
  message_client?: string | null;
  hold_expires_at: Date | string;
  gite: {
    id?: string;
    nom: string;
    email?: string | null;
  };
  pricing_snapshot: Pick<BookingQuote, "nb_nuits" | "total_global"> &
    Partial<BookingQuote>;
  options?: OptionsInput | null;
};

const settingsFile = () =>
  organizationDataPath("telegram-notifications-settings.json");

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeChatIds = (value: unknown, fallback: string[]) => {
  if (value === null || value === undefined) return fallback;

  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;]+/)
      : [];

  const seen = new Set<string>();
  const chatIds: string[] = [];

  for (const rawValue of rawValues) {
    const normalized = String(rawValue ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    chatIds.push(normalized);
  }

  return chatIds;
};

export const buildDefaultTelegramNotificationConfig =
  (): TelegramNotificationConfig => ({
    enabled: false,
    bot_token: "",
    chat_ids: [],
    recipient_user_ids: [],
    notify_gite_checked: true,
    gite_check_mentions: [],
    notify_booking_request_created: true,
    notify_booking_request_approved: true,
    notify_contract_return_overdue: true,
    notify_invoice_payment_overdue: true,
    notify_cleaning_check_reminder: true,
  });

export const normalizeTelegramNotificationConfig = (
  input: Partial<TelegramNotificationConfig> | null | undefined,
  fallback: TelegramNotificationConfig,
): TelegramNotificationConfig => ({
  enabled: toBoolean(input?.enabled, fallback.enabled),
  bot_token:
    typeof input?.bot_token === "string"
      ? input.bot_token.trim()
      : fallback.bot_token,
  chat_ids: normalizeChatIds(input?.chat_ids, fallback.chat_ids),
  recipient_user_ids: normalizeChatIds(
    input?.recipient_user_ids,
    fallback.recipient_user_ids,
  ),
  notify_gite_checked: toBoolean(
    input?.notify_gite_checked,
    fallback.notify_gite_checked,
  ),
  gite_check_mentions: normalizeChatIds(
    input?.gite_check_mentions,
    fallback.gite_check_mentions,
  )
    .map((name) => name.replace(/^@/, ""))
    .filter((name) => /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(name))
    .map((name) => `@${name}`),
  notify_booking_request_created: toBoolean(
    input?.notify_booking_request_created,
    fallback.notify_booking_request_created,
  ),
  notify_booking_request_approved: toBoolean(
    input?.notify_booking_request_approved,
    fallback.notify_booking_request_approved,
  ),
  notify_contract_return_overdue: toBoolean(
    input?.notify_contract_return_overdue,
    fallback.notify_contract_return_overdue,
  ),
  notify_invoice_payment_overdue: toBoolean(
    input?.notify_invoice_payment_overdue,
    fallback.notify_invoice_payment_overdue,
  ),
  notify_cleaning_check_reminder: toBoolean(
    input?.notify_cleaning_check_reminder,
    fallback.notify_cleaning_check_reminder,
  ),
});

export const readTelegramNotificationConfig = (
  fallback?: TelegramNotificationConfig,
): TelegramNotificationConfig => {
  const defaults = fallback ?? buildDefaultTelegramNotificationConfig();
  ensureDataDir();

  if (!fs.existsSync(settingsFile())) return defaults;

  try {
    const raw = fs.readFileSync(settingsFile(), "utf-8");
    if (!raw.trim()) return defaults;
    return normalizeTelegramNotificationConfig(
      JSON.parse(raw) as Partial<TelegramNotificationConfig>,
      defaults,
    );
  } catch {
    return defaults;
  }
};

export const writeTelegramNotificationConfig = (
  config: TelegramNotificationConfig,
) => {
  ensureDataDir();
  fs.writeFileSync(settingsFile(), JSON.stringify(config, null, 2), "utf-8");
};

export const mergeTelegramNotificationConfig = (
  current: TelegramNotificationConfig,
  patch: Partial<TelegramNotificationConfig>,
) =>
  normalizeTelegramNotificationConfig(
    {
      ...patch,
      bot_token:
        typeof patch.bot_token === "string" && patch.bot_token.trim()
          ? patch.bot_token
          : current.bot_token,
    },
    current,
  );

export const buildTelegramNotificationState = (
  config = readTelegramNotificationConfig(),
): TelegramNotificationPublicState => ({
  config: {
    enabled: config.enabled,
    bot_token: "",
    chat_ids: config.chat_ids,
    recipient_user_ids: config.recipient_user_ids,
    notify_gite_checked: config.notify_gite_checked,
    gite_check_mentions: config.gite_check_mentions,
    notify_booking_request_created: config.notify_booking_request_created,
    notify_booking_request_approved: config.notify_booking_request_approved,
    notify_contract_return_overdue: config.notify_contract_return_overdue,
    notify_invoice_payment_overdue: config.notify_invoice_payment_overdue,
    notify_cleaning_check_reminder: config.notify_cleaning_check_reminder,
  },
  bot_configured: Boolean(config.bot_token.trim()),
});

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const bookingManagementLink = (
  payload: BookingRequestTelegramPayload,
  reservationId = payload.approved_reservation_id,
) => {
  const action = buildBookingManagementAction(payload, reservationId);
  return action
    ? `<a href="${escapeHtml(action.url).replace(/"/g, "&quot;")}">${action.label}</a>`
    : "";
};

const bookingGuestDetails = (payload: BookingRequestTelegramPayload) => [
  `<b>Client</b>: ${escapeHtml(payload.hote_nom.slice(0, 160))}`,
  `<b>Téléphone</b>: ${escapeHtml(payload.telephone?.trim().slice(0, 100) || "Non renseigné")}`,
  `<b>Email</b>: ${escapeHtml(payload.email?.trim().slice(0, 254) || "Non renseigné")}`,
  payload.message_client?.trim()
    ? `<b>Message</b>: ${escapeHtml(payload.message_client.trim().slice(0, 400))}`
    : "",
];

const formatDateTimeFr = (value: Date | string) =>
  new Date(value).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });

const formatPrice = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);

export const sendTelegramMessage = async (
  text: string,
  config = readTelegramNotificationConfig(),
  explicitRecipients?: string[],
  pushKey?: string,
) => {
  const recipients =
    explicitRecipients ?? (await resolveTelegramNotificationRecipients(config));
  const result = await telegramMessageChannel.send({
    message: text,
    recipients,
    options: { ...config, owner_push: { key: pushKey } },
  });
  return {
    sent_count: result.sent_count,
    skipped_reason: result.skipped_reason,
  };
};

export const resolveTelegramNotificationRecipients = async (
  config = readTelegramNotificationConfig(),
) => {
  const users = config.recipient_user_ids.length
    ? await prisma.appUser.findMany({
        where: { id: { in: config.recipient_user_ids }, is_active: true },
        select: { telegram_chat_id: true },
      })
    : [];
  return [
    ...new Set([
      ...config.chat_ids,
      ...users
        .map((user) => user.telegram_chat_id?.trim() ?? "")
        .filter(Boolean),
    ]),
  ];
};

export const buildBookingRequestCreatedMessage = (
  payload: BookingRequestTelegramPayload,
) =>
  [
    "<b>Nouvelle demande de réservation</b>",
    "",
    `<b>Gîte</b>: ${escapeHtml(payload.gite.nom.slice(0, 160))}`,
    `<b>Séjour</b>: du ${escapeHtml(formatBookedDateInput(payload.date_entree))} au ${escapeHtml(formatBookedDateInput(payload.date_sortie))} (${payload.pricing_snapshot.nb_nuits} nuit(s))`,
    `<b>Voyageurs</b>: ${payload.nb_adultes} adulte(s), ${payload.nb_enfants_2_17} enfant(s)`,
    `<b>Options</b>: ${buildBookingOptionsSummary(payload)}`,
    `<b>Total estimatif</b>: ${escapeHtml(formatPrice(payload.pricing_snapshot.total_global))}`,
    "<b>Statut</b>: en attente d’approbation manuelle",
    `<b>Blocage jusqu'au</b>: ${escapeHtml(formatDateTimeFr(payload.hold_expires_at))}`,
    "",
    ...bookingGuestDetails(payload),
    "",
    `Demande #${escapeHtml(payload.id)}`,
    bookingManagementLink(payload),
  ]
    .filter(Boolean)
    .join("\n");

export const notifyBookingRequestCreatedOnTelegram = async (
  payload: BookingRequestTelegramPayload,
) => {
  const config = readTelegramNotificationConfig();
  if (!config.notify_booking_request_created) {
    return { sent_count: 0, skipped_reason: "event_disabled" as const };
  }

  return sendTelegramMessage(
    buildBookingRequestCreatedMessage(payload),
    config,
  );
};

const buildBookingOptionsSummary = (payload: BookingRequestTelegramPayload) => {
  const summary =
    buildBookingRequestOptionsTemplateValues(payload).optionsSummary;
  return summary
    ? "\n" + escapeHtml(summary.split("\n").slice(1).join("\n"))
    : "aucune";
};

export const buildBookingRequestApprovedTelegramMessage = (
  payload: BookingRequestTelegramPayload,
) => {
  return [
    "✅ <b>Réservation approuvée manuellement</b>",
    "",
    `<b>Gîte</b>: ${escapeHtml(payload.gite.nom.slice(0, 160))}`,
    `<b>Séjour</b>: du ${escapeHtml(formatBookedDateInput(payload.date_entree))} au ${escapeHtml(formatBookedDateInput(payload.date_sortie))}`,
    ...bookingGuestDetails(payload),
    `<b>Options</b>: ${buildBookingOptionsSummary(payload)}`,
    `<b>Total</b>: ${escapeHtml(formatPrice(payload.pricing_snapshot.total_global))}`,
    "<b>Règlement</b>: sur place",
    `Demande #${escapeHtml(payload.id)}`,
    bookingManagementLink(payload),
  ].join("\n");
};

export const buildBookingPaymentTelegramMessage = (
  payload: BookingRequestTelegramPayload,
  payment: BookingPaymentEmailInfo & { review_reason?: string | null },
  existingReservation = false,
) => {
  if (
    !["paid", "requires_review", "refunded", "partially_refunded"].includes(
      payment.status,
    )
  ) {
    throw new Error("Le paiement n’a pas encore de résultat à notifier.");
  }
  const refunded = payment.refunded_amount_cents > 0;
  const review = payment.status === "requires_review";
  const title = review
    ? "⚠️ <b>Paiement à vérifier</b>"
    : refunded
      ? "↩️ <b>Remboursement enregistré</b>"
      : existingReservation
        ? "💳 <b>Paiement reçu sur une réservation</b>"
        : "✅ <b>Réservation confirmée après paiement en ligne</b>";
  const lines = [
    title,
    "",
    `<b>Gîte</b>: ${escapeHtml(payload.gite.nom.slice(0, 160))}`,
    `<b>Séjour</b>: du ${formatBookedDateInput(payload.date_entree)} au ${formatBookedDateInput(payload.date_sortie)} (${payload.pricing_snapshot.nb_nuits} nuit(s))`,
    `<b>Voyageurs</b>: ${payload.nb_adultes} adulte(s), ${payload.nb_enfants_2_17} enfant(s)`,
    ...bookingGuestDetails(payload),
    `<b>Options</b>: ${buildBookingOptionsSummary(payload)}`,
    `<b>Total du séjour</b>: ${formatPrice(payment.total_cents / 100)}`,
    `<b>${!review && payment.purpose === "deposit" ? "Arrhes reçues" : "Paiement reçu"}</b>: ${formatPrice(payment.paid_amount_cents / 100)} (Stripe)`,
  ];
  if (review)
    lines.push(
      "<b>Suivi</b>: contrôler le dossier et le règlement avant toute confirmation.",
      payment.review_reason
        ? escapeHtml(payment.review_reason.slice(0, 400))
        : "",
    );
  else if (refunded)
    lines.push(
      `<b>Montant remboursé</b>: ${formatPrice(payment.refunded_amount_cents / 100)}`,
      "Le remboursement n’annule pas automatiquement le séjour.",
    );
  else {
    const remaining =
      payment.remaining_cents ??
      Math.max(0, payment.total_cents - payment.paid_amount_cents);
    lines.push(
      `<b>Solde à régler sur place</b>: ${formatPrice(remaining / 100)}`,
    );
    if (!remaining) lines.push("Le séjour est réglé en totalité.");
    if (!existingReservation)
      lines.push("Aucune approbation manuelle n’est nécessaire.");
  }
  lines.push(
    bookingManagementLink(
      payload,
      existingReservation ? payload.id : payload.approved_reservation_id,
    ),
  );
  return lines.filter(Boolean).join("\n");
};

export const notifyBookingRequestApprovedOnTelegram = async (
  payload: BookingRequestTelegramPayload,
) => {
  const config = readTelegramNotificationConfig();
  if (!config.notify_booking_request_approved)
    return { sent_count: 0, skipped_reason: "event_disabled" as const };
  return sendTelegramMessage(
    buildBookingRequestApprovedTelegramMessage(payload),
    config,
  );
};

export const buildGiteCheckedMessage = (
  name: string,
  checkedAt: Date,
  mentions: string[] = [],
  checkedBy?: string | null,
) =>
  [
    `✅ <b>Gîte ${escapeHtml(name)} checké !</b>`,
    checkedBy ? `Par ${escapeHtml(checkedBy)}` : "",
    escapeHtml(formatDateTimeFr(checkedAt)),
    mentions.map(escapeHtml).join(" "),
  ]
    .filter(Boolean)
    .join("\n");

export const notifyGiteCheckedOnTelegram = async (
  name: string,
  checkedAt: Date,
  checkedBy?: string | null,
) => {
  const config = readTelegramNotificationConfig();
  if (!config.notify_gite_checked)
    return { sent_count: 0, skipped_reason: "event_disabled" };
  return sendTelegramMessage(
    buildGiteCheckedMessage(
      name,
      checkedAt,
      config.gite_check_mentions,
      checkedBy,
    ),
    config,
  );
};

export const notifyCleaningCompletedOnTelegram = async (
  name: string,
  completedAt: Date,
  completedBy?: string | null,
) => {
  const config = readTelegramNotificationConfig();
  return sendTelegramMessage(
    [
      `🧹 <b>Ménage terminé : ${escapeHtml(name)}</b>`,
      completedBy ? `Par ${escapeHtml(completedBy)}` : "",
      escapeHtml(formatDateTimeFr(completedAt)),
    ]
      .filter(Boolean)
      .join("\n"),
    config,
  );
};

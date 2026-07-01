import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { formatBookedDateInput, type BookingQuote } from "./booked.js";

export type TelegramNotificationConfig = {
  enabled: boolean;
  bot_token: string;
  chat_ids: string[];
  notify_booking_request_created: boolean;
  notify_contract_return_overdue: boolean;
  notify_invoice_payment_overdue: boolean;
};

export type TelegramNotificationPublicState = {
  config: Omit<TelegramNotificationConfig, "bot_token"> & {
    bot_token: "";
  };
  bot_configured: boolean;
};

type BookingRequestTelegramPayload = {
  id: string;
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
    nom: string;
    email?: string | null;
  };
  pricing_snapshot: BookingQuote;
};

const SETTINGS_FILE = path.join(
  env.DATA_DIR,
  "telegram-notifications-settings.json",
);

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
    notify_booking_request_created: true,
    notify_contract_return_overdue: true,
    notify_invoice_payment_overdue: true,
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
  notify_booking_request_created: toBoolean(
    input?.notify_booking_request_created,
    fallback.notify_booking_request_created,
  ),
  notify_contract_return_overdue: toBoolean(
    input?.notify_contract_return_overdue,
    fallback.notify_contract_return_overdue,
  ),
  notify_invoice_payment_overdue: toBoolean(
    input?.notify_invoice_payment_overdue,
    fallback.notify_invoice_payment_overdue,
  ),
});

export const readTelegramNotificationConfig = (
  fallback?: TelegramNotificationConfig,
): TelegramNotificationConfig => {
  const defaults = fallback ?? buildDefaultTelegramNotificationConfig();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
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
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
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
    notify_booking_request_created: config.notify_booking_request_created,
    notify_contract_return_overdue: config.notify_contract_return_overdue,
    notify_invoice_payment_overdue: config.notify_invoice_payment_overdue,
  },
  bot_configured: Boolean(config.bot_token.trim()),
});

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

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

const postTelegramMessage = async (params: {
  botToken: string;
  chatId: string;
  text: string;
}) => {
  const response = await fetch(
    `https://api.telegram.org/bot${params.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Telegram sendMessage failed (${response.status}): ${body || response.statusText}`,
    );
  }
};

export const sendTelegramMessage = async (
  text: string,
  config = readTelegramNotificationConfig(),
) => {
  if (!config.enabled) {
    return { sent_count: 0, skipped_reason: "disabled" as const };
  }
  if (!config.bot_token.trim()) {
    return { sent_count: 0, skipped_reason: "missing_bot_token" as const };
  }
  if (config.chat_ids.length === 0) {
    return { sent_count: 0, skipped_reason: "missing_chat_ids" as const };
  }

  for (const chatId of config.chat_ids) {
    await postTelegramMessage({
      botToken: config.bot_token,
      chatId,
      text,
    });
  }

  return { sent_count: config.chat_ids.length, skipped_reason: null };
};

const buildBookingRequestCreatedMessage = (
  payload: BookingRequestTelegramPayload,
) =>
  [
    "<b>Nouvelle demande de réservation Booked</b>",
    "",
    `<b>Gîte</b>: ${escapeHtml(payload.gite.nom)}`,
    `<b>Séjour</b>: du ${escapeHtml(formatBookedDateInput(payload.date_entree))} au ${escapeHtml(formatBookedDateInput(payload.date_sortie))} (${payload.pricing_snapshot.nb_nuits} nuit(s))`,
    `<b>Voyageurs</b>: ${payload.nb_adultes} adulte(s), ${payload.nb_enfants_2_17} enfant(s)`,
    `<b>Total estimatif</b>: ${escapeHtml(formatPrice(payload.pricing_snapshot.total_global))}`,
    `<b>Blocage jusqu'au</b>: ${escapeHtml(formatDateTimeFr(payload.hold_expires_at))}`,
    "",
    `<b>Client</b>: ${escapeHtml(payload.hote_nom)}`,
    `<b>Téléphone</b>: ${escapeHtml(payload.telephone?.trim() || "Non renseigné")}`,
    `<b>Email</b>: ${escapeHtml(payload.email?.trim() || "Non renseigné")}`,
    payload.message_client?.trim()
      ? `<b>Message</b>: ${escapeHtml(payload.message_client.trim())}`
      : "",
    "",
    `Demande #${escapeHtml(payload.id)}`,
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

  return sendTelegramMessage(buildBookingRequestCreatedMessage(payload), config);
};

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type DailyReservationEmailConfig = {
  enabled: boolean;
  recipients: DailyReservationEmailRecipientConfig[];
  hour: number;
  minute: number;
};

export type DailyReservationEmailRecipientConfig = {
  email: string;
  enabled: boolean;
  send_if_empty: boolean;
};

const SETTINGS_FILE = path.join(
  env.DATA_DIR,
  "daily-reservation-email-settings.json",
);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

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

const clampInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
};

const normalizeLegacyRecipientEmails = (value: unknown, fallback: string[]) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;]+/)
      : [];

  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of rawValues) {
    const normalized = String(rawValue ?? "").trim().toLowerCase();
    if (!normalized || !EMAIL_PATTERN.test(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    recipients.push(normalized);
  }

  return recipients.length > 0 ? recipients : fallback;
};

const normalizeRecipientConfigs = (
  recipientsValue: unknown,
  fallback: DailyReservationEmailRecipientConfig[],
  legacySendIfEmptyFallback?: boolean,
) => {
  if (!Array.isArray(recipientsValue)) return fallback;

  const recipientConfigs: DailyReservationEmailRecipientConfig[] = [];
  const seen = new Set<string>();

  for (const value of recipientsValue) {
    if (typeof value === "string") {
      const email = String(value).trim().toLowerCase();
      if (!email || !EMAIL_PATTERN.test(email) || seen.has(email)) continue;
      seen.add(email);
      recipientConfigs.push({
        email,
        enabled: true,
        send_if_empty: Boolean(legacySendIfEmptyFallback),
      });
      continue;
    }

    if (!value || typeof value !== "object") continue;
    const item = value as Partial<DailyReservationEmailRecipientConfig>;
    const email = String(item.email ?? "").trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || seen.has(email)) continue;
    seen.add(email);
    recipientConfigs.push({
      email,
      enabled: toBoolean(item.enabled, true),
      send_if_empty: toBoolean(
        item.send_if_empty,
        Boolean(legacySendIfEmptyFallback),
      ),
    });
  }

  return recipientConfigs.length > 0 ? recipientConfigs : fallback;
};

export const buildDefaultDailyReservationEmailConfig =
  (): DailyReservationEmailConfig => ({
    enabled: false,
    recipients: [],
    hour: 7,
    minute: 0,
  });

export const normalizeDailyReservationEmailConfig = (
  input: Partial<DailyReservationEmailConfig> | null | undefined,
  fallback: DailyReservationEmailConfig,
): DailyReservationEmailConfig => ({
  enabled: toBoolean(input?.enabled, fallback.enabled),
  recipients: normalizeRecipientConfigs(
    input?.recipients ??
      normalizeLegacyRecipientEmails(input?.recipients, []),
    fallback.recipients,
    toBoolean(
      (input as Partial<{ send_if_empty: boolean }> | null | undefined)
        ?.send_if_empty,
      false,
    ),
  ),
  hour: clampInteger(input?.hour, fallback.hour, 0, 23),
  minute: clampInteger(input?.minute, fallback.minute, 0, 59),
});

export const readDailyReservationEmailConfig = (
  fallback?: DailyReservationEmailConfig,
): DailyReservationEmailConfig => {
  const defaults = fallback ?? buildDefaultDailyReservationEmailConfig();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    return normalizeDailyReservationEmailConfig(
      JSON.parse(raw) as Partial<DailyReservationEmailConfig>,
      defaults,
    );
  } catch {
    return defaults;
  }
};

export const writeDailyReservationEmailConfig = (
  config: DailyReservationEmailConfig,
) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
};

export const mergeDailyReservationEmailConfig = (
  current: DailyReservationEmailConfig,
  patch: Partial<DailyReservationEmailConfig>,
) => normalizeDailyReservationEmailConfig(patch, current);

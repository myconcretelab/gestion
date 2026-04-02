import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import os from "os";

const dotenvPaths = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), ".env.production"),
  path.join(process.cwd(), ".env.update"),
  path.join(process.cwd(), "..", ".env"),
  path.join(process.cwd(), "..", ".env.production"),
  path.join(process.cwd(), "..", ".env.update"),
].filter(Boolean) as string[];

const initialEnvKeys = new Set(Object.keys(process.env));

for (const envPath of dotenvPaths) {
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    for (const [key, value] of Object.entries(parsed)) {
      if (initialEnvKeys.has(key)) continue;
      process.env[key] = value;
    }
  }
}

const normalizePlaywrightBrowsersPath = (value?: string) => {
  if (!value || value === "0") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
};

const normalizedPlaywrightBrowsersPath = normalizePlaywrightBrowsersPath(
  process.env.PLAYWRIGHT_BROWSERS_PATH
);

if (normalizedPlaywrightBrowsersPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = normalizedPlaywrightBrowsersPath;
}

const port = Number(process.env.PORT ?? 4000);
const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};
const parseIntegerEnv = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
};

export const env = {
  PORT: Number.isNaN(port) ? 4000 : port,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD ?? "",
  INTEGRATION_API_TOKEN: process.env.INTEGRATION_API_TOKEN ?? "",
  CRON_TRIGGER_TOKEN: process.env.CRON_TRIGGER_TOKEN ?? "",
  PUMP_API_BASE_URL: process.env.PUMP_API_BASE_URL ?? "http://localhost:3000/api/reservations",
  PUMP_API_KEY: process.env.PUMP_API_KEY ?? "",
  PUMP_BASE_URL: process.env.PUMP_BASE_URL ?? "https://www.airbnb.fr/hosting/multicalendar",
  PUMP_USERNAME: process.env.PUMP_USERNAME ?? "",
  PUMP_SESSION_PASSWORD: process.env.PUMP_SESSION_PASSWORD ?? "",
  PUMP_AUTH_MODE:
    String(process.env.PUMP_AUTH_MODE ?? "persisted-only").trim().toLowerCase() === "legacy-auto-login"
      ? "legacy-auto-login"
      : "persisted-only",
  PUMP_HAS_OTP: parseBooleanEnv(process.env.PUMP_HAS_OTP, false),
  PUMP_PERSIST_SESSION: parseBooleanEnv(process.env.PUMP_PERSIST_SESSION, true),
  PUMP_MANUAL_SCROLL_MODE: parseBooleanEnv(process.env.PUMP_MANUAL_SCROLL_MODE, false),
  PUMP_MANUAL_SCROLL_DURATION: parseIntegerEnv(process.env.PUMP_MANUAL_SCROLL_DURATION, 20_000, 0, 600_000),
  PUMP_SCROLL_SELECTOR: process.env.PUMP_SCROLL_SELECTOR ?? "",
  PUMP_SCROLL_COUNT: parseIntegerEnv(process.env.PUMP_SCROLL_COUNT, 5, 1, 500),
  PUMP_SCROLL_DISTANCE: parseIntegerEnv(process.env.PUMP_SCROLL_DISTANCE, 500, 1, 20_000),
  PUMP_SCROLL_DELAY: parseIntegerEnv(process.env.PUMP_SCROLL_DELAY, 1_000, 0, 120_000),
  PUMP_WAIT_BEFORE_SCROLL: parseIntegerEnv(process.env.PUMP_WAIT_BEFORE_SCROLL, 2_000, 0, 120_000),
  PUMP_OUTPUT_FOLDER: process.env.PUMP_OUTPUT_FOLDER ?? "",
  PUMP_HEALTH_STALE_AFTER_HOURS: parseIntegerEnv(process.env.PUMP_HEALTH_STALE_AFTER_HOURS, 96, 1, 24 * 30),
  PUMP_LOGIN_STRATEGY:
    String(process.env.PUMP_LOGIN_STRATEGY ?? "simple").trim().toLowerCase() === "multi-step" ? "multi-step" : "simple",
  DEFAULT_ARRHES_RATE: Number(process.env.DEFAULT_ARRHES_RATE ?? 0.2),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  DATA_DIR: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  PDF_SUBDIR: process.env.PDF_SUBDIR ?? "pdfs",
  ICAL_SYNC_ENABLED: parseBooleanEnv(process.env.ICAL_SYNC_ENABLED, true),
  ICAL_SYNC_RUN_ON_START: parseBooleanEnv(process.env.ICAL_SYNC_RUN_ON_START, false),
  ICAL_SYNC_INTERVAL_HOURS: parseIntegerEnv(process.env.ICAL_SYNC_INTERVAL_HOURS, 24, 1, 168),
  ICAL_SYNC_HOUR: parseIntegerEnv(process.env.ICAL_SYNC_HOUR, 3, 0, 23),
  ICAL_SYNC_MINUTE: parseIntegerEnv(process.env.ICAL_SYNC_MINUTE, 15, 0, 59),
  PUMP_IMPORT_CRON_ENABLED: parseBooleanEnv(process.env.PUMP_IMPORT_CRON_ENABLED, true),
  PUMP_IMPORT_CRON_SCHEDULER:
    String(process.env.PUMP_IMPORT_CRON_SCHEDULER ?? "internal").trim().toLowerCase() === "external"
      ? "external"
      : "internal",
  PUMP_IMPORT_CRON_RUN_ON_START: parseBooleanEnv(process.env.PUMP_IMPORT_CRON_RUN_ON_START, false),
  PUMP_IMPORT_CRON_INTERVAL_DAYS: parseIntegerEnv(process.env.PUMP_IMPORT_CRON_INTERVAL_DAYS, 3, 1, 30),
  PUMP_IMPORT_CRON_HOUR: parseIntegerEnv(process.env.PUMP_IMPORT_CRON_HOUR, 10, 0, 23),
  PUMP_IMPORT_CRON_MINUTE: parseIntegerEnv(process.env.PUMP_IMPORT_CRON_MINUTE, 0, 0, 59),
  PUMP_ALERT_EMAIL_ENABLED: parseBooleanEnv(process.env.PUMP_ALERT_EMAIL_ENABLED, true),
  PUMP_ALERT_EMAIL_TO: process.env.PUMP_ALERT_EMAIL_TO ?? "",
  PUMP_ALERT_EMAIL_FROM: process.env.PUMP_ALERT_EMAIL_FROM ?? "",
  SMTP_HOST: process.env.SMTP_HOST ?? "",
  SMTP_PORT: parseIntegerEnv(process.env.SMTP_PORT, 587, 1, 65535),
  SMTP_SECURE: parseBooleanEnv(process.env.SMTP_SECURE, false),
  SMTP_USER: process.env.SMTP_USER ?? "",
  SMTP_PASS: process.env.SMTP_PASS ?? "",
  SMTP_FROM: process.env.SMTP_FROM ?? "",
  SMTP_REPLY_TO: process.env.SMTP_REPLY_TO ?? "",
};

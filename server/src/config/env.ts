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
  PUMP_API_BASE_URL: process.env.PUMP_API_BASE_URL ?? "http://localhost:3000/api/reservations",
  PUMP_API_KEY: process.env.PUMP_API_KEY ?? "",
  DEFAULT_ARRHES_RATE: Number(process.env.DEFAULT_ARRHES_RATE ?? 0.2),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  DATA_DIR: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  PDF_SUBDIR: process.env.PDF_SUBDIR ?? "pdfs",
  ICAL_SYNC_ENABLED: parseBooleanEnv(process.env.ICAL_SYNC_ENABLED, true),
  ICAL_SYNC_RUN_ON_START: parseBooleanEnv(process.env.ICAL_SYNC_RUN_ON_START, false),
  ICAL_SYNC_HOUR: parseIntegerEnv(process.env.ICAL_SYNC_HOUR, 3, 0, 23),
  ICAL_SYNC_MINUTE: parseIntegerEnv(process.env.ICAL_SYNC_MINUTE, 15, 0, 59),
};

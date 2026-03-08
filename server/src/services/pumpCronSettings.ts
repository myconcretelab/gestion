import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type PumpCronConfig = {
  enabled: boolean;
  interval_days: number;
  hour: number;
  minute: number;
  run_on_start: boolean;
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "pump-cron-settings.json");

const clampInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
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

export const buildDefaultPumpCronConfig = (): PumpCronConfig => ({
  enabled: env.PUMP_IMPORT_CRON_ENABLED,
  interval_days: env.PUMP_IMPORT_CRON_INTERVAL_DAYS,
  hour: env.PUMP_IMPORT_CRON_HOUR,
  minute: env.PUMP_IMPORT_CRON_MINUTE,
  run_on_start: env.PUMP_IMPORT_CRON_RUN_ON_START,
});

const normalizeConfig = (input: Partial<PumpCronConfig>, fallback: PumpCronConfig): PumpCronConfig => ({
  enabled: toBoolean(input.enabled, fallback.enabled),
  interval_days: clampInteger(input.interval_days, fallback.interval_days, 1, 30),
  hour: clampInteger(input.hour, fallback.hour, 0, 23),
  minute: clampInteger(input.minute, fallback.minute, 0, 59),
  run_on_start: toBoolean(input.run_on_start, fallback.run_on_start),
});

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

export const readPumpCronConfig = (fallback?: PumpCronConfig): PumpCronConfig => {
  const defaults = fallback ?? buildDefaultPumpCronConfig();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    const parsed = JSON.parse(raw) as Partial<PumpCronConfig>;
    return normalizeConfig(parsed, defaults);
  } catch {
    return defaults;
  }
};

export const writePumpCronConfig = (config: PumpCronConfig) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
};

export const mergePumpCronConfig = (current: PumpCronConfig, patch: Partial<PumpCronConfig>) =>
  normalizeConfig(patch, current);

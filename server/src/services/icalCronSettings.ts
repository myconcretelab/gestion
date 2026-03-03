import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type IcalCronConfig = {
  enabled: boolean;
  hour: number;
  minute: number;
  run_on_start: boolean;
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "ical-cron-settings.json");

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

export const buildDefaultIcalCronConfig = (): IcalCronConfig => ({
  enabled: env.ICAL_SYNC_ENABLED,
  hour: env.ICAL_SYNC_HOUR,
  minute: env.ICAL_SYNC_MINUTE,
  run_on_start: env.ICAL_SYNC_RUN_ON_START,
});

const normalizeConfig = (input: Partial<IcalCronConfig>, fallback: IcalCronConfig): IcalCronConfig => ({
  enabled: toBoolean(input.enabled, fallback.enabled),
  hour: clampInteger(input.hour, fallback.hour, 0, 23),
  minute: clampInteger(input.minute, fallback.minute, 0, 59),
  run_on_start: toBoolean(input.run_on_start, fallback.run_on_start),
});

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

export const readIcalCronConfig = (fallback?: IcalCronConfig): IcalCronConfig => {
  const defaults = fallback ?? buildDefaultIcalCronConfig();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    const parsed = JSON.parse(raw) as Partial<IcalCronConfig>;
    return normalizeConfig(parsed, defaults);
  } catch {
    return defaults;
  }
};

export const writeIcalCronConfig = (config: IcalCronConfig) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
};

export const mergeIcalCronConfig = (current: IcalCronConfig, patch: Partial<IcalCronConfig>) =>
  normalizeConfig(patch, current);

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type IcalCronConfig = {
  enabled: boolean;
  auto_sync_on_app_load: boolean;
  auto_run_pump_for_new_airbnb_ical: boolean;
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "ical-cron-settings.json");

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
  auto_sync_on_app_load: false,
  auto_run_pump_for_new_airbnb_ical: false,
});

type IcalCronConfigInput = Partial<IcalCronConfig> & {
  hour?: unknown;
  minute?: unknown;
  interval_hours?: unknown;
  run_on_start?: unknown;
};

export const normalizeIcalCronConfig = (input: IcalCronConfigInput, fallback: IcalCronConfig): IcalCronConfig => ({
  enabled: toBoolean(input.enabled, fallback.enabled),
  auto_sync_on_app_load: toBoolean(input.auto_sync_on_app_load, fallback.auto_sync_on_app_load),
  auto_run_pump_for_new_airbnb_ical: toBoolean(
    input.auto_run_pump_for_new_airbnb_ical,
    fallback.auto_run_pump_for_new_airbnb_ical
  ),
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
    const parsed = JSON.parse(raw) as IcalCronConfigInput;
    return normalizeIcalCronConfig(parsed, defaults);
  } catch {
    return defaults;
  }
};

export const writeIcalCronConfig = (config: IcalCronConfig) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
};

export const mergeIcalCronConfig = (current: IcalCronConfig, patch: Partial<IcalCronConfig>) =>
  normalizeIcalCronConfig(patch, current);

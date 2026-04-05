import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type SmartlifeRegion =
  | "eu"
  | "eu-west"
  | "us"
  | "us-e"
  | "in"
  | "cn";

export type SmartlifeAutomationRule = {
  id: string;
  enabled: boolean;
  label: string;
  gite_ids: string[];
  trigger:
    | "before-arrival"
    | "after-arrival"
    | "before-departure"
    | "after-departure";
  offset_minutes: number;
  device_id: string;
  device_name: string;
  command_code: string;
  command_label: string | null;
  command_value: boolean;
};

export type SmartlifeAutomationConfig = {
  enabled: boolean;
  region: SmartlifeRegion;
  access_id: string;
  access_secret: string;
  rules: SmartlifeAutomationRule[];
};

const SETTINGS_FILE = path.join(
  env.DATA_DIR,
  "smartlife-automation-settings.json",
);

const MAX_OFFSET_MINUTES = 14 * 24 * 60;

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeInteger = (
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

const normalizeRegion = (
  value: unknown,
  fallback: SmartlifeRegion,
): SmartlifeRegion => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "eu") return "eu";
  if (normalized === "eu-west") return "eu-west";
  if (normalized === "us") return "us";
  if (normalized === "us-e") return "us-e";
  if (normalized === "in") return "in";
  if (normalized === "cn") return "cn";
  return fallback;
};

const normalizeStringList = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const items: string[] = [];
  for (const rawItem of value) {
    const item = normalizeString(rawItem);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
};

const normalizeRule = (
  value: unknown,
  fallback?: SmartlifeAutomationRule,
): SmartlifeAutomationRule | null => {
  if (!value || typeof value !== "object") return fallback ?? null;

  const rule = value as Partial<SmartlifeAutomationRule>;
  const trigger =
    rule.trigger === "after-arrival"
      ? "after-arrival"
      : rule.trigger === "before-departure"
      ? "before-departure"
      : rule.trigger === "after-departure"
        ? "after-departure"
        : "before-arrival";

  const giteIds = normalizeStringList(rule.gite_ids, fallback?.gite_ids ?? []);

  return {
    id: normalizeString(rule.id) || fallback?.id || crypto.randomUUID(),
    enabled: normalizeBoolean(rule.enabled, fallback?.enabled ?? true),
    label:
      normalizeString(rule.label) ||
      fallback?.label ||
      "Nouvelle automatisation",
    gite_ids: giteIds,
    trigger,
    offset_minutes: normalizeInteger(
      rule.offset_minutes,
      fallback?.offset_minutes ?? 60,
      0,
      MAX_OFFSET_MINUTES,
    ),
    device_id: normalizeString(rule.device_id) || fallback?.device_id || "",
    device_name:
      normalizeString(rule.device_name) || fallback?.device_name || "",
    command_code:
      normalizeString(rule.command_code) || fallback?.command_code || "",
    command_label:
      normalizeNullableString(rule.command_label) ?? fallback?.command_label ?? null,
    command_value: normalizeBoolean(
      rule.command_value,
      fallback?.command_value ?? true,
    ),
  };
};

export const buildDefaultSmartlifeAutomationConfig =
  (): SmartlifeAutomationConfig => ({
    enabled: false,
    region: "eu",
    access_id: "",
    access_secret: "",
    rules: [],
  });

export const normalizeSmartlifeAutomationConfig = (
  value: Partial<SmartlifeAutomationConfig> | null | undefined,
  fallback: SmartlifeAutomationConfig,
): SmartlifeAutomationConfig => {
  const input = value ?? {};
  const rules = Array.isArray(input.rules)
    ? input.rules
        .map((rule) => normalizeRule(rule))
        .filter((rule): rule is SmartlifeAutomationRule => rule !== null)
    : fallback.rules;

  return {
    enabled: normalizeBoolean(input.enabled, fallback.enabled),
    region: normalizeRegion(input.region, fallback.region),
    access_id: normalizeString(input.access_id) || fallback.access_id,
    access_secret:
      normalizeString(input.access_secret) || fallback.access_secret,
    rules,
  };
};

export const readSmartlifeAutomationConfig = (
  fallback?: SmartlifeAutomationConfig,
): SmartlifeAutomationConfig => {
  const defaults = fallback ?? buildDefaultSmartlifeAutomationConfig();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    return normalizeSmartlifeAutomationConfig(
      JSON.parse(raw) as Partial<SmartlifeAutomationConfig>,
      defaults,
    );
  } catch {
    return defaults;
  }
};

export const writeSmartlifeAutomationConfig = (
  config: SmartlifeAutomationConfig,
) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
};

export const mergeSmartlifeAutomationConfig = (
  current: SmartlifeAutomationConfig,
  patch: Partial<SmartlifeAutomationConfig>,
) => normalizeSmartlifeAutomationConfig(patch, current);

export const hasSmartlifeCredentials = (
  config: SmartlifeAutomationConfig,
) => Boolean(config.access_id.trim() && config.access_secret.trim());

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type DeclarationNightsSettings = {
  excluded_sources: string[];
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "declaration-nights-settings.json");

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const normalizeSourceList = (values: unknown, fallback: string[]) => {
  if (!Array.isArray(values)) return fallback;

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const label = String(value ?? "").trim();
    if (!label) continue;
    const key = normalizeTextKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(label);
  }

  return normalized;
};

export const buildDefaultDeclarationNightsSettings = (): DeclarationNightsSettings => ({
  excluded_sources: ["Airbnb"],
});

const normalizeSettings = (
  input: Partial<DeclarationNightsSettings>,
  fallback: DeclarationNightsSettings
): DeclarationNightsSettings => ({
  excluded_sources: normalizeSourceList(input.excluded_sources, fallback.excluded_sources),
});

export const readDeclarationNightsSettings = (
  fallback?: DeclarationNightsSettings
): DeclarationNightsSettings => {
  const defaults = fallback ?? buildDefaultDeclarationNightsSettings();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    const parsed = JSON.parse(raw) as Partial<DeclarationNightsSettings>;
    return normalizeSettings(parsed, defaults);
  } catch {
    return defaults;
  }
};

export const writeDeclarationNightsSettings = (settings: DeclarationNightsSettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
};

export const mergeDeclarationNightsSettings = (
  current: DeclarationNightsSettings,
  patch: Partial<DeclarationNightsSettings>
) => normalizeSettings(patch, current);

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type SourceColorSettings = {
  colors: Record<string, string>;
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "source-color-settings.json");

const DEFAULT_SOURCE_COLORS: Record<string, string> = {
  Airbnb: "#FF1920",
  Abritel: "#2D8CFF",
  "Gites de France": "#FFD700",
  HomeExchange: "#7C3AED",
  Virement: "#247595",
  "Chèque": "#258AA0",
  "Espèces": "#EF18C8",
  "A définir": "#D3D3D3",
};

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const normalizeHexColor = (value: string) => {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toUpperCase()}`;
  }
  return null;
};

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

export const buildDefaultSourceColorSettings = (): SourceColorSettings => ({
  colors: { ...DEFAULT_SOURCE_COLORS },
});

const normalizeColors = (values: unknown, fallback: Record<string, string>) => {
  const input = values && typeof values === "object" ? (values as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const normalized: Record<string, string> = {};

  Object.entries(input).forEach(([label, color]) => {
    const trimmedLabel = String(label ?? "").trim();
    const key = normalizeTextKey(trimmedLabel);
    const normalizedColor = normalizeHexColor(String(color ?? ""));
    if (!trimmedLabel || !key || !normalizedColor || seen.has(key)) return;
    seen.add(key);
    normalized[trimmedLabel] = normalizedColor;
  });

  if (Object.keys(normalized).length > 0) return normalized;
  return { ...fallback };
};

const normalizeSettings = (input: Partial<SourceColorSettings>, fallback: SourceColorSettings): SourceColorSettings => ({
  colors: normalizeColors(input.colors, fallback.colors),
});

export const readSourceColorSettings = (fallback?: SourceColorSettings): SourceColorSettings => {
  const defaults = fallback ?? buildDefaultSourceColorSettings();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    const parsed = JSON.parse(raw) as Partial<SourceColorSettings>;
    return normalizeSettings(parsed, defaults);
  } catch {
    return defaults;
  }
};

export const writeSourceColorSettings = (settings: SourceColorSettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
};

export const mergeSourceColorSettings = (current: SourceColorSettings, patch: Partial<SourceColorSettings>) =>
  normalizeSettings(patch, current);

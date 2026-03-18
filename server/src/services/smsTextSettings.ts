import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type SmsTextItem = {
  id: string;
  title: string;
  text: string;
};

export type SmsTextSettings = {
  texts: SmsTextItem[];
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "sms-text-settings.json");

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const slugifySmsTextId = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const buildSmsTextId = (value: string, index: number) => {
  const slug = slugifySmsTextId(value);
  return slug || `sms-text-${index + 1}`;
};

export const buildDefaultSmsTextSettings = (): SmsTextSettings => ({
  texts: [
    {
      id: "bedding-cleaning",
      title: "Draps/ménage",
      text: "Comme indiqué, je vous laisse prendre vos draps, serviettes et faire le ménage avant de partir.",
    },
    {
      id: "bedding-option",
      title: "Option Draps/Serviettes",
      text: "Vous pourrez prendre l'option draps à 15€ par lit si vous ne souhaitez pas emporter votre linge.",
    },
  ],
});

const normalizeTexts = (values: unknown, fallback: SmsTextItem[]) => {
  if (!Array.isArray(values)) return fallback;

  const seen = new Set<string>();
  const normalized: SmsTextItem[] = [];

  values.forEach((value, index) => {
    if (!value || typeof value !== "object") return;
    const item = value as Partial<SmsTextItem>;
    const title = String(item.title ?? "").trim();
    const text = String(item.text ?? "").trim();
    if (!title || !text) return;

    const requestedId = String(item.id ?? "").trim();
    const nextId = buildSmsTextId(requestedId || title, index);
    if (seen.has(nextId)) return;
    seen.add(nextId);
    normalized.push({
      id: nextId,
      title,
      text,
    });
  });

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeSettings = (input: Partial<SmsTextSettings>, fallback: SmsTextSettings): SmsTextSettings => ({
  texts: normalizeTexts(input.texts, fallback.texts),
});

export const readSmsTextSettings = (fallback?: SmsTextSettings): SmsTextSettings => {
  const defaults = fallback ?? buildDefaultSmsTextSettings();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    const parsed = JSON.parse(raw) as Partial<SmsTextSettings>;
    return normalizeSettings(parsed, defaults);
  } catch {
    return defaults;
  }
};

export const writeSmsTextSettings = (settings: SmsTextSettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
};

export const mergeSmsTextSettings = (current: SmsTextSettings, patch: Partial<SmsTextSettings>) =>
  normalizeSettings(patch, current);

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type GiteExpenseCategory = {
  id: string;
  name: string;
  color: string;
};

export type GiteExpenseCategorySettings = {
  categories: GiteExpenseCategory[];
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "gite-expense-category-settings.json");

const DEFAULT_EXPENSE_CATEGORIES: GiteExpenseCategory[] = [
  { id: "energie", name: "Énergie", color: "#2D8CFF" },
  { id: "entretien", name: "Entretien", color: "#43B77D" },
  { id: "taxes", name: "Taxes", color: "#F5A623" },
  { id: "assurance", name: "Assurance", color: "#7E5BEF" },
];

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

export const buildDefaultGiteExpenseCategorySettings = (): GiteExpenseCategorySettings => ({
  categories: DEFAULT_EXPENSE_CATEGORIES.map((category) => ({ ...category })),
});

export const normalizeGiteExpenseCategories = (value: unknown, fallback?: GiteExpenseCategory[]) => {
  const fallbackCategories = fallback?.length ? fallback : DEFAULT_EXPENSE_CATEGORIES;
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const categories = input
    .map((item, index): GiteExpenseCategory | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Partial<GiteExpenseCategory>;
      const id = String(row.id ?? "").trim();
      const name = String(row.name ?? "").trim();
      const color = normalizeHexColor(String(row.color ?? "")) ?? fallbackCategories[index % fallbackCategories.length]?.color ?? "#64748B";
      if (!id || !name || seen.has(id)) return null;
      seen.add(id);
      return { id, name, color };
    })
    .filter((category): category is GiteExpenseCategory => Boolean(category));

  return categories.length > 0 ? categories : fallbackCategories.map((category) => ({ ...category }));
};

const normalizeSettings = (
  input: Partial<GiteExpenseCategorySettings> | null | undefined,
  fallback?: GiteExpenseCategorySettings
): GiteExpenseCategorySettings => ({
  categories: normalizeGiteExpenseCategories(input?.categories, fallback?.categories),
});

export const readGiteExpenseCategorySettings = (
  fallback?: GiteExpenseCategorySettings
): GiteExpenseCategorySettings => {
  const defaults = fallback ?? buildDefaultGiteExpenseCategorySettings();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    return normalizeSettings(JSON.parse(raw) as Partial<GiteExpenseCategorySettings>, defaults);
  } catch {
    return defaults;
  }
};

export const hasGiteExpenseCategorySettings = () => {
  ensureDataDir();
  return fs.existsSync(SETTINGS_FILE);
};

export const writeGiteExpenseCategorySettings = (settings: GiteExpenseCategorySettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalizeSettings(settings), null, 2), "utf-8");
};

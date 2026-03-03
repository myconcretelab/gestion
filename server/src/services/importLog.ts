import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export const IMPORT_LOG_LIMIT = 20;
const IMPORT_LOG_FILE = path.join(env.DATA_DIR, "import-log.json");

type ImportLogEntryInput = {
  source: string;
  selectionCount: number;
  inserted: number;
  updated: number;
  skipped?: {
    duplicate?: number;
    invalid?: number;
    outsideYear?: number;
    unknown?: number;
  };
  perGite?: Record<string, { inserted?: number; updated?: number; skipped?: number }>;
  insertedItems?: Array<{
    giteName?: string;
    giteId?: string;
    checkIn?: string;
    checkOut?: string;
    source?: string;
  }>;
  updatedItems?: Array<{
    giteName?: string;
    giteId?: string;
    checkIn?: string;
    checkOut?: string;
    source?: string;
  }>;
};

export type ImportLogEntry = {
  id: string;
  at: string;
  source: string;
  selectionCount: number;
  inserted: number;
  updated: number;
  skipped: {
    duplicate: number;
    invalid: number;
    outsideYear: number;
    unknown: number;
  };
  perGite: Record<string, { inserted: number; updated: number; skipped: number }>;
  insertedItems: Array<{
    giteName: string;
    giteId: string;
    checkIn: string;
    checkOut: string;
    source: string;
  }>;
  updatedItems: Array<{
    giteName: string;
    giteId: string;
    checkIn: string;
    checkOut: string;
    source: string;
  }>;
};

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
};

export const readImportLog = (): ImportLogEntry[] => {
  ensureDataDir();
  if (!fs.existsSync(IMPORT_LOG_FILE)) return [];

  try {
    const raw = fs.readFileSync(IMPORT_LOG_FILE, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ImportLogEntry[]) : [];
  } catch {
    return [];
  }
};

export const writeImportLog = (entries: ImportLogEntry[]) => {
  ensureDataDir();
  fs.writeFileSync(IMPORT_LOG_FILE, JSON.stringify(entries, null, 2), "utf-8");
};

export const buildImportLogEntry = (input: ImportLogEntryInput): ImportLogEntry => {
  const sanitizeItems = (
    items:
      | Array<{
          giteName?: string;
          giteId?: string;
          checkIn?: string;
          checkOut?: string;
          source?: string;
        }>
      | undefined
  ) =>
    Array.isArray(items)
      ? items.map((item) => ({
          giteName: String(item.giteName ?? "").trim(),
          giteId: String(item.giteId ?? "").trim(),
          checkIn: String(item.checkIn ?? "").trim(),
          checkOut: String(item.checkOut ?? "").trim(),
          source: String(item.source ?? "").trim(),
        }))
      : [];

  const insertedItems = sanitizeItems(input.insertedItems);
  const updatedItems = sanitizeItems(input.updatedItems);

  const normalizedPerGite: ImportLogEntry["perGite"] = {};
  for (const [key, value] of Object.entries(input.perGite ?? {})) {
    normalizedPerGite[key] = {
      inserted: toNumber(value?.inserted),
      updated: toNumber(value?.updated),
      skipped: toNumber(value?.skipped),
    };
  }

  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source: String(input.source || "import").trim() || "import",
    selectionCount: toNumber(input.selectionCount),
    inserted: toNumber(input.inserted),
    updated: toNumber(input.updated),
    skipped: {
      duplicate: toNumber(input.skipped?.duplicate),
      invalid: toNumber(input.skipped?.invalid),
      outsideYear: toNumber(input.skipped?.outsideYear),
      unknown: toNumber(input.skipped?.unknown),
    },
    perGite: normalizedPerGite,
    insertedItems,
    updatedItems,
  };
};

export const appendImportLog = (entry: ImportLogEntry) => {
  const log = readImportLog();
  log.unshift(entry);
  const trimmed = log.slice(0, IMPORT_LOG_LIMIT);
  writeImportLog(trimmed);
  return trimmed;
};

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { extractPumpReservationsFromSession } from "./pumpAutomationExtraction.js";

export const IMPORT_LOG_LIMIT = 20;
const IMPORT_LOG_FILE = path.join(env.DATA_DIR, "import-log.json");
const PUMP_SESSIONS_INDEX_FILE = path.join(env.DATA_DIR, "pump", "sessions", "index.json");

type ImportLogEntryInput = {
  source: string;
  status?: "success" | "error";
  errorMessage?: string | null;
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
    updatedFields?: string[];
  }>;
};

export type ImportLogEntry = {
  id: string;
  at: string;
  source: string;
  status: "success" | "error";
  errorMessage: string | null;
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
    updatedFields: string[];
  }>;
};

type PumpSessionRecord = {
  sessionId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  storageDir?: string;
  lastError?: string | null;
};

type PumpSessionsRegistry = {
  sessions?: Record<string, PumpSessionRecord>;
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

const normalizeStatus = (value: unknown): "success" | "error" => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "error" ? "error" : "success";
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

const parseIsoTime = (value: string | null | undefined) => {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const hasTraceablePumpSessionStatus = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["completed", "failed", "stopped", "cancelled", "canceled", "timed_out"].includes(normalized);
};

const isPumpSessionErrorStatus = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["failed", "stopped", "cancelled", "canceled", "timed_out"].includes(normalized);
};

const getPumpSessionReservationCount = (storageDir: string | undefined) => {
  if (!storageDir || !fs.existsSync(storageDir)) return 0;

  try {
    return extractPumpReservationsFromSession(storageDir).reservations.length;
  } catch {
    return 0;
  }
};

export const buildPumpSessionImportLogEntry = (
  session: PumpSessionRecord,
  reservationCount = 0
): ImportLogEntry | null => {
  if (!session.sessionId || !hasTraceablePumpSessionStatus(session.status)) return null;

  const at = session.updatedAt || session.createdAt;
  if (!at) return null;

  const errorStatus = isPumpSessionErrorStatus(session.status);
  const normalizedReservationCount = Number.isFinite(reservationCount) ? Math.max(0, Math.round(reservationCount)) : 0;

  return {
    id: `pump-refresh:${session.sessionId}`,
    at,
    source: "pump-refresh",
    status: errorStatus ? "error" : "success",
    errorMessage:
      errorStatus
        ? String(session.lastError ?? "").trim() || `Le refresh Pump s'est terminé avec le statut ${session.status}.`
        : null,
    selectionCount: normalizedReservationCount,
    inserted: 0,
    updated: 0,
    skipped: {
      duplicate: 0,
      invalid: 0,
      outsideYear: 0,
      unknown: 0,
    },
    perGite: {},
    insertedItems: [],
    updatedItems: [],
  };
};

const readPumpSessionImportLog = (): ImportLogEntry[] => {
  ensureDataDir();
  if (!fs.existsSync(PUMP_SESSIONS_INDEX_FILE)) return [];

  try {
    const raw = fs.readFileSync(PUMP_SESSIONS_INDEX_FILE, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as PumpSessionsRegistry;
    const sessions = Object.values(parsed.sessions ?? {});

    return sessions
      .map((session) => buildPumpSessionImportLogEntry(session, getPumpSessionReservationCount(session.storageDir)))
      .filter((entry): entry is ImportLogEntry => Boolean(entry));
  } catch {
    return [];
  }
};

export const readTraceabilityLog = (): ImportLogEntry[] =>
  [...readImportLog(), ...readPumpSessionImportLog()].sort((left, right) => parseIsoTime(right.at) - parseIsoTime(left.at));

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
          updatedFields?: string[];
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
          updatedFields: Array.isArray(item.updatedFields)
            ? item.updatedFields.map((field) => String(field ?? "").trim()).filter(Boolean)
            : [],
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
    status: normalizeStatus(input.status),
    errorMessage: String(input.errorMessage ?? "").trim() || null,
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

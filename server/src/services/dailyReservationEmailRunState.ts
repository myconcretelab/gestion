import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

const STATE_FILE = path.join(env.DATA_DIR, "daily-reservation-email-state.json");

export type DailyReservationEmailRunStatus =
  | "idle"
  | "running"
  | "success"
  | "skipped"
  | "error";

export type DailyReservationEmailGiteTotal = {
  gite_id: string | null;
  gite_nom: string;
  total_amount: number;
  reservations_count: number;
};

export type DailyReservationEmailRunSummary = {
  slot_at: string;
  window_start_at: string;
  window_end_at: string;
  new_reservations_count: number;
  email_sent: boolean;
  skipped_reason:
    | "disabled"
    | "already-ran-for-slot"
    | "no-new-reservations"
    | null;
  recipients_count: number;
  total_amount: number;
  total_reservations_count: number;
  totals_by_gite: DailyReservationEmailGiteTotal[];
};

export type PersistedDailyReservationEmailRunState = {
  running: boolean;
  last_started_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_email_sent_at: string | null;
  last_slot_at: string | null;
  last_status: DailyReservationEmailRunStatus;
  last_error: string | null;
  last_result: DailyReservationEmailRunSummary | null;
};

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const parseIsoDateTime = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const normalizeStatus = (value: unknown): DailyReservationEmailRunStatus => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "running") return "running";
  if (normalized === "success") return "success";
  if (normalized === "skipped") return "skipped";
  if (normalized === "error") return "error";
  return "idle";
};

const normalizeError = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeTotalsByGite = (
  value: unknown,
): DailyReservationEmailGiteTotal[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<DailyReservationEmailGiteTotal>;
      const giteNom = String(row.gite_nom ?? "").trim();
      if (!giteNom) return null;
      return {
        gite_id:
          typeof row.gite_id === "string" && row.gite_id.trim()
            ? row.gite_id.trim()
            : null,
        gite_nom: giteNom,
        total_amount: normalizeNumber(row.total_amount),
        reservations_count: Math.max(0, Math.round(normalizeNumber(row.reservations_count))),
      };
    })
    .filter((item): item is DailyReservationEmailGiteTotal => item !== null);
};

const normalizeSummary = (
  value: unknown,
): DailyReservationEmailRunSummary | null => {
  if (!value || typeof value !== "object") return null;
  const summary = value as Partial<DailyReservationEmailRunSummary>;
  const slotAt = parseIsoDateTime(summary.slot_at);
  const windowStartAt = parseIsoDateTime(summary.window_start_at);
  const windowEndAt = parseIsoDateTime(summary.window_end_at);
  if (!slotAt || !windowStartAt || !windowEndAt) return null;

  const skippedReason =
    summary.skipped_reason === "disabled" ||
    summary.skipped_reason === "already-ran-for-slot" ||
    summary.skipped_reason === "no-new-reservations"
      ? summary.skipped_reason
      : null;

  return {
    slot_at: slotAt,
    window_start_at: windowStartAt,
    window_end_at: windowEndAt,
    new_reservations_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.new_reservations_count)),
    ),
    email_sent: Boolean(summary.email_sent),
    skipped_reason: skippedReason,
    recipients_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.recipients_count)),
    ),
    total_amount: normalizeNumber(summary.total_amount),
    total_reservations_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.total_reservations_count)),
    ),
    totals_by_gite: normalizeTotalsByGite(summary.totals_by_gite),
  };
};

export const buildDefaultDailyReservationEmailRunState =
  (): PersistedDailyReservationEmailRunState => ({
    running: false,
    last_started_at: null,
    last_run_at: null,
    last_success_at: null,
    last_email_sent_at: null,
    last_slot_at: null,
    last_status: "idle",
    last_error: null,
    last_result: null,
  });

export const readDailyReservationEmailRunState =
  (): PersistedDailyReservationEmailRunState => {
    ensureDataDir();

    if (!fs.existsSync(STATE_FILE)) {
      return buildDefaultDailyReservationEmailRunState();
    }

    try {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      if (!raw.trim()) return buildDefaultDailyReservationEmailRunState();
      const parsed = JSON.parse(raw) as Partial<PersistedDailyReservationEmailRunState>;
      return {
        running: Boolean(parsed.running),
        last_started_at: parseIsoDateTime(parsed.last_started_at),
        last_run_at: parseIsoDateTime(parsed.last_run_at),
        last_success_at: parseIsoDateTime(parsed.last_success_at),
        last_email_sent_at: parseIsoDateTime(parsed.last_email_sent_at),
        last_slot_at: parseIsoDateTime(parsed.last_slot_at),
        last_status: normalizeStatus(parsed.last_status),
        last_error: normalizeError(parsed.last_error),
        last_result: normalizeSummary(parsed.last_result),
      };
    } catch {
      return buildDefaultDailyReservationEmailRunState();
    }
  };

export const writeDailyReservationEmailRunState = (
  state: PersistedDailyReservationEmailRunState,
) => {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
};

export const updateDailyReservationEmailRunState = (
  patch: Partial<PersistedDailyReservationEmailRunState>,
) => {
  const current = readDailyReservationEmailRunState();
  const has = (key: keyof PersistedDailyReservationEmailRunState) =>
    Object.prototype.hasOwnProperty.call(patch, key);

  const next: PersistedDailyReservationEmailRunState = {
    running: has("running") ? Boolean(patch.running) : current.running,
    last_started_at: parseIsoDateTime(
      has("last_started_at") ? patch.last_started_at : current.last_started_at,
    ),
    last_run_at: parseIsoDateTime(
      has("last_run_at") ? patch.last_run_at : current.last_run_at,
    ),
    last_success_at: parseIsoDateTime(
      has("last_success_at") ? patch.last_success_at : current.last_success_at,
    ),
    last_email_sent_at: parseIsoDateTime(
      has("last_email_sent_at")
        ? patch.last_email_sent_at
        : current.last_email_sent_at,
    ),
    last_slot_at: parseIsoDateTime(
      has("last_slot_at") ? patch.last_slot_at : current.last_slot_at,
    ),
    last_status: normalizeStatus(
      has("last_status") ? patch.last_status : current.last_status,
    ),
    last_error: normalizeError(
      has("last_error") ? patch.last_error : current.last_error,
    ),
    last_result: has("last_result")
      ? normalizeSummary(patch.last_result)
      : current.last_result,
  };

  writeDailyReservationEmailRunState(next);
  return next;
};

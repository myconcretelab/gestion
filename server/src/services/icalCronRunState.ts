import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { buildDefaultIcalCronConfig, readIcalCronConfig, type IcalCronConfig } from "./icalCronSettings.js";

const HOUR_MS = 60 * 60 * 1_000;
const STATE_FILE = path.join(env.DATA_DIR, "ical-cron-state.json");
const LOCK_FILE = path.join(env.DATA_DIR, "ical-cron.lock");

export type IcalCronRunStatus = "idle" | "running" | "success" | "error";

export type PersistedIcalCronRunState = {
  running: boolean;
  last_started_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: IcalCronRunStatus;
  last_error: string | null;
};

type IcalCronLock = {
  pid: number;
  started_at: string;
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

const normalizeStatus = (value: unknown): IcalCronRunStatus => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "running") return "running";
  if (normalized === "success") return "success";
  if (normalized === "error") return "error";
  return "idle";
};

const normalizeError = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const buildDefaultIcalCronRunState = (): PersistedIcalCronRunState => ({
  running: false,
  last_started_at: null,
  last_run_at: null,
  last_success_at: null,
  last_status: "idle",
  last_error: null,
});

export const readIcalCronRunState = (): PersistedIcalCronRunState => {
  ensureDataDir();

  if (!fs.existsSync(STATE_FILE)) {
    return buildDefaultIcalCronRunState();
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    if (!raw.trim()) return buildDefaultIcalCronRunState();
    const parsed = JSON.parse(raw) as Partial<PersistedIcalCronRunState>;
    return {
      running: Boolean(parsed.running),
      last_started_at: parseIsoDateTime(parsed.last_started_at),
      last_run_at: parseIsoDateTime(parsed.last_run_at),
      last_success_at: parseIsoDateTime(parsed.last_success_at),
      last_status: normalizeStatus(parsed.last_status),
      last_error: normalizeError(parsed.last_error),
    };
  } catch {
    return buildDefaultIcalCronRunState();
  }
};

export const writeIcalCronRunState = (state: PersistedIcalCronRunState) => {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
};

export const updateIcalCronRunState = (patch: Partial<PersistedIcalCronRunState>) => {
  const current = readIcalCronRunState();
  const has = (key: keyof PersistedIcalCronRunState) => Object.prototype.hasOwnProperty.call(patch, key);
  const next: PersistedIcalCronRunState = {
    running: has("running") ? Boolean(patch.running) : current.running,
    last_started_at: parseIsoDateTime(has("last_started_at") ? patch.last_started_at : current.last_started_at),
    last_run_at: parseIsoDateTime(has("last_run_at") ? patch.last_run_at : current.last_run_at),
    last_success_at: parseIsoDateTime(has("last_success_at") ? patch.last_success_at : current.last_success_at),
    last_status: normalizeStatus(has("last_status") ? patch.last_status : current.last_status),
    last_error: normalizeError(has("last_error") ? patch.last_error : current.last_error),
  };
  writeIcalCronRunState(next);
  return next;
};

export const computeIcalCronNextRunAt = (
  config: IcalCronConfig,
  state: PersistedIcalCronRunState,
  now = new Date()
) => {
  if (!config.enabled || state.running) return null;
  if (!state.last_run_at) return now.toISOString();

  const lastRunAt = new Date(state.last_run_at);
  if (Number.isNaN(lastRunAt.getTime())) return now.toISOString();
  return new Date(lastRunAt.getTime() + config.interval_hours * HOUR_MS).toISOString();
};

export const isIcalCronDue = (
  config: IcalCronConfig = readIcalCronConfig(buildDefaultIcalCronConfig()),
  state: PersistedIcalCronRunState = readIcalCronRunState(),
  now = new Date()
) => {
  if (!config.enabled || state.running) return false;
  const nextRunAt = computeIcalCronNextRunAt(config, state, now);
  if (!nextRunAt) return false;
  const parsed = new Date(nextRunAt);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() <= now.getTime();
};

const readLock = (): IcalCronLock | null => {
  ensureDataDir();
  if (!fs.existsSync(LOCK_FILE)) return null;

  try {
    const raw = fs.readFileSync(LOCK_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<IcalCronLock>;
    const pid = Number(parsed.pid);
    const startedAt = parseIsoDateTime(parsed.started_at);
    if (!Number.isInteger(pid) || pid <= 0 || !startedAt) {
      fs.unlinkSync(LOCK_FILE);
      return null;
    }
    return { pid, started_at: startedAt };
  } catch {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // Ignore stale lock cleanup failures.
    }
    return null;
  }
};

const isProcessRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== "ESRCH";
  }
};

export const acquireIcalCronLock = () => {
  ensureDataDir();
  const existing = readLock();
  if (existing) {
    if (isProcessRunning(existing.pid)) return false;
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      return false;
    }
  }

  const payload: IcalCronLock = {
    pid: process.pid,
    started_at: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify(payload, null, 2), { encoding: "utf-8", flag: "wx" });
    return true;
  } catch (error: any) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
};

export const releaseIcalCronLock = () => {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
};

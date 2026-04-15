import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import {
  getSmartlifeRuleCommandValue,
  type SmartlifeAutomationRuleAction,
} from "./smartlifeSettings.js";

const STATE_FILE = path.join(env.DATA_DIR, "smartlife-automation-state.json");
const EXECUTED_KEYS_MAX_AGE_DAYS = 90;
const EXECUTED_KEYS_MAX_ITEMS = 20_000;

export type SmartlifeAutomationRunStatus =
  | "idle"
  | "running"
  | "success"
  | "partial"
  | "skipped"
  | "error";

export type SmartlifeAutomationRunItem = {
  key: string;
  reservation_id: string;
  gite_id: string | null;
  gite_nom: string;
  reservation_label: string;
  rule_id: string;
  rule_label: string;
  device_id: string;
  device_name: string;
  action: SmartlifeAutomationRuleAction;
  command_code: string;
  command_value: boolean;
  trigger:
    | "before-arrival"
    | "after-arrival"
    | "before-departure"
    | "after-departure";
  scheduled_at: string;
  executed_at: string | null;
  previous_executed_at: string | null;
  status: "executed" | "skipped" | "error";
  message: string | null;
};

export type SmartlifeAutomationRunSummary = {
  checked_at: string;
  scanned_rules_count: number;
  scanned_reservations_count: number;
  due_events_count: number;
  executed_count: number;
  skipped_count: number;
  error_count: number;
  note: string | null;
  items: SmartlifeAutomationRunItem[];
};

export type PersistedSmartlifeAutomationRunState = {
  running: boolean;
  last_started_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: SmartlifeAutomationRunStatus;
  last_error: string | null;
  last_result: SmartlifeAutomationRunSummary | null;
  executed_event_keys: Record<string, string>;
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

const normalizeStatus = (value: unknown): SmartlifeAutomationRunStatus => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "running") return "running";
  if (normalized === "success") return "success";
  if (normalized === "partial") return "partial";
  if (normalized === "skipped") return "skipped";
  if (normalized === "error") return "error";
  return "idle";
};

const normalizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeNullableString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeRuleAction = (
  value: unknown,
  fallback: SmartlifeAutomationRuleAction,
): SmartlifeAutomationRuleAction => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "device-on") return "device-on";
  if (normalized === "device-off") return "device-off";
  return fallback;
};

const normalizeRunItem = (value: unknown): SmartlifeAutomationRunItem | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SmartlifeAutomationRunItem>;
  const key = String(item.key ?? "").trim();
  const reservationId = String(item.reservation_id ?? "").trim();
  const ruleId = String(item.rule_id ?? "").trim();
  const deviceId = String(item.device_id ?? "").trim();
  const commandCode = String(item.command_code ?? "").trim();
  const scheduledAt = parseIsoDateTime(item.scheduled_at);
  const fallbackAction = Boolean(item.command_value) ? "device-on" : "device-off";
  const action = normalizeRuleAction(item.action, fallbackAction);

  if (!key || !reservationId || !ruleId || !deviceId || !scheduledAt) {
    return null;
  }

  return {
    key,
    reservation_id: reservationId,
    gite_id: normalizeNullableString(item.gite_id),
    gite_nom: String(item.gite_nom ?? "").trim() || "Sans gîte assigné",
    reservation_label:
      String(item.reservation_label ?? "").trim() || reservationId,
    rule_id: ruleId,
    rule_label: String(item.rule_label ?? "").trim() || ruleId,
    device_id: deviceId,
    device_name: String(item.device_name ?? "").trim() || deviceId,
    action,
    command_code: commandCode,
    command_value:
      typeof item.command_value === "boolean"
        ? item.command_value
        : getSmartlifeRuleCommandValue(action),
    trigger:
      item.trigger === "after-arrival"
        ? "after-arrival"
        : item.trigger === "before-departure"
        ? "before-departure"
        : item.trigger === "after-departure"
          ? "after-departure"
          : "before-arrival",
    scheduled_at: scheduledAt,
    executed_at: parseIsoDateTime(item.executed_at),
    previous_executed_at: parseIsoDateTime(item.previous_executed_at),
    status:
      item.status === "executed" || item.status === "error"
        ? item.status
        : "skipped",
    message: normalizeNullableString(item.message),
  };
};

const normalizeSummary = (
  value: unknown,
): SmartlifeAutomationRunSummary | null => {
  if (!value || typeof value !== "object") return null;
  const summary = value as Partial<SmartlifeAutomationRunSummary>;
  const checkedAt = parseIsoDateTime(summary.checked_at);
  if (!checkedAt) return null;

  return {
    checked_at: checkedAt,
    scanned_rules_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.scanned_rules_count)),
    ),
    scanned_reservations_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.scanned_reservations_count)),
    ),
    due_events_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.due_events_count)),
    ),
    executed_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.executed_count)),
    ),
    skipped_count: Math.max(
      0,
      Math.round(normalizeNumber(summary.skipped_count)),
    ),
    error_count: Math.max(0, Math.round(normalizeNumber(summary.error_count))),
    note: normalizeNullableString(summary.note),
    items: Array.isArray(summary.items)
      ? summary.items
          .map((item) => normalizeRunItem(item))
          .filter((item): item is SmartlifeAutomationRunItem => item !== null)
      : [],
  };
};

const normalizeExecutedEventKeys = (value: unknown) => {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, executedAt]) => {
      const parsed = parseIsoDateTime(executedAt);
      return parsed ? [key, parsed] : null;
    })
    .filter((item): item is [string, string] => item !== null);

  return pruneExecutedEventKeys(Object.fromEntries(entries));
};

export const pruneExecutedEventKeys = (
  input: Record<string, string>,
): Record<string, string> => {
  const cutoff = Date.now() - EXECUTED_KEYS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const entries = Object.entries(input)
    .filter(([, executedAt]) => {
      const parsed = new Date(executedAt).getTime();
      return Number.isFinite(parsed) && parsed >= cutoff;
    })
    .sort((left, right) => {
      const leftTime = new Date(left[1]).getTime();
      const rightTime = new Date(right[1]).getTime();
      return rightTime - leftTime;
    })
    .slice(0, EXECUTED_KEYS_MAX_ITEMS);

  return Object.fromEntries(entries);
};

export const buildDefaultSmartlifeAutomationRunState =
  (): PersistedSmartlifeAutomationRunState => ({
    running: false,
    last_started_at: null,
    last_run_at: null,
    last_success_at: null,
    last_status: "idle",
    last_error: null,
    last_result: null,
    executed_event_keys: {},
  });

export const readSmartlifeAutomationRunState =
  (): PersistedSmartlifeAutomationRunState => {
    ensureDataDir();

    if (!fs.existsSync(STATE_FILE)) {
      return buildDefaultSmartlifeAutomationRunState();
    }

    try {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      if (!raw.trim()) return buildDefaultSmartlifeAutomationRunState();
      const parsed = JSON.parse(raw) as Partial<PersistedSmartlifeAutomationRunState>;
      return {
        running: Boolean(parsed.running),
        last_started_at: parseIsoDateTime(parsed.last_started_at),
        last_run_at: parseIsoDateTime(parsed.last_run_at),
        last_success_at: parseIsoDateTime(parsed.last_success_at),
        last_status: normalizeStatus(parsed.last_status),
        last_error: normalizeNullableString(parsed.last_error),
        last_result: normalizeSummary(parsed.last_result),
        executed_event_keys: normalizeExecutedEventKeys(
          parsed.executed_event_keys,
        ),
      };
    } catch {
      return buildDefaultSmartlifeAutomationRunState();
    }
  };

export const writeSmartlifeAutomationRunState = (
  state: PersistedSmartlifeAutomationRunState,
) => {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
};

export const updateSmartlifeAutomationRunState = (
  patch: Partial<PersistedSmartlifeAutomationRunState>,
) => {
  const current = readSmartlifeAutomationRunState();
  const has = (key: keyof PersistedSmartlifeAutomationRunState) =>
    Object.prototype.hasOwnProperty.call(patch, key);

  const next: PersistedSmartlifeAutomationRunState = {
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
    last_status: normalizeStatus(
      has("last_status") ? patch.last_status : current.last_status,
    ),
    last_error: normalizeNullableString(
      has("last_error") ? patch.last_error : current.last_error,
    ),
    last_result: has("last_result")
      ? normalizeSummary(patch.last_result)
      : current.last_result,
    executed_event_keys: has("executed_event_keys")
      ? pruneExecutedEventKeys(patch.executed_event_keys ?? {})
      : pruneExecutedEventKeys(current.executed_event_keys),
  };

  writeSmartlifeAutomationRunState(next);
  return next;
};

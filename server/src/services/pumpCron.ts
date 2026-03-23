import {
  buildDefaultPumpCronConfig,
  mergePumpCronConfig,
  readPumpCronConfig,
  writePumpCronConfig,
  type PumpCronConfig,
} from "./pumpCronSettings.js";
import { env } from "../config/env.js";
import { buildReservationsPreview, importPreviewReservations, type ReservationImportResult } from "./reservationImports.js";
import { getPumpLatestReservations, getPumpRefreshStatus, normalizePumpReservation, triggerPumpRefresh } from "./pumpClient.js";

const PUMP_REFRESH_POLL_MS = 5_000;
const PUMP_REFRESH_TIMEOUT_MS = 10 * 60 * 1_000;
const RUNNING_STATUSES = new Set(["queued", "pending", "running", "processing", "refreshing", "in_progress", "started"]);
const FAILURE_STATUSES = new Set(["error", "failed", "failure", "cancelled", "canceled"]);
const SUCCESS_STATUSES = new Set(["success", "completed", "complete", "done", "ready", "idle"]);

type PumpCronRunResult = ReservationImportResult & {
  pump: {
    session_id: string | null;
    status: string;
    updated_at: string | null;
    reservation_count: number;
  };
};

export type PumpCronState = {
  config: PumpCronConfig;
  scheduler: "internal" | "external";
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: PumpCronRunResult | null;
  last_error: string | null;
};

let cronTimer: NodeJS.Timeout | null = null;
let cronRunning = false;
let cronNextRunAt: Date | null = null;
let cronLastRunAt: Date | null = null;
let cronLastResult: PumpCronRunResult | null = null;
let cronLastError: string | null = null;
let cronConfig: PumpCronConfig = readPumpCronConfig(buildDefaultPumpCronConfig());
let activeImportPromise: Promise<PumpCronRunResult> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeStatus = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();

export const isPumpRefreshRunningStatus = (value: string | null | undefined) => {
  const normalized = normalizeStatus(value);
  return RUNNING_STATUSES.has(normalized) || normalized.includes("progress") || normalized.includes("refresh");
};

export const isPumpRefreshFailureStatus = (value: string | null | undefined) => {
  const normalized = normalizeStatus(value);
  return FAILURE_STATUSES.has(normalized) || normalized.includes("error") || normalized.includes("fail");
};

export const isPumpRefreshSuccessStatus = (value: string | null | undefined) => {
  const normalized = normalizeStatus(value);
  return SUCCESS_STATUSES.has(normalized) || normalized.includes("complete") || normalized.includes("success");
};

const parseIsoDateTime = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const waitForPumpRefresh = async () => {
  const refreshStartedAt = new Date();
  const refresh = await triggerPumpRefresh();
  const expectedSessionId = refresh.sessionId ?? null;
  const deadline = Date.now() + PUMP_REFRESH_TIMEOUT_MS;
  let lastKnownStatus = refresh.status;

  while (Date.now() <= deadline) {
    const status = await getPumpRefreshStatus();
    lastKnownStatus = status.status;
    const statusSessionId = status.sessionId ?? null;
    const refreshedAt = parseIsoDateTime(status.updatedAt);
    const sameSession = !expectedSessionId || !statusSessionId || statusSessionId === expectedSessionId;
    const refreshedAfterStart = Boolean(refreshedAt && refreshedAt.getTime() >= refreshStartedAt.getTime() - 1_000);

    if (sameSession && isPumpRefreshFailureStatus(status.status)) {
      const details = status.errors?.map((item) => String(item.message ?? "").trim()).filter(Boolean).join(" | ");
      throw new Error(
        details ? `Le refresh Pump a échoué (${status.status}): ${details}` : `Le refresh Pump a échoué (${status.status}).`
      );
    }

    if (sameSession && (isPumpRefreshSuccessStatus(status.status) || (refreshedAfterStart && !isPumpRefreshRunningStatus(status.status)))) {
      return status;
    }

    await sleep(PUMP_REFRESH_POLL_MS);
  }

  throw new Error(`Timeout en attente du refresh Pump (${lastKnownStatus || "statut inconnu"}).`);
};

const computeFirstRunDate = (hour: number, minute: number) => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
};

const computeRunDateFrom = (base: Date, intervalDays: number, hour: number, minute: number) => {
  const next = new Date(base);
  next.setDate(next.getDate() + intervalDays);
  next.setHours(hour, minute, 0, 0);
  return next;
};

const scheduleNextCronRun = (config: PumpCronConfig, from?: Date) => {
  cronNextRunAt = from ? computeRunDateFrom(from, config.interval_days, config.hour, config.minute) : computeFirstRunDate(config.hour, config.minute);

  while (cronNextRunAt.getTime() <= Date.now()) {
    cronNextRunAt = computeRunDateFrom(cronNextRunAt, config.interval_days, config.hour, config.minute);
  }

  const waitMs = Math.max(5_000, cronNextRunAt.getTime() - Date.now());
  cronTimer = setTimeout(async () => {
    cronRunning = true;
    try {
      await runPumpCronImport();
    } catch (error) {
      cronLastError = error instanceof Error ? error.message : "Erreur inconnue lors du cron Pump.";
      // eslint-disable-next-line no-console
      console.error("[pump-cron] Cron execution failed:", cronLastError);
    } finally {
      cronRunning = false;
      scheduleNextCronRun(config, new Date());
    }
  }, waitMs);
};

const applyCronConfig = (config: PumpCronConfig) => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;

  if (config.enabled && env.PUMP_IMPORT_CRON_SCHEDULER === "internal") {
    scheduleNextCronRun(config);
  }
};

export const runPumpCronImport = async (): Promise<PumpCronRunResult> => {
  if (activeImportPromise) return activeImportPromise;

  activeImportPromise = (async () => {
    await waitForPumpRefresh();
    const latest = await getPumpLatestReservations();
    const preview = await buildReservationsPreview(latest.reservations.map(normalizePumpReservation));
    const result = await importPreviewReservations(preview, undefined, "pump-cron");
    const response: PumpCronRunResult = {
      ...result,
      pump: {
        session_id: latest.sessionId,
        status: latest.status,
        updated_at: latest.updatedAt ?? null,
        reservation_count: latest.reservationCount,
      },
    };

    cronLastRunAt = new Date();
    cronLastResult = response;
    cronLastError = null;
    return response;
  })().finally(() => {
    activeImportPromise = null;
  });

  return activeImportPromise;
};

export const startPumpCron = () => {
  applyCronConfig(cronConfig);
  if (env.PUMP_IMPORT_CRON_SCHEDULER === "external") {
    return;
  }
  if (cronConfig.run_on_start) {
    cronRunning = true;
    void runPumpCronImport()
      .catch((error) => {
        cronLastError = error instanceof Error ? error.message : "Erreur inconnue lors du demarrage du cron Pump.";
        // eslint-disable-next-line no-console
        console.error("[pump-cron] Startup import failed:", cronLastError);
      })
      .finally(() => {
        cronRunning = false;
      });
  }
};

export const stopPumpCron = () => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;
};

export const updatePumpCronConfig = async (patch: Partial<PumpCronConfig>) => {
  cronConfig = mergePumpCronConfig(cronConfig, patch);
  writePumpCronConfig(cronConfig);
  applyCronConfig(cronConfig);
  return cronConfig;
};

export const getPumpCronConfig = () => cronConfig;

export const getPumpCronState = (): PumpCronState => ({
  config: cronConfig,
  scheduler: env.PUMP_IMPORT_CRON_SCHEDULER as PumpCronState["scheduler"],
  running: cronRunning || Boolean(activeImportPromise),
  next_run_at: cronNextRunAt ? cronNextRunAt.toISOString() : null,
  last_run_at: cronLastRunAt ? cronLastRunAt.toISOString() : null,
  last_result: cronLastResult,
  last_error: cronLastError,
});

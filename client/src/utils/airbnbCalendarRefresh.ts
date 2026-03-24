import { apiFetch, isAbortError } from "./api";
import type { AppNotice } from "./appNotices";

export type AirbnbCalendarRefreshCreateStatus = {
  status: "skipped" | "queued";
  job_id?: string;
  message: string;
};

export type AirbnbCalendarRefreshJobStatus = {
  job_id: string;
  status: "queued" | "running" | "success" | "failed";
  message?: string;
  error_code?: string;
  updated_at: string;
};

export type AirbnbCalendarRefreshNotice = {
  tone: "info" | "success" | "error";
  message: string;
};

type WaitForAirbnbCalendarRefreshOptions = {
  signal?: AbortSignal;
  maxAttempts?: number;
  pollDelayMs?: number;
  fetchStatus?: (jobId: string, signal?: AbortSignal) => Promise<AirbnbCalendarRefreshJobStatus>;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (status: AirbnbCalendarRefreshJobStatus) => void;
};

const defaultFetchStatus = (jobId: string, signal?: AbortSignal) =>
  apiFetch<AirbnbCalendarRefreshJobStatus>(`/reservations/airbnb-calendar-refresh/${encodeURIComponent(jobId)}`, {
    signal,
  });

const defaultSleep = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort);
  });

export const waitForAirbnbCalendarRefreshJob = async (
  jobId: string,
  options: WaitForAirbnbCalendarRefreshOptions = {}
) => {
  const fetchStatus = options.fetchStatus ?? defaultFetchStatus;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 40;
  const pollDelayMs = options.pollDelayMs ?? 1_500;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await fetchStatus(jobId, options.signal);
    options.onUpdate?.(status);
    if (status.status === "success" || status.status === "failed") {
      return status;
    }

    await sleep(pollDelayMs, options.signal);
  }

  return {
    job_id: jobId,
    status: "failed" as const,
    message: "Le rafraîchissement Airbnb n'a pas abouti à temps.",
    error_code: "timeout",
    updated_at: new Date().toISOString(),
  };
};

export const getAirbnbCalendarRefreshNotice = (
  status: AirbnbCalendarRefreshCreateStatus | AirbnbCalendarRefreshJobStatus
): AirbnbCalendarRefreshNotice => {
  if (status.status === "success") {
    return {
      tone: "success",
      message: status.message ?? "Rafraîchissement Airbnb terminé.",
    };
  }

  if (status.status === "failed") {
    return {
      tone: "error",
      message: status.message ?? "Le rafraîchissement Airbnb a échoué.",
    };
  }

  return {
    tone: "info",
    message:
      status.message ??
      (status.status === "running"
        ? "Rafraîchissement Airbnb en cours."
        : status.status === "queued"
          ? "Rafraîchissement Airbnb planifié."
          : "Aucun rafraîchissement Airbnb à lancer."),
  };
};

export const buildAirbnbCalendarRefreshAppNotice = (
  status: AirbnbCalendarRefreshCreateStatus | AirbnbCalendarRefreshJobStatus
): AppNotice => {
  const notice = getAirbnbCalendarRefreshNotice(status);

  return {
    label: "Airbnb",
    message: notice.message,
    tone: notice.tone === "info" ? "neutral" : notice.tone,
    timeoutMs:
      status.status === "queued" || status.status === "running"
        ? null
        : status.status === "failed"
          ? 5_200
          : 5_000,
    role: notice.tone === "error" ? "alert" : "status",
  };
};

export const handleAirbnbCalendarRefreshFailure = (
  error: unknown,
  onFailure: (message: string) => void
) => {
  if (isAbortError(error)) return;
  const message = error instanceof Error ? error.message : "Le rafraîchissement Airbnb a échoué.";
  onFailure(message);
};

import { apiFetch, isAbortError } from "./api";

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

type WaitForAirbnbCalendarRefreshOptions = {
  signal?: AbortSignal;
  maxAttempts?: number;
  pollDelayMs?: number;
  fetchStatus?: (jobId: string, signal?: AbortSignal) => Promise<AirbnbCalendarRefreshJobStatus>;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
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

export const handleAirbnbCalendarRefreshFailure = (
  error: unknown,
  onFailure: (message: string) => void
) => {
  if (isAbortError(error)) return;
  const message = error instanceof Error ? error.message : "Le rafraîchissement Airbnb a échoué.";
  onFailure(message);
};

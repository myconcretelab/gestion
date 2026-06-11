import crypto from "crypto";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";

type WordPressWebhookJobState = "queued" | "sending" | "succeeded" | "failed";

type WordPressWebhookJobRow = {
  id: string;
  gite_id: string;
  state: string;
  generation: number;
  attempts: number;
  max_attempts: number;
  run_after: Date;
  queued_at: Date;
  sent_at: Date | null;
  completed_at: Date | null;
  response_status: number | null;
  response_body: string | null;
  last_error: string | null;
};

type WebhookSendResult = {
  ok: boolean;
  retryable: boolean;
  response_status?: number;
  response_body?: unknown;
  error?: string;
};

export type GitePhotosWordPressWebhookStatus = {
  enabled: boolean;
  state: "disabled" | WordPressWebhookJobState;
  gite_id: string;
  message: string;
  debounce_ms: number;
  attempts?: number;
  max_attempts?: number;
  next_attempt_at?: string;
  queued_at?: string;
  sent_at?: string;
  completed_at?: string;
  response_status?: number;
  response_body?: unknown;
  error?: string;
};

let queueTimer: ReturnType<typeof setTimeout> | null = null;
let queueStarted = false;
let activeWorkerCount = 0;
const activeGiteIds = new Set<string>();

const getWebhookConfig = () => {
  const url = String(env.BOOKED_WORDPRESS_WEBHOOK_URL ?? "").trim();
  const secret = String(env.BOOKED_WORDPRESS_WEBHOOK_SECRET ?? "").trim();
  if (!url || !secret) return null;
  return { url, secret };
};

const getDisabledStatus = (giteId: string): GitePhotosWordPressWebhookStatus => ({
  enabled: false,
  state: "disabled",
  gite_id: giteId,
  message: "Synchro WordPress non configurée côté Contrats.",
  debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asNonEmptyString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const limitText = (value: string, maxLength = 260): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const safeJsonParse = (value: string | null): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const safeJsonStringify = (value: unknown): string | null => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatWordPressPhotoSyncIssue = (issue: unknown, index: number): string => {
  const row = asRecord(issue);
  if (!row) {
    return limitText(String(issue || `Erreur ${index + 1}`));
  }

  const photoId = asNonEmptyString(row.photo_id);
  const title = asNonEmptyString(row.title);
  const label = [title, photoId].filter(Boolean).join(" / ") || `Photo ${index + 1}`;
  const message = asNonEmptyString(row.error_message) || asNonEmptyString(row.error) || "Erreur WordPress sans message.";
  const code = asNonEmptyString(row.error_code);
  const url = asNonEmptyString(row.url);
  const details = asRecord(row.details);
  const originalCode = details ? asNonEmptyString(details.original_code) : "";
  const status = details && typeof details.status === "number" ? `HTTP ${details.status}` : "";
  const suffix = [code || originalCode, status, url].filter(Boolean).join(" · ");

  return limitText(`${label}: ${message}${suffix ? ` (${suffix})` : ""}`);
};

const getWordPressPhotoSyncErrorSummary = (responseBody: unknown): string => {
  const body = asRecord(responseBody);
  if (!body) return "";

  const result = asRecord(body.result);
  const resultError = result ? asNonEmptyString(result.error) : "";
  const bodyError = asNonEmptyString(body.error);
  const errors = result && Array.isArray(result.errors) ? result.errors : [];

  if (errors.length > 0) {
    const visibleErrors = errors.slice(0, 4).map(formatWordPressPhotoSyncIssue);
    const remaining = errors.length - visibleErrors.length;
    return `${visibleErrors.join(" | ")}${remaining > 0 ? ` | +${remaining} autre(s) erreur(s)` : ""}`;
  }

  return resultError || bodyError;
};

const isExpectedWordPressPhotoSyncResponse = (responseBody: unknown): boolean => {
  const body = asRecord(responseBody);
  if (!body) return false;

  if (body.queued === true) return true;
  if (body.ok !== true) return false;

  return Boolean(asRecord(body.result));
};

const getUnexpectedWordPressResponseError = (responseBody: unknown): string => {
  if (typeof responseBody === "string" && /<html[\s>]/i.test(responseBody)) {
    return "Réponse WordPress inattendue: le webhook a retourné une page HTML au lieu du JSON Booked attendu.";
  }

  return "Réponse WordPress inattendue: le webhook n'a pas retourné le JSON Booked attendu.";
};

const getRetryDelayMs = (attempts: number) => {
  const exponent = Math.max(0, attempts - 1);
  const backoff = env.BOOKED_WORDPRESS_WEBHOOK_RETRY_BASE_MS * 2 ** exponent;
  return Math.min(backoff, 10 * env.BOOKED_WORDPRESS_WEBHOOK_RETRY_BASE_MS);
};

const toStatus = (giteId: string, job: WordPressWebhookJobRow | null): GitePhotosWordPressWebhookStatus => {
  if (!job) {
    return {
      enabled: true,
      state: "succeeded",
      gite_id: giteId,
      message: "Aucune synchronisation WordPress récente pour ce gîte.",
      debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
    };
  }

  const responseBody = safeJsonParse(job.response_body);
  const base = {
    enabled: true,
    state: job.state as WordPressWebhookJobState,
    gite_id: job.gite_id,
    debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    next_attempt_at: job.state === "queued" ? job.run_after.toISOString() : undefined,
    queued_at: job.queued_at.toISOString(),
    sent_at: job.sent_at?.toISOString(),
    completed_at: job.completed_at?.toISOString(),
    response_status: job.response_status ?? undefined,
    response_body: responseBody,
    error: job.last_error ?? undefined,
  };

  if (job.state === "queued") {
    return {
      ...base,
      state: "queued",
      message: job.attempts > 0 ? "Nouvel essai WordPress programmé." : "Mise à jour WordPress programmée.",
    };
  }

  if (job.state === "sending") {
    return {
      ...base,
      state: "sending",
      message: "Mise à jour WordPress en cours.",
    };
  }

  if (job.state === "failed") {
    return {
      ...base,
      state: "failed",
      message: job.response_status
        ? `Mise à jour WordPress échouée (${job.response_status}).`
        : "Mise à jour WordPress impossible.",
    };
  }

  const bodyObject = asRecord(responseBody);
  const result = asRecord(bodyObject?.result);
  const changedCount =
    Number(result?.created ?? 0) +
    Number(result?.replaced ?? 0) +
    Number(result?.updated ?? 0) +
    Number(result?.orphaned ?? 0) +
    Number(result?.failed ?? 0);
  const queued = Boolean(bodyObject?.queued);

  if (!isExpectedWordPressPhotoSyncResponse(responseBody)) {
    return {
      ...base,
      state: "failed",
      message: getUnexpectedWordPressResponseError(responseBody),
    };
  }

  return {
    ...base,
    state: "succeeded",
    message: queued
      ? "Webhook WordPress accepté. Synchronisation planifiée côté WordPress."
      : `WordPress synchronisé${Number.isFinite(changedCount) ? ` (${changedCount} élément(s) traité(s))` : ""}.`,
  };
};

const sendGitePhotosWebhook = async (giteId: string): Promise<WebhookSendResult> => {
  const config = getWebhookConfig();
  if (!config) {
    return { ok: false, retryable: false, error: "Synchro WordPress non configurée côté Contrats." };
  }

  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    event: "gite.photos.saved",
    gite_id: giteId,
    version: timestamp,
  });
  const signature = crypto
    .createHmac("sha256", config.secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.BOOKED_WORDPRESS_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Booked-Timestamp": timestamp,
        "X-Booked-Signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });

    const rawPayload = await response.text().catch(() => "");
    let responseBody: unknown = rawPayload;
    if (rawPayload) {
      try {
        responseBody = JSON.parse(rawPayload);
      } catch {
        responseBody = rawPayload;
      }
    }

    if (!response.ok) {
      const errorSummary = getWordPressPhotoSyncErrorSummary(responseBody);
      return {
        ok: false,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        response_status: response.status,
        response_body: responseBody,
        error: errorSummary || `HTTP ${response.status}`,
      };
    }

    const bodyObject = asRecord(responseBody);
    const result = asRecord(bodyObject?.result);
    const failedCount = Number(result?.failed ?? 0);
    const errorSummary = getWordPressPhotoSyncErrorSummary(responseBody);

    if (!isExpectedWordPressPhotoSyncResponse(responseBody)) {
      return {
        ok: false,
        retryable: false,
        response_status: response.status,
        response_body: responseBody,
        error: errorSummary || getUnexpectedWordPressResponseError(responseBody),
      };
    }

    if (failedCount > 0) {
      return {
        ok: false,
        retryable: false,
        response_status: response.status,
        response_body: responseBody,
        error: errorSummary || `WordPress a terminé avec ${failedCount} import(s) en échec.`,
      };
    }

    return {
      ok: true,
      retryable: false,
      response_status: response.status,
      response_body: responseBody,
      error: errorSummary || undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Délai WordPress dépassé (${Math.round(env.BOOKED_WORDPRESS_WEBHOOK_TIMEOUT_MS / 1000)} s).`
        : error instanceof Error
        ? error.message
        : String(error);
    return { ok: false, retryable: true, error: message };
  } finally {
    clearTimeout(timeout);
  }
};

const nudgeQueue = (delayMs = 0) => {
  if (!getWebhookConfig()) return;
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = setTimeout(() => {
    queueTimer = null;
    void drainQueue();
  }, Math.max(0, delayMs));
};

const scheduleNextQueueWake = async () => {
  if (queueTimer || !getWebhookConfig()) return;
  const next = await prisma.wordPressWebhookJob.findFirst({
    where: { state: "queued" },
    orderBy: { run_after: "asc" },
    select: { run_after: true },
  });
  if (!next) return;
  nudgeQueue(next.run_after.getTime() - Date.now());
};

const processJob = async (job: WordPressWebhookJobRow) => {
  activeWorkerCount += 1;
  activeGiteIds.add(job.gite_id);

  try {
    const claimed = await prisma.wordPressWebhookJob.updateMany({
      where: {
        id: job.id,
        state: "queued",
        generation: job.generation,
        run_after: { lte: new Date() },
      },
      data: {
        state: "sending",
        attempts: { increment: 1 },
        sent_at: new Date(),
        completed_at: null,
        response_status: null,
        response_body: null,
        last_error: null,
      },
    });

    if (claimed.count === 0) return;

    const claimedJob = await prisma.wordPressWebhookJob.findUnique({ where: { id: job.id } });
    if (!claimedJob) return;

    const result = await sendGitePhotosWebhook(job.gite_id);
    const current = await prisma.wordPressWebhookJob.findUnique({ where: { id: job.id } });
    if (!current || current.generation !== claimedJob.generation || current.state !== "sending") {
      return;
    }

    const completedAt = new Date();
    if (result.ok) {
      await prisma.wordPressWebhookJob.update({
        where: { id: job.id },
        data: {
          state: "succeeded",
          completed_at: completedAt,
          response_status: result.response_status ?? null,
          response_body: safeJsonStringify(result.response_body),
          last_error: result.error ?? null,
        },
      });
      return;
    }

    const canRetry = result.retryable && claimedJob.attempts < claimedJob.max_attempts;
    const nextRun = new Date(Date.now() + getRetryDelayMs(claimedJob.attempts));
    await prisma.wordPressWebhookJob.update({
      where: { id: job.id },
      data: {
        state: canRetry ? "queued" : "failed",
        run_after: canRetry ? nextRun : current.run_after,
        completed_at: canRetry ? null : completedAt,
        response_status: result.response_status ?? null,
        response_body: safeJsonStringify(result.response_body),
        last_error: result.error ?? null,
      },
    });

    if (canRetry) {
      console.warn(
        `Booked WordPress webhook failed for gite ${job.gite_id}; retry ${claimedJob.attempts}/${claimedJob.max_attempts} scheduled: ${result.error}`
      );
    } else {
      console.warn(`Booked WordPress webhook failed for gite ${job.gite_id}: ${result.error}`);
    }
  } catch (error) {
    console.warn(`Booked WordPress webhook queue failed for gite ${job.gite_id}:`, error);
  } finally {
    activeGiteIds.delete(job.gite_id);
    activeWorkerCount = Math.max(0, activeWorkerCount - 1);
    nudgeQueue(0);
  }
};

const drainQueue = async () => {
  if (!getWebhookConfig()) return;

  while (activeWorkerCount < env.BOOKED_WORDPRESS_WEBHOOK_CONCURRENCY) {
    const dueJobs = await prisma.wordPressWebhookJob.findMany({
      where: {
        state: "queued",
        run_after: { lte: new Date() },
      },
      orderBy: [{ run_after: "asc" }, { queued_at: "asc" }],
      take: env.BOOKED_WORDPRESS_WEBHOOK_CONCURRENCY + activeGiteIds.size + 5,
    });

    const job = dueJobs.find((item) => !activeGiteIds.has(item.gite_id));
    if (!job) break;
    void processJob(job);
  }

  await scheduleNextQueueWake();
};

export const startGitePhotosWordPressWebhookQueue = () => {
  if (queueStarted) return;
  queueStarted = true;
  if (!getWebhookConfig()) return;

  void (async () => {
    await prisma.wordPressWebhookJob.updateMany({
      where: { state: "sending" },
      data: {
        state: "queued",
        run_after: new Date(Date.now() + env.BOOKED_WORDPRESS_WEBHOOK_RETRY_BASE_MS),
        last_error: "Synchro interrompue avant la confirmation WordPress. Nouvel essai programmé.",
      },
    });
    nudgeQueue(0);
  })().catch((error) => {
    console.warn("Booked WordPress webhook queue startup failed:", error);
  });
};

export const getGitePhotosWordPressWebhookStatus = async (giteId: string): Promise<GitePhotosWordPressWebhookStatus> => {
  const normalizedGiteId = String(giteId || "").trim();
  if (!normalizedGiteId) return getDisabledStatus("");
  if (!getWebhookConfig()) return getDisabledStatus(normalizedGiteId);

  const job = await prisma.wordPressWebhookJob.findUnique({ where: { gite_id: normalizedGiteId } });
  return toStatus(normalizedGiteId, job);
};

export const scheduleGitePhotosWordPressWebhook = async (giteId: string): Promise<GitePhotosWordPressWebhookStatus> => {
  const normalizedGiteId = String(giteId || "").trim();
  if (!normalizedGiteId) return getDisabledStatus("");
  if (!getWebhookConfig()) return getDisabledStatus(normalizedGiteId);

  const now = new Date();
  const runAfter = new Date(now.getTime() + env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS);
  const job = await prisma.wordPressWebhookJob.upsert({
    where: { gite_id: normalizedGiteId },
    create: {
      gite_id: normalizedGiteId,
      state: "queued",
      generation: 1,
      attempts: 0,
      max_attempts: env.BOOKED_WORDPRESS_WEBHOOK_MAX_ATTEMPTS,
      run_after: runAfter,
      queued_at: now,
    },
    update: {
      state: "queued",
      generation: { increment: 1 },
      attempts: 0,
      max_attempts: env.BOOKED_WORDPRESS_WEBHOOK_MAX_ATTEMPTS,
      run_after: runAfter,
      queued_at: now,
      completed_at: null,
      response_status: null,
      response_body: null,
      last_error: null,
    },
  });

  nudgeQueue(0);
  return toStatus(normalizedGiteId, job);
};

export const __bookedWordPressWebhookTestUtils = {
  getUnexpectedWordPressResponseError,
  isExpectedWordPressPhotoSyncResponse,
};

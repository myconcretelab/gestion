import crypto from "crypto";
import { env } from "../config/env.js";

const pendingPhotoWebhooks = new Map<string, ReturnType<typeof setTimeout>>();

export type GitePhotosWordPressWebhookStatus = {
  enabled: boolean;
  state: "disabled" | "queued" | "sending" | "succeeded" | "failed";
  gite_id: string;
  message: string;
  debounce_ms: number;
  queued_at?: string;
  sent_at?: string;
  completed_at?: string;
  response_status?: number;
  response_body?: unknown;
  error?: string;
};

const photoWebhookStatuses = new Map<string, GitePhotosWordPressWebhookStatus>();

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

export const getGitePhotosWordPressWebhookStatus = (giteId: string): GitePhotosWordPressWebhookStatus => {
  const normalizedGiteId = String(giteId || "").trim();
  if (!normalizedGiteId) return getDisabledStatus("");
  if (!getWebhookConfig()) return getDisabledStatus(normalizedGiteId);
  return (
    photoWebhookStatuses.get(normalizedGiteId) ?? {
      enabled: true,
      state: "succeeded",
      gite_id: normalizedGiteId,
      message: "Aucune synchronisation WordPress récente pour ce gîte.",
      debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
    }
  );
};

const sendGitePhotosWebhook = async (giteId: string) => {
  const config = getWebhookConfig();
  if (!config) return;

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

  photoWebhookStatuses.set(giteId, {
    enabled: true,
    state: "sending",
    gite_id: giteId,
    message: "Mise à jour WordPress en cours.",
    debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
    queued_at: photoWebhookStatuses.get(giteId)?.queued_at,
    sent_at: timestamp,
  });

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Booked-Timestamp": timestamp,
        "X-Booked-Signature": `sha256=${signature}`,
      },
      body,
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
    const completedAt = new Date().toISOString();

    if (!response.ok) {
      photoWebhookStatuses.set(giteId, {
        enabled: true,
        state: "failed",
        gite_id: giteId,
        message: `Mise à jour WordPress échouée (${response.status}).`,
        debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
        queued_at: photoWebhookStatuses.get(giteId)?.queued_at,
        sent_at: timestamp,
        completed_at: completedAt,
        response_status: response.status,
        response_body: responseBody,
      });
      console.warn(`Booked WordPress webhook failed for gite ${giteId}: ${response.status} ${rawPayload}`);
      return;
    }

    const bodyObject = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody) ? (responseBody as any) : null;
    const result = bodyObject?.result && typeof bodyObject.result === "object" ? bodyObject.result : null;
    const changedCount =
      Number(result?.created ?? 0) +
      Number(result?.replaced ?? 0) +
      Number(result?.updated ?? 0) +
      Number(result?.orphaned ?? 0) +
      Number(result?.failed ?? 0);
    const failedCount = Number(result?.failed ?? 0);
    const queued = Boolean(bodyObject?.queued);
    photoWebhookStatuses.set(giteId, {
      enabled: true,
      state: failedCount > 0 ? "failed" : "succeeded",
      gite_id: giteId,
      message: failedCount > 0
        ? `WordPress a terminé avec ${failedCount} import(s) en échec.`
        : queued
        ? "Webhook WordPress accepté. Synchronisation planifiée côté WordPress."
        : `WordPress synchronisé${Number.isFinite(changedCount) ? ` (${changedCount} élément(s) traité(s))` : ""}.`,
      debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
      queued_at: photoWebhookStatuses.get(giteId)?.queued_at,
      sent_at: timestamp,
      completed_at: completedAt,
      response_status: response.status,
      response_body: responseBody,
    });
  } catch (error) {
    photoWebhookStatuses.set(giteId, {
      enabled: true,
      state: "failed",
      gite_id: giteId,
      message: "Mise à jour WordPress impossible.",
      debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
      queued_at: photoWebhookStatuses.get(giteId)?.queued_at,
      sent_at: timestamp,
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    console.warn(`Booked WordPress webhook failed for gite ${giteId}:`, error);
  }
};

export const scheduleGitePhotosWordPressWebhook = (giteId: string): GitePhotosWordPressWebhookStatus => {
  const normalizedGiteId = String(giteId || "").trim();
  if (!normalizedGiteId) return getDisabledStatus("");
  if (!getWebhookConfig()) {
    const status = getDisabledStatus(normalizedGiteId);
    photoWebhookStatuses.set(normalizedGiteId, status);
    return status;
  }

  const pending = pendingPhotoWebhooks.get(normalizedGiteId);
  if (pending) {
    clearTimeout(pending);
  }

  const queuedStatus: GitePhotosWordPressWebhookStatus = {
    enabled: true,
    state: "queued",
    gite_id: normalizedGiteId,
    message: "Mise à jour WordPress programmée.",
    debounce_ms: env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS,
    queued_at: new Date().toISOString(),
  };
  photoWebhookStatuses.set(normalizedGiteId, queuedStatus);

  const timer = setTimeout(() => {
    pendingPhotoWebhooks.delete(normalizedGiteId);
    void sendGitePhotosWebhook(normalizedGiteId);
  }, env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS);

  pendingPhotoWebhooks.set(normalizedGiteId, timer);
  return queuedStatus;
};

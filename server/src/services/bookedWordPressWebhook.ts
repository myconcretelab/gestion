import crypto from "crypto";
import { env } from "../config/env.js";

const pendingPhotoWebhooks = new Map<string, ReturnType<typeof setTimeout>>();

const getWebhookConfig = () => {
  const url = String(env.BOOKED_WORDPRESS_WEBHOOK_URL ?? "").trim();
  const secret = String(env.BOOKED_WORDPRESS_WEBHOOK_SECRET ?? "").trim();
  if (!url || !secret) return null;
  return { url, secret };
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

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      console.warn(`Booked WordPress webhook failed for gite ${giteId}: ${response.status} ${payload}`);
    }
  } catch (error) {
    console.warn(`Booked WordPress webhook failed for gite ${giteId}:`, error);
  }
};

export const scheduleGitePhotosWordPressWebhook = (giteId: string) => {
  const normalizedGiteId = String(giteId || "").trim();
  if (!normalizedGiteId || !getWebhookConfig()) return;

  const pending = pendingPhotoWebhooks.get(normalizedGiteId);
  if (pending) {
    clearTimeout(pending);
  }

  const timer = setTimeout(() => {
    pendingPhotoWebhooks.delete(normalizedGiteId);
    void sendGitePhotosWebhook(normalizedGiteId);
  }, env.BOOKED_WORDPRESS_WEBHOOK_DEBOUNCE_MS);

  pendingPhotoWebhooks.set(normalizedGiteId, timer);
};

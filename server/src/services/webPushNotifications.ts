import crypto from "node:crypto";
import webPush from "web-push";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";
import { normalizeAppUserRoles } from "./appUsers.js";
import { getOrganizationId } from "./organizationContext.js";

const PREFIX = "web-push.subscription:";
const VAPID_KEY = "web-push.vapid";
const digest = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

// Only browser push services may be contacted: a subscription must not become
// an arbitrary server-side HTTP request (including requests to the local network).
export const isAllowedPushEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      ([
        "web.push.apple.com",
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
      ].includes(url.hostname) ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
};

const base64Key = (length: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine(
      (value) => Buffer.from(value, "base64url").length === length,
      "Clé de notification invalide.",
    );
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .refine(isAllowedPushEndpoint, "Service de notifications non reconnu."),
  expirationTime: z.number().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: base64Key(65).refine((value) => {
      try {
        crypto.ECDH.convertKey(Buffer.from(value, "base64url"), "prime256v1");
        return true;
      } catch {
        return false;
      }
    }, "Clé de chiffrement invalide."),
    auth: base64Key(16),
  }),
});
type BrowserSubscription = z.infer<typeof pushSubscriptionSchema>;
type StoredSubscription = {
  userId: string;
  label: string;
  subscription: BrowserSubscription;
  delivered: Record<string, number>;
};
export type OwnerPushTarget = {
  userIds?: string[];
  url?: string;
  key?: string;
};
export type OwnerPushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};
type PushTransport = (
  subscription: BrowserSubscription,
  payload: string,
  options: webPush.RequestOptions,
) => Promise<unknown>;

const subscriptionKey = (endpoint: string) => PREFIX + digest(endpoint);
const decode = (value: unknown) =>
  fromJsonString<StoredSubscription>(value, {} as StoredSubscription);

const readVapidKeys = async () => {
  const where = {
    organization_id_key: {
      organization_id: getOrganizationId(),
      key: VAPID_KEY,
    },
  };
  const existing = await prisma.organizationRuntimeSetting.findUnique({
    where,
  });
  if (existing)
    return fromJsonString<webPush.VapidKeys>(
      existing.value_json,
      {} as webPush.VapidKeys,
    );
  const row = await prisma.organizationRuntimeSetting.upsert({
    where,
    create: {
      organization_id: getOrganizationId(),
      key: VAPID_KEY,
      is_secret: true,
      value_json: encodeJsonField(webPush.generateVAPIDKeys()),
    },
    update: {},
  });
  return fromJsonString<webPush.VapidKeys>(
    row.value_json,
    {} as webPush.VapidKeys,
  );
};

export const getPushPublicKey = async () => (await readVapidKeys()).publicKey;

export const listPushDevices = async (userId: string) => {
  const rows = await prisma.organizationRuntimeSetting.findMany({
    where: { key: { startsWith: PREFIX } },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((row) => {
    const stored = decode(row.value_json);
    return stored.userId === userId
      ? [
          {
            id: row.id,
            label: stored.label,
            createdAt: row.createdAt.toISOString(),
            endpoint: stored.subscription.endpoint,
          },
        ]
      : [];
  });
};

export const savePushSubscription = async (
  userId: string,
  input: unknown,
  label: string,
) => {
  const subscription = pushSubscriptionSchema.parse(input);
  const key = subscriptionKey(subscription.endpoint);
  const where = {
    organization_id_key: { organization_id: getOrganizationId(), key },
  };
  const existing = await prisma.organizationRuntimeSetting.findUnique({
    where,
  });
  const previous = existing ? decode(existing.value_json) : null;
  // A browser endpoint belongs to one account at a time on a shared device.
  const value: StoredSubscription = {
    userId,
    label,
    subscription,
    delivered: previous?.userId === userId ? previous.delivered : {},
  };
  await prisma.organizationRuntimeSetting.upsert({
    where,
    create: {
      organization_id: getOrganizationId(),
      key,
      is_secret: true,
      value_json: encodeJsonField(value),
    },
    update: { is_secret: true, value_json: encodeJsonField(value) },
  });
};

export const removePushDevice = async (userId: string, id: string) => {
  const row = await prisma.organizationRuntimeSetting.findFirst({
    where: { id, key: { startsWith: PREFIX } },
  });
  if (row && decode(row.value_json).userId === userId)
    await prisma.organizationRuntimeSetting.delete({ where: { id: row.id } });
};

const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value: string) => {
      const point =
        value[0].toLowerCase() === "x"
          ? parseInt(value.slice(1), 16)
          : Number(value);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const safeAppPath = (value?: string) => {
  if (!value) return "/aujourdhui";
  try {
    const base = new URL(env.APP_PUBLIC_URL);
    const url = new URL(value, base);
    // Public Telegram links carry bearer tokens and may mutate state. Push
    // clicks always open the authenticated application, never those actions.
    if (
      url.origin !== base.origin ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("//")
    )
      return "/aujourdhui";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/aujourdhui";
  }
};

export const buildOwnerPushPayload = (
  message: string,
  target: OwnerPushTarget = {},
): OwnerPushPayload => {
  const lines = plainText(message)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const link = /<a\s+href="([^"]+)"/i.exec(message)?.[1];
  return {
    title: Array.from(lines[0] || "Gestion locative")
      .slice(0, 100)
      .join(""),
    body: Array.from(lines.slice(1).join("\n")).slice(0, 700).join(""),
    url: safeAppPath(target.url ?? (link ? plainText(link) : undefined)),
    tag: digest(target.key ?? message).slice(0, 32),
  };
};

export const sendOwnerPushNotification = async (
  message: string,
  target: OwnerPushTarget = {},
  transport: PushTransport = webPush.sendNotification,
) => {
  const rows = await prisma.organizationRuntimeSetting.findMany({
    where: { key: { startsWith: PREFIX } },
  });
  if (!rows.length) return { sent_count: 0, failed_count: 0 };
  const users = await prisma.appUser.findMany({
    where: {
      is_active: true,
      ...(target.userIds ? { id: { in: target.userIds } } : {}),
    },
  });
  const ownerIds = new Set(
    users
      .filter((user) =>
        normalizeAppUserRoles(user.roles, {
          isOwner: user.is_owner,
          status: user.status,
        }).includes("owner"),
      )
      .map((user) => user.id),
  );
  const payload = buildOwnerPushPayload(message, target);
  const vapid = await readVapidKeys();
  const result = { sent_count: 0, failed_count: 0 };
  for (const row of rows) {
    const stored = decode(row.value_json);
    if (!ownerIds.has(stored.userId)) continue;
    const now = Date.now();
    if (stored.delivered?.[payload.tag] > now - 7 * 86_400_000) continue;
    try {
      if (!isAllowedPushEndpoint(stored.subscription.endpoint))
        throw new Error("Invalid push service");
      await transport(stored.subscription, JSON.stringify(payload), {
        vapidDetails: { ...vapid, subject: new URL(env.APP_PUBLIC_URL).origin },
        TTL: 3600,
        timeout: 5000,
        urgency: "normal",
        topic: payload.tag,
      });
      stored.delivered = Object.fromEntries([
        ...Object.entries(stored.delivered ?? {})
          .filter(([, at]) => at > now - 7 * 86_400_000)
          .slice(-99),
        [payload.tag, now],
      ]);
      // Do not recreate an endpoint removed while its request was in flight.
      await prisma.organizationRuntimeSetting.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: { value_json: encodeJsonField(stored) },
      });
      result.sent_count++;
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await prisma.organizationRuntimeSetting.deleteMany({
          where: { id: row.id },
        });
      } else {
        result.failed_count++;
        // Provider errors may contain endpoint credentials. Never log them.
        console.error("Échec d’une notification sur appareil.", {
          organizationId: getOrganizationId(),
          deviceId: row.id,
          status,
        });
      }
    }
  }
  return result;
};

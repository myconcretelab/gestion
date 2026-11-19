import crypto from "node:crypto";
import {
  ownerNotificationEventSchema,
  type OwnerNotificationEvent,
} from "@contrats/shared";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import {
  enqueueOrganizationJob,
  runOrganizationJobBatch,
  type OrganizationJobHandler,
} from "../modules/system/jobs.js";
import { getOrganizationId } from "./organizationContext.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";
import { isModuleEnabled } from "./installationConfig.js";
import { isSmtpConfigured, sendSmtpMail } from "./mailer.js";
import { telegramMessageChannel } from "./messageChannels/telegram.js";
import {
  readTelegramNotificationConfig,
  resolveTelegramNotificationRecipients,
} from "./telegramNotifications.js";
import {
  sendOwnerPushNotification,
  telegramRecipientsAfterPush,
} from "./webPushNotifications.js";
import {
  readOwnerNotificationSettings,
  resolveOwnerNotificationEmails,
  resolveOwnerNotificationRule,
} from "./ownerNotificationSettings.js";

const JOB_TYPE = "owner.notification";
const payloadSchema = z.object({
  event: ownerNotificationEventSchema,
  key: z.string().min(1),
  message: z.string().min(1),
  url: z.string().optional(),
  propertyEmail: z.string().nullish(),
  propertyId: z.string().optional(),
  taskTemplateId: z.string().nullish(),
  cleaningSelected: z.boolean().optional(),
  automaticConfirmation: z.boolean().optional(),
  emailManagedByBooking: z.boolean().optional(),
  emailOnly: z.boolean().optional(),
  emailMessage: z
    .object({
      subject: z.string(),
      text: z.string(),
      html: z.string().optional(),
      replyTo: z.string().optional(),
    })
    .optional(),
  excludeEmail: z.string().optional(),
  payment: z.object({ id: z.string(), state: z.string() }).optional(),
  expiresAt: z.number().optional(),
  telegramAction: z.object({ text: z.string(), url: z.string() }).optional(),
  acknowledged: z.array(z.string()).default([]),
});
type OwnerNotification = Omit<z.input<typeof payloadSchema>, "acknowledged">;

const deliveryOptions = async (notification: OwnerNotification) => {
  const telegram = readTelegramNotificationConfig();
  const rule = resolveOwnerNotificationRule(
    notification.event,
    await readOwnerNotificationSettings(),
    telegram,
    notification,
  );
  if (notification.emailManagedByBooking) rule.email = false;
  if (notification.emailOnly) {
    rule.push = false;
    rule.telegram = "off";
  }
  return { telegram, rule };
};

export const enqueueOwnerNotification = async (
  notification: OwnerNotification,
) => {
  const { rule } = await deliveryOptions(notification);
  if (!rule.push && rule.telegram === "off" && !rule.email) return false;
  await enqueueOrganizationJob({
    organizationId: getOrganizationId(),
    type: JOB_TYPE,
    payload: notification,
    idempotencyKey: `${JOB_TYPE}:${notification.event}:${notification.key}`,
  });
  return true;
};

export const notifyOwner = async (notification: OwnerNotification) => {
  try {
    await enqueueOwnerNotification(notification);
  } catch {
    console.error(
      "Impossible de mettre en file une notification propriétaire.",
      {
        event: notification.event,
        organizationId: getOrganizationId(),
      },
    );
    return false;
  }
  return true;
};

export const escapeNotificationText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, entity: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity] ??
        entity,
    );

const toAppLink = (url?: string) =>
  url?.startsWith("/") && !url.startsWith("//")
    ? new URL(url, env.APP_PUBLIC_URL).toString()
    : "";

const ownerEmailMessage = (message: string, url?: string) => {
  const [subject, ...body] = plainText(message).split("\n");
  const link = toAppLink(url);
  return {
    subject: subject.trim(),
    text: [...body, ...(link ? ["", link] : [])].join("\n").trim() || subject,
  };
};

export const paymentNotificationState = (payment: {
  status: string;
  paid_amount_cents: number;
  refunded_amount_cents: number;
}) =>
  `${payment.status}:${payment.paid_amount_cents}:${payment.refunded_amount_cents}`;

const deliverOwnerNotification: OrganizationJobHandler = async (job) => {
  const input = payloadSchema.parse(fromJsonString(job.payload_json, {}));
  if (input.expiresAt && Date.now() >= input.expiresAt)
    return { skipped: "expired" };
  if (input.payment) {
    const payment = await prisma.bookingPayment.findUnique({
      where: { id: input.payment.id },
    });
    if (!payment || paymentNotificationState(payment) !== input.payment.state) {
      return { skipped: "superseded" };
    }
  }

  const { rule, telegram } = await deliveryOptions(input);
  const done = new Set(input.acknowledged);
  const failures = new Set<string>();
  let sent = 0;
  const attempt = async (
    channel: string,
    destination: string,
    send: () => Promise<void>,
  ) => {
    const key = crypto
      .createHash("sha256")
      .update(`${channel}:${destination}`)
      .digest("hex");
    if (done.has(key)) return true;
    try {
      await send();
      done.add(key);
      await prisma.organizationJob.update({
        where: { id: job.id },
        data: {
          payload_json: encodeJsonField({ ...input, acknowledged: [...done] }),
        },
      });
      sent++;
      return true;
    } catch {
      failures.add(channel);
      return false;
    }
  };

  let fallbackDelivered = false;
  let pushFailed = false;
  let push: Awaited<ReturnType<typeof sendOwnerPushNotification>> | undefined;
  if (rule.push) {
    try {
      push = await sendOwnerPushNotification(input.message, {
        key: `${input.event}:${input.key}`,
        url: input.url,
      });
    } catch {
      pushFailed = true;
    }
  }

  if (rule.telegram !== "off" && telegram.enabled && telegram.bot_token) {
    try {
      if (await isModuleEnabled("telegram")) {
        const link = toAppLink(input.url);
        const action =
          input.telegramAction ??
          (link ? { text: "Ouvrir dans l’application", url: link } : undefined);
        const message =
          input.event === "gite_checked" && telegram.gite_check_mentions.length
            ? `${input.message}\n${telegram.gite_check_mentions.join(" ")}`
            : input.message;
        const candidates =
          await resolveTelegramNotificationRecipients(telegram);
        const recipients =
          rule.telegram === "fallback" && push
            ? await telegramRecipientsAfterPush(
                candidates,
                push.handled_user_ids,
                undefined,
                telegram.recipient_user_ids,
                push.failed_user_ids,
              )
            : candidates;
        for (const recipient of recipients) {
          const delivered = await attempt("Telegram", recipient, async () => {
            const result = await telegramMessageChannel.send({
              message,
              recipients: [recipient],
              options: {
                ...telegram,
                ...(action
                  ? {
                      reply_markup: { inline_keyboard: [[action]] },
                    }
                  : {}),
              },
            });
            if (
              !result.sent_count &&
              result.skipped_reason !== "test_environment"
            ) {
              throw new Error("Telegram non remis.");
            }
          });
          if (delivered && rule.telegram === "fallback")
            fallbackDelivered = true;
        }
      }
    } catch {
      failures.add("Telegram");
    }
  }

  if (rule.email) {
    try {
      const recipients = await resolveOwnerNotificationEmails(
        input.propertyEmail,
      );
      for (const recipient of recipients) {
        if (recipient.toLowerCase() === input.excludeEmail?.toLowerCase())
          continue;
        await attempt("e-mail", recipient, async () => {
          if (!isSmtpConfigured()) throw new Error("SMTP indisponible.");
          const message =
            input.emailMessage ?? ownerEmailMessage(input.message, input.url);
          await sendSmtpMail({ to: recipient, ...message });
        });
      }
    } catch {
      failures.add("e-mail");
    }
  }

  if ((pushFailed || push?.failed_count) && !fallbackDelivered) {
    failures.add("appareils");
  }
  if (failures.size)
    throw new Error(`Notification à réessayer (${[...failures].join(", ")}).`);
  return { sent_count: sent + (push?.sent_count ?? 0) };
};

export const runOwnerNotificationBatch = () =>
  runOrganizationJobBatch({
    workerId: `owner-notification-${process.pid}-${crypto.randomUUID()}`,
    // An event can wait for several providers and recipients before it is complete.
    leaseMs: Math.max(env.ORGANIZATION_JOB_LEASE_MS, 30 * 60_000),
    maxAttempts: env.ORGANIZATION_JOB_MAX_ATTEMPTS,
    handlers: { [JOB_TYPE]: deliverOwnerNotification },
  });

export const startOwnerNotificationWorker = () => {
  if (!env.ORGANIZATION_JOB_WORKER_ENABLED) return;
  void (async () => {
    for (;;) {
      try {
        await runOwnerNotificationBatch();
      } catch {
        console.error(
          "La file des notifications propriétaire est indisponible.",
        );
      }
      await delay(env.ORGANIZATION_JOB_POLL_MS, undefined, { ref: false });
    }
  })();
};

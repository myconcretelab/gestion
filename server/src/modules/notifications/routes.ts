import { Router } from "express";
import {
  ownerNotificationEmailsSchema,
  ownerNotificationSettingsSchema,
} from "@contrats/shared";
import prisma from "../../db/prisma.js";
import {
  ownerNotificationDefaults,
  readOwnerNotificationEmails,
  readOwnerNotificationSettings,
  resolveOwnerNotificationEmails,
  saveOwnerNotificationEmails,
  saveOwnerNotificationSettings,
} from "../../services/ownerNotificationSettings.js";
import { isSmtpConfigured, sendSmtpMail } from "../../services/mailer.js";
import crypto from "node:crypto";
import { z } from "zod";
import { getAuthenticatedAppUser } from "../../services/serverAuth.js";
import { readTelegramNotificationConfig } from "../../services/telegramNotifications.js";
import { isModuleEnabled } from "../../services/installationConfig.js";
import {
  getPushPublicKey,
  listPushDevices,
  pushSubscriptionSchema,
  removePushDevice,
  savePushSubscription,
  sendOwnerPushNotification,
} from "../../services/webPushNotifications.js";

const router = Router();
router.use(async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    if (!user)
      return res
        .status(401)
        .json({ error: "Connectez-vous pour activer les notifications." });
    if (!user.permissions.isOwner)
      return res
        .status(403)
        .json({ error: "Les notifications sont réservées aux propriétaires." });
    res.locals.pushUserId = user.id;
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (error) {
    next(error);
  }
});

const rulesState = async () => {
  const [
    settings,
    telegramAvailable,
    digestAvailable,
    properties,
    cleaningRules,
    templates,
  ] = await Promise.all([
    readOwnerNotificationSettings(),
    isModuleEnabled("telegram"),
    isModuleEnabled("daily_email"),
    prisma.gite.findMany({
      select: { id: true, nom: true },
      orderBy: { nom: "asc" },
    }),
    prisma.cleaningRule.findMany({
      where: { notify_on_complete: true },
      select: { gite_id: true },
    }),
    prisma.actionTemplate.findMany({
      where: { planning_period_id: null },
      select: { id: true, title: true, gite_id: true },
      orderBy: { title: "asc" },
    }),
  ]);
  return {
    settings,
    defaults: ownerNotificationDefaults(readTelegramNotificationConfig()),
    telegramAvailable,
    digestAvailable,
    properties,
    templates,
    legacyCleaningGiteIds: cleaningRules.map((rule) => rule.gite_id),
  };
};

router.get("/rules", async (_req, res, next) => {
  try {
    res.json(await rulesState());
  } catch (error) {
    next(error);
  }
});

router.put("/rules", async (req, res, next) => {
  try {
    const settings = ownerNotificationSettingsSchema.parse(req.body);
    const current = await rulesState();
    const propertyIds = new Set(
      current.properties.map((property) => property.id),
    );
    const templateIds = new Set(
      current.templates.map((template) => template.id),
    );
    if (settings.cleaningGiteIds) {
      settings.cleaningGiteIds = [
        ...new Set(
          settings.cleaningGiteIds.filter((id) => propertyIds.has(id)),
        ),
      ];
    }
    settings.taskOverrides = Object.fromEntries(
      Object.entries(settings.taskOverrides).filter(([id]) =>
        templateIds.has(id),
      ),
    );
    await saveOwnerNotificationSettings(settings);
    res.json({ ...current, settings });
  } catch (error) {
    next(error);
  }
});

const emailState = async () => ({
  recipients: await readOwnerNotificationEmails(),
  smtpConfigured: isSmtpConfigured(),
});

router.get("/email", async (_req, res, next) => {
  try {
    res.json(await emailState());
  } catch (error) {
    next(error);
  }
});

router.put("/email", async (req, res, next) => {
  try {
    const recipients = ownerNotificationEmailsSchema.parse(
      req.body?.recipients,
    );
    await saveOwnerNotificationEmails(recipients);
    res.json(await emailState());
  } catch (error) {
    next(error);
  }
});

router.post("/email/test", async (_req, res, next) => {
  try {
    const recipients = await resolveOwnerNotificationEmails();
    if (!recipients.length) {
      return res
        .status(409)
        .json({
          error: "Enregistrez une adresse e-mail pour envoyer un test.",
        });
    }
    const results = await Promise.allSettled(
      recipients.map((to) =>
        sendSmtpMail({
          to,
          subject: "Test des notifications propriétaire",
          text: "Les alertes e-mail du propriétaire peuvent arriver à cette adresse.",
        }),
      ),
    );
    const sent_count = results.filter(
      (result) => result.status === "fulfilled",
    ).length;
    if (!sent_count) {
      return res
        .status(502)
        .json({
          error:
            "Impossible d’envoyer l’e-mail de test. Vérifiez la configuration SMTP.",
        });
    }
    res.json({ sent_count, failed_count: recipients.length - sent_count });
  } catch (error) {
    next(error);
  }
});

router.get("/status", async (_req, res, next) => {
  try {
    const devices = await listPushDevices(res.locals.pushUserId);
    const telegram = readTelegramNotificationConfig();
    const telegramReady =
      telegram.enabled &&
      Boolean(telegram.bot_token) &&
      (await isModuleEnabled("telegram"));
    res.json({
      push_active: devices.length > 0,
      device_count: devices.length,
      telegram_state: !telegramReady
        ? "disabled"
        : devices.length
          ? "standby"
          : "active",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    res.json({
      publicKey: await getPushPublicKey(),
      devices: await listPushDevices(res.locals.pushUserId),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/subscriptions", async (req, res, next) => {
  try {
    const input = z
      .object({
        subscription: pushSubscriptionSchema,
        label: z.string().trim().min(1).max(80),
      })
      .parse(req.body);
    await savePushSubscription(
      res.locals.pushUserId,
      input.subscription,
      input.label,
    );
    res
      .status(201)
      .json({ devices: await listPushDevices(res.locals.pushUserId) });
  } catch (error) {
    next(error);
  }
});

router.delete("/subscriptions/:id", async (req, res, next) => {
  try {
    await removePushDevice(res.locals.pushUserId, String(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (_req, res, next) => {
  try {
    const result = await sendOwnerPushNotification(
      "Test reçu\nVos alertes arriveront ici.",
      {
        userIds: [res.locals.pushUserId],
        key: `test:${crypto.randomUUID()}`,
        url: "/parametres/notifications",
      },
    );
    if (!result.sent_count)
      return res.status(409).json({
        error:
          "Aucun appareil n’a accepté le test. Activez ou réactivez les notifications sur cet appareil.",
      });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;

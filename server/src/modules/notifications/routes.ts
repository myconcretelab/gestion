import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { getAuthenticatedAppUser } from "../../services/serverAuth.js";
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
      "🔔 Notifications activées\nLes alertes de réservation et les rappels du propriétaire arrivent aussi ici. Telegram continue de fonctionner.",
      {
        userIds: [res.locals.pushUserId],
        key: `test:${crypto.randomUUID()}`,
        url: "/parametres/notifications",
      },
    );
    if (!result.sent_count)
      return res
        .status(409)
        .json({
          error:
            "Aucun appareil n’a accepté le test. Activez ou réactivez les notifications sur cet appareil.",
        });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;

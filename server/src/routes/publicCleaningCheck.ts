import { Router } from "express";
import prisma from "../db/prisma.js";
import {
  notifyGiteCheckedOnTelegram,
  readTelegramNotificationConfig,
} from "../services/telegramNotifications.js";
import { parseCleaningCheckToken } from "../services/telegramDeadlineNotifications.js";

const router = Router();

const renderResult = (title: string, message: string, success: boolean) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:system-ui,sans-serif;background:#f5f3ee;color:#28251f;margin:0;min-height:100vh;display:grid;place-items:center}
main{max-width:34rem;margin:1.5rem;padding:2rem;border-radius:1rem;background:white;box-shadow:0 8px 30px #0001;text-align:center}
.icon{font-size:3rem}h1{font-size:1.5rem;margin:.75rem 0}.ok{color:#287a4b}.error{color:#a33b32}p{line-height:1.5}
</style></head><body><main><div class="icon">${success ? "✅" : "⚠️"}</div><h1 class="${success ? "ok" : "error"}">${title}</h1><p>${message}</p></main></body></html>`;

router.get("/confirm", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const config = readTelegramNotificationConfig();
    const payload = parseCleaningCheckToken(token, config.bot_token);
    if (!payload) {
      return res.status(400).type("html").send(renderResult(
        "Lien invalide ou expiré",
        "Le contrôle peut toujours être validé depuis l'application.",
        false,
      ));
    }

    const [departure, arrival] = await Promise.all([
      prisma.reservation.findUnique({
        where: { id: payload.departureReservationId },
        select: { id: true, gite_id: true, departure_cleaning_checked_at: true },
      }),
      prisma.reservation.findUnique({
        where: { id: payload.arrivalReservationId },
        select: {
          id: true,
          gite_id: true,
          arrival_cleaning_checked_at: true,
          gite: { select: { nom: true } },
        },
      }),
    ]);
    if (!departure || !arrival || !departure.gite_id || departure.gite_id !== arrival.gite_id) {
      return res.status(404).type("html").send(renderResult(
        "Contrôle introuvable",
        "La réservation associée à ce rappel n'existe plus.",
        false,
      ));
    }

    const checkedAt = departure.departure_cleaning_checked_at ?? arrival.arrival_cleaning_checked_at ?? new Date();
    const changed = !departure.departure_cleaning_checked_at || !arrival.arrival_cleaning_checked_at;
    if (changed) {
      await prisma.$transaction([
        prisma.reservation.update({
          where: { id: departure.id },
          data: { departure_cleaning_checked_at: checkedAt, departure_cleaning_checked_by_user_id: null },
        }),
        prisma.reservation.update({
          where: { id: arrival.id },
          data: { arrival_cleaning_checked_at: checkedAt, arrival_cleaning_checked_by_user_id: null },
        }),
      ]);
      try {
        await notifyGiteCheckedOnTelegram(arrival.gite?.nom ?? "Gîte", checkedAt, "Telegram");
      } catch (error) {
        console.error("Échec de la confirmation Telegram du contrôle ménage:", error);
      }
    }

    return res.type("html").send(renderResult(
      changed ? "Contrôle validé" : "Contrôle déjà validé",
      changed ? "Le gîte est maintenant marqué comme prêt." : "Aucune autre action n'est nécessaire.",
      true,
    ));
  } catch (error) {
    return next(error);
  }
});

export default router;

import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { readSourceColorSettings } from "../services/sourceColorSettings.js";
import { readTodayStatuses, writeTodayStatuses } from "../services/todayStatuses.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

const statusSchema = z.object({
  done: z.boolean(),
  user: z.string().trim().max(80).optional().default(""),
});

router.get("/overview", async (req, res, next) => {
  try {
    const daysRaw = typeof req.query.days === "string" ? Number.parseInt(req.query.days, 10) : 14;
    const days = Number.isFinite(daysRaw) ? Math.min(21, Math.max(7, daysRaw)) : 14;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const endExclusive = new Date(today.getTime() + days * DAY_MS);

    const [gites, managers, reservations, unassignedCount] = await Promise.all([
      prisma.gite.findMany({
        select: { id: true, nom: true, prefixe_contrat: true, ordre: true },
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      }),
      prisma.gestionnaire.findMany({
        select: { id: true, prenom: true, nom: true },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      }),
      prisma.reservation.findMany({
        where: {
          gite_id: { not: null },
          date_entree: { lt: endExclusive },
          date_sortie: { gt: today },
        },
        include: {
          gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
        },
        orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }],
      }),
      prisma.reservation.count({
        where: {
          gite_id: null,
          date_entree: { lt: endExclusive },
          date_sortie: { gt: today },
        },
      }),
    ]);

    return res.json({
      today: today.toISOString().slice(0, 10),
      days,
      gites,
      managers,
      reservations,
      statuses: readTodayStatuses(),
      source_colors: readSourceColorSettings().colors,
      unassigned_count: unassignedCount,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/statuses", (_req, res) => {
  res.json(readTodayStatuses());
});

router.post("/statuses/:id", (req, res, next) => {
  try {
    const statusId = String(req.params.id ?? "").trim();
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(statusId)) {
      return res.status(400).json({ error: "Identifiant de statut invalide." });
    }

    const payload = statusSchema.parse(req.body ?? {});
    const statuses = readTodayStatuses();
    statuses[statusId] = payload;
    writeTodayStatuses(statuses);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;

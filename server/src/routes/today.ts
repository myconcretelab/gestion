import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { readTraceabilityLog } from "../services/importLog.js";
import { readSourceColorSettings } from "../services/sourceColorSettings.js";
import { readTodayStatuses, writeTodayStatuses } from "../services/todayStatuses.js";
import { getReservationOriginSystem } from "../utils/reservationOrigin.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_DAY_COUNT = 3;
const RECENT_ACTIVITY_LIMIT = 36;

const statusSchema = z.object({
  done: z.boolean(),
  user: z.string().trim().max(80).optional().default(""),
});

const getRecentActivitySince = () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(today.getTime() - (RECENT_ACTIVITY_DAY_COUNT - 1) * DAY_MS);
};

const parseDateTime = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildRecentAppActivity = async (since: Date) => {
  const rows = await prisma.reservation.findMany({
    where: {
      OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }],
    },
    select: {
      id: true,
      gite_id: true,
      hote_nom: true,
      source_paiement: true,
      commentaire: true,
      prix_total: true,
      prix_par_nuit: true,
      origin_system: true,
      createdAt: true,
      updatedAt: true,
      gite: {
        select: {
          nom: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const items = rows.flatMap((reservation) => {
    if (getReservationOriginSystem(reservation) !== "app") return [];

    const createdAt = parseDateTime(reservation.createdAt);
    const updatedAt = parseDateTime(reservation.updatedAt);
    const guestName = String(reservation.hote_nom ?? "").trim() || "Réservation";
    const giteName = String(reservation.gite?.nom ?? "").trim() || "Sans gîte";
    const source = String(reservation.source_paiement ?? "").trim() || null;
    const events: Array<{
      id: string;
      at: string;
      type: "created" | "updated";
      reservation_id: string;
      gite_id: string | null;
      gite_name: string;
      guest_name: string;
      source: string | null;
    }> = [];

    if (createdAt && createdAt.getTime() >= since.getTime()) {
      events.push({
        id: `app-created:${reservation.id}`,
        at: createdAt.toISOString(),
        type: "created",
        reservation_id: reservation.id,
        gite_id: reservation.gite_id ?? null,
        gite_name: giteName,
        guest_name: guestName,
        source,
      });
    }

    if (updatedAt && updatedAt.getTime() >= since.getTime() && (!createdAt || updatedAt.getTime() !== createdAt.getTime())) {
      events.push({
        id: `app-updated:${reservation.id}:${updatedAt.toISOString()}`,
        at: updatedAt.toISOString(),
        type: "updated",
        reservation_id: reservation.id,
        gite_id: reservation.gite_id ?? null,
        gite_name: giteName,
        guest_name: guestName,
        source,
      });
    }

    return events;
  });

  return items
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT);
};

router.get("/overview", async (req, res, next) => {
  try {
    const daysRaw = typeof req.query.days === "string" ? Number.parseInt(req.query.days, 10) : 14;
    const days = Number.isFinite(daysRaw) ? Math.min(21, Math.max(7, daysRaw)) : 14;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const endExclusive = new Date(today.getTime() + days * DAY_MS);
    const recentActivitySince = getRecentActivitySince();

    const [gites, managers, reservations, unassignedCount, recentAppActivity] = await Promise.all([
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
          date_sortie: { gte: today },
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
          date_sortie: { gte: today },
        },
      }),
      buildRecentAppActivity(recentActivitySince),
    ]);

    const recentImportLog = readTraceabilityLog()
      .filter((entry) => {
        const parsed = parseDateTime(entry.at);
        return parsed ? parsed.getTime() >= recentActivitySince.getTime() : false;
      })
      .slice(0, RECENT_ACTIVITY_LIMIT);

    return res.json({
      today: today.toISOString().slice(0, 10),
      days,
      gites,
      managers,
      reservations,
      statuses: readTodayStatuses(),
      source_colors: readSourceColorSettings().colors,
      unassigned_count: unassignedCount,
      recent_import_log: recentImportLog,
      recent_app_activity: recentAppActivity,
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

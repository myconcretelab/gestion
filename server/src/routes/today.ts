import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { readTraceabilityLog } from "../services/importLog.js";
import {
  getIcalConflictRecord,
  listOpenIcalConflictRecords,
  updateIcalConflictRecord,
  type IcalConflictResolutionAction,
} from "../services/icalConflicts.js";
import { readSourceColorSettings } from "../services/sourceColorSettings.js";
import { loadLiveReservationEnergySummaries } from "../services/smartlifeEnergyTracking.js";
import {
  buildDefaultSmartlifeAutomationConfig,
  hasSmartlifeCredentials,
  readSmartlifeAutomationConfig,
} from "../services/smartlifeSettings.js";
import { buildNewReservations } from "../services/dailyReservationEmail.js";
import { readTodayStatuses, writeTodayStatuses } from "../services/todayStatuses.js";
import { getReservationOriginSystem } from "../utils/reservationOrigin.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_DAY_COUNT = 3;
const RECENT_ACTIVITY_LIMIT = 36;
const DEFAULT_NOTIFICATION_DAY_COUNT = 1;
const MAX_NOTIFICATION_DAY_COUNT = 5;

const statusSchema = z.object({
  done: z.boolean(),
  user: z.string().trim().max(80).optional().default(""),
});
const icalConflictResolutionSchema = z.object({
  action: z.enum(["keep_reservation", "apply_ical", "delete_reservation"]),
});

const conflictReservationSelect = {
  id: true,
  gite_id: true,
  hote_nom: true,
  date_entree: true,
  date_sortie: true,
  source_paiement: true,
  commentaire: true,
  airbnb_url: true,
  origin_system: true,
  origin_reference: true,
  gite: {
    select: {
      id: true,
      nom: true,
      prefixe_contrat: true,
      ordre: true,
    },
  },
} as const;

const getRecentActivitySince = () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(today.getTime() - (RECENT_ACTIVITY_DAY_COUNT - 1) * DAY_MS);
};

const getNotificationSince = (dayCount: number) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(today.getTime() - (dayCount - 1) * DAY_MS);
};

const parseDateTime = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseIsoDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const formatIsoDateFr = (value: Date | string) => {
  const parsed = value instanceof Date ? value : parseDateTime(value);
  if (!parsed) return String(value ?? "");
  return parsed.toLocaleDateString("fr-FR", { timeZone: "UTC" });
};

const buildOverlapConflictPayload = (conflicts: Array<{ id: string; hote_nom: string; date_entree: Date; date_sortie: Date }>) => ({
  error: "Chevauchement détecté sur ce gîte.",
  conflicts: conflicts.map((conflict) => ({
    id: conflict.id,
    hote_nom: conflict.hote_nom,
    date_entree: conflict.date_entree,
    date_sortie: conflict.date_sortie,
    label: `${conflict.hote_nom} (${formatIsoDateFr(conflict.date_entree)} - ${formatIsoDateFr(conflict.date_sortie)})`,
  })),
});

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
    const notificationDaysRaw =
      typeof req.query.notification_days === "string"
        ? Number.parseInt(req.query.notification_days, 10)
        : DEFAULT_NOTIFICATION_DAY_COUNT;
    const notificationDays = Number.isFinite(notificationDaysRaw)
      ? Math.min(MAX_NOTIFICATION_DAY_COUNT, Math.max(1, notificationDaysRaw))
      : DEFAULT_NOTIFICATION_DAY_COUNT;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const endExclusive = new Date(today.getTime() + days * DAY_MS);
    const recentActivitySince = getRecentActivitySince();
    const notificationSince = getNotificationSince(notificationDays);

    const openIcalConflicts = listOpenIcalConflictRecords();
    const [gites, managers, reservations, unassignedCount, recentAppActivity, conflictReservations, newReservations] = await Promise.all([
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
          gite: {
            select: {
              id: true,
              nom: true,
              prefixe_contrat: true,
              ordre: true,
              electricity_price_per_kwh: true,
            },
          },
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
      openIcalConflicts.length > 0
        ? prisma.reservation.findMany({
            where: { id: { in: openIcalConflicts.map((item) => item.reservation_id) } },
            select: conflictReservationSelect,
          })
        : Promise.resolve([]),
      buildNewReservations(notificationSince, new Date()),
    ]);

    const smartlifeConfig = readSmartlifeAutomationConfig(buildDefaultSmartlifeAutomationConfig());
    const liveEnergyByReservationId = hasSmartlifeCredentials(smartlifeConfig)
      ? await loadLiveReservationEnergySummaries(smartlifeConfig, reservations)
      : new Map();

    const recentImportLog = readTraceabilityLog()
      .filter((entry) => {
        const parsed = parseDateTime(entry.at);
        return parsed ? parsed.getTime() >= recentActivitySince.getTime() : false;
      })
      .slice(0, RECENT_ACTIVITY_LIMIT);

    const conflictReservationById = new Map(conflictReservations.map((reservation) => [reservation.id, reservation]));

    return res.json({
      today: today.toISOString().slice(0, 10),
      days,
      notification_days: notificationDays,
      gites,
      managers,
      reservations: reservations.map((reservation) => ({
        ...reservation,
        ...(liveEnergyByReservationId.get(reservation.id) ?? {}),
      })),
      statuses: readTodayStatuses(),
      source_colors: readSourceColorSettings().colors,
      unassigned_count: unassignedCount,
      new_reservations: newReservations,
      recent_import_log: recentImportLog,
      recent_app_activity: recentAppActivity,
      ical_conflicts: openIcalConflicts
        .filter((conflict) => {
          const detectedAt = parseDateTime(conflict.detected_at);
          return detectedAt ? detectedAt.getTime() >= notificationSince.getTime() : false;
        })
        .map((conflict) => ({
          ...conflict,
          reservation: conflictReservationById.get(conflict.reservation_id) ?? null,
        })),
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

router.post("/ical-conflicts/:id/resolve", async (req, res, next) => {
  try {
    const conflict = getIcalConflictRecord(String(req.params.id ?? "").trim());
    if (!conflict || conflict.status !== "open") {
      return res.status(404).json({ error: "Conflit iCal introuvable." });
    }

    const payload = icalConflictResolutionSchema.parse(req.body ?? {});
    const action = payload.action as IcalConflictResolutionAction;

    if (action === "keep_reservation") {
      const updated = updateIcalConflictRecord(conflict.id, (record) => ({
        ...record,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolution_action: "keep_reservation",
      }));
      return res.json({ ok: true, conflict: updated });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: conflict.reservation_id },
      select: {
        id: true,
        gite_id: true,
        placeholder_id: true,
        hote_nom: true,
        date_entree: true,
        date_sortie: true,
      },
    });

    if (action === "delete_reservation" || (action === "apply_ical" && conflict.type === "deleted")) {
      if (reservation) {
        await prisma.reservation.delete({ where: { id: reservation.id } });
      }
      const updated = updateIcalConflictRecord(conflict.id, (record) => ({
        ...record,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolution_action: action,
      }));
      return res.json({ ok: true, conflict: updated });
    }

    if (action === "apply_ical" && conflict.type === "modified") {
      if (!reservation) {
        return res.status(404).json({ error: "La réservation liée au conflit est introuvable." });
      }
      if (!conflict.incoming_snapshot) {
        return res.status(400).json({ error: "Le conflit iCal ne contient pas de version entrante à appliquer." });
      }

      const nextCheckIn = parseIsoDate(conflict.incoming_snapshot.date_entree);
      const nextCheckOut = parseIsoDate(conflict.incoming_snapshot.date_sortie);
      if (!nextCheckIn || !nextCheckOut || nextCheckOut.getTime() <= nextCheckIn.getTime()) {
        return res.status(400).json({ error: "Les dates iCal à appliquer sont invalides." });
      }

      const overlapConflicts = await prisma.reservation.findMany({
        where: {
          gite_id: reservation.gite_id,
          date_entree: { lt: nextCheckOut },
          date_sortie: { gt: nextCheckIn },
          NOT: { id: reservation.id },
        },
        select: {
          id: true,
          hote_nom: true,
          date_entree: true,
          date_sortie: true,
        },
        orderBy: { date_entree: "asc" },
      });
      if (overlapConflicts.length > 0) {
        return res.status(409).json(buildOverlapConflictPayload(overlapConflicts));
      }

      const nbNuits = Math.max(1, Math.round((nextCheckOut.getTime() - nextCheckIn.getTime()) / DAY_MS));
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: {
          hote_nom: conflict.incoming_snapshot.hote_nom ?? reservation.hote_nom,
          date_entree: nextCheckIn,
          date_sortie: nextCheckOut,
          nb_nuits: nbNuits,
          source_paiement: conflict.incoming_snapshot.final_source ?? conflict.incoming_snapshot.source_paiement ?? undefined,
          airbnb_url: conflict.incoming_snapshot.airbnb_url,
        },
      });

      const updated = updateIcalConflictRecord(conflict.id, (record) => ({
        ...record,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolution_action: "apply_ical",
      }));
      return res.json({ ok: true, conflict: updated });
    }

    return res.status(400).json({ error: "Action de résolution non gérée pour ce conflit." });
  } catch (error) {
    return next(error);
  }
});

export default router;

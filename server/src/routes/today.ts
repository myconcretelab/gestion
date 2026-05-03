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
import {
  buildOverviewReservationsWhere,
  buildRecentAppActivity,
  createOverviewHandler,
  parseDateTime,
  parseOverviewParams,
} from "./todayOverview.shared.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 36;

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

const loadOverviewReservations = (today: Date, endExclusive: Date) =>
  prisma.reservation.findMany({
    where: buildOverviewReservationsWhere(today, endExclusive),
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
  });

const loadOverviewLiveEnergyByReservationId = async (today: Date, endExclusive: Date) => {
  const smartlifeConfig = readSmartlifeAutomationConfig(buildDefaultSmartlifeAutomationConfig());
  if (!hasSmartlifeCredentials(smartlifeConfig)) {
    return {} as Record<
      string,
      {
        energy_live_consumption_kwh: number;
        energy_live_cost_eur: number;
        energy_live_price_per_kwh: number | null;
        energy_live_recorded_at: string;
      }
    >;
  }

  const reservations = await prisma.reservation.findMany({
    where: buildOverviewReservationsWhere(today, endExclusive),
    select: {
      id: true,
      energy_tracking: true,
      gite: {
        select: {
          electricity_price_per_kwh: true,
        },
      },
    },
  });
  if (reservations.length === 0) {
    return {};
  }

  const liveEnergyByReservationId = await loadLiveReservationEnergySummaries(smartlifeConfig, reservations);
  return Object.fromEntries(liveEnergyByReservationId.entries());
};

const loadRecentAppActivity = (since: Date) =>
  buildRecentAppActivity(since, () =>
    prisma.reservation.findMany({
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
    })
  );

router.get("/overview/primary", async (req, res, next) => {
  try {
    const { days, notificationDays, today, endExclusive } = parseOverviewParams(req.query as Record<string, unknown>);
    const [gites, reservations] = await Promise.all([
      prisma.gite.findMany({
        select: { id: true, nom: true, prefixe_contrat: true, ordre: true },
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      }),
      loadOverviewReservations(today, endExclusive),
    ]);

    return res.json({
      today: toIsoDate(today),
      days,
      notification_days: notificationDays,
      gites,
      reservations,
      source_colors: readSourceColorSettings().colors,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/overview/deferred", async (req, res, next) => {
  try {
    const { days, notificationDays, today, endExclusive, notificationSince } = parseOverviewParams(
      req.query as Record<string, unknown>
    );
    const openIcalConflicts = listOpenIcalConflictRecords();
    const [unassignedCount, conflictReservations, newReservations, liveEnergyByReservationId] = await Promise.all([
      prisma.reservation.count({
        where: {
          gite_id: null,
          date_entree: { lt: endExclusive },
          date_sortie: { gte: today },
        },
      }),
      openIcalConflicts.length > 0
        ? prisma.reservation.findMany({
            where: { id: { in: openIcalConflicts.map((item) => item.reservation_id) } },
            select: conflictReservationSelect,
          })
        : Promise.resolve([]),
      buildNewReservations(notificationSince, new Date()),
      loadOverviewLiveEnergyByReservationId(today, endExclusive),
    ]);

    const conflictReservationById = new Map(conflictReservations.map((reservation) => [reservation.id, reservation]));

    return res.json({
      days,
      notification_days: notificationDays,
      unassigned_count: unassignedCount,
      new_reservations: newReservations,
      live_energy_by_reservation_id: liveEnergyByReservationId,
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

router.get(
  "/overview",
  createOverviewHandler({
    loadGites: () =>
      prisma.gite.findMany({
        select: { id: true, nom: true, prefixe_contrat: true, ordre: true },
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      }),
    loadReservations: loadOverviewReservations,
    countUnassignedReservations: (today, endExclusive) =>
      prisma.reservation.count({
        where: {
          gite_id: null,
          date_entree: { lt: endExclusive },
          date_sortie: { gte: today },
        },
      }),
    loadRecentAppActivity,
    listOpenIcalConflicts: listOpenIcalConflictRecords,
    loadConflictReservations: (reservationIds) =>
      prisma.reservation.findMany({
        where: { id: { in: reservationIds } },
        select: conflictReservationSelect,
      }),
    buildNewReservations,
    loadLiveEnergyByReservationId: async (reservations) => {
      const smartlifeConfig = readSmartlifeAutomationConfig(buildDefaultSmartlifeAutomationConfig());
      if (!hasSmartlifeCredentials(smartlifeConfig)) {
        return {};
      }
      return Object.fromEntries((await loadLiveReservationEnergySummaries(smartlifeConfig, reservations)).entries());
    },
    readTraceabilityLog,
    readSourceColors: () => readSourceColorSettings().colors,
  })
);

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

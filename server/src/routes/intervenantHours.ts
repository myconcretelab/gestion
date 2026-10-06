import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { isValidWorkDate, MAX_WORK_MINUTES } from "../utils/intervenantHours.js";

const router = Router();
const workDate = z.string().refine(isValidWorkDate, "Date invalide.");
const duration = z.number().int().min(1).max(MAX_WORK_MINUTES);
const entrySchema = z.object({
  id: z.string().uuid(),
  worked_on: workDate,
  minutes: duration,
});
const correctionSchema = z.object({
  worked_on: workDate,
  minutes: duration,
  expected_updated_at: z.string().datetime(),
});
const historyQuerySchema = z.object({
  worker_id: z.string().trim().min(1).optional(),
  status: z.enum(["all", "unpaid", "paid"]).default("all"),
  from: workDate.optional(),
  to: workDate.optional(),
});

const serializeEntry = (entry: {
  id: string; intervenant_id: string | null; intervenant_nom: string;
  worked_on: string; minutes: number; paid_at: Date | null;
  hourly_rate_snapshot: unknown; createdAt: Date; updatedAt: Date;
}) => ({
  id: entry.id,
  intervenant_id: entry.intervenant_id,
  intervenant_nom: entry.intervenant_nom,
  worked_on: entry.worked_on,
  minutes: entry.minutes,
  paid_at: entry.paid_at?.toISOString() ?? null,
  hourly_rate_snapshot: entry.hourly_rate_snapshot == null ? null : Number(entry.hourly_rate_snapshot),
  created_at: entry.createdAt.toISOString(),
  updated_at: entry.updatedAt.toISOString(),
});

router.get("/", async (req, res, next) => {
  try {
    const date = workDate.parse(req.query.date);
    const [workers, entries, unpaidTotals] = await Promise.all([
      prisma.planningRelayWorker.findMany({
        select: { id: true, nom: true, is_active: true, show_on_today: true, hourly_rate: true,
          app_user: { select: { id: true, display_name: true, hourly_rate: true, cleaning_check_rate: true, full_cleaning_rate: true } } },
        orderBy: [{ nom: "asc" }, { id: "asc" }],
      }),
      prisma.intervenantHourEntry.findMany({
        where: { worked_on: date, deleted_at: null },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      prisma.intervenantHourEntry.groupBy({
        by: ["intervenant_id"],
        where: { intervenant_id: { not: null }, deleted_at: null, paid_at: null },
        _sum: { minutes: true },
      }),
    ]);
    const unpaidByWorker = new Map(unpaidTotals.map((row) => [row.intervenant_id, row._sum.minutes ?? 0]));
    return res.json({
      workers: workers.map((worker) => ({
        ...worker,
        nom: worker.app_user?.display_name ?? worker.nom,
        user_id: worker.app_user?.id ?? null,
        hourly_rate: Number(worker.app_user?.hourly_rate ?? worker.hourly_rate ?? 0),
        cleaning_check_rate: Number(worker.app_user?.cleaning_check_rate ?? 0),
        full_cleaning_rate: Number(worker.app_user?.full_cleaning_rate ?? 0),
        app_user: undefined,
        unpaid_minutes: unpaidByWorker.get(worker.id) ?? 0,
      })),
      entries: entries.map(serializeEntry),
    });
  } catch (error) { return next(error); }
});

router.get("/history", async (req, res, next) => {
  try {
    const query = historyQuerySchema.parse(req.query);
    const entries = await prisma.intervenantHourEntry.findMany({
      where: {
        deleted_at: null,
        ...(query.worker_id ? { intervenant_id: query.worker_id } : {}),
        ...(query.status === "paid" ? { paid_at: { not: null } } : {}),
        ...(query.status === "unpaid" ? { paid_at: null } : {}),
        ...(query.from || query.to ? {
          worked_on: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        } : {}),
      },
      orderBy: [{ worked_on: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 1000,
    });
    return res.json({ entries: entries.map(serializeEntry) });
  } catch (error) { return next(error); }
});

router.post("/:workerId/settle", async (req, res, next) => {
  try {
    const worker = await prisma.planningRelayWorker.findUnique({
      where: { id: req.params.workerId },
      select: { id: true, nom: true, hourly_rate: true,
        app_user: { select: { id: true, display_name: true, hourly_rate: true } } },
    });
    if (!worker) return res.status(404).json({ error: "Intervenant introuvable." });
    const [entries, interventions] = await Promise.all([
      prisma.intervenantHourEntry.findMany({
        where: { intervenant_id: worker.id, deleted_at: null, paid_at: null },
        select: { id: true, minutes: true },
      }),
      worker.app_user ? prisma.userIntervention.findMany({
        where: { user_id: worker.app_user.id, paid_at: null },
        select: { id: true, amount_snapshot: true },
      }) : [],
    ]);
    const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
    const hourlyRate = Number(worker.app_user?.hourly_rate ?? worker.hourly_rate ?? 0);
    const interventionAmount = interventions.reduce((sum, entry) => sum + Number(entry.amount_snapshot ?? 0), 0);
    if (!entries.length && !interventions.length) {
      return res.json({ worker_id: worker.id, worker_name: worker.nom, entry_count: 0,
        intervention_count: 0, total_minutes: 0, hourly_rate: hourlyRate, amount: 0, paid_at: null });
    }
    const paidAt = new Date();
    const [updatedHours, updatedInterventions] = await Promise.all([
      prisma.intervenantHourEntry.updateMany({
        where: { id: { in: entries.map((entry) => entry.id) }, paid_at: null, deleted_at: null },
        data: { paid_at: paidAt, hourly_rate_snapshot: hourlyRate },
      }),
      prisma.userIntervention.updateMany({
        where: { id: { in: interventions.map((entry) => entry.id) }, paid_at: null },
        data: { paid_at: paidAt },
      }),
    ]);
    const hoursAmount = Math.round((totalMinutes / 60) * hourlyRate * 100) / 100;
    return res.json({
      worker_id: worker.id,
      worker_name: worker.app_user?.display_name ?? worker.nom,
      entry_count: updatedHours.count,
      intervention_count: updatedInterventions.count,
      total_minutes: totalMinutes,
      hourly_rate: hourlyRate,
      amount: Math.round((hoursAmount + interventionAmount) * 100) / 100,
      paid_at: paidAt.toISOString(),
    });
  } catch (error) { return next(error); }
});

router.post("/:workerId", async (req, res, next) => {
  try {
    const payload = entrySchema.parse(req.body);
    const worker = await prisma.planningRelayWorker.findUnique({
      where: { id: req.params.workerId },
      select: { id: true, nom: true, is_active: true },
    });
    if (!worker) return res.status(404).json({ error: "Intervenant introuvable." });
    if (!worker.is_active) return res.status(409).json({ error: "Cet intervenant est inactif." });

    // The client retains this UUID after a network error: retrying never adds hours twice.
    // Deleted entries remain as tombstones so an old retry cannot undo a cancellation.
    const entry = await prisma.intervenantHourEntry.upsert({
      where: { id: payload.id },
      update: {},
      create: {
        id: payload.id,
        intervenant_id: worker.id,
        intervenant_nom: worker.nom,
        worked_on: payload.worked_on,
        minutes: payload.minutes,
      },
    });
    if (entry.deleted_at || entry.intervenant_id !== worker.id ||
        entry.worked_on !== payload.worked_on || entry.minutes !== payload.minutes) {
      return res.status(409).json({ error: "Cette saisie a déjà été utilisée ou annulée. Rechargez les heures avant de réessayer." });
    }
    return res.status(200).json(serializeEntry(entry));
  } catch (error) { return next(error); }
});

router.patch("/:workerId/:entryId", async (req, res, next) => {
  try {
    const payload = correctionSchema.parse(req.body);
    const updated = await prisma.intervenantHourEntry.updateMany({
      where: {
        id: req.params.entryId,
        intervenant_id: req.params.workerId,
        deleted_at: null,
        paid_at: null,
        updatedAt: new Date(payload.expected_updated_at),
      },
      data: { worked_on: payload.worked_on, minutes: payload.minutes },
    });
    if (!updated.count) {
      return res.status(409).json({ error: "Cette saisie a changé, a été payée ou supprimée. Rechargez l'historique." });
    }
    const entry = await prisma.intervenantHourEntry.findUniqueOrThrow({ where: { id: req.params.entryId } });
    return res.json(serializeEntry(entry));
  } catch (error) { return next(error); }
});

router.delete("/:workerId/:entryId", async (req, res, next) => {
  try {
    await prisma.intervenantHourEntry.updateMany({
      where: { id: req.params.entryId, intervenant_id: req.params.workerId, deleted_at: null, paid_at: null },
      data: { deleted_at: new Date() },
    });
    return res.status(204).end();
  } catch (error) { return next(error); }
});

export default router;

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

const serializeEntry = (entry: {
  id: string; intervenant_id: string | null; intervenant_nom: string;
  worked_on: string; minutes: number; createdAt: Date; updatedAt: Date;
}) => ({
  id: entry.id,
  intervenant_id: entry.intervenant_id,
  intervenant_nom: entry.intervenant_nom,
  worked_on: entry.worked_on,
  minutes: entry.minutes,
  created_at: entry.createdAt.toISOString(),
  updated_at: entry.updatedAt.toISOString(),
});

router.get("/", async (req, res, next) => {
  try {
    const date = workDate.parse(req.query.date);
    const [workers, entries] = await Promise.all([
      prisma.planningRelayWorker.findMany({
        select: { id: true, nom: true, is_active: true, show_on_today: true },
        orderBy: [{ nom: "asc" }, { id: "asc" }],
      }),
      prisma.intervenantHourEntry.findMany({
        where: { worked_on: date, deleted_at: null },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
    ]);
    return res.json({ workers, entries: entries.map(serializeEntry) });
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
        updatedAt: new Date(payload.expected_updated_at),
      },
      data: { worked_on: payload.worked_on, minutes: payload.minutes },
    });
    if (!updated.count) {
      return res.status(409).json({ error: "Cette saisie a changé ou a été supprimée. Rechargez l'historique." });
    }
    const entry = await prisma.intervenantHourEntry.findUniqueOrThrow({ where: { id: req.params.entryId } });
    return res.json(serializeEntry(entry));
  } catch (error) { return next(error); }
});

router.delete("/:workerId/:entryId", async (req, res, next) => {
  try {
    await prisma.intervenantHourEntry.updateMany({
      where: { id: req.params.entryId, intervenant_id: req.params.workerId, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    return res.status(204).end();
  } catch (error) { return next(error); }
});

export default router;

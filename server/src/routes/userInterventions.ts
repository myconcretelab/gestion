import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { getOrganizationId } from "../services/organizationContext.js";
import { normalizeAppUserRoles } from "../services/appUsers.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { isValidWorkDate } from "../utils/intervenantHours.js";

const router = Router();
const workDate = z.string().refine(isValidWorkDate, "Date invalide.");
const querySchema = z.object({
  user_id: z.string().trim().min(1).optional(),
  status: z.enum(["all", "unpaid", "paid"]).default("all"),
  from: workDate.optional(),
  to: workDate.optional(),
});
const createSchema = z.object({
  userId: z.string().trim().min(1),
  giteId: z.string().trim().min(1),
  occurredOn: workDate,
});

const serialize = (entry: any) => ({
  id: entry.id,
  user_id: entry.user_id,
  user_name: entry.user_name,
  kind: entry.kind,
  occurred_on: entry.occurred_on,
  gite_id: entry.gite_id,
  gite_name: entry.gite_name,
  reservation_id: entry.reservation_id,
  amount: Number(entry.amount_snapshot ?? 0),
  paid_at: entry.paid_at?.toISOString() ?? null,
  created_at: entry.createdAt.toISOString(),
});

router.get("/", async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const entries = await prisma.userIntervention.findMany({
      where: {
        ...(query.user_id ? { user_id: query.user_id } : {}),
        ...(query.status === "paid" ? { paid_at: { not: null } } : {}),
        ...(query.status === "unpaid" ? { paid_at: null } : {}),
        ...(query.from || query.to ? {
          occurred_on: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        } : {}),
      },
      orderBy: [{ occurred_on: "desc" }, { createdAt: "desc" }],
      take: 2000,
    });
    res.json({ entries: entries.map(serialize) });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = createSchema.parse(req.body ?? {});
    const [user, gite] = await Promise.all([
      prisma.appUser.findUnique({ where: { id: payload.userId } }),
      prisma.gite.findUnique({ where: { id: payload.giteId }, select: { id: true, nom: true } }),
    ]);
    if (!user || !normalizeAppUserRoles(user.roles).includes("worker")) {
      return res.status(404).json({ error: "Intervenant introuvable." });
    }
    if (!gite) return res.status(404).json({ error: "Gîte introuvable." });

    const start = new Date(`${payload.occurredOn}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const candidates = await prisma.reservation.findMany({
      where: { gite_id: gite.id, date_sortie: { gte: start, lt: end } },
      select: { id: true, options: true },
      orderBy: { createdAt: "desc" },
    });
    const reservation = candidates.find((item) =>
      Boolean(fromJsonString<{ menage?: { enabled?: boolean } }>(item.options, {}).menage?.enabled)
    );
    if (!reservation) {
      return res.status(409).json({ error: "Aucun départ avec l’option ménage n’existe pour ce gîte à cette date." });
    }

    const sourceKey = `full-cleaning:${reservation.id}`;
    const existing = await prisma.userIntervention.findUnique({ where: { organization_id_source_key: { organization_id: getOrganizationId(), source_key: sourceKey } } });
    if (existing) return res.status(409).json({ error: "Ce ménage complet est déjà comptabilisé." });
    const entry = await prisma.userIntervention.create({
      data: {
        user_id: user.id,
        user_name: user.display_name,
        kind: "full_cleaning",
        occurred_on: payload.occurredOn,
        gite_id: gite.id,
        gite_name: gite.nom,
        reservation_id: reservation.id,
        source_key: sourceKey,
        amount_snapshot: Number(user.full_cleaning_rate ?? 0),
      },
    });
    res.status(201).json(serialize(entry));
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const removed = await prisma.userIntervention.deleteMany({
      where: { id: req.params.id, paid_at: null, kind: "full_cleaning" },
    });
    if (!removed.count) return res.status(409).json({ error: "Cette intervention est déjà payée ou automatique." });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;

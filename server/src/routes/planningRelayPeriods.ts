import { Router } from "express";
import { addDays, differenceInCalendarDays, endOfDay } from "date-fns";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";
import {
  buildPlanningRelayToken,
  generatePlanningRelayNonce,
  parsePlanningRelayToken,
  verifyPlanningRelayToken,
} from "../services/planningRelayShare.js";

const MAX_DAYS = 31;
const privateRouter = Router();
const publicRouter = Router();

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableIsoDateSchema = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  isoDateSchema.nullable(),
);

const payloadSchema = z.object({
  label: z.string().trim().min(1).max(120),
  from: isoDateSchema,
  to: isoDateSchema,
  gite_ids: z.array(z.string().trim().min(1)).min(1).max(50),
  show_timeline: z.boolean(),
  show_comments: z.boolean(),
  show_phones: z.boolean(),
  expires_at: nullableIsoDateSchema.optional(),
});

const patchSchema = payloadSchema.partial().extend({
  is_active: z.boolean().optional(),
});

const parseIsoDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(result.getTime()) ||
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new Error("Date invalide.");
  }
  return result;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const validatePeriod = (from: string, to: string) => {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const dayCount = differenceInCalendarDays(end, start) + 1;
  if (dayCount < 1 || dayCount > MAX_DAYS) {
    throw new Error(`La période doit contenir entre 1 et ${MAX_DAYS} jours.`);
  }
  return { start, end };
};

const normalizeGiteIds = (value: unknown) => [
  ...new Set(fromJsonString<unknown[]>(value, []).filter((id): id is string => typeof id === "string" && Boolean(id))),
];

const sanitizePublicOptions = (value: unknown) => {
  const options = fromJsonString<Record<string, any>>(value, {});
  return {
    ...(options.draps ? { draps: { enabled: Boolean(options.draps.enabled), nb_lits: Number(options.draps.nb_lits) || 0 } } : {}),
    ...(options.linge_toilette ? { linge_toilette: { enabled: Boolean(options.linge_toilette.enabled), nb_personnes: Number(options.linge_toilette.nb_personnes) || 0 } } : {}),
    ...(options.menage ? { menage: { enabled: Boolean(options.menage.enabled) } } : {}),
    ...(options.depart_tardif ? { depart_tardif: { enabled: Boolean(options.depart_tardif.enabled) } } : {}),
  };
};

const assertGitesExist = async (giteIds: string[]) => {
  const count = await prisma.gite.count({ where: { id: { in: giteIds } } });
  if (count !== new Set(giteIds).size) throw new Error("Un ou plusieurs gîtes sont introuvables.");
};

const serializePeriod = (period: any) => {
  const token = buildPlanningRelayToken(period.id, period.share_nonce);
  return {
    id: period.id,
    label: period.label,
    from: toIsoDate(period.date_debut),
    to: toIsoDate(period.date_fin),
    gite_ids: normalizeGiteIds(period.gite_ids),
    show_timeline: period.show_timeline,
    show_comments: period.show_comments,
    show_phones: period.show_phones,
    is_active: period.is_active,
    expires_at: period.expires_at?.toISOString() ?? null,
    last_accessed_at: period.last_accessed_at?.toISOString() ?? null,
    created_at: period.createdAt.toISOString(),
    updated_at: period.updatedAt.toISOString(),
    public_path: `/relais/${token}`,
  };
};

const buildCreateData = (payload: z.infer<typeof payloadSchema>) => {
  const { start, end } = validatePeriod(payload.from, payload.to);
  return {
    label: payload.label,
    date_debut: start,
    date_fin: end,
    gite_ids: encodeJsonField([...new Set(payload.gite_ids)]),
    show_timeline: payload.show_timeline,
    show_comments: payload.show_comments,
    show_phones: payload.show_phones,
    share_nonce: generatePlanningRelayNonce(),
    expires_at: payload.expires_at ? endOfDay(parseIsoDate(payload.expires_at)) : endOfDay(addDays(end, 7)),
  };
};

privateRouter.get("/", async (_req, res, next) => {
  try {
    const periods = await prisma.planningRelayPeriod.findMany({
      orderBy: [{ date_debut: "asc" }, { createdAt: "asc" }],
    });
    return res.json(periods.map(serializePeriod));
  } catch (error) {
    return next(error);
  }
});

privateRouter.post("/", async (req, res, next) => {
  try {
    const payload = payloadSchema.parse(req.body);
    await assertGitesExist(payload.gite_ids);
    const period = await prisma.planningRelayPeriod.create({ data: buildCreateData(payload) });
    return res.status(201).json(serializePeriod(period));
  } catch (error) {
    return next(error);
  }
});

privateRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = patchSchema.parse(req.body);
    const current = await prisma.planningRelayPeriod.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Période introuvable." });

    const from = payload.from ?? toIsoDate(current.date_debut);
    const to = payload.to ?? toIsoDate(current.date_fin);
    const { start, end } = validatePeriod(from, to);
    const giteIds = payload.gite_ids ?? normalizeGiteIds(current.gite_ids);
    await assertGitesExist(giteIds);

    const period = await prisma.planningRelayPeriod.update({
      where: { id: current.id },
      data: {
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        date_debut: start,
        date_fin: end,
        gite_ids: encodeJsonField([...new Set(giteIds)]),
        ...(payload.show_timeline !== undefined ? { show_timeline: payload.show_timeline } : {}),
        ...(payload.show_comments !== undefined ? { show_comments: payload.show_comments } : {}),
        ...(payload.show_phones !== undefined ? { show_phones: payload.show_phones } : {}),
        ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
        ...(payload.expires_at !== undefined
          ? { expires_at: payload.expires_at ? endOfDay(parseIsoDate(payload.expires_at)) : null }
          : {}),
      },
    });
    return res.json(serializePeriod(period));
  } catch (error) {
    return next(error);
  }
});

privateRouter.post("/:id/rotate-link", async (req, res, next) => {
  try {
    const current = await prisma.planningRelayPeriod.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Période introuvable." });
    const period = await prisma.planningRelayPeriod.update({
      where: { id: current.id },
      data: {
        share_nonce: generatePlanningRelayNonce(),
        is_active: true,
        ...(current.expires_at && current.expires_at.getTime() < Date.now()
          ? { expires_at: endOfDay(addDays(new Date(), 7)) }
          : {}),
      },
    });
    return res.json(serializePeriod(period));
  } catch (error) {
    return next(error);
  }
});

privateRouter.delete("/:id", async (req, res, next) => {
  try {
    await prisma.planningRelayPeriod.delete({ where: { id: req.params.id } });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

publicRouter.get("/:token", async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    const parsedToken = parsePlanningRelayToken(req.params.token);
    if (!parsedToken) return res.status(404).json({ error: "Planning introuvable." });

    const period = await prisma.planningRelayPeriod.findUnique({ where: { id: parsedToken.id } });
    if (
      !period ||
      !period.is_active ||
      (period.expires_at && period.expires_at.getTime() < Date.now()) ||
      !verifyPlanningRelayToken(req.params.token, period.share_nonce)
    ) {
      return res.status(404).json({ error: "Ce planning n’est plus disponible." });
    }

    const giteIds = normalizeGiteIds(period.gite_ids);
    const periodEndExclusive = addDays(period.date_fin, 1);
    const [gites, reservations] = await Promise.all([
      prisma.gite.findMany({
        where: { id: { in: giteIds } },
        select: {
          id: true,
          nom: true,
          prefixe_contrat: true,
          ordre: true,
          heure_arrivee_defaut: true,
          heure_depart_defaut: true,
        },
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      }),
      prisma.reservation.findMany({
        where: {
          gite_id: { in: giteIds },
          date_entree: { lt: periodEndExclusive },
          date_sortie: { gte: period.date_debut },
        },
        select: {
          id: true,
          gite_id: true,
          hote_nom: true,
          telephone: true,
          date_entree: true,
          date_sortie: true,
          nb_nuits: true,
          commentaire: true,
          options: true,
          gite: {
            select: {
              id: true,
              nom: true,
              prefixe_contrat: true,
              ordre: true,
              heure_arrivee_defaut: true,
              heure_depart_defaut: true,
            },
          },
        },
        orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }],
      }),
      prisma.planningRelayPeriod.update({
        where: { id: period.id },
        data: { last_accessed_at: new Date() },
      }),
    ]);

    return res.json({
      period: {
        label: period.label,
        from: toIsoDate(period.date_debut),
        to: toIsoDate(period.date_fin),
        show_timeline: period.show_timeline,
        show_comments: period.show_comments,
        show_phones: period.show_phones,
        expires_at: period.expires_at?.toISOString() ?? null,
      },
      gites,
      reservations: reservations.map((reservation) => ({
        ...reservation,
        telephone: period.show_phones ? reservation.telephone : null,
        commentaire: period.show_comments ? reservation.commentaire : null,
        options: sanitizePublicOptions(reservation.options),
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export { privateRouter as planningRelayPeriodsRouter, publicRouter as publicPlanningRelayRouter };

import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { normalizePlanningRelaySmsConfigs } from "../services/planningRelaySms.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";

const router = Router();

const intervenantPayloadSchema = z.object({
  nom: z.string().trim().min(1).max(120),
  telephone: z.string().trim().min(1).max(32),
  email: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.string().trim().email().max(180).nullable(),
  ).optional(),
  adresse: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.string().trim().max(500).nullable(),
  ).optional(),
  message_channel_addresses: z.record(
    z.string().trim().min(1).max(40),
    z.string().trim().max(180),
  ).optional(),
  is_active: z.boolean().optional(),
});

const intervenantExpenseFieldsSchema = z.object({
  scope: z.enum(["all_gites", "gite"]),
  gite_id: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.string().trim().min(1).nullable(),
  ).optional(),
  year: z.coerce.number().int().min(2000).max(3000),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().positive().max(1_000_000),
  notes: z.string().trim().max(500).default(""),
});

const intervenantExpensePayloadSchema = intervenantExpenseFieldsSchema.superRefine((payload, context) => {
  if (payload.scope === "gite" && !payload.gite_id) {
    context.addIssue({
      code: "custom",
      message: "Choisissez un gîte.",
      path: ["gite_id"],
    });
  }
});
const intervenantExpensePatchSchema = intervenantExpenseFieldsSchema.partial();

const serializeIntervenantExpense = (expense: any) => ({
  id: expense.id,
  intervenant_id: expense.intervenant_id,
  scope: expense.scope === "gite" ? "gite" : "all_gites",
  gite_id: expense.gite_id ?? null,
  gite_nom: expense.gite?.nom ?? expense.gite_nom ?? null,
  year: expense.year,
  month: expense.month,
  amount: Number(expense.amount),
  notes: expense.notes ?? "",
  created_at: expense.createdAt.toISOString(),
  updated_at: expense.updatedAt.toISOString(),
});

const serializeIntervenant = (intervenant: any) => ({
  id: intervenant.id,
  nom: intervenant.nom,
  telephone: intervenant.telephone,
  email: intervenant.email ?? null,
  adresse: intervenant.adresse ?? null,
  message_channel_addresses: {
    ...fromJsonString<Record<string, string>>(
      intervenant.message_channel_addresses,
      {},
    ),
    sms: intervenant.telephone,
  },
  is_active: Boolean(intervenant.is_active),
  expenses: Array.isArray(intervenant.expenses)
    ? intervenant.expenses.map(serializeIntervenantExpense)
    : [],
  created_at: intervenant.createdAt.toISOString(),
  updated_at: intervenant.updatedAt.toISOString(),
});

router.get("/", async (_req, res, next) => {
  try {
    const intervenants = await prisma.planningRelayWorker.findMany({
      orderBy: [{ is_active: "desc" }, { nom: "asc" }, { createdAt: "asc" }],
      include: {
        expenses: {
          include: { gite: { select: { id: true, nom: true } } },
          orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    return res.json(intervenants.map(serializeIntervenant));
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = intervenantPayloadSchema.parse(req.body ?? {});
    const intervenant = await prisma.planningRelayWorker.create({
      data: {
        nom: payload.nom,
        telephone: payload.telephone,
        email: payload.email ?? null,
        adresse: payload.adresse ?? null,
        message_channel_addresses: encodeJsonField(
          payload.message_channel_addresses ?? {},
        ),
        is_active: payload.is_active ?? true,
      },
    });
    return res.status(201).json(serializeIntervenant(intervenant));
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/expenses", async (req, res, next) => {
  try {
    const payload = intervenantExpensePayloadSchema.parse(req.body ?? {});
    const intervenant = await prisma.planningRelayWorker.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!intervenant) {
      return res.status(404).json({ error: "Intervenant introuvable." });
    }

    const gite = payload.scope === "gite" && payload.gite_id
      ? await prisma.gite.findUnique({
          where: { id: payload.gite_id },
          select: { id: true, nom: true },
        })
      : null;
    if (payload.scope === "gite" && !gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const expense = await prisma.intervenantExpense.create({
      data: {
        intervenant_id: intervenant.id,
        scope: payload.scope,
        gite_id: gite?.id ?? null,
        gite_nom: gite?.nom ?? null,
        year: payload.year,
        month: payload.month,
        amount: payload.amount,
        notes: payload.notes,
      },
      include: { gite: { select: { id: true, nom: true } } },
    });
    return res.status(201).json(serializeIntervenantExpense(expense));
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/expenses/:expenseId", async (req, res, next) => {
  try {
    const payload = intervenantExpensePatchSchema.parse(req.body ?? {});
    const current = await prisma.intervenantExpense.findFirst({
      where: {
        id: req.params.expenseId,
        intervenant_id: req.params.id,
      },
    });
    if (!current) {
      return res.status(404).json({ error: "Frais d'intervenant introuvable." });
    }

    const scope = payload.scope ?? (current.scope === "gite" ? "gite" : "all_gites");
    const requestedGiteId = payload.gite_id !== undefined
      ? payload.gite_id
      : current.gite_id;
    if (scope === "gite" && !requestedGiteId) {
      return res.status(400).json({ error: "Choisissez un gîte." });
    }

    const gite = scope === "gite" && requestedGiteId
      ? await prisma.gite.findUnique({
          where: { id: requestedGiteId },
          select: { id: true, nom: true },
        })
      : null;
    if (scope === "gite" && !gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const expense = await prisma.intervenantExpense.update({
      where: { id: current.id },
      data: {
        scope,
        gite_id: gite?.id ?? null,
        gite_nom: gite?.nom ?? null,
        ...(payload.year !== undefined ? { year: payload.year } : {}),
        ...(payload.month !== undefined ? { month: payload.month } : {}),
        ...(payload.amount !== undefined ? { amount: payload.amount } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      },
      include: { gite: { select: { id: true, nom: true } } },
    });
    return res.json(serializeIntervenantExpense(expense));
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id/expenses/:expenseId", async (req, res, next) => {
  try {
    const expense = await prisma.intervenantExpense.findFirst({
      where: {
        id: req.params.expenseId,
        intervenant_id: req.params.id,
      },
      select: { id: true },
    });
    if (!expense) {
      return res.status(404).json({ error: "Frais d'intervenant introuvable." });
    }
    await prisma.intervenantExpense.delete({ where: { id: expense.id } });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const payload = intervenantPayloadSchema.partial().parse(req.body ?? {});
    const current = await prisma.planningRelayWorker.findUnique({
      where: { id: req.params.id },
    });
    if (!current) {
      return res.status(404).json({ error: "Intervenant introuvable." });
    }

    const intervenant = await prisma.planningRelayWorker.update({
      where: { id: current.id },
      data: {
        ...(payload.nom !== undefined ? { nom: payload.nom } : {}),
        ...(payload.telephone !== undefined
          ? { telephone: payload.telephone }
          : {}),
        ...(payload.email !== undefined ? { email: payload.email } : {}),
        ...(payload.adresse !== undefined ? { adresse: payload.adresse } : {}),
        ...(payload.message_channel_addresses !== undefined
          ? {
              message_channel_addresses: encodeJsonField(
                payload.message_channel_addresses,
              ),
            }
          : {}),
        ...(payload.is_active !== undefined
          ? { is_active: payload.is_active }
          : {}),
      },
    });
    return res.json(serializeIntervenant(intervenant));
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const intervenant = await prisma.planningRelayWorker.findUnique({
      where: { id: req.params.id },
    });
    if (!intervenant) {
      return res.status(404).json({ error: "Intervenant introuvable." });
    }

    const periods = await prisma.planningRelayPeriod.findMany();
    const periodsUsingIntervenant = periods.flatMap((period) => {
      const configs = normalizePlanningRelaySmsConfigs(period.sms_configs, period);
      if (!configs.some((config) => config.worker_ids.includes(intervenant.id))) {
        return [];
      }

      return [{
        period,
        configs: configs.flatMap((config) => {
          const workerIds = config.worker_ids.filter(
            (id) => id !== intervenant.id,
          );
          return workerIds.length > 0
            ? [{
                ...config,
                worker_id: workerIds[0],
                worker_ids: workerIds,
                recipient_channels: Object.fromEntries(
                  Object.entries(config.recipient_channels).filter(
                    ([workerId]) => workerId !== intervenant.id,
                  ),
                ),
              }]
            : [];
        }),
      }];
    });

    await prisma.$transaction([
      ...periodsUsingIntervenant.map(({ period, configs }) =>
        prisma.planningRelayPeriod.update({
          where: { id: period.id },
          data: { sms_configs: encodeJsonField(configs) },
        }),
      ),
      prisma.planningRelayWorker.delete({ where: { id: intervenant.id } }),
    ]);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;

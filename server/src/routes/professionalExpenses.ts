import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";

const router = Router();

const nullableId = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.string().trim().min(1).nullable(),
);

const payloadSchema = z.object({
  label: z.string().trim().min(1).max(160),
  intervenant_id: nullableId.optional(),
  scope: z.enum(["all_gites", "gite"]),
  gite_id: nullableId.optional(),
  year: z.coerce.number().int().min(2000).max(3000),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().positive().max(1_000_000),
  notes: z.string().trim().max(500).default(""),
}).superRefine((payload, context) => {
  if (payload.scope === "gite" && !payload.gite_id) {
    context.addIssue({ code: "custom", message: "Choisissez un gîte.", path: ["gite_id"] });
  }
});

const patchSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  intervenant_id: nullableId.optional(),
  scope: z.enum(["all_gites", "gite"]).optional(),
  gite_id: nullableId.optional(),
  year: z.coerce.number().int().min(2000).max(3000).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  amount: z.coerce.number().positive().max(1_000_000).optional(),
  notes: z.string().trim().max(500).optional(),
});

const include = {
  intervenant: { select: { id: true, nom: true } },
  gite: { select: { id: true, nom: true } },
} as const;

const serialize = (expense: any) => ({
  id: expense.id,
  label: expense.label,
  intervenant_id: expense.intervenant_id ?? null,
  intervenant_nom: expense.intervenant?.nom ?? expense.intervenant_nom ?? null,
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

const resolveReferences = async (intervenantId: string | null, scope: string, giteId: string | null) => {
  const [intervenant, gite] = await Promise.all([
    intervenantId
      ? prisma.planningRelayWorker.findUnique({ where: { id: intervenantId }, select: { id: true, nom: true } })
      : null,
    scope === "gite" && giteId
      ? prisma.gite.findUnique({ where: { id: giteId }, select: { id: true, nom: true } })
      : null,
  ]);
  if (intervenantId && !intervenant) throw Object.assign(new Error("Intervenant introuvable."), { status: 404 });
  if (scope === "gite" && !gite) throw Object.assign(new Error("Gîte introuvable."), { status: 404 });
  return { intervenant, gite };
};

router.get("/one-off", async (_req, res, next) => {
  try {
    const expenses = await prisma.intervenantExpense.findMany({
      include,
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
    });
    res.json(expenses.map(serialize));
  } catch (error) {
    next(error);
  }
});

router.post("/one-off", async (req, res, next) => {
  try {
    const payload = payloadSchema.parse(req.body ?? {});
    const { intervenant, gite } = await resolveReferences(
      payload.intervenant_id ?? null,
      payload.scope,
      payload.gite_id ?? null,
    );
    const expense = await prisma.intervenantExpense.create({
      data: {
        label: payload.label,
        intervenant_id: intervenant?.id ?? null,
        intervenant_nom: intervenant?.nom ?? null,
        scope: payload.scope,
        gite_id: gite?.id ?? null,
        gite_nom: gite?.nom ?? null,
        year: payload.year,
        month: payload.month,
        amount: payload.amount,
        notes: payload.notes,
      },
      include,
    });
    res.status(201).json(serialize(expense));
  } catch (error: any) {
    if (error?.status === 404) return res.status(404).json({ error: error.message });
    next(error);
  }
});

router.patch("/one-off/:id", async (req, res, next) => {
  try {
    const payload = patchSchema.parse(req.body ?? {});
    const current = await prisma.intervenantExpense.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Frais ponctuel introuvable." });
    const scope = payload.scope ?? current.scope;
    const intervenantId = payload.intervenant_id !== undefined ? payload.intervenant_id : current.intervenant_id;
    const giteId = payload.gite_id !== undefined ? payload.gite_id : current.gite_id;
    if (scope === "gite" && !giteId) return res.status(400).json({ error: "Choisissez un gîte." });
    const { intervenant, gite } = await resolveReferences(intervenantId, scope, giteId);
    const expense = await prisma.intervenantExpense.update({
      where: { id: current.id },
      data: {
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        intervenant_id: intervenant?.id ?? null,
        intervenant_nom: intervenant?.nom ?? null,
        scope,
        gite_id: gite?.id ?? null,
        gite_nom: gite?.nom ?? null,
        ...(payload.year !== undefined ? { year: payload.year } : {}),
        ...(payload.month !== undefined ? { month: payload.month } : {}),
        ...(payload.amount !== undefined ? { amount: payload.amount } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      },
      include,
    });
    res.json(serialize(expense));
  } catch (error: any) {
    if (error?.status === 404) return res.status(404).json({ error: error.message });
    next(error);
  }
});

router.delete("/one-off/:id", async (req, res, next) => {
  try {
    const current = await prisma.intervenantExpense.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!current) return res.status(404).json({ error: "Frais ponctuel introuvable." });
    await prisma.intervenantExpense.delete({ where: { id: current.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;

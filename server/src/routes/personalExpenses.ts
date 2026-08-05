import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { buildDefaultGiteExpenseCategorySettings } from "../services/giteExpenseCategorySettings.js";

const router = Router();
const colorPattern = /^#[0-9a-f]{6}$/i;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().regex(colorPattern),
});

const recurringSchema = z.object({
  gestionnaire_id: z.string().trim().min(1),
  category_id: z.string().trim().min(1),
  label: z.string().trim().min(1).max(160),
  frequency: z.enum(["monthly", "annual"]),
  amount: z.coerce.number().positive().max(10_000_000),
  start_date: z.string().regex(dateOnlyPattern),
  end_date: z.string().regex(dateOnlyPattern).nullable().optional(),
  notes: z.string().trim().max(2000).default(""),
  is_active: z.boolean().default(true),
});

const entrySchema = z.object({
  gestionnaire_id: z.string().trim().min(1),
  category_id: z.string().trim().min(1),
  label: z.string().trim().min(1).max(160),
  amount: z.coerce.number().positive().max(10_000_000),
  expense_date: z.string().regex(dateOnlyPattern),
  status: z.enum(["planned", "paid"]),
  notes: z.string().trim().max(2000).default(""),
});

const toUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isPrismaCode = (error: unknown, code: string) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === code);

const ensureDefaultCategories = async () => {
  const count = await prisma.expenseCategory.count({
    where: { scope: { in: ["both", "personal"] } },
  });
  if (count > 0) return;

  const defaults = buildDefaultGiteExpenseCategorySettings().categories;
  for (const [index, category] of defaults.entries()) {
    await prisma.expenseCategory.create({
      data: {
        id: `personal-${category.id}`,
        name: category.name,
        color: category.color,
        scope: "both",
        ordre: index,
      },
    });
  }
};

const validateReferences = async (managerId: string, categoryId: string) => {
  const [manager, category] = await Promise.all([
    prisma.gestionnaire.findUnique({ where: { id: managerId }, select: { id: true } }),
    prisma.expenseCategory.findFirst({
      where: { id: categoryId, scope: { in: ["both", "personal"] } },
      select: { id: true },
    }),
  ]);
  if (!manager) return { status: 400, error: "La personne sélectionnée est introuvable." };
  if (!category) return { status: 400, error: "La catégorie sélectionnée est introuvable." };
  return null;
};

router.get("/", async (_req, res, next) => {
  try {
    await ensureDefaultCategories();
    const [managers, categories, recurring, entries] = await Promise.all([
      prisma.gestionnaire.findMany({
        select: { id: true, prenom: true, nom: true },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      }),
      prisma.expenseCategory.findMany({
        where: { scope: { in: ["both", "personal"] } },
        orderBy: [{ ordre: "asc" }, { name: "asc" }],
      }),
      prisma.expenseRecurringRule.findMany({
        where: { scope: "personal" },
        include: {
          category: true,
          gestionnaire: { select: { id: true, prenom: true, nom: true } },
        },
        orderBy: [{ start_date: "desc" }, { label: "asc" }],
      }),
      prisma.expenseEntry.findMany({
        where: { scope: "personal" },
        include: {
          category: true,
          gestionnaire: { select: { id: true, prenom: true, nom: true } },
        },
        orderBy: [{ expense_date: "desc" }, { label: "asc" }],
      }),
    ]);
    res.json({ managers, categories, recurring, entries });
  } catch (error) {
    next(error);
  }
});

router.post("/categories", async (req, res, next) => {
  try {
    const payload = categorySchema.parse(req.body);
    const ordre = await prisma.expenseCategory.count({ where: { scope: "personal" } });
    const category = await prisma.expenseCategory.create({
      data: { ...payload, scope: "personal", ordre },
    });
    res.status(201).json(category);
  } catch (error) {
    if (isPrismaCode(error, "P2002")) return res.status(409).json({ error: "Cette catégorie existe déjà." });
    next(error);
  }
});

router.put("/categories/:id", async (req, res, next) => {
  try {
    const payload = categorySchema.parse(req.body);
    const category = await prisma.expenseCategory.findFirst({
      where: { id: req.params.id, scope: { in: ["both", "personal"] } },
    });
    if (!category) return res.status(404).json({ error: "Catégorie introuvable." });
    const updated = await prisma.expenseCategory.update({ where: { id: category.id }, data: payload });
    res.json(updated);
  } catch (error) {
    if (isPrismaCode(error, "P2002")) return res.status(409).json({ error: "Cette catégorie existe déjà." });
    next(error);
  }
});

router.delete("/categories/:id", async (req, res, next) => {
  try {
    const category = await prisma.expenseCategory.findFirst({
      where: { id: req.params.id, scope: { in: ["both", "personal"] } },
      include: { _count: { select: { recurring_rules: true, entries: true } } },
    });
    if (!category) return res.status(404).json({ error: "Catégorie introuvable." });
    const usageCount = category._count.recurring_rules + category._count.entries;
    if (usageCount > 0) {
      return res.status(409).json({ error: `Cette catégorie est utilisée par ${usageCount} frais.` });
    }
    await prisma.expenseCategory.delete({ where: { id: category.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/recurring", async (req, res, next) => {
  try {
    const payload = recurringSchema.parse(req.body);
    const referenceError = await validateReferences(payload.gestionnaire_id, payload.category_id);
    if (referenceError) return res.status(referenceError.status).json({ error: referenceError.error });
    const startDate = toUtcDate(payload.start_date);
    const endDate = payload.end_date ? toUtcDate(payload.end_date) : null;
    if (endDate && endDate < startDate) {
      return res.status(400).json({ error: "La date de fin doit suivre la date de début." });
    }
    const recurring = await prisma.expenseRecurringRule.create({
      data: {
        scope: "personal",
        gestionnaire_id: payload.gestionnaire_id,
        category_id: payload.category_id,
        label: payload.label,
        frequency: payload.frequency,
        amount: payload.amount,
        start_date: startDate,
        end_date: endDate,
        notes: payload.notes,
        is_active: payload.is_active,
      },
      include: { category: true, gestionnaire: true },
    });
    res.status(201).json(recurring);
  } catch (error) {
    next(error);
  }
});

router.put("/recurring/:id", async (req, res, next) => {
  try {
    const payload = recurringSchema.parse(req.body);
    const existing = await prisma.expenseRecurringRule.findFirst({
      where: { id: req.params.id, scope: "personal" },
    });
    if (!existing) return res.status(404).json({ error: "Frais récurrent introuvable." });
    const referenceError = await validateReferences(payload.gestionnaire_id, payload.category_id);
    if (referenceError) return res.status(referenceError.status).json({ error: referenceError.error });
    const startDate = toUtcDate(payload.start_date);
    const endDate = payload.end_date ? toUtcDate(payload.end_date) : null;
    if (endDate && endDate < startDate) {
      return res.status(400).json({ error: "La date de fin doit suivre la date de début." });
    }
    const recurring = await prisma.expenseRecurringRule.update({
      where: { id: existing.id },
      data: {
        gestionnaire_id: payload.gestionnaire_id,
        category_id: payload.category_id,
        label: payload.label,
        frequency: payload.frequency,
        amount: payload.amount,
        start_date: startDate,
        end_date: endDate,
        notes: payload.notes,
        is_active: payload.is_active,
      },
      include: { category: true, gestionnaire: true },
    });
    res.json(recurring);
  } catch (error) {
    next(error);
  }
});

router.delete("/recurring/:id", async (req, res, next) => {
  try {
    const result = await prisma.expenseRecurringRule.deleteMany({
      where: { id: req.params.id, scope: "personal" },
    });
    if (result.count === 0) return res.status(404).json({ error: "Frais récurrent introuvable." });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/entries", async (req, res, next) => {
  try {
    const payload = entrySchema.parse(req.body);
    const referenceError = await validateReferences(payload.gestionnaire_id, payload.category_id);
    if (referenceError) return res.status(referenceError.status).json({ error: referenceError.error });
    const entry = await prisma.expenseEntry.create({
      data: {
        scope: "personal",
        gestionnaire_id: payload.gestionnaire_id,
        category_id: payload.category_id,
        label: payload.label,
        amount: payload.amount,
        expense_date: toUtcDate(payload.expense_date),
        status: payload.status,
        notes: payload.notes,
      },
      include: { category: true, gestionnaire: true },
    });
    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
});

router.put("/entries/:id", async (req, res, next) => {
  try {
    const payload = entrySchema.parse(req.body);
    const existing = await prisma.expenseEntry.findFirst({
      where: { id: req.params.id, scope: "personal" },
    });
    if (!existing) return res.status(404).json({ error: "Dépense ponctuelle introuvable." });
    const referenceError = await validateReferences(payload.gestionnaire_id, payload.category_id);
    if (referenceError) return res.status(referenceError.status).json({ error: referenceError.error });
    const entry = await prisma.expenseEntry.update({
      where: { id: existing.id },
      data: {
        gestionnaire_id: payload.gestionnaire_id,
        category_id: payload.category_id,
        label: payload.label,
        amount: payload.amount,
        expense_date: toUtcDate(payload.expense_date),
        status: payload.status,
        notes: payload.notes,
      },
      include: { category: true, gestionnaire: true },
    });
    res.json(entry);
  } catch (error) {
    next(error);
  }
});

router.delete("/entries/:id", async (req, res, next) => {
  try {
    const result = await prisma.expenseEntry.deleteMany({
      where: { id: req.params.id, scope: "personal" },
    });
    if (result.count === 0) return res.status(404).json({ error: "Dépense ponctuelle introuvable." });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;

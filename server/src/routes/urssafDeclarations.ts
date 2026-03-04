import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";

const router = Router();

const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
});

const declarationListSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

const declarationSchema = periodSchema.extend({
  manager_id: z.string().trim().min(1),
  amount: z.coerce.number().finite().min(0).default(0),
});

router.get("/", async (req, res, next) => {
  try {
    const { year, month } = declarationListSchema.parse(req.query);
    const declarations = await prisma.urssafDeclaration.findMany({
      where: month ? { year, month } : { year },
      select: {
        year: true,
        month: true,
        gestionnaire_id: true,
        amount: true,
        declared_at: true,
      },
      orderBy: [{ month: "asc" }, { gestionnaire_id: "asc" }],
    });

    res.json(
      declarations.map((item) => ({
        year: item.year,
        month: item.month,
        manager_id: item.gestionnaire_id,
        amount: Number(item.amount ?? 0),
        declared_at: item.declared_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = declarationSchema.parse(req.body);
    const existingManager = await prisma.gestionnaire.findUnique({
      where: { id: payload.manager_id },
      select: { id: true },
    });
    if (!existingManager) {
      return res.status(404).json({ error: "Gestionnaire introuvable." });
    }

    const now = new Date();
    const saved = await prisma.urssafDeclaration.upsert({
      where: {
        year_month_gestionnaire_id: {
          year: payload.year,
          month: payload.month,
          gestionnaire_id: payload.manager_id,
        },
      },
      create: {
        year: payload.year,
        month: payload.month,
        gestionnaire_id: payload.manager_id,
        amount: payload.amount,
        declared_at: now,
      },
      update: {
        amount: payload.amount,
        declared_at: now,
      },
      select: {
        year: true,
        month: true,
        gestionnaire_id: true,
        amount: true,
        declared_at: true,
      },
    });

    res.json({
      year: saved.year,
      month: saved.month,
      manager_id: saved.gestionnaire_id,
      amount: Number(saved.amount ?? 0),
      declared_at: saved.declared_at,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

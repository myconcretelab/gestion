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
  gite_id: z.string().trim().min(1),
  guest_nights: z.coerce.number().int().min(0).default(0),
});

router.get("/", async (req, res, next) => {
  try {
    const { year, month } = declarationListSchema.parse(req.query);
    const declarations = await prisma.guestNightDeclaration.findMany({
      where: month ? { year, month } : { year },
      select: {
        year: true,
        month: true,
        gite_id: true,
        guest_nights: true,
        declared_at: true,
      },
      orderBy: [{ month: "asc" }, { gite_id: "asc" }],
    });

    res.json(
      declarations.map((item) => ({
        year: item.year,
        month: item.month,
        gite_id: item.gite_id,
        guest_nights: Number(item.guest_nights ?? 0),
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
    const existingGite = await prisma.gite.findUnique({
      where: { id: payload.gite_id },
      select: { id: true },
    });
    if (!existingGite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const now = new Date();
    const saved = await prisma.guestNightDeclaration.upsert({
      where: {
        year_month_gite_id: {
          year: payload.year,
          month: payload.month,
          gite_id: payload.gite_id,
        },
      },
      create: {
        year: payload.year,
        month: payload.month,
        gite_id: payload.gite_id,
        guest_nights: payload.guest_nights,
        declared_at: now,
      },
      update: {
        guest_nights: payload.guest_nights,
        declared_at: now,
      },
      select: {
        year: true,
        month: true,
        gite_id: true,
        guest_nights: true,
        declared_at: true,
      },
    });

    res.json({
      year: saved.year,
      month: saved.month,
      gite_id: saved.gite_id,
      guest_nights: Number(saved.guest_nights ?? 0),
      declared_at: saved.declared_at,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";

const router = Router();

const managerSchema = z.object({
  prenom: z.string().trim().min(1),
  nom: z.string().trim().min(1),
});

const formatManager = (manager: any) => ({
  ...manager,
  gites_count: typeof manager?._count?.gites === "number" ? manager._count.gites : manager.gites_count ?? 0,
});

router.get("/", async (_req, res, next) => {
  try {
    const managers = await prisma.gestionnaire.findMany({
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      include: { _count: { select: { gites: true } } },
    });
    res.json(managers.map(formatManager));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = managerSchema.parse(req.body);
    const existing = await prisma.gestionnaire.findFirst({
      where: { prenom: payload.prenom, nom: payload.nom },
    });
    if (existing) {
      return res.status(409).json({ error: "Ce gestionnaire existe déjà." });
    }

    const manager = await prisma.gestionnaire.create({
      data: payload,
      include: { _count: { select: { gites: true } } },
    });
    res.status(201).json(formatManager(manager));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const manager = await prisma.gestionnaire.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { gites: true } } },
    });

    if (!manager) return res.status(404).json({ error: "Gestionnaire introuvable." });
    if ((manager._count?.gites ?? 0) > 0) {
      return res
        .status(409)
        .json({ error: `Ce gestionnaire est associé à ${manager._count.gites} gîte(s).` });
    }

    await prisma.gestionnaire.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

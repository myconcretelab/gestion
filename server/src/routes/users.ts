import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { getAuthenticatedAppUser } from "../services/serverAuth.js";
import { ensureAppUsersInitialized, serializeAppUser } from "../services/appUsers.js";

const router = Router();

const nullableId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.string().min(1).nullable(),
);

const userSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  gestionnaireId: nullableId.optional().default(null),
  canWrite: z.boolean().default(false),
  canViewAmounts: z.boolean().default(false),
  isOwner: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const requireOwner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    if (!user?.permissions.isOwner) {
      return res.status(403).json({
        error: "Le privilège propriétaire est requis pour gérer les utilisateurs.",
        code: "OWNER_REQUIRED",
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

router.use(requireOwner);

router.get("/", async (_req, res, next) => {
  try {
    await ensureAppUsersInitialized();
    const users = await prisma.appUser.findMany({
      orderBy: [{ is_active: "desc" }, { display_name: "asc" }],
      include: {
        gestionnaire: {
          include: { _count: { select: { gites: true } } },
        },
      },
    });
    res.json(users.map((user) => ({
      ...serializeAppUser(user),
      gestionnaire: user.gestionnaire
        ? {
            id: user.gestionnaire.id,
            prenom: user.gestionnaire.prenom,
            nom: user.gestionnaire.nom,
            gitesCount: user.gestionnaire._count.gites,
          }
        : null,
    })));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = userSchema.parse(req.body);
    const user = await prisma.appUser.create({
      data: {
        display_name: payload.displayName,
        gestionnaire_id: payload.gestionnaireId,
        can_write: payload.canWrite,
        can_view_amounts: payload.canViewAmounts,
        is_owner: payload.isOwner,
        is_active: payload.isActive,
      },
    });
    res.status(201).json(serializeAppUser(user));
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const payload = userSchema.parse(req.body);
    const currentUser = await getAuthenticatedAppUser(req);
    const existing = await prisma.appUser.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Utilisateur introuvable." });

    if (currentUser?.id === existing.id && !payload.isActive) {
      return res.status(409).json({ error: "Vous ne pouvez pas désactiver votre propre compte." });
    }

    if (existing.is_owner && existing.is_active && (!payload.isOwner || !payload.isActive)) {
      const otherActiveOwners = await prisma.appUser.count({
        where: { is_owner: true, is_active: true, id: { not: existing.id } },
      });
      if (otherActiveOwners === 0) {
        return res.status(409).json({ error: "Au moins un propriétaire actif doit être conservé." });
      }
    }

    const user = await prisma.appUser.update({
      where: { id: existing.id },
      data: {
        display_name: payload.displayName,
        gestionnaire_id: payload.gestionnaireId,
        can_write: payload.canWrite,
        can_view_amounts: payload.canViewAmounts,
        is_owner: payload.isOwner,
        is_active: payload.isActive,
      },
    });
    res.json(serializeAppUser(user));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const currentUser = await getAuthenticatedAppUser(req);
    if (currentUser?.id === req.params.id) {
      return res.status(409).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
    }
    const existing = await prisma.appUser.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (existing.is_owner && existing.is_active) {
      const otherActiveOwners = await prisma.appUser.count({
        where: { is_owner: true, is_active: true, id: { not: existing.id } },
      });
      if (otherActiveOwners === 0) {
        return res.status(409).json({ error: "Au moins un propriétaire actif doit être conservé." });
      }
    }
    await prisma.appUser.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;

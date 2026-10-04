import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { getAuthenticatedAppUser } from "../services/serverAuth.js";
import {
  APP_PAGE_IDS,
  ensureAppUsersInitialized,
  listStatusPresets,
  normalizeAppUserStatus,
  serializeAppUser,
  serializeStatusPreset,
} from "../services/appUsers.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";

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
  status: z.enum(["owner", "worker", "custom"]).default("custom"),
  pageAccess: z.array(z.enum(APP_PAGE_IDS)).default([]),
  isOwner: z.boolean().optional(),
  isActive: z.boolean().default(true),
  workerProfile: z.object({
    telephone: z.string().trim().min(1).max(32),
    email: z.string().trim().email().max(180).nullable().optional(),
    adresse: z.string().trim().max(500).nullable().optional(),
    telegramChatId: z.string().trim().max(180).nullable().optional(),
    hourlyRate: z.coerce.number().min(0).max(10_000).default(0),
    showOnToday: z.boolean().default(true),
  }).nullable().optional(),
});

const statusPresetSchema = z.object({
  canWrite: z.boolean(),
  canViewAmounts: z.boolean(),
  pageAccess: z.array(z.enum(APP_PAGE_IDS)),
});

const resolvedPermissions = (payload: z.infer<typeof userSchema>) => {
  const status = normalizeAppUserStatus(payload.status);
  const isOwner = status === "owner";
  return {
    status,
    isOwner,
    canWrite: isOwner ? true : payload.canWrite,
    canViewAmounts: isOwner ? true : payload.canViewAmounts,
    pageAccess: isOwner ? [...APP_PAGE_IDS] : payload.pageAccess,
  };
};

const workerData = (displayName: string, isActive: boolean, profile: NonNullable<z.infer<typeof userSchema>["workerProfile"]>) => ({
  nom: displayName,
  telephone: profile.telephone,
  email: profile.email ?? null,
  adresse: profile.adresse ?? null,
  message_channel_addresses: encodeJsonField({
    sms: profile.telephone,
    ...(profile.telegramChatId ? { telegram: profile.telegramChatId } : {}),
  }),
  is_active: isActive,
  show_on_today: profile.showOnToday,
  hourly_rate: profile.hourlyRate,
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

router.get("/status-presets", async (_req, res, next) => {
  try {
    res.json(await listStatusPresets());
  } catch (error) {
    next(error);
  }
});

router.put("/status-presets/:status", async (req, res, next) => {
  try {
    const status = z.enum(["worker", "custom"]).parse(req.params.status);
    const payload = statusPresetSchema.parse(req.body);
    const pageAccess = APP_PAGE_IDS.filter((page) => payload.pageAccess.includes(page));
    const preset = await prisma.$transaction(async (tx) => {
      const row = await tx.appUserStatusPreset.upsert({
        where: { status },
        update: {
          can_write: payload.canWrite,
          can_view_amounts: payload.canViewAmounts,
          page_access: encodeJsonField(pageAccess),
        },
        create: {
          status,
          can_write: payload.canWrite,
          can_view_amounts: payload.canViewAmounts,
          page_access: encodeJsonField(pageAccess),
        },
      });
      await tx.appUser.updateMany({
        where: { status, is_owner: false },
        data: {
          can_write: payload.canWrite,
          can_view_amounts: payload.canViewAmounts,
          page_access: encodeJsonField(pageAccess),
        },
      });
      return row;
    });
    res.json(serializeStatusPreset(preset));
  } catch (error) {
    next(error);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    await ensureAppUsersInitialized();
    const users = await prisma.appUser.findMany({
      orderBy: [{ is_active: "desc" }, { display_name: "asc" }],
      include: {
        gestionnaire: {
          include: { _count: { select: { gites: true } } },
        },
        intervenant: true,
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
      intervenant: user.intervenant
        ? {
            id: user.intervenant.id,
            telephone: user.intervenant.telephone,
            email: user.intervenant.email ?? null,
            adresse: user.intervenant.adresse ?? null,
            telegramChatId: fromJsonString<Record<string, string>>(user.intervenant.message_channel_addresses, {}).telegram ?? null,
            hourlyRate: Number(user.intervenant.hourly_rate ?? 0),
            showOnToday: Boolean(user.intervenant.show_on_today),
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
    const permissions = resolvedPermissions(payload);
    if (permissions.status === "worker" && !payload.workerProfile) {
      return res.status(400).json({ error: "Les coordonnées de l’intervenant sont requises." });
    }
    const user = await prisma.$transaction(async (tx) => {
      const worker = payload.workerProfile
        ? await tx.planningRelayWorker.create({ data: workerData(payload.displayName, payload.isActive, payload.workerProfile) })
        : null;
      return tx.appUser.create({ data: {
        display_name: payload.displayName,
        gestionnaire_id: payload.gestionnaireId,
        intervenant_id: worker?.id ?? null,
        status: permissions.status,
        page_access: encodeJsonField(permissions.pageAccess),
        can_write: permissions.canWrite,
        can_view_amounts: permissions.canViewAmounts,
        is_owner: permissions.isOwner,
        is_active: payload.isActive,
      }});
    });
    res.status(201).json(serializeAppUser(user));
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const payload = userSchema.parse(req.body);
    const permissions = resolvedPermissions(payload);
    const currentUser = await getAuthenticatedAppUser(req);
    const existing = await prisma.appUser.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Utilisateur introuvable." });

    if (currentUser?.id === existing.id && !payload.isActive) {
      return res.status(409).json({ error: "Vous ne pouvez pas désactiver votre propre compte." });
    }

    if (existing.is_owner && existing.is_active && (!permissions.isOwner || !payload.isActive)) {
      const otherActiveOwners = await prisma.appUser.count({
        where: { is_owner: true, is_active: true, id: { not: existing.id } },
      });
      if (otherActiveOwners === 0) {
        return res.status(409).json({ error: "Au moins un propriétaire actif doit être conservé." });
      }
    }

    if (permissions.status === "worker" && !payload.workerProfile) {
      return res.status(400).json({ error: "Les coordonnées de l’intervenant sont requises." });
    }
    const user = await prisma.$transaction(async (tx) => {
      let intervenantId = existing.intervenant_id;
      if (payload.workerProfile) {
        if (intervenantId) {
          await tx.planningRelayWorker.update({ where: { id: intervenantId }, data: workerData(payload.displayName, payload.isActive, payload.workerProfile) });
        } else {
          const worker = await tx.planningRelayWorker.create({ data: workerData(payload.displayName, payload.isActive, payload.workerProfile) });
          intervenantId = worker.id;
        }
      }
      return tx.appUser.update({ where: { id: existing.id }, data: {
        display_name: payload.displayName,
        gestionnaire_id: payload.gestionnaireId,
        intervenant_id: intervenantId,
        status: permissions.status,
        page_access: encodeJsonField(permissions.pageAccess),
        can_write: permissions.canWrite,
        can_view_amounts: permissions.canViewAmounts,
        is_owner: permissions.isOwner,
        is_active: payload.isActive,
      }});
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

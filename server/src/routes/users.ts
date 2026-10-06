import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { getAuthenticatedAppUser } from "../services/serverAuth.js";
import {
  APP_PAGE_IDS,
  APP_USER_ROLES,
  ensureAppUsersInitialized,
  listStatusPresets,
  serializeAppUser,
  serializeStatusPreset,
} from "../services/appUsers.js";
import { encodeJsonField } from "../utils/jsonFields.js";

const router = Router();

const userSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(""),
  roles: z.array(z.enum(APP_USER_ROLES)).optional(),
  telephone: z.string().trim().max(32).default(""),
  email: z.preprocess((value) => value === "" ? null : value, z.string().trim().email().max(180).nullable()).optional(),
  adresse: z.preprocess((value) => value === "" ? null : value, z.string().trim().max(500).nullable()).optional(),
  telegramChatId: z.preprocess((value) => value === "" ? null : value, z.string().trim().max(180).nullable()).optional(),
  hourlyRate: z.coerce.number().min(0).max(10_000).default(0),
  cleaningCheckRate: z.coerce.number().min(0).max(10_000).default(0),
  fullCleaningRate: z.coerce.number().min(0).max(10_000).default(0),
  canWrite: z.boolean().default(false),
  canViewAmounts: z.boolean().default(false),
  status: z.enum(["owner", "worker", "custom"]).optional(),
  pageAccess: z.array(z.enum(APP_PAGE_IDS)).default([]),
  isOwner: z.boolean().optional(),
  isActive: z.boolean().default(true),
  workerProfile: z.object({
    showOnToday: z.boolean().default(true),
  }).nullable().optional(),
});

const statusPresetSchema = z.object({
  canWrite: z.boolean(),
  canViewAmounts: z.boolean(),
  pageAccess: z.array(z.enum(APP_PAGE_IDS)),
});

const resolvedPermissions = (payload: z.infer<typeof userSchema>) => {
  const legacyRoles = payload.status === "owner"
    ? ["owner"] as const
    : payload.status === "worker"
      ? ["worker"] as const
      : [];
  const requestedRoles: readonly string[] = payload.roles ?? legacyRoles;
  const roles = APP_USER_ROLES.filter((role) => requestedRoles.includes(role));
  const isOwner = roles.includes("owner");
  const status = isOwner ? "owner" : roles.includes("worker") ? "worker" : "custom";
  return {
    roles,
    status,
    isOwner,
    canWrite: isOwner ? true : payload.canWrite,
    canViewAmounts: isOwner ? true : payload.canViewAmounts,
    pageAccess: isOwner ? [...APP_PAGE_IDS] : payload.pageAccess,
  };
};

const workerData = (
  displayName: string,
  isActive: boolean,
  contacts: Pick<z.infer<typeof userSchema>, "telephone" | "email" | "adresse" | "hourlyRate">,
  profile: NonNullable<z.infer<typeof userSchema>["workerProfile"]>,
) => ({
  nom: displayName,
  telephone: contacts.telephone,
  email: contacts.email ?? null,
  adresse: contacts.adresse ?? null,
  message_channel_addresses: encodeJsonField({ sms: contacts.telephone }),
  is_active: isActive,
  show_on_today: profile.showOnToday,
  hourly_rate: contacts.hourlyRate,
});

const displayNameFor = (payload: Pick<z.infer<typeof userSchema>, "firstName" | "lastName">) =>
  [payload.firstName, payload.lastName].filter(Boolean).join(" ");

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

router.get("/owners", async (_req, res, next) => {
  try {
    await ensureAppUsersInitialized();
    const owners = await prisma.appUser.findMany({
      where: {
        status: "owner",
        is_owner: true,
        is_active: true,
        gestionnaire_id: { not: null },
      },
      orderBy: [{ first_name: "asc" }, { last_name: "asc" }],
    });
    res.json(owners.map((owner) => {
      const user = serializeAppUser(owner);
      return {
        id: user.id,
        displayName: user.displayName,
        firstName: user.firstName,
        lastName: user.lastName,
        gestionnaireId: user.gestionnaireId,
      };
    }));
  } catch (error) {
    next(error);
  }
});

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
    const displayName = displayNameFor(payload);
    if (permissions.roles.includes("worker") && (!payload.workerProfile || !payload.telephone)) {
      return res.status(400).json({ error: "Le téléphone et les informations de l’intervenant sont requis." });
    }

    const matchingManager = permissions.isOwner
      ? await prisma.gestionnaire.findUnique({
          where: { prenom_nom: { prenom: payload.firstName, nom: payload.lastName } },
          include: { app_user: { select: { id: true } } },
        })
      : null;
    if (matchingManager?.app_user) {
      return res.status(409).json({ error: "Un utilisateur est déjà associé à ce propriétaire." });
    }

    const user = await prisma.$transaction(async (tx) => {
      const worker = permissions.roles.includes("worker") && payload.workerProfile
        ? await tx.planningRelayWorker.create({ data: workerData(displayName, payload.isActive, payload, payload.workerProfile) })
        : null;
      const manager = permissions.isOwner
        ? matchingManager ?? await tx.gestionnaire.create({ data: { prenom: payload.firstName, nom: payload.lastName } })
        : null;
      return tx.appUser.create({ data: {
        display_name: displayName,
        first_name: payload.firstName,
        last_name: payload.lastName,
        roles: encodeJsonField(permissions.roles),
        telephone: payload.telephone || null,
        email: payload.email ?? null,
        adresse: payload.adresse ?? null,
        telegram_chat_id: payload.telegramChatId ?? null,
        hourly_rate: payload.hourlyRate,
        cleaning_check_rate: payload.cleaningCheckRate,
        full_cleaning_rate: payload.fullCleaningRate,
        gestionnaire_id: manager?.id ?? null,
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
    const displayName = displayNameFor(payload);
    const currentUser = await getAuthenticatedAppUser(req);
    const existing = await prisma.appUser.findUnique({
      where: { id: req.params.id },
      include: {
        gestionnaire: { include: { _count: { select: { gites: true } } } },
      },
    });
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

    if (existing.gestionnaire?._count.gites && (!permissions.isOwner || !payload.isActive)) {
      return res.status(409).json({
        error: `Cet utilisateur est propriétaire de ${existing.gestionnaire._count.gites} gîte(s). Réattribuez-les avant de modifier son statut ou de le désactiver.`,
      });
    }

    if (permissions.roles.includes("worker") && (!payload.workerProfile || !payload.telephone)) {
      return res.status(400).json({ error: "Le téléphone et les informations de l’intervenant sont requis." });
    }


    const matchingManager = await prisma.gestionnaire.findUnique({
      where: { prenom_nom: { prenom: payload.firstName, nom: payload.lastName } },
      include: { app_user: { select: { id: true } } },
    });
    if (matchingManager && matchingManager.id !== existing.gestionnaire_id) {
      if (existing.gestionnaire_id || !permissions.isOwner || matchingManager.app_user) {
        return res.status(409).json({ error: "Une autre personne utilise déjà ce prénom et ce nom." });
      }
    }

    const user = await prisma.$transaction(async (tx) => {
      let intervenantId = existing.intervenant_id;
      if (permissions.roles.includes("worker") && payload.workerProfile) {
        if (intervenantId) {
          await tx.planningRelayWorker.update({ where: { id: intervenantId }, data: workerData(displayName, payload.isActive, payload, payload.workerProfile) });
        } else {
          const worker = await tx.planningRelayWorker.create({ data: workerData(displayName, payload.isActive, payload, payload.workerProfile) });
          intervenantId = worker.id;
        }
      } else if (intervenantId) {
        await tx.planningRelayWorker.update({
          where: { id: intervenantId },
          data: {
            nom: displayName,
            telephone: payload.telephone || existing.telephone || "Non renseigné",
            email: payload.email ?? null,
            adresse: payload.adresse ?? null,
            message_channel_addresses: encodeJsonField({ sms: payload.telephone }),
            is_active: false,
          },
        });
      }
      let gestionnaireId = existing.gestionnaire_id;
      if (gestionnaireId) {
        await tx.gestionnaire.update({
          where: { id: gestionnaireId },
          data: { prenom: payload.firstName, nom: payload.lastName },
        });
      } else if (permissions.isOwner) {
        const manager = matchingManager
          ?? await tx.gestionnaire.create({ data: { prenom: payload.firstName, nom: payload.lastName } });
        gestionnaireId = manager.id;
      }
      return tx.appUser.update({ where: { id: existing.id }, data: {
        display_name: displayName,
        first_name: payload.firstName,
        last_name: payload.lastName,
        roles: encodeJsonField(permissions.roles),
        telephone: payload.telephone || null,
        email: payload.email ?? null,
        adresse: payload.adresse ?? null,
        telegram_chat_id: payload.telegramChatId ?? null,
        hourly_rate: payload.hourlyRate,
        cleaning_check_rate: payload.cleaningCheckRate,
        full_cleaning_rate: payload.fullCleaningRate,
        gestionnaire_id: gestionnaireId,
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
    const existing = await prisma.appUser.findUnique({
      where: { id: req.params.id },
      include: { gestionnaire: { include: { _count: { select: { gites: true } } } } },
    });
    if (!existing) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (existing.gestionnaire?._count.gites) {
      return res.status(409).json({
        error: `Cet utilisateur est propriétaire de ${existing.gestionnaire._count.gites} gîte(s). Réattribuez-les avant de le supprimer.`,
      });
    }
    if (existing.gestionnaire_id || existing.intervenant_id) {
      return res.status(409).json({
        error: "Cet utilisateur est lié à des données de gestion. Désactivez son compte pour conserver son historique.",
      });
    }
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

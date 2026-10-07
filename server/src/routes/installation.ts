import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { createFirstAdministrator } from "../services/serverAuth.js";
import {
  completeInstallation,
  getInstallationConfig,
  organizationProfileSchema,
} from "../services/installationConfig.js";
import { generateIcalExportToken } from "../utils/reservationOrigin.js";
import { provisionGlobalIdentityForProfile } from "../services/globalIdentity.js";

const router = Router();

const setupSchema = z.object({
  administrator: z.object({
    displayName: z.string().trim().min(1).max(160),
    email: z.union([z.literal(""), z.string().trim().email()]).optional(),
    loginId: z.string().trim().min(1).max(180),
    password: z.string().min(12).max(1024),
  }),
  organization: organizationProfileSchema,
  modules: z.record(z.string(), z.boolean()),
  firstGite: z.object({
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().min(1).max(240),
    capacity: z.number().int().min(1).max(100),
    contractPrefix: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9_-]+$/),
  }),
});

const safePublicConfig = async () => {
  const config = await getInstallationConfig();
  return {
    setupComplete: config.setupComplete,
    organization: {
      tradeName: config.organization.tradeName,
      publicDisplayName: config.organization.publicDisplayName || config.organization.tradeName,
      logoUrl: config.organization.logoUrl,
      faviconUrl: config.organization.faviconUrl,
      primaryColor: config.organization.primaryColor,
      locale: config.organization.locale,
      country: config.organization.country,
      currency: config.organization.currency,
      timezone: config.organization.timezone,
      website: config.organization.website,
    },
    modules: config.modules,
  };
};

router.get("/public-config", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await safePublicConfig());
  } catch (error) {
    next(error);
  }
});

router.post("/setup", async (req, res, next) => {
  try {
    const config = await getInstallationConfig();
    if (config.setupComplete) return res.status(409).json({ error: "Installation déjà configurée.", code: "SETUP_ALREADY_COMPLETED" });
    const suppliedToken = String(req.headers["x-setup-token"] ?? "");
    if (!env.SETUP_TOKEN || suppliedToken.length !== env.SETUP_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(env.SETUP_TOKEN))) {
      return res.status(403).json({ error: "Jeton d'installation invalide.", code: "SETUP_TOKEN_REQUIRED" });
    }
    const payload = setupSchema.parse(req.body);
    const giteCount = await prisma.gite.count();
    if (giteCount > 0) return res.status(409).json({ error: "Une installation contenant déjà des hébergements doit utiliser la migration existante.", code: "SETUP_DATA_PRESENT" });

    const administrator = await createFirstAdministrator(payload.administrator);
    await provisionGlobalIdentityForProfile(administrator.id);
    const organization = payload.organization;
    await prisma.gite.create({
      data: {
        nom: payload.firstGite.name,
        prefixe_contrat: payload.firstGite.contractPrefix.toUpperCase(),
        adresse_ligne1: payload.firstGite.address,
        capacite_max: payload.firstGite.capacity,
        nb_adultes_max: payload.firstGite.capacity,
        nb_adultes_habituel: payload.firstGite.capacity,
        proprietaires_noms: organization.legalName,
        proprietaires_adresse: [organization.addressLine1, organization.addressLine2, `${organization.postalCode} ${organization.city}`.trim()].filter(Boolean).join(", "),
        site_web: organization.website || null,
        email: organization.email || null,
        telephones: JSON.stringify(organization.phone ? [organization.phone] : []),
        taxe_sejour_par_personne_par_nuit: 0,
        iban: organization.iban,
        bic: organization.bic || null,
        titulaire: organization.bankAccountHolder || organization.legalName,
        ical_export_token: generateIcalExportToken(),
      },
    });
    const result = await completeInstallation(organization, payload.modules);
    res.status(201).json({ ...result, smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_FROM) });
  } catch (error) {
    next(error);
  }
});

export default router;

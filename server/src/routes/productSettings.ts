import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import {
  getInstallationConfig,
  saveModuleSettings,
  saveOrganizationProfile,
} from "../services/installationConfig.js";
import { env } from "../config/env.js";
import fs from "node:fs";
import path from "node:path";
import { readDocumentEmailTemplateSettings } from "../services/documentEmailTemplateSettings.js";
import { versionDocumentEmailTemplates } from "../services/contentTemplateVersions.js";

const router = Router();

router.get("/organization", async (_req, res, next) => {
  try { res.json((await getInstallationConfig()).organization); } catch (error) { next(error); }
});
router.put("/organization", async (req, res, next) => {
  try { res.json(await saveOrganizationProfile(req.body)); } catch (error) { next(error); }
});
router.get("/modules", async (_req, res, next) => {
  try { res.json((await getInstallationConfig()).modules); } catch (error) { next(error); }
});
router.put("/modules", async (req, res, next) => {
  try { res.json(await saveModuleSettings(req.body)); } catch (error) { next(error); }
});

router.get("/overview/:section", async (req, res, next) => {
  try {
    const section = z.enum(["accommodations", "documents", "channels", "connections", "team", "data", "system"]).parse(req.params.section);
    const config = await getInstallationConfig();
    if (section === "accommodations") return res.json({ gites: await prisma.gite.count(), endpoint: "/api/gites" });
    if (section === "documents") return res.json({ versions: await prisma.contentTemplateVersion.count(), endpoint: "/api/settings/document-templates" });
    if (section === "channels") return res.json({ modules: { sms: config.modules.sms, telegram: config.modules.telegram, dailyEmail: config.modules.daily_email }, smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_FROM) });
    if (section === "connections") return res.json({ modules: { webPublication: config.modules.web_publication, ical: config.modules.ical, pumpAirbnb: config.modules.pump_airbnb, smartLife: config.modules.smart_life } });
    if (section === "team") return res.json({ users: await prisma.appUser.count(), activeUsers: await prisma.appUser.count({ where: { is_active: true } }), endpoint: "/api/users" });
    if (section === "data") {
      const assetRoots = ["pdfs", "uploads", "signed", "photos"];
      return res.json({ database: process.env.DATABASE_URL?.startsWith("file:") ? "sqlite" : "postgresql", assetRoots: assetRoots.filter((name) => fs.existsSync(path.join(env.DATA_DIR, name))), secretsExported: false });
    }
    return res.json({ node: process.version, environment: env.NODE_ENV, database: process.env.DATABASE_URL?.startsWith("file:") ? "sqlite" : "postgresql", setupComplete: config.setupComplete });
  } catch (error) { next(error); }
});

const templateSchema = z.object({
  templateKey: z.string().trim().min(1).max(100).regex(/^[a-z0-9_.-]+$/),
  subject: z.string().max(500).nullable().optional(),
  content: z.string().min(1).max(200_000),
});

router.get("/document-templates", async (_req, res, next) => {
  try {
    await versionDocumentEmailTemplates(readDocumentEmailTemplateSettings());
    res.json(await prisma.contentTemplateVersion.findMany({ orderBy: [{ template_key: "asc" }, { version: "desc" }] }));
  } catch (error) { next(error); }
});

router.post("/document-templates", async (req, res, next) => {
  try {
    const payload = templateSchema.parse(req.body);
    const latest = await prisma.contentTemplateVersion.findFirst({ where: { template_key: payload.templateKey }, orderBy: { version: "desc" } });
    const created = await prisma.$transaction(async (tx) => {
      await tx.contentTemplateVersion.updateMany({ where: { template_key: payload.templateKey }, data: { is_active: false } });
      return tx.contentTemplateVersion.create({ data: {
        template_key: payload.templateKey,
        version: (latest?.version ?? 0) + 1,
        subject: payload.subject ?? null,
        content: payload.content,
        is_active: true,
      } });
    });
    res.status(201).json(created);
  } catch (error) { next(error); }
});

export default router;

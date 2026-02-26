import { Router } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { computeTotals, type OptionsInput } from "../services/contractCalculator.js";
import { generateInvoiceNumber } from "../services/invoiceNumber.js";
import {
  generateInvoicePdf,
  generateInvoicePreviewHtml,
  type InvoiceRenderInput,
} from "../services/pdfService.js";
import { toNumber, round2 } from "../utils/money.js";
import { getPdfPaths } from "../utils/paths.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";
import {
  addDays,
  buildDocumentListWhere,
  ensureValidDate,
  getLatestTemplateMtimeMs,
  hydrateGite,
  normalizeOptions,
  optionalDateString,
  optionsSchema,
  parseDate,
} from "./shared/rentalDocument.js";

const router = Router();

const invoiceSchema = z.object({
  gite_id: z.string().min(1),
  locataire_nom: z.string().min(1),
  locataire_adresse: z.string().optional().default(""),
  locataire_tel: z.string().min(1),
  nb_adultes: z.number().int().min(1),
  nb_enfants_2_17: z.number().int().min(0),
  date_debut: z.string().min(1),
  heure_arrivee: z.string().min(1),
  date_fin: z.string().min(1),
  heure_depart: z.string().min(1),
  prix_par_nuit: z.number().min(0),
  remise_montant: z.number().min(0).default(0),
  options: optionsSchema.default({}),
  arrhes_montant: z.number().min(0).optional(),
  arrhes_date_limite: z.string().min(1),
  caution_montant: z.number().min(0),
  cheque_menage_montant: z.number().min(0),
  afficher_caution_phrase: z.boolean().optional().default(true),
  afficher_cheque_menage_phrase: z.boolean().optional().default(true),
  clauses: z.record(z.any()).optional(),
  notes: z.string().optional().nullable(),
  statut_paiement: z.enum(["non_reglee", "reglee"]).optional(),
});

const paymentStatusSchema = z.object({
  statut_paiement: z.enum(["non_reglee", "reglee"]),
});

const previewSchema = z.object({
  gite_id: z.string().min(1),
  locataire_nom: z.string().optional().default(""),
  locataire_adresse: z.string().optional().default(""),
  locataire_tel: z.string().optional().default(""),
  nb_adultes: z.number().int().min(1).optional().default(1),
  nb_enfants_2_17: z.number().int().min(0).optional().default(0),
  date_debut: optionalDateString,
  heure_arrivee: z.string().optional().default("17:00"),
  date_fin: optionalDateString,
  heure_depart: z.string().optional().default("12:00"),
  prix_par_nuit: z.number().min(0).optional().default(0),
  remise_montant: z.number().min(0).optional().default(0),
  options: optionsSchema.default({}),
  arrhes_montant: z.number().min(0).optional(),
  arrhes_date_limite: optionalDateString,
  caution_montant: z.number().min(0).optional().default(0),
  cheque_menage_montant: z.number().min(0).optional().default(0),
  afficher_caution_phrase: z.boolean().optional().default(true),
  afficher_cheque_menage_phrase: z.boolean().optional().default(true),
  clauses: z.record(z.any()).optional(),
  notes: z.string().optional().nullable(),
  statut_paiement: z.enum(["non_reglee", "reglee"]).optional(),
});

const hydrateInvoice = (contrat: any) => ({
  ...contrat,
  options: fromJsonString<OptionsInput>(contrat.options, {}),
  clauses: fromJsonString<Record<string, unknown>>(contrat.clauses, {}),
  gite: contrat.gite ? hydrateGite(contrat.gite) : undefined,
});

const toInvoiceRenderInput = (contrat: any): InvoiceRenderInput => ({
  numero_facture: contrat.numero_facture,
  locataire_nom: contrat.locataire_nom,
  locataire_adresse: contrat.locataire_adresse,
  locataire_tel: contrat.locataire_tel,
  nb_adultes: contrat.nb_adultes,
  nb_enfants_2_17: contrat.nb_enfants_2_17,
  date_debut: contrat.date_debut,
  heure_arrivee: contrat.heure_arrivee,
  date_fin: contrat.date_fin,
  heure_depart: contrat.heure_depart,
  prix_par_nuit: contrat.prix_par_nuit,
  remise_montant: contrat.remise_montant,
  arrhes_montant: contrat.arrhes_montant,
  arrhes_date_limite: contrat.arrhes_date_limite,
  solde_montant: contrat.solde_montant,
  cheque_menage_montant: contrat.cheque_menage_montant,
  caution_montant: contrat.caution_montant,
  afficher_caution_phrase: contrat.afficher_caution_phrase,
  afficher_cheque_menage_phrase: contrat.afficher_cheque_menage_phrase,
  options: fromJsonString<OptionsInput>(contrat.options, {}),
  clauses: fromJsonString<Record<string, unknown>>(contrat.clauses, {}),
  statut_paiement: contrat.statut_paiement,
  notes: contrat.notes ?? null,
});

const invoiceTemplatePaths = [
  path.join(process.cwd(), "server/templates/invoice.html"),
  path.join(process.cwd(), "templates/invoice.html"),
];

const regenerateStoredInvoicePdf = async (contrat: any) => {
  const options = normalizeOptions(fromJsonString<OptionsInput>(contrat.options, {}), contrat.gite);

  const totals = computeTotals({
    dateDebut: contrat.date_debut,
    dateFin: contrat.date_fin,
    prixParNuit: toNumber(contrat.prix_par_nuit),
    remiseMontant: toNumber(contrat.remise_montant),
    nbAdultes: contrat.nb_adultes,
    nbEnfants: contrat.nb_enfants_2_17,
    arrhesMontant: toNumber(contrat.arrhes_montant),
    options,
    gite: contrat.gite,
  });

  const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(
    contrat.numero_facture,
    contrat.date_debut
  );

  await prisma.facture.update({
    where: { id: contrat.id },
    data: {
      nb_nuits: totals.nbNuits,
      taxe_sejour_calculee: totals.taxeSejourCalculee,
      solde_montant: totals.solde,
      pdf_path: pdfRelativePath,
      options: encodeJsonField(options),
    },
  });

  const invoiceForPdf = {
    ...toInvoiceRenderInput(contrat),
    solde_montant: totals.solde,
    options,
  };
  await generateInvoicePdf({
    invoice: invoiceForPdf,
    gite: contrat.gite,
    totals,
    outputPath: pdfAbsolutePath,
  });

  return { pdfRelativePath, pdfAbsolutePath };
};

const shouldRegenerateInvoicePdf = async (contrat: any, absolutePath: string) => {
  const [pdfStat, latestTemplateMtimeMs] = await Promise.all([
    fs.stat(absolutePath).catch(() => null),
    getLatestTemplateMtimeMs(invoiceTemplatePaths),
  ]);
  if (!pdfStat) return true;

  const contractMtimeMs =
    contrat.date_derniere_modif instanceof Date
      ? contrat.date_derniere_modif.getTime()
      : new Date(contrat.date_derniere_modif).getTime();
  const latestSourceMtimeMs = Math.max(contractMtimeMs, latestTemplateMtimeMs);
  return pdfStat.mtimeMs + 1 < latestSourceMtimeMs;
};

type PreviewContext = {
  gite: NonNullable<Awaited<ReturnType<typeof prisma.gite.findUnique>>>;
  totals: ReturnType<typeof computeTotals>;
  invoiceForPdf: InvoiceRenderInput;
};

type PreviewError = { error: { status: number; message: string } };

const buildPreviewContext = async (payload: unknown): Promise<PreviewContext | PreviewError> => {
  const data = previewSchema.parse(payload);
  const gite = await prisma.gite.findUnique({ where: { id: data.gite_id } });
  if (!gite) return { error: { status: 404, message: "Gîte introuvable" } };

  const dateDebut = data.date_debut ? parseDate(data.date_debut) : null;
  const dateFin = data.date_fin ? parseDate(data.date_fin) : null;
  if (dateDebut) ensureValidDate(dateDebut, "date_debut");
  if (dateFin) ensureValidDate(dateFin, "date_fin");
  if (dateDebut && dateFin && dateFin <= dateDebut) {
    return { error: { status: 400, message: "La date de fin doit être postérieure à la date de début." } };
  }

  const totalsDateDebut = dateDebut ? dateDebut : dateFin ? addDays(dateFin, -1) : new Date();
  const totalsDateFin = dateFin ? dateFin : dateDebut ? addDays(dateDebut, 1) : addDays(totalsDateDebut, 1);

  const options = normalizeOptions(data.options as OptionsInput, gite);

  const totalsPre = computeTotals({
    dateDebut: totalsDateDebut,
    dateFin: totalsDateFin,
    prixParNuit: data.prix_par_nuit ?? 0,
    remiseMontant: data.remise_montant ?? 0,
    nbAdultes: data.nb_adultes ?? 1,
    nbEnfants: data.nb_enfants_2_17 ?? 0,
    arrhesMontant: data.arrhes_montant ?? 0,
    options,
    gite,
  });

  const arrhesRate =
    gite.arrhes_taux_defaut !== undefined && gite.arrhes_taux_defaut !== null
      ? toNumber(gite.arrhes_taux_defaut)
      : env.DEFAULT_ARRHES_RATE;
  const arrhesMontant =
    data.arrhes_montant !== undefined ? data.arrhes_montant : round2(totalsPre.totalSansOptions * arrhesRate);

  const totals = computeTotals({
    dateDebut: totalsDateDebut,
    dateFin: totalsDateFin,
    prixParNuit: data.prix_par_nuit ?? 0,
    remiseMontant: data.remise_montant ?? 0,
    nbAdultes: data.nb_adultes ?? 1,
    nbEnfants: data.nb_enfants_2_17 ?? 0,
    arrhesMontant,
    options,
    gite,
  });

  const arrhesDateLimite = data.arrhes_date_limite ? parseDate(data.arrhes_date_limite) : addDays(new Date(), 15);
  if (data.arrhes_date_limite) ensureValidDate(arrhesDateLimite, "arrhes_date_limite");

  const invoiceForPdf: InvoiceRenderInput = {
    numero_facture: "BROUILLON",
    locataire_nom: data.locataire_nom ?? "",
    locataire_adresse: data.locataire_adresse ?? "",
    locataire_tel: data.locataire_tel ?? "",
    nb_adultes: data.nb_adultes ?? 1,
    nb_enfants_2_17: data.nb_enfants_2_17 ?? 0,
    date_debut: dateDebut,
    heure_arrivee: data.heure_arrivee ?? "17:00",
    date_fin: dateFin,
    heure_depart: data.heure_depart ?? "12:00",
    prix_par_nuit: data.prix_par_nuit ?? 0,
    remise_montant: data.remise_montant ?? 0,
    arrhes_montant: arrhesMontant,
    arrhes_date_limite: arrhesDateLimite,
    solde_montant: totals.solde,
    cheque_menage_montant: data.cheque_menage_montant ?? 0,
    caution_montant: data.caution_montant ?? 0,
    afficher_caution_phrase: data.afficher_caution_phrase ?? true,
    afficher_cheque_menage_phrase: data.afficher_cheque_menage_phrase ?? true,
    options,
    clauses: data.clauses ?? {},
    statut_paiement: data.statut_paiement ?? "non_reglee",
    notes: data.notes ?? null,
  };

  return { gite, totals, invoiceForPdf };
};

router.get("/", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const giteId = typeof req.query.giteId === "string" ? req.query.giteId : undefined;
    const numero = typeof req.query.numero === "string" ? req.query.numero : "";
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const where = buildDocumentListWhere({
      q,
      giteId,
      numero,
      from,
      to,
      numeroField: "numero_facture",
    });

    const factures = await prisma.facture.findMany({
      where,
      orderBy: { date_creation: "desc" },
      include: { gite: true },
    });
    res.json(factures.map(hydrateInvoice));
  } catch (err) {
    next(err);
  }
});

router.post("/preview-html", async (req, res, next) => {
  try {
    const context = await buildPreviewContext(req.body);
    if ("error" in context) return res.status(context.error.status).json({ error: context.error.message });

    const previewHtml = await generateInvoicePreviewHtml({
      invoice: context.invoiceForPdf,
      gite: context.gite,
      totals: context.totals,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Invoice-Overflow", previewHtml.overflowBefore ? "1" : "0");
    res.setHeader("X-Invoice-Overflow-After", previewHtml.overflowAfter ? "1" : "0");
    res.setHeader("X-Invoice-Compact", previewHtml.compactApplied ? "1" : "0");
    res.send(previewHtml.html);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const contrat = await prisma.facture.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!contrat) return res.status(404).json({ error: "Facture introuvable" });
    res.json(hydrateInvoice(contrat));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = invoiceSchema.parse(req.body);
    const gite = await prisma.gite.findUnique({ where: { id: data.gite_id } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable" });

    const dateDebut = parseDate(data.date_debut);
    const dateFin = parseDate(data.date_fin);
    ensureValidDate(dateDebut, "date_debut");
    ensureValidDate(dateFin, "date_fin");
    if (dateFin <= dateDebut) {
      return res.status(400).json({ error: "La date de fin doit être postérieure à la date de début." });
    }

    const options = normalizeOptions(data.options as OptionsInput, gite);

    const totalsPre = computeTotals({
      dateDebut,
      dateFin,
      prixParNuit: data.prix_par_nuit,
      remiseMontant: data.remise_montant ?? 0,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
      arrhesMontant: data.arrhes_montant ?? 0,
      options,
      gite,
    });

    const arrhesRate =
      gite.arrhes_taux_defaut !== undefined && gite.arrhes_taux_defaut !== null
        ? toNumber(gite.arrhes_taux_defaut)
        : env.DEFAULT_ARRHES_RATE;
    const arrhesMontant =
      data.arrhes_montant !== undefined ? data.arrhes_montant : round2(totalsPre.totalSansOptions * arrhesRate);

    const totals = computeTotals({
      dateDebut,
      dateFin,
      prixParNuit: data.prix_par_nuit,
      remiseMontant: data.remise_montant ?? 0,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
      arrhesMontant,
      options,
      gite,
    });

    const numeroFacture = await generateInvoiceNumber(
      data.gite_id,
      gite.prefixe_contrat,
      dateDebut.getFullYear()
    );

    const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(
      numeroFacture,
      dateDebut
    );

    const contrat = await prisma.facture.create({
      data: {
        numero_facture: numeroFacture,
        gite_id: data.gite_id,
        locataire_nom: data.locataire_nom,
        locataire_adresse: data.locataire_adresse,
        locataire_tel: data.locataire_tel,
        nb_adultes: data.nb_adultes,
        nb_enfants_2_17: data.nb_enfants_2_17,
        date_debut: dateDebut,
        heure_arrivee: data.heure_arrivee,
        date_fin: dateFin,
        heure_depart: data.heure_depart,
        nb_nuits: totals.nbNuits,
        prix_par_nuit: data.prix_par_nuit,
        remise_montant: data.remise_montant ?? 0,
        taxe_sejour_calculee: totals.taxeSejourCalculee,
        options: encodeJsonField(options),
        arrhes_montant: arrhesMontant,
        arrhes_date_limite: parseDate(data.arrhes_date_limite),
        solde_montant: totals.solde,
        caution_montant: data.caution_montant,
        cheque_menage_montant: data.cheque_menage_montant,
        afficher_caution_phrase: data.afficher_caution_phrase ?? true,
        afficher_cheque_menage_phrase: data.afficher_cheque_menage_phrase ?? true,
        clauses: encodeJsonField(data.clauses ?? {}),
        pdf_path: pdfRelativePath,
        statut_paiement: data.statut_paiement ?? "non_reglee",
        notes: data.notes ?? null,
      },
      include: { gite: true },
    });

    const invoiceForPdf = toInvoiceRenderInput(contrat);
    await generateInvoicePdf({
      invoice: invoiceForPdf,
      gite,
      totals,
      outputPath: pdfAbsolutePath,
    });

    res.status(201).json(hydrateInvoice(contrat));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const data = invoiceSchema.parse(req.body);
    const existing = await prisma.facture.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Facture introuvable" });

    const gite = await prisma.gite.findUnique({ where: { id: data.gite_id } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable" });

    const dateDebut = parseDate(data.date_debut);
    const dateFin = parseDate(data.date_fin);
    ensureValidDate(dateDebut, "date_debut");
    ensureValidDate(dateFin, "date_fin");
    if (dateFin <= dateDebut) {
      return res.status(400).json({ error: "La date de fin doit être postérieure à la date de début." });
    }

    const arrhesMontant =
      data.arrhes_montant !== undefined
        ? data.arrhes_montant
        : round2(toNumber(existing.arrhes_montant));

    const options = normalizeOptions(data.options as OptionsInput, gite);

    const totals = computeTotals({
      dateDebut,
      dateFin,
      prixParNuit: data.prix_par_nuit,
      remiseMontant: data.remise_montant ?? 0,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
      arrhesMontant,
      options,
      gite,
    });

    const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(
      existing.numero_facture,
      dateDebut
    );

    const contrat = await prisma.facture.update({
      where: { id: req.params.id },
      data: {
        gite_id: data.gite_id,
        locataire_nom: data.locataire_nom,
        locataire_adresse: data.locataire_adresse,
        locataire_tel: data.locataire_tel,
        nb_adultes: data.nb_adultes,
        nb_enfants_2_17: data.nb_enfants_2_17,
        date_debut: dateDebut,
        heure_arrivee: data.heure_arrivee,
        date_fin: dateFin,
        heure_depart: data.heure_depart,
        nb_nuits: totals.nbNuits,
        prix_par_nuit: data.prix_par_nuit,
        remise_montant: data.remise_montant ?? 0,
        taxe_sejour_calculee: totals.taxeSejourCalculee,
        options: encodeJsonField(options),
        arrhes_montant: arrhesMontant,
        arrhes_date_limite: parseDate(data.arrhes_date_limite),
        solde_montant: totals.solde,
        caution_montant: data.caution_montant,
        cheque_menage_montant: data.cheque_menage_montant,
        afficher_caution_phrase: data.afficher_caution_phrase ?? true,
        afficher_cheque_menage_phrase: data.afficher_cheque_menage_phrase ?? true,
        clauses: encodeJsonField(data.clauses ?? {}),
        pdf_path: pdfRelativePath,
        statut_paiement: data.statut_paiement ?? "non_reglee",
        notes: data.notes ?? null,
      },
      include: { gite: true },
    });

    const invoiceForPdf = toInvoiceRenderInput(contrat);
    await generateInvoicePdf({
      invoice: invoiceForPdf,
      gite,
      totals,
      outputPath: pdfAbsolutePath,
    });

    res.json(hydrateInvoice(contrat));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/payment", async (req, res, next) => {
  try {
    const data = paymentStatusSchema.parse(req.body);
    const contrat = await prisma.facture.update({
      where: { id: req.params.id },
      data: { statut_paiement: data.statut_paiement },
      include: { gite: true },
    });
    res.json(hydrateInvoice(contrat));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/regenerate", async (req, res, next) => {
  try {
    const contrat = await prisma.facture.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!contrat) return res.status(404).json({ error: "Facture introuvable" });
    await regenerateStoredInvoicePdf(contrat);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const contrat = await prisma.facture.findUnique({ where: { id: req.params.id } });
    if (!contrat) return res.status(404).json({ error: "Facture introuvable" });
    await prisma.facture.delete({ where: { id: req.params.id } });
    const absolutePath = path.join(process.cwd(), contrat.pdf_path);
    await fs.unlink(absolutePath).catch(() => undefined);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const contrat = await prisma.facture.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!contrat) return res.status(404).json({ error: "Facture introuvable" });

    let absolutePath = path.join(process.cwd(), contrat.pdf_path);
    if (await shouldRegenerateInvoicePdf(contrat, absolutePath)) {
      const regenerated = await regenerateStoredInvoicePdf(contrat);
      absolutePath = regenerated.pdfAbsolutePath;
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(absolutePath);
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { computeTotals, type OptionsInput } from "../services/contractCalculator.js";
import { generateContractNumber } from "../services/contractNumber.js";
import { syncReservationFromDocument } from "../services/documentReservationSync.js";
import {
  generateContractPdf,
  generateContractPreviewHtml,
  generateContractPreviewPdf,
  type ContractRenderInput,
} from "../services/pdfService.js";
import {
  DocumentEmailError,
  sendContractEmail,
  type ContractEmailDocument,
} from "../services/documentEmail.js";
import { SmtpConfigurationError, SmtpDeliveryError } from "../services/mailer.js";
import { getRemainingDueAmount, toNumber, round2 } from "../utils/money.js";
import { getPdfPaths, getSentPdfPaths } from "../utils/paths.js";
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
  validateDocumentOccupancy,
} from "./shared/rentalDocument.js";

const router = Router();

const emptyStringToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const nullableDateString = z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable()).optional();

const contractSchema = z.object({
  gite_id: z.string().min(1),
  locataire_nom: z.string().min(1),
  locataire_adresse: z.string().optional().default(""),
  locataire_tel: z.string().min(1),
  locataire_email: z.preprocess(emptyStringToNull, z.string().trim().email().nullable()).optional(),
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
  statut_reception_contrat: z.enum(["non_recu", "recu"]).optional(),
  date_reception_contrat: nullableDateString,
  statut_paiement_arrhes: z.enum(["non_recu", "recu"]).optional(),
  date_paiement_arrhes: nullableDateString,
  reservation_id: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable()).optional(),
});

const receptionStatusSchema = z.object({
  statut_reception_contrat: z.enum(["non_recu", "recu"]),
});

const arrhesStatusSchema = z.object({
  statut_paiement_arrhes: z.enum(["non_recu", "recu"]),
});

const balanceStatusSchema = z.object({
  statut_paiement_solde: z.enum(["non_regle", "regle"]),
});

const trackingDatesSchema = z.object({
  date_reception_contrat: nullableDateString,
  date_paiement_arrhes: nullableDateString,
});

const sendEmailSchema = z.object({
  recipient: z.preprocess(emptyStringToNull, z.string().trim().email().nullable()).optional(),
  subject: z.preprocess(emptyStringToNull, z.string().trim().min(1).max(200).nullable()).optional(),
  body: z.preprocess(emptyStringToNull, z.string().trim().min(1).max(20_000).nullable()).optional(),
});

const reservationPaymentSourceValues = [
  "Abritel",
  "Airbnb",
  "Chèque",
  "Espèces",
  "HomeExchange",
  "Virement",
  "A définir",
  "Gites de France",
] as const;

const arrhesPaymentModeValues = ["Chèque", "Virement", "Espèces", "A définir"] as const;

const returnProcessingSchema = z.object({
  statut_reception_contrat: z.enum(["non_recu", "recu"]).optional(),
  date_reception_contrat: nullableDateString,
  statut_paiement_arrhes: z.enum(["non_recu", "recu"]).optional(),
  date_paiement_arrhes: nullableDateString,
  mode_paiement_arrhes: z.preprocess(emptyStringToNull, z.enum(arrhesPaymentModeValues).nullable()).optional(),
  notes: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  reservation: z
    .object({
      source_paiement: z.preprocess(emptyStringToNull, z.enum(reservationPaymentSourceValues).nullable()).optional(),
      options: optionsSchema.optional(),
    })
    .optional(),
});

const previewSchema = z.object({
  gite_id: z.string().min(1),
  locataire_nom: z.string().optional().default(""),
  locataire_adresse: z.string().optional().default(""),
  locataire_tel: z.string().optional().default(""),
  locataire_email: z.preprocess(emptyStringToNull, z.string().trim().email().nullable()).optional(),
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
  statut_paiement_arrhes: z.enum(["non_recu", "recu"]).optional(),
});

const hydrateContractMoneyFields = (contract: any) => ({
  ...contract,
  prix_par_nuit: toNumber(contract.prix_par_nuit),
  remise_montant: toNumber(contract.remise_montant),
  taxe_sejour_calculee:
    contract.taxe_sejour_calculee === null || contract.taxe_sejour_calculee === undefined
      ? contract.taxe_sejour_calculee
      : toNumber(contract.taxe_sejour_calculee),
  arrhes_montant: toNumber(contract.arrhes_montant),
  solde_montant: getRemainingDueAmount(
    contract.solde_montant,
    contract.statut_paiement_solde,
  ),
  caution_montant: toNumber(contract.caution_montant),
  cheque_menage_montant: toNumber(contract.cheque_menage_montant),
});

const hydrateContract = (contrat: any) => ({
  ...hydrateContractMoneyFields(contrat),
  options: fromJsonString<OptionsInput>(contrat.options, {}),
  clauses: fromJsonString<Record<string, unknown>>(contrat.clauses, {}),
  gite: contrat.gite ? hydrateGite(contrat.gite) : undefined,
});

const hydrateContractForTrackingStatusResponse = (contrat: any) => ({
  ...hydrateContract(contrat),
  date_reception_contrat: contrat.statut_reception_contrat === "recu" ? contrat.date_reception_contrat : null,
  date_paiement_arrhes: contrat.statut_paiement_arrhes === "recu" ? contrat.date_paiement_arrhes : null,
});

const summarizeReservationOptions = (options: OptionsInput) => {
  const labels: string[] = [];
  const declarationFlags: boolean[] = [];

  if (options.draps?.enabled) {
    labels.push(`Draps x${Math.max(0, Math.round(options.draps.nb_lits ?? 0))}${options.draps.offert ? " offerts" : ""}`);
    declarationFlags.push(Boolean(options.draps.declared));
  }
  if (options.linge_toilette?.enabled) {
    labels.push(
      `Linge x${Math.max(0, Math.round(options.linge_toilette.nb_personnes ?? 0))}${
        options.linge_toilette.offert ? " offert" : ""
      }`
    );
    declarationFlags.push(Boolean(options.linge_toilette.declared));
  }
  if (options.menage?.enabled) {
    labels.push(`Ménage${options.menage.offert ? " offert" : ""}`);
    declarationFlags.push(Boolean(options.menage.declared));
  }
  if (options.depart_tardif?.enabled) {
    labels.push(`Départ tardif${options.depart_tardif.offert ? " offert" : ""}`);
    declarationFlags.push(Boolean(options.depart_tardif.declared));
  }
  if (options.chiens?.enabled) {
    labels.push(`Chiens x${Math.max(0, Math.round(options.chiens.nb ?? 0))}${options.chiens.offert ? " offerts" : ""}`);
    declarationFlags.push(Boolean(options.chiens.declared));
  }

  return {
    label: labels.join(" · "),
    allDeclared: declarationFlags.length > 0 && declarationFlags.every(Boolean),
  };
};

const parseOptionalTrackedDate = (value: string | null | undefined, label: string) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = parseDate(value);
  ensureValidDate(parsed, label);
  return parsed;
};

const toContractRenderInput = (contrat: any): ContractRenderInput => ({
  numero_contrat: contrat.numero_contrat,
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
  notes: contrat.notes ?? null,
});

const toContractEmailDocument = (contrat: any): ContractEmailDocument => ({
  id: contrat.id,
  numero_contrat: contrat.numero_contrat,
  locataire_nom: contrat.locataire_nom,
  locataire_email: contrat.locataire_email,
  date_debut: contrat.date_debut,
  heure_arrivee: contrat.heure_arrivee,
  date_fin: contrat.date_fin,
  heure_depart: contrat.heure_depart,
  nb_nuits: contrat.nb_nuits,
  arrhes_montant: toNumber(contrat.arrhes_montant),
  arrhes_date_limite: contrat.arrhes_date_limite,
  solde_montant: toNumber(contrat.solde_montant),
  gite: contrat.gite
    ? {
        nom: contrat.gite.nom,
        email: contrat.gite.email,
      }
    : undefined,
});

const isFrozenContract = (contrat: { pdf_sent_path?: string | null }) => Boolean(String(contrat.pdf_sent_path ?? "").trim());

const buildFrozenContractSnapshot = (contrat: any) =>
  JSON.stringify({
    numero_contrat: contrat.numero_contrat,
    gite_id: contrat.gite_id,
    date_creation: contrat.date_creation,
    date_envoi_email: new Date().toISOString(),
    contract: toContractRenderInput(contrat),
  });

const ensureSentContractArchive = async (contrat: any, currentPdfAbsolutePath: string) => {
  if (isFrozenContract(contrat)) {
    return {
      sentPdfRelativePath: contrat.pdf_sent_path,
      sentPdfAbsolutePath: path.join(process.cwd(), contrat.pdf_sent_path),
      snapshotJson: typeof contrat.snapshot_json === "string" ? contrat.snapshot_json : null,
    };
  }

  const { relativePath: sentPdfRelativePath, absolutePath: sentPdfAbsolutePath } = getSentPdfPaths(
    contrat.numero_contrat,
    contrat.date_debut
  );

  await fs.mkdir(path.dirname(sentPdfAbsolutePath), { recursive: true });
  await fs.copyFile(currentPdfAbsolutePath, sentPdfAbsolutePath);

  return {
    sentPdfRelativePath,
    sentPdfAbsolutePath,
    snapshotJson: buildFrozenContractSnapshot(contrat),
  };
};

const contractTemplatePaths = [
  path.join(process.cwd(), "server/templates/contract.html"),
  path.join(process.cwd(), "server/templates/conditions.html"),
];

const regenerateStoredContractPdf = async (contrat: any) => {
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
    contrat.numero_contrat,
    contrat.date_debut
  );

  await prisma.contrat.update({
    where: { id: contrat.id },
    data: {
      nb_nuits: totals.nbNuits,
      taxe_sejour_calculee: totals.taxeSejourCalculee,
      solde_montant: totals.solde,
      pdf_path: pdfRelativePath,
      options: encodeJsonField(options),
    },
  });

  const contractForPdf = {
    ...toContractRenderInput(contrat),
    solde_montant: totals.solde,
    options,
  };
  await generateContractPdf({
    contract: contractForPdf,
    gite: contrat.gite,
    totals,
    outputPath: pdfAbsolutePath,
  });

  return { pdfRelativePath, pdfAbsolutePath };
};

const shouldRegeneratePdf = async (contrat: any, absolutePath: string) => {
  const [pdfStat, latestTemplateMtimeMs] = await Promise.all([
    fs.stat(absolutePath).catch(() => null),
    getLatestTemplateMtimeMs(contractTemplatePaths),
  ]);
  if (!pdfStat) return true;

  const contractMtimeMs =
    contrat.date_derniere_modif instanceof Date
      ? contrat.date_derniere_modif.getTime()
      : new Date(contrat.date_derniere_modif).getTime();
  const latestSourceMtimeMs = Math.max(contractMtimeMs, latestTemplateMtimeMs);
  return pdfStat.mtimeMs + 1 < latestSourceMtimeMs;
};

const handleDocumentEmailError = (err: unknown, res: Response, next: NextFunction) => {
  if (
    err instanceof DocumentEmailError ||
    err instanceof SmtpConfigurationError ||
    err instanceof SmtpDeliveryError
  ) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  return next(err);
};

type PreviewContext = {
  gite: NonNullable<Awaited<ReturnType<typeof prisma.gite.findUnique>>>;
  totals: ReturnType<typeof computeTotals>;
  contractForPdf: ContractRenderInput;
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

  const contractForPdf: ContractRenderInput = {
    numero_contrat: "BROUILLON",
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
    notes: data.notes ?? null,
  };

  return { gite, totals, contractForPdf };
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
      numeroField: "numero_contrat",
    });

    const contrats = await prisma.contrat.findMany({
      where,
      orderBy: { date_creation: "desc" },
      include: { gite: true },
    });
    res.json(contrats.map(hydrateContract));
  } catch (err) {
    next(err);
  }
});

router.post("/preview", async (req, res, next) => {
  try {
    const context = await buildPreviewContext(req.body);
    if ("error" in context) return res.status(context.error.status).json({ error: context.error.message });

    const previewPdf = await generateContractPreviewPdf({
      contract: context.contractForPdf,
      gite: context.gite,
      totals: context.totals,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Contract-Overflow", previewPdf.overflowBefore ? "1" : "0");
    res.setHeader("X-Contract-Overflow-After", previewPdf.overflowAfter ? "1" : "0");
    res.setHeader("X-Contract-Compact", previewPdf.compactApplied ? "1" : "0");
    res.send(previewPdf.buffer);
  } catch (err) {
    next(err);
  }
});

router.post("/preview-html", async (req, res, next) => {
  try {
    const context = await buildPreviewContext(req.body);
    if ("error" in context) return res.status(context.error.status).json({ error: context.error.message });

    const previewHtml = await generateContractPreviewHtml({
      contract: context.contractForPdf,
      gite: context.gite,
      totals: context.totals,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Contract-Overflow", previewHtml.overflowBefore ? "1" : "0");
    res.setHeader("X-Contract-Overflow-After", previewHtml.overflowAfter ? "1" : "0");
    res.setHeader("X-Contract-Compact", previewHtml.compactApplied ? "1" : "0");
    res.send(previewHtml.html);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const contrat = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!contrat) return res.status(404).json({ error: "Contrat introuvable" });
    res.json(hydrateContract(contrat));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = contractSchema.parse(req.body);
    const gite = await prisma.gite.findUnique({ where: { id: data.gite_id } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable" });
    const occupancyError = validateDocumentOccupancy({
      gite,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
    });
    if (occupancyError) throw occupancyError;
    if (data.reservation_id) {
      const reservation = await prisma.reservation.findUnique({
        where: { id: data.reservation_id },
        select: { id: true, gite_id: true },
      });
      if (!reservation) return res.status(404).json({ error: "Réservation introuvable." });
      if (reservation.gite_id && reservation.gite_id !== data.gite_id) {
        return res.status(400).json({ error: "La réservation sélectionnée est rattachée à un autre gîte." });
      }
    }

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

    const numeroContrat = await generateContractNumber(
      data.gite_id,
      gite.prefixe_contrat,
      dateDebut.getFullYear()
    );

    const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(
      numeroContrat,
      dateDebut
    );

    const reservationId = await syncReservationFromDocument({
      explicitReservationId: data.reservation_id ?? null,
      giteId: data.gite_id,
      locataireNom: data.locataire_nom,
      locataireTel: data.locataire_tel,
      locataireEmail: data.locataire_email ?? null,
      dateDebut,
      dateFin,
      nbNuits: totals.nbNuits,
      nbAdultes: data.nb_adultes,
      prixParNuit: data.prix_par_nuit,
      prixTotal: totals.montantBase,
      remiseMontant: data.remise_montant ?? 0,
      options,
      optionsTotal: totals.optionsTotal,
    });

    const contrat = await prisma.contrat.create({
      data: {
        numero_contrat: numeroContrat,
        gite_id: data.gite_id,
        locataire_nom: data.locataire_nom,
        locataire_adresse: data.locataire_adresse,
        locataire_tel: data.locataire_tel,
        locataire_email: data.locataire_email ?? null,
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
        date_envoi_email: null,
        statut_reception_contrat: data.statut_reception_contrat ?? "non_recu",
        date_reception_contrat: parseOptionalTrackedDate(data.date_reception_contrat, "date_reception_contrat") ?? null,
        statut_paiement_arrhes: data.statut_paiement_arrhes ?? "non_recu",
        date_paiement_arrhes: parseOptionalTrackedDate(data.date_paiement_arrhes, "date_paiement_arrhes") ?? null,
        notes: data.notes ?? null,
        reservation_id: reservationId,
      },
      include: { gite: true },
    });

    const contractForPdf = toContractRenderInput(contrat);
    await generateContractPdf({
      contract: contractForPdf,
      gite,
      totals,
      outputPath: pdfAbsolutePath,
    });

    res.status(201).json(hydrateContract(contrat));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const data = contractSchema.parse(req.body);
    const existing = await prisma.contrat.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Contrat introuvable" });
    if (isFrozenContract(existing)) {
      return res.status(409).json({
        error:
          "Ce contrat a déjà été envoyé et figé. Modifiez la réservation via le traitement du retour ou créez un avenant.",
      });
    }

    const gite = await prisma.gite.findUnique({ where: { id: data.gite_id } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable" });
    const occupancyError = validateDocumentOccupancy({
      gite,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
    });
    if (occupancyError) throw occupancyError;
    if (data.reservation_id) {
      const reservation = await prisma.reservation.findUnique({
        where: { id: data.reservation_id },
        select: { id: true, gite_id: true },
      });
      if (!reservation) return res.status(404).json({ error: "Réservation introuvable." });
      if (reservation.gite_id && reservation.gite_id !== data.gite_id) {
        return res.status(400).json({ error: "La réservation sélectionnée est rattachée à un autre gîte." });
      }
    }

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

    const reservationId = await syncReservationFromDocument({
      explicitReservationId: data.reservation_id ?? null,
      existingReservationId: existing.reservation_id ?? null,
      giteId: data.gite_id,
      locataireNom: data.locataire_nom,
      locataireTel: data.locataire_tel,
      locataireEmail: data.locataire_email ?? null,
      dateDebut,
      dateFin,
      nbNuits: totals.nbNuits,
      nbAdultes: data.nb_adultes,
      prixParNuit: data.prix_par_nuit,
      prixTotal: totals.montantBase,
      remiseMontant: data.remise_montant ?? 0,
      options,
      optionsTotal: totals.optionsTotal,
    });

    const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(
      existing.numero_contrat,
      dateDebut
    );

    const contrat = await prisma.contrat.update({
      where: { id: req.params.id },
      data: {
        gite_id: data.gite_id,
        locataire_nom: data.locataire_nom,
        locataire_adresse: data.locataire_adresse,
        locataire_tel: data.locataire_tel,
        locataire_email: data.locataire_email ?? null,
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
        date_envoi_email: existing.date_envoi_email,
        statut_reception_contrat: data.statut_reception_contrat ?? existing.statut_reception_contrat ?? "non_recu",
        date_reception_contrat:
          data.date_reception_contrat === undefined
            ? existing.date_reception_contrat
            : parseOptionalTrackedDate(data.date_reception_contrat, "date_reception_contrat"),
        statut_paiement_arrhes: data.statut_paiement_arrhes ?? existing.statut_paiement_arrhes ?? "non_recu",
        date_paiement_arrhes:
          data.date_paiement_arrhes === undefined
            ? existing.date_paiement_arrhes
            : parseOptionalTrackedDate(data.date_paiement_arrhes, "date_paiement_arrhes"),
        notes: data.notes ?? null,
        reservation_id: reservationId,
      },
      include: { gite: true },
    });

    const contractForPdf = toContractRenderInput(contrat);
    await generateContractPdf({
      contract: contractForPdf,
      gite,
      totals,
      outputPath: pdfAbsolutePath,
    });

    res.json(hydrateContract(contrat));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/email-sent", async (req, res, next) => {
  try {
    const existing = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Contrat introuvable" });

    const contrat = await prisma.contrat.update({
      where: { id: req.params.id },
      data: { date_envoi_email: new Date() },
      include: { gite: true },
    });
    res.json(hydrateContract(contrat));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/send-email", async (req, res, next) => {
  try {
    const emailDraft = sendEmailSchema.parse(req.body ?? {});
    const contrat = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!contrat) return res.status(404).json({ error: "Contrat introuvable" });

    let absolutePath = path.join(process.cwd(), contrat.pdf_path);
    if (!isFrozenContract(contrat) && (await shouldRegeneratePdf(contrat, absolutePath))) {
      const regenerated = await regenerateStoredContractPdf(contrat);
      absolutePath = regenerated.pdfAbsolutePath;
    }

    const archive = await ensureSentContractArchive(contrat, absolutePath);
    absolutePath = archive.sentPdfAbsolutePath;

    const documentUrl = new URL(`/api/contracts/${req.params.id}/pdf`, `${req.protocol}://${req.get("host")}`).toString();
    await sendContractEmail(toContractEmailDocument(contrat), absolutePath, {
      documentUrl,
      customMessage: emailDraft,
    });

    const updated = await prisma.contrat.update({
      where: { id: req.params.id },
      data: {
        date_envoi_email: new Date(),
        pdf_sent_path: archive.sentPdfRelativePath,
        snapshot_json: archive.snapshotJson ?? contrat.snapshot_json ?? null,
      },
      include: { gite: true },
    });

    res.json(hydrateContract(updated));
  } catch (err) {
    return handleDocumentEmailError(err, res, next);
  }
});

router.patch("/:id/reception", async (req, res, next) => {
  try {
    const data = receptionStatusSchema.parse(req.body);
    const existing = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      select: { date_reception_contrat: true },
    });
    if (!existing) return res.status(404).json({ error: "Contrat introuvable" });

    const contrat = await prisma.contrat.update({
      where: { id: req.params.id },
      data: {
        statut_reception_contrat: data.statut_reception_contrat,
        date_reception_contrat:
          data.statut_reception_contrat === "recu"
            ? existing.date_reception_contrat ?? new Date()
            : existing.date_reception_contrat,
      },
      include: { gite: true },
    });
    res.json(hydrateContractForTrackingStatusResponse(contrat));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/arrhes", async (req, res, next) => {
  try {
    const data = arrhesStatusSchema.parse(req.body);
    const existing = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      select: { date_paiement_arrhes: true },
    });
    if (!existing) return res.status(404).json({ error: "Contrat introuvable" });

    const contrat = await prisma.contrat.update({
      where: { id: req.params.id },
      data: {
        statut_paiement_arrhes: data.statut_paiement_arrhes,
        date_paiement_arrhes:
          data.statut_paiement_arrhes === "recu" ? existing.date_paiement_arrhes ?? new Date() : existing.date_paiement_arrhes,
        mode_paiement_arrhes: data.statut_paiement_arrhes === "recu" ? undefined : null,
      },
      include: { gite: true },
    });
    res.json(hydrateContractForTrackingStatusResponse(contrat));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/solde", async (req, res, next) => {
  try {
    const data = balanceStatusSchema.parse(req.body);
    const contrat = await prisma.contrat.update({
      where: { id: req.params.id },
      data: {
        statut_paiement_solde: data.statut_paiement_solde,
      },
      include: { gite: true },
    });

    res.json(hydrateContractForTrackingStatusResponse(contrat));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/return-processing", async (req, res, next) => {
  try {
    const data = returnProcessingSchema.parse(req.body ?? {});
    const existing = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!existing) return res.status(404).json({ error: "Contrat introuvable" });

    const nextReceptionStatus = data.statut_reception_contrat ?? existing.statut_reception_contrat;
    const explicitReceptionDate =
      data.date_reception_contrat === undefined
        ? undefined
        : parseOptionalTrackedDate(data.date_reception_contrat, "date_reception_contrat");
    const nextReceptionDate =
      nextReceptionStatus === "recu"
        ? explicitReceptionDate ?? existing.date_reception_contrat ?? new Date()
        : explicitReceptionDate === undefined || explicitReceptionDate === null
          ? existing.date_reception_contrat
          : explicitReceptionDate;

    const nextArrhesStatus = data.statut_paiement_arrhes ?? existing.statut_paiement_arrhes;
    const explicitArrhesDate =
      data.date_paiement_arrhes === undefined
        ? undefined
        : parseOptionalTrackedDate(data.date_paiement_arrhes, "date_paiement_arrhes");
    const nextArrhesDate =
      nextArrhesStatus === "recu"
        ? explicitArrhesDate ?? existing.date_paiement_arrhes ?? new Date()
        : explicitArrhesDate === undefined || explicitArrhesDate === null
          ? existing.date_paiement_arrhes
          : explicitArrhesDate;
    const nextArrhesPaymentMode =
      nextArrhesStatus === "recu"
        ? data.mode_paiement_arrhes === undefined
          ? existing.mode_paiement_arrhes ?? null
          : data.mode_paiement_arrhes
        : null;

    const updatedContract = await prisma.$transaction(async (tx) => {
      if (data.reservation && existing.reservation_id) {
        const reservation = await tx.reservation.findUnique({
          where: { id: existing.reservation_id },
        });
        if (!reservation) {
          throw new Error("Réservation liée introuvable.");
        }

        const reservationUpdate: Record<string, unknown> = {};
        if (data.reservation.source_paiement !== undefined) {
          reservationUpdate.source_paiement = data.reservation.source_paiement;
        }
        if (data.reservation.options !== undefined) {
          const nextOptions = normalizeOptions(data.reservation.options as OptionsInput, existing.gite);
          const summary = summarizeReservationOptions(nextOptions);
          const totals = computeTotals({
            dateDebut: reservation.date_entree,
            dateFin: reservation.date_sortie,
            prixParNuit: toNumber(reservation.prix_par_nuit),
            remiseMontant: toNumber(reservation.remise_montant),
            nbAdultes: reservation.nb_adultes,
            nbEnfants: 0,
            arrhesMontant: 0,
            options: nextOptions,
            gite: existing.gite,
          });

          reservationUpdate.options = encodeJsonField(nextOptions);
          reservationUpdate.frais_optionnels_montant = round2(totals.optionsTotal);
          reservationUpdate.frais_optionnels_libelle = summary.label || null;
          reservationUpdate.frais_optionnels_declares = summary.allDeclared;
        }

        if (Object.keys(reservationUpdate).length > 0) {
          await tx.reservation.update({
            where: { id: reservation.id },
            data: reservationUpdate,
          });
        }
      }

      return tx.contrat.update({
        where: { id: existing.id },
        data: {
          statut_reception_contrat: nextReceptionStatus,
          date_reception_contrat: nextReceptionDate,
          statut_paiement_arrhes: nextArrhesStatus,
          date_paiement_arrhes: nextArrhesDate,
          mode_paiement_arrhes: nextArrhesPaymentMode,
          notes: data.notes === undefined ? existing.notes : data.notes,
        },
        include: { gite: true },
      });
    });

    res.json(hydrateContractForTrackingStatusResponse(updatedContract));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/create-linked-reservation", async (req, res, next) => {
  try {
    const existing = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!existing) return res.status(404).json({ error: "Contrat introuvable" });

    if (existing.reservation_id) {
      const updated = await prisma.contrat.findUnique({
        where: { id: existing.id },
        include: { gite: true },
      });
      return res.json(hydrateContract(updated));
    }

    const options = normalizeOptions(fromJsonString<OptionsInput>(existing.options, {}), existing.gite);
    const totals = computeTotals({
      dateDebut: existing.date_debut,
      dateFin: existing.date_fin,
      prixParNuit: toNumber(existing.prix_par_nuit),
      remiseMontant: toNumber(existing.remise_montant),
      nbAdultes: existing.nb_adultes,
      nbEnfants: existing.nb_enfants_2_17,
      arrhesMontant: toNumber(existing.arrhes_montant),
      options,
      gite: existing.gite,
    });

    const reservationId = await syncReservationFromDocument({
      giteId: existing.gite_id,
      locataireNom: existing.locataire_nom,
      locataireTel: existing.locataire_tel,
      locataireEmail: existing.locataire_email ?? null,
      dateDebut: existing.date_debut,
      dateFin: existing.date_fin,
      nbNuits: totals.nbNuits,
      nbAdultes: existing.nb_adultes,
      prixParNuit: toNumber(existing.prix_par_nuit),
      prixTotal: totals.montantBase,
      remiseMontant: toNumber(existing.remise_montant),
      options,
      optionsTotal: totals.optionsTotal,
    });

    const updated = await prisma.contrat.update({
      where: { id: existing.id },
      data: { reservation_id: reservationId },
      include: { gite: true },
    });

    res.json(hydrateContract(updated));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/tracking-dates", async (req, res, next) => {
  try {
    const data = trackingDatesSchema.parse(req.body);
    const existing = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!existing) return res.status(404).json({ error: "Contrat introuvable" });

    const nextData: Record<string, Date | null> = {};
    if (data.date_reception_contrat !== undefined) {
      nextData.date_reception_contrat = parseOptionalTrackedDate(data.date_reception_contrat, "date_reception_contrat") ?? null;
    }
    if (data.date_paiement_arrhes !== undefined) {
      nextData.date_paiement_arrhes = parseOptionalTrackedDate(data.date_paiement_arrhes, "date_paiement_arrhes") ?? null;
    }

    const contrat =
      Object.keys(nextData).length === 0
        ? existing
        : await prisma.contrat.update({
            where: { id: req.params.id },
            data: nextData,
            include: { gite: true },
          });

    res.json(hydrateContract(contrat));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/regenerate", async (req, res, next) => {
  try {
    const contrat = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!contrat) return res.status(404).json({ error: "Contrat introuvable" });
    if (isFrozenContract(contrat)) {
      return res.status(409).json({
        error: "Le PDF envoyé est figé. La régénération du contrat original n'est plus autorisée.",
      });
    }
    await regenerateStoredContractPdf(contrat);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const contrat = await prisma.contrat.findUnique({ where: { id: req.params.id } });
    if (!contrat) return res.status(404).json({ error: "Contrat introuvable" });
    await prisma.contrat.delete({ where: { id: req.params.id } });
    const absolutePath = path.join(process.cwd(), contrat.pdf_path);
    const sentAbsolutePath = contrat.pdf_sent_path ? path.join(process.cwd(), contrat.pdf_sent_path) : null;
    await fs.unlink(absolutePath).catch(() => undefined);
    if (sentAbsolutePath && sentAbsolutePath !== absolutePath) {
      await fs.unlink(sentAbsolutePath).catch(() => undefined);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const contrat = await prisma.contrat.findUnique({
      where: { id: req.params.id },
      include: { gite: true },
    });
    if (!contrat) return res.status(404).json({ error: "Contrat introuvable" });

    const frozenPdfPath = isFrozenContract(contrat) ? String(contrat.pdf_sent_path) : null;
    let absolutePath = frozenPdfPath ? path.join(process.cwd(), frozenPdfPath) : path.join(process.cwd(), contrat.pdf_path);
    if (!frozenPdfPath && (await shouldRegeneratePdf(contrat, absolutePath))) {
      const regenerated = await regenerateStoredContractPdf(contrat);
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

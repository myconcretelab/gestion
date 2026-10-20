import { Router, type NextFunction, type Response } from "express";
import { createSuperPdpEmissionRouter } from "../modules/superpdp/emissionRoutes.js";
import { z } from "zod";
import { invoiceFiscalInputSchema, invoiceFiscalIssues, computeInvoiceFiscal } from "@contrats/shared";
import { parseInvoiceFiscal, proposeInvoiceFiscal } from "../modules/documents/invoiceFiscal.js";
import path from "path";
import fs from "fs/promises";
import crypto from "node:crypto";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { computeTotals, type ContractTotals, type OptionsInput } from "../services/contractCalculator.js";
import { syncReservationFromDocument } from "../services/documentReservationSync.js";
import {
  assertEditableInvoice, buildInvoiceCalculation, createFullCreditNote, deleteInvoiceDraft,
  invoiceError, invoiceReadInclude, invoiceRenderInput, issueInvoice, parseInvoiceCalculation,
  readArchivedInvoicePdf, withEditableInvoice, updateInvoicePayment,
} from "../modules/documents/invoiceLifecycle.js";
import { getAuthenticatedAppUser } from "../services/serverAuth.js";
import {
  generateInvoicePdf,
  generateInvoicePreviewHtml,
  type InvoiceRenderInput,
} from "../services/pdfService.js";
import { DocumentEmailError, sendInvoiceEmail } from "../services/documentEmail.js";
import { SmtpConfigurationError, SmtpDeliveryError } from "../services/mailer.js";
import { toNumber, round2 } from "../utils/money.js";
import { getPdfPaths } from "../utils/paths.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";
import { recordUsageEvent } from "../modules/billing/service.js";
import { getOrganizationId } from "../services/organizationContext.js";
import { registerGeneratedDocumentAsset } from "../modules/documents/storage.js";
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
router.use(createSuperPdpEmissionRouter());

const emptyStringToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const invoiceExtraFeeSchema = z.object({
  libelle: z.string().optional().default(""),
  montant: z.number().min(0).optional().default(0),
});

type InvoiceExtraFeeInput = z.infer<typeof invoiceExtraFeeSchema>;
type InvoiceExtraFee = { libelle: string; montant: number };

export type InvoiceReservationItem = {
  reservation_id: string;
  gite_id: string;
  gite_nom: string;
  hote_nom: string;
  date_debut: string;
  date_fin: string;
  nb_nuits: number;
  nb_adultes: number;
  nb_enfants_2_17: number;
  montant: number;
};

const normalizeInvoiceExtraFees = (fees: InvoiceExtraFeeInput[] | null | undefined): InvoiceExtraFee[] =>
  (fees ?? [])
    .map((fee) => ({
      libelle: fee.libelle.trim() || "Frais complémentaires",
      montant: round2(fee.montant ?? 0),
    }))
    .filter((fee) => fee.montant > 0);

const getInvoiceExtraFeesTotal = (fees: InvoiceExtraFee[]) =>
  round2(fees.reduce((sum, fee) => sum + fee.montant, 0));

const addInvoiceExtraFeesToTotals = (totals: ContractTotals, fees: InvoiceExtraFee[]): ContractTotals => {
  const feesTotal = getInvoiceExtraFeesTotal(fees);
  if (feesTotal <= 0) return totals;
  return {
    ...totals,
    totalGlobal: round2(totals.totalGlobal + feesTotal),
    solde: round2(totals.solde + feesTotal),
  };
};

const invoiceSchema = z.object({
  fiscal_input: invoiceFiscalInputSchema.nullable().optional(),
  revision: z.number().int().nonnegative().optional(),
  gite_id: z.string().min(1),
  locataire_nom: z.string().min(1),
  locataire_adresse: z.string().optional().default(""),
  locataire_tel: z.string().trim().optional().default(""),
  locataire_email: z.preprocess(emptyStringToNull, z.string().trim().email().nullable()).optional(),
  nb_adultes: z.number().int().min(1),
  nb_enfants_2_17: z.number().int().min(0),
  date_debut: z.string().min(1),
  heure_arrivee: z.string().min(1),
  date_fin: z.string().min(1),
  heure_depart: z.string().min(1),
  prix_par_nuit: z.number().min(0),
  remise_montant: z.number().min(0).default(0),
  frais_supplementaires: z.array(invoiceExtraFeeSchema).optional().default([]),
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
  reservation_id: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable()).optional(),
  reservation_ids: z.array(z.string().trim().min(1)).max(50).optional().default([]),
});

const paymentStatusSchema = z.object({
  statut_paiement: z.enum(["non_reglee", "reglee"]),
});
const issuanceSchema = z.object({ revision: z.number().int().nonnegative() });
const creditNoteSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

const sendEmailSchema = z.object({
  recipient: z.preprocess(emptyStringToNull, z.string().trim().email().nullable()).optional(),
  subject: z.preprocess(emptyStringToNull, z.string().trim().min(1).max(200).nullable()).optional(),
  body: z.preprocess(emptyStringToNull, z.string().trim().min(1).max(20_000).nullable()).optional(),
  deliveryMode: z.enum(["attachment", "download_link"]).optional().default("attachment"),
});

const previewSchema = z.object({
  fiscal_input: invoiceFiscalInputSchema.nullable().optional(),
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
  frais_supplementaires: z.array(invoiceExtraFeeSchema).optional().default([]),
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
  reservation_ids: z.array(z.string().trim().min(1)).max(50).optional().default([]),
});

const hydrateInvoiceMoneyFields = (invoice: any) => ({
  ...invoice,
  prix_par_nuit: toNumber(invoice.prix_par_nuit),
  remise_montant: toNumber(invoice.remise_montant),
  taxe_sejour_calculee:
    invoice.taxe_sejour_calculee === null || invoice.taxe_sejour_calculee === undefined
      ? invoice.taxe_sejour_calculee
      : toNumber(invoice.taxe_sejour_calculee),
  arrhes_montant: toNumber(invoice.arrhes_montant),
  solde_montant: toNumber(invoice.solde_montant),
  caution_montant: toNumber(invoice.caution_montant),
  cheque_menage_montant: toNumber(invoice.cheque_menage_montant),
});

const invoiceSeller = (invoice: any) => {
  const archived = fromJsonString<any>(invoice.immutable_snapshot, null)?.invoice?.seller;
  if (archived) return archived;
  if (invoice.document_kind === "credit_note") return fromJsonString<any>(invoice.original_invoice?.immutable_snapshot, null)?.invoice?.seller;
  const establishment = invoice.gite?.fiscal_establishment;
  if (invoice.lifecycle_status !== "draft" || !establishment) return undefined;
  const entity = establishment.fiscal_entity;
  return { legal_name: entity.legal_name, siren: entity.siren, siret: establishment.siret, vat_number: entity.vat_number, email: entity.email,
    address: [entity.address_line1, entity.address_line2, entity.postal_code, entity.city, entity.country_code].filter(Boolean).join(" · ") };
};

const hydrateInvoice = (contrat: any) => ({
  ...hydrateInvoiceMoneyFields(contrat),
  frais_supplementaires: fromJsonString<InvoiceExtraFee[]>(contrat.frais_supplementaires, []),
  reservation_items: fromJsonString<InvoiceReservationItem[]>(contrat.reservation_items, []),
  options: fromJsonString<OptionsInput>(contrat.options, {}),
  clauses: fromJsonString<Record<string, unknown>>(contrat.clauses, {}),
  gite: contrat.gite ? { ...hydrateGite(contrat.gite), ...fromJsonString<any>(contrat.immutable_snapshot, null)?.calculation?.gite } : undefined,
  calculation_snapshot: undefined,
  immutable_snapshot: undefined,
  original_invoice: contrat.original_invoice ? { id: contrat.original_invoice.id, numero_facture: contrat.original_invoice.numero_facture } : null,
  issuer: invoiceSeller(contrat) ?? null,
  fiscal_data: undefined,
  fiscal_input: parseInvoiceFiscal(contrat.fiscal_data),
  fiscal_totals: parseInvoiceFiscal(contrat.fiscal_data) ? computeInvoiceFiscal(parseInvoiceFiscal(contrat.fiscal_data)!) : null,
  fiscal_issues: contrat.document_kind === "credit_note" && !parseInvoiceFiscal(contrat.fiscal_data) && !fromJsonString<any>(contrat.original_invoice?.immutable_snapshot, null)?.structured_invoice ? [] : invoiceFiscalIssues(parseInvoiceFiscal(contrat.fiscal_data), toNumber(contrat.solde_montant) + toNumber(contrat.arrhes_montant), {
    vatRegime: fromJsonString<any>(contrat.immutable_snapshot, null)?.issuer?.entity?.vat_regime ?? fromJsonString<any>(contrat.original_invoice?.immutable_snapshot, null)?.issuer?.entity?.vat_regime ?? contrat.gite?.fiscal_establishment?.fiscal_entity?.vat_regime,
    sellerVatNumber: invoiceSeller(contrat)?.vat_number,
    touristTax: Math.abs(toNumber(contrat.taxe_sejour_calculee ?? 0)) || (fromJsonString<unknown[]>(contrat.reservation_items, []).length >= 2 ? 1 : 0), credit: contrat.document_kind === "credit_note",
  }),
  structured_available: !!fromJsonString<any>(contrat.immutable_snapshot, null)?.structured_invoice,
});

const toInvoiceRenderInput = (invoice: any): InvoiceRenderInput => ({
  ...invoiceRenderInput(invoice),
  source_invoice_number: invoice.original_invoice?.numero_facture,
  seller: invoiceSeller(invoice),
});

const invoiceTemplatePaths = [
  path.join(process.cwd(), "server/templates/invoice.html"),
  path.join(process.cwd(), "templates/invoice.html"),
];

const regenerateStoredInvoicePdf = async (invoice: any) => {
  assertEditableInvoice(invoice);
  const calculation = parseInvoiceCalculation(invoice.calculation_snapshot);
  const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(invoice.numero_facture, invoice.date_debut);
  await generateInvoicePdf({
    invoice: toInvoiceRenderInput(invoice),
    gite: calculation.gite,
    totals: calculation.totals,
    outputPath: pdfAbsolutePath,
  });
  return { pdfRelativePath, pdfAbsolutePath };
};

const shouldRegenerateInvoicePdf = async (invoice: any, absolutePath: string) => {
  if (invoice.lifecycle_status !== "draft") return false;
  if (!invoice.pdf_path) return true;
  const [pdfStat, latestTemplateMtimeMs] = await Promise.all([
    fs.stat(absolutePath).catch(() => null),
    getLatestTemplateMtimeMs(invoiceTemplatePaths),
  ]);
  if (!pdfStat?.isFile()) return true;
  return pdfStat.mtimeMs + 1 < Math.max(new Date(invoice.date_derniere_modif).getTime(), latestTemplateMtimeMs);
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

const resolveLinkedReservation = async (reservationId: string | null | undefined, giteId: string) => {
  if (!reservationId) return null;
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { id: true, gite_id: true },
  });
  if (!reservation) return { error: "Réservation introuvable." } as const;
  if (reservation.gite_id && reservation.gite_id !== giteId) {
    return { error: "La réservation sélectionnée est rattachée à un autre gîte." } as const;
  }
  return { id: reservation.id } as const;
};

const resolveInvoiceReservationItems = async (reservationIds: string[]): Promise<InvoiceReservationItem[]> => {
  const ids = [...new Set(reservationIds)];
  if (ids.length < 2) return [];
  const reservations = await prisma.reservation.findMany({
    where: { id: { in: ids } },
    include: { gite: { select: { id: true, nom: true } } },
  });
  if (reservations.length !== ids.length) {
    throw new z.ZodError([{ code: "custom", path: ["reservation_ids"], message: "Une réservation sélectionnée est introuvable." }]);
  }
  const byId = new Map(reservations.map((reservation) => [reservation.id, reservation]));
  return ids.map((id) => {
    const reservation = byId.get(id)!;
    if (!reservation.gite_id || !reservation.gite) {
      throw new z.ZodError([{ code: "custom", path: ["reservation_ids"], message: "Toutes les réservations doivent être rattachées à un gîte." }]);
    }
    return {
      reservation_id: reservation.id,
      gite_id: reservation.gite_id,
      gite_nom: reservation.gite.nom,
      hote_nom: reservation.hote_nom,
      date_debut: reservation.date_entree.toISOString(),
      date_fin: reservation.date_sortie.toISOString(),
      nb_nuits: reservation.nb_nuits,
      nb_adultes: reservation.nb_adultes,
      nb_enfants_2_17: reservation.nb_enfants_2_17,
      montant: round2(
        toNumber(reservation.prix_total) -
          toNumber(reservation.remise_montant) +
          toNumber(reservation.frais_optionnels_montant)
      ),
    };
  });
};

const ensureReservationsCanBeInvoiced = async (reservationIds: string[], excludedInvoiceId?: string) => {
  if (reservationIds.length < 2) return;
  const invoices = await prisma.facture.findMany({
    where: { document_kind: "invoice" },
    select: { id: true, numero_facture: true, reservation_id: true, reservation_items: true },
  });
  const requested = new Set(reservationIds);
  const conflict = invoices.find((invoice) => {
    if (invoice.id === excludedInvoiceId) return false;
    const linkedIds = new Set([
      ...(invoice.reservation_id ? [invoice.reservation_id] : []),
      ...fromJsonString<InvoiceReservationItem[]>(invoice.reservation_items, []).map((item) => item.reservation_id),
    ]);
    return [...requested].some((id) => linkedIds.has(id));
  });
  if (conflict) {
    throw new z.ZodError([{
      code: "custom",
      path: ["reservation_ids"],
      message: `Une réservation sélectionnée est déjà incluse dans la facture ${conflict.numero_facture}.`,
    }]);
  }
};

const applyReservationItemsToTotals = (
  totals: ContractTotals,
  items: InvoiceReservationItem[],
  arrhesMontant: number,
  extraFees: InvoiceExtraFee[]
): ContractTotals => {
  if (items.length < 2) return addInvoiceExtraFeesToTotals(totals, extraFees);
  const reservationsTotal = round2(items.reduce((sum, item) => sum + item.montant, 0));
  const feesTotal = getInvoiceExtraFeesTotal(extraFees);
  const totalGlobal = round2(reservationsTotal + feesTotal);
  return {
    ...totals,
    nbNuits: items.reduce((sum, item) => sum + item.nb_nuits, 0),
    montantBase: reservationsTotal,
    totalSansOptions: reservationsTotal,
    optionsTotal: 0,
    taxeSejourCalculee: 0,
    totalGlobal,
    solde: round2(totalGlobal - arrhesMontant),
    optionsDetail: { draps: 0, linge: 0, menage: 0, departTardif: 0, chiens: 0 },
  };
};

type PreviewContext = {
  gite: NonNullable<Awaited<ReturnType<typeof prisma.gite.findUnique>>>;
  totals: ReturnType<typeof computeTotals>;
  invoiceForPdf: InvoiceRenderInput;
  fiscalValidation: { vatRegime?: string; sellerVatNumber?: string | null; sellerCountryCode?: string; touristTax: number };
};

type PreviewError = { error: { status: number; message: string } };

const buildPreviewContext = async (payload: unknown): Promise<PreviewContext | PreviewError> => {
  const data = previewSchema.parse(payload);
  const reservationItems = await resolveInvoiceReservationItems(data.reservation_ids);
  const gite = await prisma.gite.findUnique({ where: { id: data.gite_id }, include: invoiceReadInclude.gite.include });
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

  const totalsBase = computeTotals({
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
  const fraisSupplementaires = normalizeInvoiceExtraFees(data.frais_supplementaires);
  const totals = applyReservationItemsToTotals(totalsBase, reservationItems, arrhesMontant, fraisSupplementaires);

  const arrhesDateLimite = data.arrhes_date_limite ? parseDate(data.arrhes_date_limite) : addDays(new Date(), 15);
  if (data.arrhes_date_limite) ensureValidDate(arrhesDateLimite, "arrhes_date_limite");

  const invoiceForPdf: InvoiceRenderInput = {
    fiscal: data.fiscal_input ?? null,
    numero_facture: "BROUILLON",
    lifecycle_status: "draft",
    seller: invoiceSeller({ lifecycle_status: "draft", gite }),
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
    frais_supplementaires: fraisSupplementaires,
    reservation_items: reservationItems,
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

  return { gite, totals, invoiceForPdf, fiscalValidation: {
    vatRegime: gite.fiscal_establishment?.fiscal_entity?.vat_regime,
    sellerCountryCode: gite.fiscal_establishment?.fiscal_entity?.country_code,
    sellerVatNumber: invoiceForPdf.seller?.vat_number,
    touristTax: Math.abs(totals.taxeSejourCalculee) || (reservationItems.length >= 2 ? 1 : 0),
  } };
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
      include: invoiceReadInclude,
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

router.post("/fiscal-preview", async (req, res, next) => {
  try {
    const context = await buildPreviewContext(req.body);
    if ("error" in context) return res.status(context.error.status).json({ error: context.error.message });
    res.setHeader("Cache-Control", "no-store");
    res.json({ fiscal_input: proposeInvoiceFiscal(context.invoiceForPdf, context.totals), total_ttc: context.totals.totalGlobal, tourist_tax: context.totals.taxeSejourCalculee, validation_options: context.fiscalValidation });
  } catch (error) { next(error); }
});

router.get("/:id/structured", async (req, res, next) => {
  try {
    const invoice = await prisma.facture.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: "Facture introuvable" });
    const structured = fromJsonString<any>(invoice.immutable_snapshot, null)?.structured_invoice;
    if (invoice.lifecycle_status !== "issued" || !structured) throw invoiceError("Aucun instantané fiscal structuré émis n’est disponible pour ce document.");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.id}-structured.json"`);
    res.json(structured);
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const contrat = await prisma.facture.findUnique({
      where: { id: req.params.id },
      include: invoiceReadInclude,
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
    const reservationItems = await resolveInvoiceReservationItems(data.reservation_ids);
    await ensureReservationsCanBeInvoiced(data.reservation_ids);
    const gite = await prisma.gite.findUnique({ where: { id: data.gite_id } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable" });
    const occupancyError = reservationItems.length < 2 ? validateDocumentOccupancy({
      gite,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
    }) : null;
    if (occupancyError) throw occupancyError;
    const linkedReservation = reservationItems.length < 2
      ? await resolveLinkedReservation(data.reservation_id ?? null, data.gite_id)
      : null;
    if (linkedReservation && "error" in linkedReservation) {
      return res.status(400).json({ error: linkedReservation.error });
    }

    let dateDebut = parseDate(data.date_debut);
    let dateFin = parseDate(data.date_fin);
    if (reservationItems.length >= 2) {
      dateDebut = new Date(Math.min(...reservationItems.map((item) => new Date(item.date_debut).getTime())));
      dateFin = new Date(Math.max(...reservationItems.map((item) => new Date(item.date_fin).getTime())));
    }
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
    const fraisSupplementaires = normalizeInvoiceExtraFees(data.frais_supplementaires);
    const invoiceTotals = applyReservationItemsToTotals(totals, reservationItems, arrhesMontant, fraisSupplementaires);

    const numeroFacture = `BROUILLON-${new Date().getFullYear()}-${crypto.randomUUID()}`;

    const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(
      numeroFacture,
      dateDebut
    );

    const reservationId = reservationItems.length >= 2 ? reservationItems[0].reservation_id : await syncReservationFromDocument({
      explicitReservationId: data.reservation_id ?? null,
      giteId: data.gite_id,
      locataireNom: data.locataire_nom,
      locataireTel: data.locataire_tel,
      locataireEmail: data.locataire_email ?? null,
      dateDebut,
      dateFin,
      nbNuits: totals.nbNuits,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
      prixParNuit: data.prix_par_nuit,
      prixTotal: totals.montantBase,
      remiseMontant: data.remise_montant ?? 0,
      options,
      optionsTotal: totals.optionsTotal,
      additionalFees: fraisSupplementaires.map((fee) => ({
        label: fee.libelle,
        amount: fee.montant,
      })),
    });

    const contrat = await prisma.facture.create({
      data: {
        numero_facture: numeroFacture,
        lifecycle_status: "draft",
        calculation_snapshot: buildInvoiceCalculation(gite, invoiceTotals),
        fiscal_data: data.fiscal_input ? JSON.stringify(data.fiscal_input) : null,
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
        nb_nuits: invoiceTotals.nbNuits,
        prix_par_nuit: data.prix_par_nuit,
        remise_montant: data.remise_montant ?? 0,
        taxe_sejour_calculee: invoiceTotals.taxeSejourCalculee,
        options: encodeJsonField(options),
        arrhes_montant: arrhesMontant,
        arrhes_date_limite: parseDate(data.arrhes_date_limite),
        frais_supplementaires: encodeJsonField(fraisSupplementaires),
        reservation_items: encodeJsonField(reservationItems),
        solde_montant: invoiceTotals.solde,
        caution_montant: data.caution_montant,
        cheque_menage_montant: data.cheque_menage_montant,
        afficher_caution_phrase: data.afficher_caution_phrase ?? true,
        afficher_cheque_menage_phrase: data.afficher_cheque_menage_phrase ?? true,
        clauses: encodeJsonField(data.clauses ?? {}),
        pdf_path: pdfRelativePath,
        statut_paiement: data.statut_paiement ?? "non_reglee",
        notes: data.notes ?? null,
        reservation_id: reservationId,
      },
      include: invoiceReadInclude,
    });

    const invoiceForPdf = toInvoiceRenderInput(contrat);
    await generateInvoicePdf({
      invoice: invoiceForPdf,
      gite,
      totals: invoiceTotals,
      outputPath: pdfAbsolutePath,
    });
    await registerGeneratedDocumentAsset({ organizationId: getOrganizationId(), storageKey: `invoices/${contrat.id}.pdf`, absolutePath: pdfAbsolutePath, legacyPath: pdfRelativePath });
    await recordUsageEvent({ organizationId: getOrganizationId(), metricKey: "documents_generated", idempotencyKey: `invoice:${contrat.id}:generated`, source: "invoice_pdf", metadata: { documentType: "invoice" } });

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
    assertEditableInvoice(existing);
    if (existing.document_kind === "credit_note") throw invoiceError("Un avoir intégral ne peut pas être édité.");
    const reservationItems = await resolveInvoiceReservationItems(data.reservation_ids);
    await ensureReservationsCanBeInvoiced(data.reservation_ids, req.params.id);

    const gite = await prisma.gite.findUnique({ where: { id: data.gite_id } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable" });
    const occupancyError = reservationItems.length < 2 ? validateDocumentOccupancy({
      gite,
      nbAdultes: data.nb_adultes,
      nbEnfants: data.nb_enfants_2_17,
    }) : null;
    if (occupancyError) throw occupancyError;
    const linkedReservation = reservationItems.length < 2
      ? await resolveLinkedReservation(data.reservation_id ?? null, data.gite_id)
      : null;
    if (linkedReservation && "error" in linkedReservation) {
      return res.status(400).json({ error: linkedReservation.error });
    }

    let dateDebut = parseDate(data.date_debut);
    let dateFin = parseDate(data.date_fin);
    if (reservationItems.length >= 2) {
      dateDebut = new Date(Math.min(...reservationItems.map((item) => new Date(item.date_debut).getTime())));
      dateFin = new Date(Math.max(...reservationItems.map((item) => new Date(item.date_fin).getTime())));
    }
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
    const fraisSupplementaires = normalizeInvoiceExtraFees(data.frais_supplementaires);
    const invoiceTotals = applyReservationItemsToTotals(totals, reservationItems, arrhesMontant, fraisSupplementaires);

    const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(
      existing.numero_facture,
      dateDebut
    );

    const contrat = await withEditableInvoice(req.params.id, data.revision ?? existing.revision, async (tx) => {
      const reservationId = reservationItems.length >= 2 ? reservationItems[0].reservation_id : await syncReservationFromDocument({
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
        nbEnfants: data.nb_enfants_2_17,
        prixParNuit: data.prix_par_nuit,
        prixTotal: totals.montantBase,
        remiseMontant: data.remise_montant ?? 0,
        options,
        optionsTotal: totals.optionsTotal,
        additionalFees: fraisSupplementaires.map((fee) => ({
          label: fee.libelle,
          amount: fee.montant,
        })),
      }, tx);

      return tx.facture.update({
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
          nb_nuits: invoiceTotals.nbNuits,
          prix_par_nuit: data.prix_par_nuit,
          remise_montant: data.remise_montant ?? 0,
          taxe_sejour_calculee: invoiceTotals.taxeSejourCalculee,
          options: encodeJsonField(options),
          arrhes_montant: arrhesMontant,
          arrhes_date_limite: parseDate(data.arrhes_date_limite),
          frais_supplementaires: encodeJsonField(fraisSupplementaires),
          reservation_items: encodeJsonField(reservationItems),
          solde_montant: invoiceTotals.solde,
          caution_montant: data.caution_montant,
          cheque_menage_montant: data.cheque_menage_montant,
          afficher_caution_phrase: data.afficher_caution_phrase ?? true,
          afficher_cheque_menage_phrase: data.afficher_cheque_menage_phrase ?? true,
          clauses: encodeJsonField(data.clauses ?? {}),
          pdf_path: pdfRelativePath,
          calculation_snapshot: buildInvoiceCalculation(gite, invoiceTotals),
          fiscal_data: data.fiscal_input ? JSON.stringify(data.fiscal_input) : null,
          revision: { increment: 1 },
          statut_paiement: data.statut_paiement ?? "non_reglee",
          notes: data.notes ?? null,
          reservation_id: reservationId,
        },
        include: invoiceReadInclude,
      });
    });

    const invoiceForPdf = toInvoiceRenderInput(contrat);
    await generateInvoicePdf({
      invoice: invoiceForPdf,
      gite,
      totals: invoiceTotals,
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
    const contrat = await updateInvoicePayment(req.params.id, data.statut_paiement);
    res.json(hydrateInvoice(contrat));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/issue", async (req, res, next) => {
  try {
    const { revision } = issuanceSchema.parse(req.body);
    const user = await getAuthenticatedAppUser(req);
    const invoice = await issueInvoice(req.params.id, revision, { userId: user?.id, requestId: String(res.getHeader("X-Request-Id") ?? "") });
    await recordUsageEvent({ organizationId: getOrganizationId(), metricKey: "documents_generated", idempotencyKey: `invoice:${invoice.id}:generated`, source: "invoice_pdf", metadata: { documentType: invoice.document_kind } });
    res.json(hydrateInvoice(invoice));
  } catch (error) { next(error); }
});

router.post("/:id/credit-note", async (req, res, next) => {
  try {
    const { reason } = creditNoteSchema.parse(req.body);
    const user = await getAuthenticatedAppUser(req);
    const invoice = await createFullCreditNote(req.params.id, reason, { userId: user?.id, requestId: String(res.getHeader("X-Request-Id") ?? "") });
    res.status(201).json(hydrateInvoice(invoice));
  } catch (error) { next(error); }
});

router.post("/:id/send-email", async (req, res, next) => {
  try {
    const emailDraft = sendEmailSchema.parse(req.body ?? {});
    const contrat = await prisma.facture.findUnique({
      where: { id: req.params.id },
      include: invoiceReadInclude,
    });
    if (!contrat) return res.status(404).json({ error: "Facture introuvable" });

    const { absolutePath } = await readArchivedInvoicePdf(contrat);

    const documentUrl = new URL(`/api/invoices/${req.params.id}/pdf`, `${req.protocol}://${req.get("host")}`).toString();
    await sendInvoiceEmail(hydrateInvoice(contrat), absolutePath, {
      documentUrl,
      deliveryMode: emailDraft.deliveryMode,
      customMessage: emailDraft,
    });

    const updated = await prisma.facture.update({
      where: { id: req.params.id },
      data: { date_envoi_email: new Date() },
      include: invoiceReadInclude,
    });

    res.json(hydrateInvoice(updated));
  } catch (err) {
    return handleDocumentEmailError(err, res, next);
  }
});

router.post("/:id/regenerate", async (req, res, next) => {
  try {
    const contrat = await prisma.facture.findUnique({
      where: { id: req.params.id },
      include: invoiceReadInclude,
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
    const storedPath = await deleteInvoiceDraft(req.params.id);
    if (storedPath) await fs.unlink(path.resolve(process.cwd(), storedPath)).catch(() => undefined);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const contrat = await prisma.facture.findUnique({
      where: { id: req.params.id },
      include: invoiceReadInclude,
    });
    if (!contrat) return res.status(404).json({ error: "Facture introuvable" });

    if (contrat.lifecycle_status !== "draft") {
      const { contents } = await readArchivedInvoicePdf(contrat);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.type("application/pdf").send(contents);
    }

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

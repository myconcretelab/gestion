import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  Facture,
  Gite,
  Prisma,
  FiscalEntity,
  FiscalEstablishment,
} from "@prisma/client";
import { z } from "zod";
import { fiscalEntityMissingFields } from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import { getOrganizationId } from "../../services/organizationContext.js";
import {
  generateInvoicePdf,
  type GiteLike,
  type InvoiceRenderInput,
} from "../../services/pdfService.js";
import type {
  ContractTotals,
  OptionsInput,
} from "../../services/contractCalculator.js";
import {
  resolveDataDir,
  resolveStoredDataFilePath,
} from "../../utils/paths.js";
import { encodeJsonField, fromJsonString } from "../../utils/jsonFields.js";
import { round2, toNumber } from "../../utils/money.js";

export const invoiceReadInclude = {
  gite: {
    include: { fiscal_establishment: { include: { fiscal_entity: true } } },
  },
  original_invoice: {
    select: { id: true, numero_facture: true, immutable_snapshot: true },
  },
  credit_notes: {
    select: { id: true, numero_facture: true, lifecycle_status: true },
  },
} as const satisfies Prisma.FactureInclude;

export const invoiceError = (message: string, status = 409) =>
  Object.assign(new Error(message), { status });
export const assertEditableInvoice = (
  invoice: Pick<Facture, "lifecycle_status" | "document_kind">,
) => {
  if (invoice.lifecycle_status !== "draft")
    throw invoiceError(
      "Cette facture est verrouillée. Son contenu ne peut plus être modifié ou supprimé.",
    );
};

export const invoiceRenderInput = (invoice: Facture): InvoiceRenderInput => ({
  numero_facture: invoice.numero_facture,
  lifecycle_status: invoice.lifecycle_status,
  document_kind: invoice.document_kind,
  issued_at: invoice.issued_at,
  locataire_nom: invoice.locataire_nom,
  locataire_adresse: invoice.locataire_adresse,
  locataire_tel: invoice.locataire_tel,
  nb_adultes: invoice.nb_adultes,
  nb_enfants_2_17: invoice.nb_enfants_2_17,
  date_debut: invoice.date_debut,
  heure_arrivee: invoice.heure_arrivee,
  date_fin: invoice.date_fin,
  heure_depart: invoice.heure_depart,
  prix_par_nuit: invoice.prix_par_nuit,
  remise_montant: invoice.remise_montant,
  frais_supplementaires: fromJsonString(invoice.frais_supplementaires, []),
  reservation_items: fromJsonString(invoice.reservation_items, []),
  arrhes_montant: invoice.arrhes_montant,
  arrhes_date_limite: invoice.arrhes_date_limite,
  solde_montant: invoice.solde_montant,
  cheque_menage_montant: invoice.cheque_menage_montant,
  caution_montant: invoice.caution_montant,
  afficher_caution_phrase: invoice.afficher_caution_phrase,
  afficher_cheque_menage_phrase: invoice.afficher_cheque_menage_phrase,
  options: fromJsonString<OptionsInput>(invoice.options, {}),
  clauses: fromJsonString(invoice.clauses, {}),
  statut_paiement: invoice.statut_paiement as "reglee" | "non_reglee",
  notes: invoice.notes,
});

// Only rendering/pricing fields: never retain iCal export tokens or integration configuration.
export const snapshotInvoiceGite = (gite: Gite): GiteLike => ({
  nom: gite.nom,
  adresse_ligne1: gite.adresse_ligne1,
  adresse_ligne2: gite.adresse_ligne2,
  proprietaires_noms: gite.proprietaires_noms,
  proprietaires_adresse: gite.proprietaires_adresse,
  capacite_max: gite.capacite_max,
  site_web: gite.site_web,
  email: gite.email,
  telephones: fromJsonString(gite.telephones, []),
  iban: gite.iban,
  bic: gite.bic,
  titulaire: gite.titulaire,
  regle_animaux_acceptes: gite.regle_animaux_acceptes,
  regle_bois_premiere_flambee: gite.regle_bois_premiere_flambee,
  regle_tiers_personnes_info: gite.regle_tiers_personnes_info,
  taxe_sejour_par_personne_par_nuit: toNumber(
    gite.taxe_sejour_par_personne_par_nuit,
  ),
  options_draps_par_lit: toNumber(gite.options_draps_par_lit),
  options_linge_toilette_par_personne: toNumber(
    gite.options_linge_toilette_par_personne,
  ),
  options_menage_forfait: toNumber(gite.options_menage_forfait),
  options_depart_tardif_forfait: toNumber(gite.options_depart_tardif_forfait),
  options_chiens_forfait: toNumber(gite.options_chiens_forfait),
});

export type InvoiceCalculation = {
  version: 1;
  gite: GiteLike;
  totals: ContractTotals;
};
const totalsSchema = z.object({
  nbNuits: z.number().int().positive(),
  montantBase: z.number().finite(),
  totalSansOptions: z.number().finite(),
  optionsTotal: z.number().finite(),
  taxeSejourCalculee: z.number().finite(),
  solde: z.number().finite(),
  totalGlobal: z.number().finite(),
  optionsDetail: z.object({
    draps: z.number().finite(),
    linge: z.number().finite(),
    menage: z.number().finite(),
    departTardif: z.number().finite(),
    chiens: z.number().finite(),
  }),
});
export const parseInvoiceCalculation = (value: unknown): InvoiceCalculation => {
  const parsed = fromJsonString<InvoiceCalculation | null>(value, null);
  if (
    !parsed ||
    parsed.version !== 1 ||
    !parsed.gite ||
    !totalsSchema.safeParse(parsed.totals).success
  ) {
    throw invoiceError(
      "Réenregistrez le brouillon pour figer ses éléments de calcul avant validation.",
    );
  }
  return parsed;
};
export const buildInvoiceCalculation = (gite: Gite, totals: ContractTotals) =>
  JSON.stringify({
    version: 1,
    gite: snapshotInvoiceGite(gite),
    totals,
  } satisfies InvoiceCalculation);

type Issuer = { entity: FiscalEntity; establishment: FiscalEstablishment };
type Archive = {
  version: 1;
  issuer: Issuer;
  calculation: InvoiceCalculation;
  invoice: InvoiceRenderInput;
  buyer: { name: string; address: string; email: string | null; phone: string };
};
const parseArchive = (value: unknown): Archive => {
  const snapshot = fromJsonString<Archive | null>(value, null);
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !snapshot.issuer?.entity ||
    !snapshot.issuer?.establishment ||
    !snapshot.invoice
  ) {
    throw invoiceError(
      "Cette facture ne possède pas d’instantané d’émission exploitable.",
    );
  }
  parseInvoiceCalculation(snapshot.calculation);
  return snapshot;
};

export const withEditableInvoice = async <T>(
  id: string,
  revision: number,
  work: (tx: TenantTransactionClient) => Promise<T>,
) => {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.facture.findUnique({ where: { id } });
        if (!invoice) throw invoiceError("Facture introuvable.", 404);
        assertEditableInvoice(invoice);
        if (invoice.document_kind === "credit_note")
          throw invoiceError(
            "Un avoir intégral reprend les montants de sa facture source et ne peut pas être édité.",
          );
        if (invoice.revision !== revision)
          throw invoiceError(
            "Le brouillon a changé. Rechargez la page avant de l’enregistrer.",
          );
        return work(tx);
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    throw normalizeConflict(error);
  }
};

const normalizeConflict = (error: unknown) =>
  ["P2034", "P2028", "P1008"].includes(
    String((error as { code?: string })?.code),
  )
    ? invoiceError(
        "Une autre opération a modifié cette facture. Rechargez la page puis réessayez.",
      )
    : error;

const issuerForInvoice = async (
  tx: TenantTransactionClient,
  invoice: Facture,
): Promise<Issuer> => {
  if (invoice.document_kind === "credit_note") {
    const original = await tx.facture.findUnique({
      where: { id: invoice.credited_invoice_id ?? "" },
    });
    if (!original || original.lifecycle_status !== "issued")
      throw invoiceError("Facture source introuvable ou non émise.");
    return parseArchive(original.immutable_snapshot).issuer;
  }
  const gite = await tx.gite.findUnique({
    where: { id: invoice.gite_id },
    include: { fiscal_establishment: { include: { fiscal_entity: true } } },
  });
  const establishment = gite?.fiscal_establishment;
  if (!establishment)
    throw invoiceError(
      "Rattachez d’abord ce gîte à un établissement facturant dans sa fiche.",
    );
  const { fiscal_entity: entity, ...establishmentData } = establishment;
  const missing = [
    ...fiscalEntityMissingFields(entity),
    ...(!establishment.siret ? ["SIRET"] : []),
  ];
  if (missing.length)
    throw invoiceError(
      `Complétez l’entreprise avant validation : ${missing.join(", ")}.`,
    );
  if (!invoice.locataire_adresse.trim())
    throw invoiceError(
      "L’adresse du client est nécessaire pour valider la facture.",
    );
  const items = fromJsonString<Array<{ gite_id: string }>>(
    invoice.reservation_items,
    [],
  );
  const giteIds = [
    ...new Set([invoice.gite_id, ...items.map((item) => item.gite_id)]),
  ];
  const gites = await tx.gite.findMany({
    where: { id: { in: giteIds } },
    include: { fiscal_establishment: true },
  });
  if (
    gites.length !== giteIds.length ||
    gites.some(
      (item) => item.fiscal_establishment?.fiscal_entity_id !== entity.id,
    )
  ) {
    throw invoiceError(
      "Une facture ne peut regrouper que des gîtes rattachés à la même entreprise.",
    );
  }
  return { entity, establishment: establishmentData };
};

type Actor = { userId?: string; requestId?: string };
export const issueInvoice = async (
  id: string,
  revision: number,
  actor: Actor = {},
) => {
  if (
    process.env.SKIP_PDF_GENERATION === "1" &&
    process.env.NODE_ENV !== "test"
  ) {
    throw invoiceError(
      "La validation nécessite la génération réelle du PDF.",
      503,
    );
  }
  // An issuance is all-or-nothing: sequence, snapshot, PDF reference, asset and audit event.
  for (let attempt = 0; attempt < 3; attempt++) {
    let generatedPath: string | null = null;
    try {
      return await prisma.$transaction(
        async (tx) => {
          const invoice = await tx.facture.findUnique({
            where: { id },
            include: invoiceReadInclude,
          });
          if (!invoice) throw invoiceError("Facture introuvable.", 404);
          if (invoice.lifecycle_status === "issued") return invoice; // Retry never consumes another number.
          assertEditableInvoice(invoice);
          if (invoice.revision !== revision)
            throw invoiceError(
              "Le brouillon a changé. Rechargez-le avant de le valider.",
            );
          const issuer = await issuerForInvoice(tx, invoice);
          const calculation = parseInvoiceCalculation(
            invoice.calculation_snapshot,
          );
          if (
            round2(calculation.totals.solde) !==
              round2(toNumber(invoice.solde_montant)) ||
            round2(calculation.totals.totalGlobal) !==
              round2(
                toNumber(invoice.solde_montant) +
                  toNumber(invoice.arrhes_montant),
              )
          ) {
            throw invoiceError(
              "Les montants du brouillon sont incohérents. Réenregistrez-le avant validation.",
            );
          }
          const organizationId = getOrganizationId();
          const now = new Date();
          const year = Number(
            new Intl.DateTimeFormat("fr", {
              timeZone: "Europe/Paris",
              year: "numeric",
            }).format(now),
          );
          const sequence = await tx.invoiceSequence.upsert({
            where: {
              organization_id_fiscal_entity_id_year: {
                organization_id: organizationId,
                fiscal_entity_id: issuer.entity.id,
                year,
              },
            },
            create: {
              fiscal_entity_id: issuer.entity.id,
              year,
              last_number: 1,
              last_issued_at: now,
            },
            update: { last_number: { increment: 1 }, last_issued_at: now },
          });
          const previous = await tx.facture.findFirst({
            where: {
              fiscal_entity_id: issuer.entity.id,
              lifecycle_status: "issued",
            },
            orderBy: { issued_at: "desc" },
          });
          if (previous?.issued_at && previous.issued_at > now)
            throw invoiceError(
              "L’horloge serveur est antérieure à la dernière émission. Corrigez-la avant de valider.",
            );
          const issuedAt = now;
          const number = `F-${year}-${issuer.entity.siren}-${String(sequence.last_number).padStart(6, "0")}`;
          const seller = {
            legal_name: issuer.entity.legal_name,
            siren: issuer.entity.siren,
            siret: issuer.establishment.siret,
            vat_number: issuer.entity.vat_number,
            email: issuer.entity.email,
            address: [
              issuer.entity.address_line1,
              issuer.entity.address_line2,
              issuer.entity.postal_code,
              issuer.entity.city,
              issuer.entity.country_code,
            ]
              .filter(Boolean)
              .join(" · "),
          };
          const archive: Archive = {
            version: 1,
            issuer,
            calculation,
            invoice: {
              ...invoiceRenderInput(invoice),
              numero_facture: number,
              lifecycle_status: "issued",
              issued_at: issuedAt,
              seller,
              source_invoice_number: invoice.original_invoice?.numero_facture,
            },
            buyer: {
              name: invoice.locataire_nom,
              address: invoice.locataire_adresse,
              email: invoice.locataire_email,
              phone: invoice.locataire_tel,
            },
          };
          const absolutePath = path.join(
            resolveDataDir(),
            "organizations",
            organizationId,
            "invoices",
            "issued",
            String(year),
            `${id}-${crypto.randomUUID()}.pdf`,
          );
          generatedPath = absolutePath;
          await generateInvoicePdf({
            invoice: archive.invoice,
            gite: calculation.gite,
            totals: calculation.totals,
            outputPath: absolutePath,
          });
          const contents = await fs.readFile(absolutePath);
          const checksum = crypto
            .createHash("sha256")
            .update(contents)
            .digest("hex");
          const relativePath = path.relative(process.cwd(), absolutePath);
          const saved = await tx.facture.update({
            where: { id, lifecycle_status: "draft", revision },
            data: {
              numero_facture: number,
              lifecycle_status: "issued",
              issued_at: issuedAt,
              fiscal_entity_id: issuer.entity.id,
              fiscal_establishment_id: issuer.establishment.id,
              immutable_snapshot: JSON.stringify(archive),
              pdf_path: relativePath,
              pdf_sha256: checksum,
              revision: { increment: 1 },
            },
            include: invoiceReadInclude,
          });
          const storageKey = `invoices/${id}.pdf`;
          const asset = {
            legacy_path: relativePath,
            content_type: "application/pdf",
            size_bytes: contents.byteLength,
            checksum_sha256: checksum,
            status: "active",
            deleted_at: null,
          };
          await tx.documentAsset.upsert({
            where: {
              organization_id_storage_key: {
                organization_id: organizationId,
                storage_key: storageKey,
              },
            },
            create: {
              organization_id: organizationId,
              storage_key: storageKey,
              ...asset,
            },
            update: asset,
          });
          await tx.auditLog.create({
            data: {
              organization_id: organizationId,
              action: "invoice.issued",
              resource_type: "invoice",
              resource_id: id,
              user_id: actor.userId,
              request_id: actor.requestId,
              metadata_json: JSON.stringify({
                number,
                document_kind: invoice.document_kind,
                pdf_sha256: checksum,
                fiscal_entity_id: issuer.entity.id,
              }),
            },
          });
          return saved;
        },
        { isolationLevel: "Serializable", timeout: 60_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (generatedPath) {
        // A lost commit acknowledgement must never delete a successfully archived PDF.
        const persisted = await prisma.facture
          .findUnique({ where: { id }, include: invoiceReadInclude })
          .catch(() => undefined);
        const referenced =
          persisted &&
          path.resolve(process.cwd(), persisted.pdf_path) === generatedPath;
        if (persisted !== undefined && !referenced)
          await fs.unlink(generatedPath).catch(() => undefined);
        if (persisted?.lifecycle_status === "issued") return persisted;
      }
      if (
        attempt < 2 &&
        ["P2034", "P2002"].includes(String((error as { code?: string })?.code))
      )
        continue;
      throw normalizeConflict(error);
    }
  }
  throw invoiceError("Validation impossible. Réessayez.");
};

export const readArchivedInvoicePdf = async (
  invoice: Pick<Facture, "pdf_path" | "pdf_sha256" | "lifecycle_status">,
) => {
  if (invoice.lifecycle_status === "draft")
    throw invoiceError("Validez la facture avant de la transmettre.");
  const absolutePath =
    resolveStoredDataFilePath(invoice.pdf_path) ??
    path.resolve(process.cwd(), invoice.pdf_path);
  const contents = await fs.readFile(absolutePath).catch(() => {
    throw invoiceError(
      "Le PDF archivé est absent. Restaurez le fichier original depuis une sauvegarde.",
    );
  });
  if (
    invoice.pdf_sha256 &&
    crypto.createHash("sha256").update(contents).digest("hex") !==
      invoice.pdf_sha256
  ) {
    throw invoiceError(
      "L’empreinte du PDF archivé ne correspond plus. Restaurez le fichier original depuis une sauvegarde.",
    );
  }
  return { absolutePath, contents };
};

export const deleteInvoiceDraft = async (id: string) =>
  prisma.$transaction(
    async (tx) => {
      const invoice = await tx.facture.findUnique({ where: { id } });
      if (!invoice) throw invoiceError("Facture introuvable.", 404);
      assertEditableInvoice(invoice);
      await tx.facture.delete({ where: { id, lifecycle_status: "draft" } });
      await tx.documentAsset.updateMany({
        where: { storage_key: `invoices/${id}.pdf` },
        data: { status: "deleted", deleted_at: new Date() },
      });
      await tx.documentShare.updateMany({
        where: { document_type: "invoice", document_id: id },
        data: { revoked_at: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organization_id: getOrganizationId(),
          action: "invoice.draft_deleted",
          resource_type: "invoice",
          resource_id: id,
        },
      });
      return invoice.pdf_path;
    },
    { isolationLevel: "Serializable" },
  );

export const createFullCreditNote = async (
  id: string,
  reason: string,
  actor: Actor = {},
) => {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const source = await tx.facture.findUnique({
          where: { id },
          include: { credit_notes: true },
        });
        if (!source) throw invoiceError("Facture introuvable.", 404);
        if (
          source.document_kind !== "invoice" ||
          source.lifecycle_status !== "issued"
        )
          throw invoiceError(
            "Un avoir automatique nécessite une facture émise avec son instantané. Les factures historiques nécessitent une reprise vérifiée de l’émetteur et des montants.",
          );
        if (source.credit_notes[0]) return source.credit_notes[0];
        const archive = parseArchive(source.immutable_snapshot);
        const total = round2(
          toNumber(source.solde_montant) + toNumber(source.arrhes_montant),
        );
        if (total <= 0)
          throw invoiceError(
            "Cette facture n’a pas de montant positif à annuler.",
          );
        const {
          id: _id,
          numero_facture: _number,
          date_creation: _created,
          date_derniere_modif: _modified,
          credit_notes: _notes,
          issued_at: _issued,
          immutable_snapshot: _archive,
          pdf_sha256: _sha,
          ...copy
        } = source;
        const totals: ContractTotals = {
          ...archive.calculation.totals,
          montantBase: -total,
          totalSansOptions: -total,
          totalGlobal: -total,
          solde: -total,
          taxeSejourCalculee: -archive.calculation.totals.taxeSejourCalculee,
          optionsTotal: 0,
          optionsDetail: {
            draps: 0,
            linge: 0,
            menage: 0,
            departTardif: 0,
            chiens: 0,
          },
        };
        const credit = await tx.facture.create({
          data: {
            ...copy,
            numero_facture: `BROUILLON-${new Date().getFullYear()}-${crypto.randomUUID()}`,
            lifecycle_status: "draft",
            document_kind: "credit_note",
            revision: 0,
            credited_invoice_id: source.id,
            reservation_id: null,
            reservation_items: encodeJsonField([]),
            frais_supplementaires: encodeJsonField([]),
            options: encodeJsonField({}),
            clauses: encodeJsonField(fromJsonString(source.clauses, {})),
            prix_par_nuit: 0,
            remise_montant: 0,
            arrhes_montant: 0,
            solde_montant: -total,
            taxe_sejour_calculee: totals.taxeSejourCalculee,
            date_envoi_email: null,
            statut_paiement: "non_reglee",
            notes: reason,
            calculation_snapshot: JSON.stringify({
              ...archive.calculation,
              totals,
            }),
            pdf_path: "",
          },
        });
        await tx.auditLog.create({
          data: {
            organization_id: getOrganizationId(),
            action: "invoice.credit_draft_created",
            resource_type: "invoice",
            resource_id: credit.id,
            user_id: actor.userId,
            request_id: actor.requestId,
            metadata_json: JSON.stringify({ original_invoice_id: id, reason }),
          },
        });
        return credit;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    throw normalizeConflict(error);
  }
};

export const shareableInvoice = async (id: string) => {
  const invoice = await prisma.facture.findUnique({ where: { id } });
  if (invoice?.lifecycle_status === "draft")
    throw invoiceError("Validez la facture avant de la partager.");
  return invoice;
};

export const updateInvoicePayment = async (
  id: string,
  status: "reglee" | "non_reglee",
) =>
  prisma.$transaction(
    async (tx) => {
      const existing = await tx.facture.findUnique({ where: { id } });
      if (!existing) throw invoiceError("Facture introuvable.", 404);
      const saved = await tx.facture.update({
        where: { id },
        data: {
          statut_paiement: status,
          ...(existing.lifecycle_status === "draft"
            ? { revision: { increment: 1 } }
            : {}),
        },
        include: invoiceReadInclude,
      });
      await tx.auditLog.create({
        data: {
          organization_id: getOrganizationId(),
          action: "invoice.payment_updated",
          resource_type: "invoice",
          resource_id: id,
          metadata_json: JSON.stringify({
            previous: existing.statut_paiement,
            current: status,
          }),
        },
      });
      return saved;
    },
    { isolationLevel: "Serializable" },
  );

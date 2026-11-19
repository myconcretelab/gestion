import crypto from "node:crypto";
import {
  invoiceReservationServices,
  reservationAmountToCollect,
  reservationTouristTax,
  touristTaxResultSchema,
  type TouristTaxResult,
} from "@contrats/shared";
import { z } from "zod";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import type {
  ContractTotals,
  OptionsInput,
} from "../../services/contractCalculator.js";
import { encodeJsonField, fromJsonString } from "../../utils/jsonFields.js";
import { getPdfPaths } from "../../utils/paths.js";
import { proposeInvoiceFiscal } from "./invoiceFiscal.js";
import {
  buildInvoiceCalculation,
  invoiceError,
  readInvoiceShare,
} from "./invoiceLifecycle.js";

const cents = (amount: number) => Math.round(amount * 100);
const amountCents = z.number().int().nonnegative().max(1_000_000_000);
export const splitInvoiceSchema = z.object({
  requestId: z.uuid(),
  totalCents: amountCents,
  recipients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(250),
        email: z.union([z.literal(""), z.email().max(254)]).optional(),
        cents: amountCents.min(1),
        taxCents: amountCents.default(0),
      }),
    )
    .min(1)
    .max(50),
});

type SplitInput = z.infer<typeof splitInvoiceSchema>;
type Fee = { key: string; label: string; cents: number };
const linkedInvoiceSelect = {
  id: true,
  document_kind: true,
  lifecycle_status: true,
  numero_facture: true,
  reservation_id: true,
  reservation_items: true,
  calculation_snapshot: true,
  locataire_nom: true,
  solde_montant: true,
  arrhes_montant: true,
  taxe_sejour_calculee: true,
  statut_paiement: true,
  gite_id: true,
  date_debut: true,
  date_fin: true,
  credit_notes: { where: { lifecycle_status: "issued" }, select: { id: true } },
} as const;

const splitConflict = () =>
  invoiceError(
    "Ce séjour est en facturation répartie. Ouvrez « Répartir la facturation » depuis la réservation pour consulter ou compléter ses factures.",
  );

export const assertNoActiveSplitInvoices = async (
  tx: TenantTransactionClient,
  reservationIds: string[],
) => {
  if (!reservationIds.length) return;
  const linked = await tx.facture.findMany({
    where: {
      reservation_id: { in: reservationIds },
      document_kind: "invoice",
      credit_notes: { none: { lifecycle_status: "issued" } },
    },
    select: { calculation_snapshot: true },
  });
  if (linked.some((invoice) => readInvoiceShare(invoice.calculation_snapshot)))
    throw splitConflict();
};

const loadSplit = async (
  tx: TenantTransactionClient,
  reservationId: string,
) => {
  const reservation = await tx.reservation.findUnique({
    where: { id: reservationId },
    include: { gite: true },
  });
  if (!reservation) throw invoiceError("Réservation introuvable.", 404);
  const gite = reservation.gite;
  if (!gite)
    throw invoiceError("La réservation doit être rattachée à un gîte.");

  const documents = (
    await tx.facture.findMany({
      where: { document_kind: "invoice" },
      select: linkedInvoiceSelect,
      orderBy: [{ date_creation: "asc" }, { id: "asc" }],
    })
  ).filter(
    (invoice) =>
      invoice.reservation_id === reservationId ||
      fromJsonString<Array<{ reservation_id: string }>>(
        invoice.reservation_items,
        [],
      ).some((item) => item.reservation_id === reservationId),
  );
  const invoices = documents.map((invoice) => ({
    id: invoice.id,
    number:
      invoice.lifecycle_status === "draft" ? null : invoice.numero_facture,
    name: invoice.locataire_nom,
    lifecycle: invoice.lifecycle_status,
    paid: invoice.statut_paiement === "reglee",
    credited: invoice.credit_notes.length > 0,
    cents: cents(
      Number(invoice.solde_montant) + Number(invoice.arrhes_montant),
    ),
  }));

  const tax = reservationTouristTax(reservation);
  const totalCents = cents(reservationAmountToCollect(reservation));
  const hostTaxCents = cents(tax?.host_amount ?? 0);
  const fees = invoiceReservationServices(
    {
      ...reservation,
      options: fromJsonString<OptionsInput>(reservation.options, {}),
    },
    gite,
  )
    .services.map((service) => ({
      key: service.key,
      label: service.label,
      cents: cents(service.quantity * service.unit_price_ttc),
    }))
    .filter((fee) => fee.cents > 0);
  const active = documents.filter((invoice) => !invoice.credit_notes.length);
  const activeShares = active.map((invoice) => ({
    invoice,
    share: readInvoiceShare(invoice.calculation_snapshot),
  }));
  const remainingCents =
    totalCents -
    activeShares.reduce(
      (sum, { invoice, share }) =>
        sum +
        (share
          ? cents(
              Number(invoice.solde_montant) + Number(invoice.arrhes_montant),
            )
          : 0),
      0,
    );
  const remainingTaxCents =
    hostTaxCents -
    activeShares.reduce(
      (sum, { invoice, share }) =>
        sum + (share ? cents(Number(invoice.taxe_sejour_calculee)) : 0),
      0,
    );

  const feeBalance = new Map(fees.map((fee) => [fee.key, fee]));
  let allocationChanged = false;
  for (const { invoice, share } of activeShares) {
    if (!share) continue;
    if (
      share.stayTotalCents !== totalCents ||
      invoice.gite_id !== gite.id ||
      invoice.date_debut.getTime() !== reservation.date_entree.getTime() ||
      invoice.date_fin.getTime() !== reservation.date_sortie.getTime()
    )
      allocationChanged = true;
    for (const fee of share.fees) {
      const balance = feeBalance.get(fee.key);
      if (!balance) {
        allocationChanged = true;
        continue;
      }
      balance.cents -= fee.cents;
    }
  }
  const remainingFees = [...feeBalance.values()];
  const feesCents = remainingFees.reduce((sum, fee) => sum + fee.cents, 0);
  const blockedReason = activeShares.some(({ share }) => !share)
    ? "Une facture couvre déjà ce séjour. Consultez-la avant de créer une répartition."
    : allocationChanged ||
        remainingTaxCents < 0 ||
        remainingFees.some((fee) => fee.cents < 0)
      ? "Le séjour a changé depuis la répartition. Vérifiez les factures existantes avant de poursuivre."
      : tax?.issues.length
        ? tax.issues.join(" ")
        : remainingCents < remainingTaxCents + feesCents
          ? "Vérifiez le prix, les frais et la taxe de séjour de cette réservation."
          : null;
  const summary = {
    totalCents,
    remainingCents: Math.max(0, remainingCents),
    remainingTaxCents: Math.max(0, remainingTaxCents),
    canComplete: activeShares.some(({ share }) => Boolean(share)),
    blockedReason,
    invoices,
  };

  return { reservation, gite, tax, documents, remainingFees, summary };
};

export const getInvoiceSplit = async (reservationId: string) =>
  (await loadSplit(prisma, reservationId)).summary;

// Largest-remainder allocation preserves every cent and never exceeds a recipient's available balance.
const allocateFee = (value: number, balances: number[]) => {
  const total = balances.reduce((sum, balance) => sum + balance, 0);
  if (!value) return balances.map(() => 0);
  const divisor = BigInt(total);
  const weights = balances.map((balance, index) => {
    const weighted = BigInt(value) * BigInt(balance);
    return {
      index,
      cents: Number(weighted / divisor),
      remainder: Number(weighted % divisor),
    };
  });
  const remaining =
    value - weights.reduce((sum, weight) => sum + weight.cents, 0);
  const allocated = weights.map((weight) => weight.cents);
  for (const weight of weights
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, remaining)) {
    allocated[weight.index] += 1;
  }
  return allocated;
};

const shareTax = (
  tax: TouristTaxResult | null,
  taxCents: number,
  lodgingCents: number,
) => {
  if (!tax) return undefined;
  if (tax.collector !== "host")
    return [
      touristTaxResultSchema.parse({ ...tax, stay_label: "Séjour complet" }),
    ];
  return [
    touristTaxResultSchema.parse({
      ...tax,
      allocated: true,
      amount: taxCents / 100,
      host_amount: taxCents / 100,
      accommodation_amount: lodgingCents / 100,
    }),
  ];
};

export const createInvoiceSplit = async (
  reservationId: string,
  data: SplitInput,
) => {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const { reservation, gite, tax, documents, remainingFees, summary } =
          await loadSplit(tx, reservationId);
        if (
          documents.some(
            (invoice) =>
              readInvoiceShare(invoice.calculation_snapshot)?.requestId ===
              data.requestId,
          )
        )
          return summary;
        if (summary.blockedReason) throw invoiceError(summary.blockedReason);
        if (data.totalCents !== summary.totalCents) {
          throw invoiceError(
            "Le montant du séjour a changé. Fermez puis rouvrez la répartition.",
          );
        }
        if (!summary.canComplete && data.recipients.length < 2)
          throw invoiceError("Ajoutez au moins deux destinataires.");
        if (
          data.recipients.reduce(
            (sum, recipient) => sum + recipient.cents,
            0,
          ) !== summary.remainingCents
        ) {
          throw invoiceError(
            "La somme des parts doit correspondre au reste à facturer.",
          );
        }
        if (
          data.recipients.some(
            (recipient) => recipient.taxCents > recipient.cents,
          ) ||
          data.recipients.reduce(
            (sum, recipient) => sum + recipient.taxCents,
            0,
          ) !== summary.remainingTaxCents
        ) {
          throw invoiceError(
            "Vérifiez que la taxe de séjour est entièrement répartie, sans dépasser le montant d’une part.",
          );
        }

        const balances = data.recipients.map(
          (recipient) => recipient.cents - recipient.taxCents,
        );
        const feeShares = data.recipients.map((): Fee[] => []);
        for (const fee of remainingFees) {
          allocateFee(fee.cents, balances).forEach((amount, index) => {
            if (!amount) return;
            balances[index] -= amount;
            feeShares[index].push({ ...fee, cents: amount });
          });
        }

        const dueDate = new Date();
        const year = dueDate.getFullYear();
        dueDate.setUTCDate(dueDate.getUTCDate() + 15);
        const drafts = data.recipients.map((recipient, index) => {
          const fees = feeShares[index];
          const lodging = balances[index];
          const touristTaxes = shareTax(tax, recipient.taxCents, lodging);
          const totals: ContractTotals = {
            nbNuits: reservation.nb_nuits,
            montantBase: lodging / 100,
            totalSansOptions: lodging / 100,
            optionsTotal: 0,
            optionsDetail: {
              draps: 0,
              linge: 0,
              menage: 0,
              departTardif: 0,
              chiens: 0,
            },
            taxeSejourCalculee: recipient.taxCents / 100,
            touristTaxes,
            totalGlobal: recipient.cents / 100,
            solde: recipient.cents / 100,
          };
          const extraFees = encodeJsonField(
            fees.map((fee) => ({
              libelle: `Quote-part · ${fee.label}`.slice(0, 500),
              montant: fee.cents / 100,
            })),
          );
          const fiscal = proposeInvoiceFiscal(
            { frais_supplementaires: extraFees, split: true },
            totals,
          );
          const draftNumber = `BROUILLON-${year}-${crypto.randomUUID()}`;
          return {
            numero_facture: draftNumber,
            lifecycle_status: "draft",
            reservation_id: reservation.id,
            gite_id: gite.id,
            locataire_nom: recipient.name,
            locataire_email: recipient.email || null,
            locataire_adresse: "",
            locataire_tel: "",
            date_debut: reservation.date_entree,
            date_fin: reservation.date_sortie,
            heure_arrivee: gite.heure_arrivee_defaut,
            heure_depart: gite.heure_depart_defaut,
            nb_nuits: reservation.nb_nuits,
            nb_adultes: reservation.nb_adultes,
            nb_enfants_2_17: reservation.nb_enfants_2_17,
            prix_par_nuit: 0,
            arrhes_montant: 0,
            arrhes_date_limite: dueDate,
            solde_montant: totals.solde,
            taxe_sejour_calculee: totals.taxeSejourCalculee,
            frais_supplementaires: extraFees,
            caution_montant: 0,
            cheque_menage_montant: 0,
            afficher_caution_phrase: false,
            afficher_cheque_menage_phrase: false,
            options: encodeJsonField({}),
            clauses: encodeJsonField({}),
            pdf_path: getPdfPaths(draftNumber, reservation.date_entree)
              .relativePath,
            fiscal_data: JSON.stringify(fiscal),
            calculation_snapshot: buildInvoiceCalculation(gite, totals, {
              requestId: data.requestId,
              stayTotalCents: summary.totalCents,
              fees: fees.map(({ key, cents }) => ({ key, cents })),
            }),
          };
        });
        // Draft PDFs are rendered on demand, after the whole allocation commits.
        await tx.facture.createMany({ data: drafts });
        return (await loadSplit(tx, reservationId)).summary;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (
      ["P2034", "P2028", "P1008"].includes(
        String((error as { code?: string })?.code),
      )
    ) {
      throw invoiceError(
        "Une autre opération de facturation est en cours. Réessayez dans un instant.",
      );
    }
    throw error;
  }
};

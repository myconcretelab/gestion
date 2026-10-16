import { z } from "zod";

const text = z.string().trim().max(500);
export const invoiceOperationKindSchema = z.enum([
  "unknown",
  "goods",
  "services",
  "mixed",
]);
export const invoiceOperationChoices = [
  { value: "goods", label: "Biens" },
  { value: "services", label: "Services" },
  { value: "mixed", label: "Mixte — biens et services distincts" },
] as const;

/** Ordinary invoices/credits only. Special frames (advances, prior reporting, etc.) need a dedicated workflow. */
export const invoiceBusinessProcessType = (
  operation: unknown,
  amounts: { paid_cents: number; due_cents: number },
  credit = false,
) => {
  const prefix =
    operation === "goods"
      ? "B"
      : operation === "services"
        ? "S"
        : operation === "mixed"
          ? "M"
          : null;
  if (
    !prefix ||
    !Number.isSafeInteger(amounts.paid_cents) ||
    !Number.isSafeInteger(amounts.due_cents) ||
    amounts.paid_cents < 0 ||
    amounts.due_cents < 0 ||
    (credit && amounts.paid_cents !== 0) ||
    (amounts.paid_cents > 0 && amounts.due_cents > 0)
  )
    return null;
  return `${prefix}${!credit && amounts.paid_cents > 0 && amounts.due_cents === 0 ? "2" : "1"}`;
};
export const b2bPaymentMentionsSchema = z.object({
  late_payment_penalties: text.default(""),
  recovery_fee: text.default(""),
  early_payment_discount: text.default(""),
});
export const b2bPaymentMentionFields = [
  {
    key: "late_payment_penalties",
    subject_code: "PMD",
    label: "Pénalités de retard",
  },
  {
    key: "recovery_fee",
    subject_code: "PMT",
    label: "Indemnité forfaitaire de recouvrement",
  },
  {
    key: "early_payment_discount",
    subject_code: "AAB",
    label: "Escompte pour paiement anticipé",
  },
] as const;
const amount = z
  .number()
  .finite()
  .min(0)
  .max(10_000_000)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Deux décimales maximum.",
  );
const isoDate = z
  .string()
  .refine(
    (s) =>
      s === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(new Date(s).getTime()) &&
        new Date(s).toISOString().slice(0, 10) === s),
    "Date invalide.",
  );
export const invoiceFiscalInputSchema = z.object({
  version: z.literal(1),
  // Legacy data remains readable, never automatically classified from the gîte or its VAT rate.
  operation_kind: invoiceOperationKindSchema.default("unknown"),
  buyer: z.object({
    kind: z.enum(["unknown", "individual", "business"]),
    address_line1: text,
    address_line2: text.default(""),
    postal_code: text,
    city: text,
    country_code: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (s) => s === "" || /^[A-Z]{2}$/.test(s),
        "Pays ISO à deux lettres attendu.",
      ),
    siren: z
      .string()
      .trim()
      .refine((s) => s === "" || /^\d{9}$/.test(s), "SIREN invalide."),
    vat_number: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (s) => s === "" || /^[A-Z]{2}[A-Z0-9]{2,14}$/.test(s),
        "Numéro de TVA invalide.",
      ),
  }),
  lines: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        label: text,
        quantity: z
          .number()
          .finite()
          .positive()
          .max(100_000)
          .refine(
            (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001,
            "Trois décimales maximum.",
          ),
        unit: z.enum(["C62", "DAY", "E48"]),
        unit_price_ttc: amount,
        vat_category: z.enum(["unknown", "S", "Z", "E", "O"]),
        vat_rate: z
          .number()
          .finite()
          .min(0)
          .max(100)
          .refine(
            (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
            "Deux décimales maximum.",
          ),
        exemption_reason: text,
      }),
    )
    .max(100)
    .superRefine((lines, ctx) => {
      if (new Set(lines.map((line) => line.id)).size !== lines.length)
        ctx.addIssue({
          code: "custom",
          message: "Les identifiants de lignes doivent être uniques.",
        });
    }),
  paid_amount: amount,
  payment_due_date: isoDate,
  payment_terms: z.string().trim().max(2000),
  // Existing drafts remain readable; missing mentions must be completed before B2B issuance.
  b2b_payment_mentions: b2bPaymentMentionsSchema.default({}),
  reviewed: z.boolean(),
  tourist_tax_reviewed: z.boolean(),
});
export type InvoiceFiscalInput = z.infer<typeof invoiceFiscalInputSchema>;
export type InvoiceFiscalLine = InvoiceFiscalInput["lines"][number];

/** One source for the PDF and EN16931 notes, never inferred from free-form payment terms. */
export const invoicePaymentNotes = (input: InvoiceFiscalInput) =>
  input.buyer.kind === "business"
    ? b2bPaymentMentionFields.flatMap(({ key, subject_code }) => {
        const note = input.b2b_payment_mentions?.[key]?.trim();
        return note ? [{ subject_code, note }] : [];
      })
    : [];

// All arithmetic uses scaled integers. Inputs are TTC, like the existing rental calculator.
export const invoiceCents = (value: number) => Math.round(value * 100);
const divRound = (n: bigint, d: bigint) => (n + d / 2n) / d;
export const decimalAmount = (cents: number) => (cents / 100).toFixed(2);
export const computeInvoiceFiscal = (input: InvoiceFiscalInput) => {
  const lines = input.lines.map((line) => {
    const gross = Number(
      divRound(
        BigInt(invoiceCents(line.unit_price_ttc)) *
          BigInt(Math.round(line.quantity * 1000)),
        1000n,
      ),
    );
    const rate =
      line.vat_category === "S" ? Math.round(line.vat_rate * 100) : 0;
    const net = Number(divRound(BigInt(gross) * 10000n, BigInt(10000 + rate)));
    return { ...line, gross_cents: gross, net_cents: net };
  });
  const groups = new Map<
    string,
    {
      category: InvoiceFiscalLine["vat_category"];
      rate: number;
      reason: string;
      net_cents: number;
      vat_cents: number;
    }
  >();
  for (const line of lines) {
    const rate = line.vat_category === "S" ? line.vat_rate : 0;
    // EN16931: one breakdown per category/rate, not one per reason.
    const key = `${line.vat_category}:${rate}`;
    const group = groups.get(key) ?? {
      category: line.vat_category,
      rate,
      reason: line.exemption_reason,
      net_cents: 0,
      vat_cents: 0,
    };
    group.net_cents += line.net_cents;
    groups.set(key, group);
  }
  const breakdown = [...groups.values()].map((group) => ({
    ...group,
    vat_cents: Number(
      divRound(
        BigInt(group.net_cents) * BigInt(Math.round(group.rate * 100)),
        10000n,
      ),
    ),
  }));
  const net = lines.reduce((sum, line) => sum + line.net_cents, 0);
  const vat = breakdown.reduce((sum, group) => sum + group.vat_cents, 0);
  const gross = lines.reduce((sum, line) => sum + line.gross_cents, 0);
  const paid = invoiceCents(input.paid_amount);
  return {
    lines,
    breakdown,
    net_cents: net,
    vat_cents: vat,
    total_with_vat_cents: net + vat,
    gross_cents: gross,
    rounding_cents: gross - net - vat,
    paid_cents: paid,
    due_cents: gross - paid,
  };
};

export const invoiceFiscalIssues = (
  input: InvoiceFiscalInput | null,
  expectedTotal: number,
  options: {
    vatRegime?: string;
    sellerVatNumber?: string | null;
    touristTax?: number;
    credit?: boolean;
  } = {},
): string[] => {
  if (!input)
    return [
      "Préparez les données fiscales du brouillon (client, lignes et TVA).",
    ];
  const issues: string[] = [];
  if (!Number.isFinite(expectedTotal) || (!options.credit && expectedTotal < 0))
    issues.push(
      "Le total d’une facture doit être positif ou nul. Utilisez un avoir pour une annulation.",
    );
  const buyer = input.buyer;
  if (buyer.kind === "business")
    for (const { key, label } of b2bPaymentMentionFields)
      if (!input.b2b_payment_mentions?.[key]?.trim())
        issues.push(
          `Client professionnel : renseignez la mention « ${label} » après vérification de vos conditions.`,
        );
  if (buyer.kind === "unknown")
    issues.push("Précisez si le client est un particulier ou une entreprise.");
  if (
    !buyer.address_line1 ||
    !buyer.postal_code ||
    !buyer.city ||
    !buyer.country_code
  )
    issues.push("Complétez l’adresse structurée du client et son pays.");
  if (buyer.kind === "business" && buyer.country_code === "FR" && !buyer.siren)
    issues.push("Renseignez le SIREN de l’entreprise cliente française.");
  if (buyer.kind === "individual" && (buyer.siren || buyer.vat_number))
    issues.push(
      "Un particulier ne doit pas porter d’identifiants fiscaux d’entreprise.",
    );
  if (
    buyer.vat_number.startsWith("FR") &&
    (!/^FR[A-Z0-9]{2}\d{9}$/.test(buyer.vat_number) ||
      (buyer.siren && buyer.vat_number.slice(-9) !== buyer.siren))
  )
    issues.push("Le numéro de TVA du client doit correspondre à son SIREN.");
  if (!input.lines.length)
    issues.push("Ajoutez au moins une ligne de facture.");
  for (const [index, line] of input.lines.entries()) {
    const prefix = `Ligne ${index + 1} : `;
    if (!line.label) issues.push(prefix + "renseignez un libellé.");
    if (line.vat_category === "unknown")
      issues.push(prefix + "choisissez le traitement de TVA.");
    if (line.vat_category === "S" && line.vat_rate <= 0)
      issues.push(
        prefix + "un taux positif est nécessaire pour une ligne soumise à TVA.",
      );
    if (line.vat_category !== "S" && line.vat_rate !== 0)
      issues.push(prefix + "le taux doit être nul pour cette catégorie.");
    if (["E", "O"].includes(line.vat_category) && !line.exemption_reason)
      issues.push(
        prefix +
          "renseignez le motif et la référence d’exonération ou de hors-champ.",
      );
    if (["S", "Z"].includes(line.vat_category) && line.exemption_reason)
      issues.push(
        prefix + "retirez le motif d’exonération pour cette catégorie.",
      );
    if (
      options.vatRegime === "franchise_en_base" &&
      !["E", "O", "unknown"].includes(line.vat_category)
    )
      issues.push(
        prefix +
          "le régime franchise en base ne permet pas de facturer de TVA.",
      );
    if (
      options.vatRegime === "franchise_en_base" &&
      line.vat_category === "E" &&
      !/293\s*B/i.test(line.exemption_reason)
    )
      issues.push(
        prefix +
          "la franchise en base nécessite la mention TVA non applicable, article 293 B du CGI.",
      );
    if (options.vatRegime === "hors_champ" && line.vat_category !== "O")
      issues.push(
        prefix + "le régime hors champ nécessite une vérification fiscale.",
      );
    if (options.vatRegime === "exonere" && line.vat_category === "S")
      issues.push(
        prefix + "le régime exonéré ne permet pas de facturer de TVA.",
      );
    if (line.vat_category === "S" && !options.sellerVatNumber)
      issues.push(prefix + "le numéro de TVA de l’émetteur est nécessaire.");
  }
  const categories = new Set(input.lines.map((line) => line.vat_category));
  if (categories.has("O") && categories.size > 1)
    issues.push(
      "Le hors-champ (O) ne peut pas être mélangé à d’autres catégories dans ce modèle EN16931. Faites vérifier le traitement des débours/taxes avant émission.",
    );
  if (categories.has("O") && (buyer.vat_number || options.sellerVatNumber))
    issues.push(
      "Une facture EN16931 entièrement hors champ (O) ne doit pas porter de numéros de TVA. Faites vérifier ce cas avant émission.",
    );
  for (const category of ["E", "O"] as const) {
    if (
      new Set(
        input.lines
          .filter((line) => line.vat_category === category)
          .map((line) => line.exemption_reason),
      ).size > 1
    )
      issues.push(
        "Utilisez un motif commun par catégorie d’exonération pour le récapitulatif TVA.",
      );
  }
  const totals = computeInvoiceFiscal(input);
  if (buyer.kind === "business" && !options.credit) {
    if (!input.operation_kind || input.operation_kind === "unknown")
      issues.push(
        "Choisissez la nature de l’opération : biens, services ou mixte, après qualification.",
      );
    if (totals.paid_cents > 0 && totals.due_cents > 0)
      issues.push(
        "Les paiements partiels à l’émission nécessitent la qualification du cadre de facturation, notamment en présence d’un acompte. Ce cas reste hors du lot B2B actuel.",
      );
  }
  if (
    !Number.isSafeInteger(totals.gross_cents) ||
    totals.gross_cents > 1_000_000_000
  )
    issues.push("Le montant total dépasse la limite autorisée.");
  if (totals.gross_cents !== invoiceCents(Math.abs(expectedTotal)))
    issues.push(
      "Le total TTC des lignes doit correspondre exactement au total du séjour (remise, options et frais inclus).",
    );
  if (totals.due_cents < 0)
    issues.push(
      "Le montant réellement reçu ne peut pas dépasser le total facturé.",
    );
  if (options.credit && totals.paid_cents !== 0)
    issues.push(
      "Un avoir intégral ne doit pas reprendre l’acompte reçu de la facture source.",
    );
  if (
    !options.credit &&
    totals.due_cents > 0 &&
    !input.payment_due_date &&
    !input.payment_terms
  )
    issues.push("Précisez l’échéance du solde ou les conditions de paiement.");
  if (options.touristTax && !input.tourist_tax_reviewed)
    issues.push(
      "Vérifiez explicitement le traitement de la taxe de séjour (incluse, collectée ailleurs ou non applicable).",
    );
  if (!input.reviewed)
    issues.push(
      "Confirmez la vérification des lignes, des taux, des motifs et des sommes réellement reçues.",
    );
  return [...new Set(issues)];
};

export const emptyInvoiceFiscalInput = (): InvoiceFiscalInput => ({
  version: 1,
  operation_kind: "unknown",
  buyer: {
    kind: "unknown",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    city: "",
    country_code: "",
    siren: "",
    vat_number: "",
  },
  lines: [],
  paid_amount: 0,
  payment_due_date: "",
  payment_terms: "",
  b2b_payment_mentions: b2bPaymentMentionsSchema.parse({}),
  reviewed: false,
  tourist_tax_reviewed: false,
});

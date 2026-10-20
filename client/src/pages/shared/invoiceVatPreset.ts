import type { InvoiceFiscalInput, InvoiceFiscalLine } from "@contrats/shared";

export type InvoiceVatPresetContext = {
  giteId: string;
  vatRegime?: string;
  sellerCountryCode?: string;
  grouped: boolean;
};
type VatChoice = Pick<
  InvoiceFiscalLine,
  "vat_category" | "vat_rate" | "exemption_reason"
>;
export type AppliedInvoiceVatPresets = Record<
  string,
  VatChoice & { contextKey: string }
>;
const sameVat = (left: VatChoice, right: VatChoice) =>
  left.vat_category === right.vat_category &&
  left.vat_rate === right.vat_rate &&
  left.exemption_reason === right.exemption_reason;
export const untouchedVatChoice = (line: VatChoice) =>
  line.vat_category === "unknown" &&
  line.vat_rate === 0 &&
  !line.exemption_reason.trim();

// The buyer's status never establishes an exemption or a rate. Only use the
// recorded French issuer regime, and leave the legal basis of other exemptions
// to the user. BOI-TVA-DECLA-40-10-20 (2026-07-01), § 50-60:
// https://bofip.impots.gouv.fr/bofip/1079-PGP.html/identifiant=BOI-TVA-DECLA-40-10-20-20260701
const presetFor = (context: InvoiceVatPresetContext): VatChoice | null => {
  if (context.grouped || context.sellerCountryCode !== "FR") return null;
  if (context.vatRegime === "franchise_en_base")
    return {
      vat_category: "E",
      vat_rate: 0,
      exemption_reason: "TVA non applicable, article 293 B du CGI",
    };
  if (context.vatRegime === "exonere")
    return { vat_category: "E", vat_rate: 0, exemption_reason: "" };
  return null;
};

export function applyIndividualVatPreset(
  input: InvoiceFiscalInput,
  context: InvoiceVatPresetContext,
  previouslyApplied: AppliedInvoiceVatPresets = {},
  touched: ReadonlyMap<string, InvoiceFiscalLine> = new Map(),
): { input: InvoiceFiscalInput; applied: AppliedInvoiceVatPresets } {
  const contextKey = JSON.stringify(context);
  const applied: AppliedInvoiceVatPresets = {};
  const preset = input.buyer.kind === "individual" ? presetFor(context) : null;
  let changed = false;
  const lines = input.lines.map((original) => {
    const manual = touched.get(original.id);
    const sourceLabel = (label: string) =>
      /^Location(?: ·|$)/.test(label) ? "Location" : label;
    if (
      manual &&
      sourceLabel(manual.label) === sourceLabel(original.label) &&
      sameVat(manual, original)
    )
      return original;
    const previous = previouslyApplied[original.id];
    let line = original;
    // Remove only our own unchanged suggestion when the issuer changes. A
    // saved or manually edited choice must never be silently reclassified.
    if (previous && sameVat(original, previous)) {
      if (previous.contextKey === contextKey) {
        applied[line.id] = previous;
        return line;
      }
      line = {
        ...original,
        vat_category: "unknown",
        vat_rate: 0,
        exemption_reason: "",
      };
    }
    if (preset && untouchedVatChoice(line)) {
      line = { ...line, ...preset };
      applied[line.id] = { ...preset, contextKey };
    }
    if (!sameVat(line, original)) changed = true;
    return line;
  });
  return {
    input: changed
      ? { ...input, lines, reviewed: false, tourist_tax_reviewed: false }
      : input,
    applied,
  };
}

export const changedVatLineIds = (
  previous: InvoiceFiscalInput,
  next: InvoiceFiscalInput,
) =>
  next.lines
    .filter((line) => {
      const old = previous.lines.find(({ id }) => id === line.id);
      return old && !sameVat(old, line);
    })
    .map(({ id }) => id);

export const individualVatPresetHint = (context: InvoiceVatPresetContext) => {
  if (context.grouped)
    return "Séjours regroupés : vérifiez le traitement de TVA de chaque réservation et prestation.";
  if (
    context.sellerCountryCode === "FR" &&
    context.vatRegime === "franchise_en_base"
  )
    return "TVA préremplie d’après le régime de l’entreprise du gîte : franchise en base, avec la mention de l’article 293 B du CGI. Les choix déjà saisis sont conservés.";
  if (context.sellerCountryCode === "FR" && context.vatRegime === "exonere")
    return "Exonération présélectionnée d’après le régime de l’entreprise du gîte. Le motif et sa référence légale restent à préciser pour chaque prestation.";
  return "Le statut de particulier ne détermine pas la TVA. Le traitement et le taux restent à préciser selon le régime de l’entreprise et la prestation.";
};

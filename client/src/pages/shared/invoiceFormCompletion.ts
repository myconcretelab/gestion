import {
  invoiceFiscalInputSchema,
  invoiceFiscalIssues,
  type InvoiceFiscalInput,
} from "@contrats/shared";

import {
  formCompletionProgress,
  type FormCompletionItem,
} from "./formCompletion";
export { focusFormField as focusInvoiceField } from "./formCompletion";
export type InvoiceCompletionItem = FormCompletionItem;
export type InvoiceValidationOptions = Parameters<
  typeof invoiceFiscalIssues
>[2] & { sellerCountryCode?: string };

export const invoiceIssueTarget = (issue: string) => {
  if (issue.includes("Confirmez la vérification")) return "invoice-reviewed";
  const line = issue.match(/^Ligne (\d+) :/);
  if (line) {
    const index = Number(line[1]) - 1;
    const field = issue.includes("libellé") ? "label" : "vat";
    return `invoice-line-${field}${index ? `-${index}` : ""}`;
  }
  if (issue.includes("adresse structurée")) return "buyer-address";
  if (
    issue.includes("échéance du solde") ||
    issue.includes("conditions de paiement") ||
    issue.includes("réellement reçu") ||
    issue.includes("paiements partiels")
  )
    return "payment-details";
  if (issue.includes("particulier ou une entreprise")) return "buyer-kind";
  if (issue.includes("SIREN") || issue.includes("identifiants fiscaux"))
    return "buyer-kind";
  if (issue.includes("mention «")) return "b2b-payment-mentions";
  if (issue.includes("nature de l’opération")) return "invoice-operation-kind";
  if (issue.includes("taxe de séjour"))
    return issue.startsWith("Vérifiez explicitement")
      ? "tourist-tax-reviewed"
      : "invoice-lines";
  return "invoice-fiscal";
};

export function invoiceFormCompletion(
  input: InvoiceFiscalInput,
  total: number,
  options: InvoiceValidationOptions,
  context: {
    name: string;
    giteId: string;
    start: string;
    end: string;
    email: string;
  },
): InvoiceCompletionItem[] {
  const items: InvoiceCompletionItem[] = [];
  if (!context.giteId)
    items.push({ label: "Choisir un gîte", target: "invoice-gite" });
  if (!context.name.trim())
    items.push({
      label: "Renseigner le nom du client",
      target: "invoice-buyer-name",
    });
  if (context.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.email))
    items.push({
      label: "Corriger l’adresse e-mail",
      target: "invoice-buyer-email",
    });
  if (!context.start || !context.end || context.end <= context.start)
    items.push({
      label: "Compléter les dates du séjour",
      target: "invoice-start",
    });
  const parsed = invoiceFiscalInputSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [section, key, field] = issue.path;
      const target =
        section === "buyer"
          ? ({
              country_code: "buyer-country",
              siren: "buyer-siren",
              vat_number: "buyer-vat-number",
            }[String(key)] ?? "buyer-address")
          : section === "lines"
            ? `invoice-line-${field === "label" ? "label" : "vat"}${Number(key) ? `-${key}` : ""}`
            : "payment-details";
      items.push({
        label: `${section === "buyer" ? "Client" : section === "lines" ? `Ligne ${Number(key) + 1}` : "Paiement"} : ${issue.message}`,
        target,
      });
    }
  } else {
    const buyerFields = [
      ["address_line1", "Adresse de facturation", "buyer-address"],
      ["postal_code", "Code postal", "buyer-postal-code"],
      ["city", "Ville", "buyer-city"],
      ["country_code", "Pays", "buyer-country"],
    ] as const;
    for (const [key, label, target] of buyerFields)
      if (!parsed.data.buyer[key]) items.push({ label, target });
    for (const label of invoiceFiscalIssues(parsed.data, total, options)) {
      if (!label.includes("adresse structurée"))
        items.push({ label, target: invoiceIssueTarget(label) });
    }
  }
  return items;
}

// Fixed, equally weighted sections keep progress meaningful when the number of
// VAT lines or B2B mentions changes. Completion uses the existing validators.
export function invoiceCompletionProgress(
  items: InvoiceCompletionItem[],
): number {
  const grouped = items.map((item) => {
    const target = item.target;
    const group = (() => {
      if (target === "invoice-gite" || target === "invoice-start")
        return "stay";
      if (target.startsWith("buyer-") || target.startsWith("invoice-buyer-"))
        return "buyer";
      if (target === "payment-details" || target === "b2b-payment-mentions")
        return "payment";
      if (target === "invoice-reviewed" || target === "tourist-tax-reviewed")
        return "review";
      return "lines";
    })();
    return { ...item, group };
  });
  return formCompletionProgress(grouped, [
    "stay",
    "buyer",
    "payment",
    "review",
    "lines",
  ]);
}

import type { InvoiceFiscalInput, InvoiceFiscalLine } from "@contrats/shared";

const invoiceDataKey = (value: unknown) =>
  JSON.stringify(value, (_, field: unknown) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return field;
    return Object.fromEntries(
      Object.entries(field).sort(([first], [second]) => first.localeCompare(second)),
    );
  });

// Keep the latest tax calculation, even when only the accommodation subtotal changes.
const taxReviewKey = (taxes: InvoiceFiscalInput["tourist_taxes"]) =>
  invoiceDataKey((taxes ?? []).map(({ accommodation_amount: _accommodation, ...tax }) => tax));

export function applyInvoiceFiscalProposal(
  current: InvoiceFiscalInput,
  lines: InvoiceFiscalLine[],
  touristTaxes: InvoiceFiscalInput["tourist_taxes"],
): InvoiceFiscalInput {
  const linesChanged = lines !== current.lines && invoiceDataKey(lines) !== invoiceDataKey(current.lines);
  const taxesChanged = invoiceDataKey(touristTaxes ?? []) !== invoiceDataKey(current.tourist_taxes ?? []);
  if (!linesChanged && !taxesChanged) return current;
  return {
    ...current,
    lines: linesChanged ? lines : current.lines,
    tourist_taxes: taxesChanged ? touristTaxes : current.tourist_taxes,
    reviewed: current.reviewed && !linesChanged,
    tourist_tax_reviewed: current.tourist_tax_reviewed &&
      (!taxesChanged || taxReviewKey(touristTaxes) === taxReviewKey(current.tourist_taxes)),
  };
}

export const sameInvoiceLineAmounts = (
  left: InvoiceFiscalLine[],
  right: InvoiceFiscalLine[],
) =>
  left.length === right.length &&
  left.every(
    (line, index) =>
      line.quantity === right[index].quantity &&
      line.unit === right[index].unit &&
      line.unit_price_ttc === right[index].unit_price_ttc,
  );

// A source keeps its fiscal choices when its price or position changes. Removed
// options must never pass their VAT treatment on to the next generated line.
const sourceKey = (line: InvoiceFiscalLine) =>
  line.source?.key ?? (/^Location(?: ·|$)/.test(line.label) ? "Location" : line.label);

export function reconcileInvoiceGeneratedLines(
  previous: InvoiceFiscalLine[],
  proposed: InvoiceFiscalLine[],
  baseline?: InvoiceFiscalLine[],
) {
  const used = new Set<string>();
  const sameInitialAmounts =
    !baseline && sameInvoiceLineAmounts(previous, proposed);
  const unchangedSources =
    baseline &&
    sameInvoiceLineAmounts(baseline, proposed) &&
    baseline.every((line, index) => line.label === proposed[index].label);
  return proposed.map((line, index) => {
    const candidates = baseline?.filter(
      (item) => sourceKey(item) === sourceKey(line),
    );
    const proposedCount = proposed.filter(
      (item) => sourceKey(item) === sourceKey(line),
    ).length;
    // Duplicate source labels are ambiguous after a change: require a new fiscal
    // review instead of assigning the treatment of a different fee or option.
    const source = unchangedSources
      ? baseline[index]
      : candidates?.length === 1 && proposedCount === 1
        ? candidates[0]
        : undefined;
    if (source) used.add(source.id);
    const old = source
      ? previous.find((item) => item.id === source.id)
      : !baseline
        ? (previous.find(
            (item) => !used.has(item.id) && sourceKey(item) === sourceKey(line),
          ) ?? (sameInitialAmounts ? previous[index] : undefined))
        : undefined;
    if (!old) return line;
    if (!baseline) used.add(old.id);
    return {
      ...line,
      label:
        old.label !== (source?.label ?? line.label) ? old.label : line.label,
      vat_category: old.vat_category,
      vat_rate: old.vat_rate,
      exemption_reason: old.exemption_reason,
    };
  });
}

export const shouldSyncInvoiceGeneratedLines = (
  manual: boolean,
  current: InvoiceFiscalLine[],
  proposed: InvoiceFiscalLine[],
  baseline?: InvoiceFiscalLine[],
) => !manual || (!baseline && sameInvoiceLineAmounts(current, proposed));

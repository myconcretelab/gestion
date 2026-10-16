import {
  computeInvoiceFiscal,
  decimalAmount,
  emptyInvoiceFiscalInput,
  invoiceFiscalInputSchema,
  invoiceFiscalIssues,
  invoicePaymentNotes,
  invoiceBusinessProcessType,
  type InvoiceFiscalInput,
} from "@contrats/shared";
import type { FiscalEntity, FiscalEstablishment } from "@prisma/client";
import { fromJsonString } from "../../utils/jsonFields.js";
import type { ContractTotals } from "../../services/contractCalculator.js";

export const parseInvoiceFiscal = (
  value: unknown,
): InvoiceFiscalInput | null => {
  const parsed = invoiceFiscalInputSchema.safeParse(
    fromJsonString(value, null),
  );
  return parsed.success ? parsed.data : null;
};

export const proposeInvoiceFiscal = (
  invoice: {
    frais_supplementaires?: unknown;
    reservation_items?: unknown;
    remise_montant?: unknown;
  },
  totals: ContractTotals,
): InvoiceFiscalInput => {
  const input = emptyInvoiceFiscalInput();
  const items = fromJsonString<
    Array<{
      gite_nom: string;
      montant: number;
      date_debut: string;
      date_fin: string;
    }>
  >(invoice.reservation_items, []);
  const fees = fromJsonString<Array<{ libelle: string; montant: number }>>(
    invoice.frais_supplementaires,
    [],
  );
  const add = (label: string, value: number) => {
    if (value === 0) return;
    input.lines.push({
      id: `line-${input.lines.length + 1}`,
      label,
      quantity: 1,
      unit: "C62",
      unit_price_ttc: value,
      vat_category: "unknown",
      vat_rate: 0,
      exemption_reason: "",
    });
  };
  if (items.length >= 2) {
    items.forEach((item) =>
      add(
        `${item.gite_nom} · ${item.date_debut.slice(0, 10)} au ${item.date_fin.slice(0, 10)} (montant regroupé à ventiler si nécessaire)`,
        item.montant,
      ),
    );
  } else {
    add(
      `Location · ${totals.nbNuits} nuit(s)${Number(invoice.remise_montant) > 0 ? " (remise déjà déduite)" : ""}`,
      totals.totalSansOptions,
    );
    const labels = {
      draps: "Draps",
      linge: "Linge de toilette",
      menage: "Ménage",
      departTardif: "Départ tardif",
      chiens: "Animaux",
    };
    for (const key of Object.keys(labels) as Array<keyof typeof labels>)
      add(labels[key], totals.optionsDetail[key]);
  }
  fees.forEach((fee) => add(fee.libelle, fee.montant));
  // Zero-value invoices still need one explicit EN16931 line.
  if (!input.lines.length)
    input.lines.push({
      id: "line-1",
      label: "Location",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 0,
      vat_category: "unknown",
      vat_rate: 0,
      exemption_reason: "",
    });
  return input;
};

export const validateInvoiceFiscal = (
  input: InvoiceFiscalInput | null,
  total: number,
  entity: FiscalEntity,
  touristTax: number,
  credit = false,
) => {
  const issues = invoiceFiscalIssues(input, total, {
    vatRegime: entity.vat_regime,
    sellerVatNumber: entity.vat_number,
    touristTax,
    credit,
  });
  if (issues.length)
    throw Object.assign(new Error(issues.join("\n")), { status: 409 });
};

const localDate = (value: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(value);

const netPriceDetails = (netCents: number, quantity: number) => {
  const quantityMilli = BigInt(Math.round(quantity * 1000));
  const microPrice =
    (BigInt(netCents) * 10_000_000n + quantityMilli / 2n) / quantityMilli;
  // Six decimal places (BR-FR-DEC-03). For large quantities, a rounded unit
  // price can alter the line total: quote the exact price for the whole quantity instead.
  const reconstructedCents =
    (microPrice * quantityMilli + 5_000_000n) / 10_000_000n;
  return {
    item_net_price:
      reconstructedCents === BigInt(netCents)
        ? `${microPrice / 1_000_000n}.${String(microPrice % 1_000_000n).padStart(6, "0")}`
        : decimalAmount(netCents),
    item_price_base_quantity:
      reconstructedCents === BigInt(netCents) ? "1" : String(quantity),
  };
};

/** Versioned local semantic snapshot, not a validated transmission payload.
 * API reference: SUPER PDP 1.37.0.beta, en_invoice, reviewed 2026-10-16.
 * Directory addresses/profile, conversion and Schematron validation belong to the transport layer.
 */
export const buildStructuredInvoice = (params: {
  input: InvoiceFiscalInput;
  issuer: {
    entity: Pick<
      FiscalEntity,
      | "legal_name"
      | "siren"
      | "vat_number"
      | "address_line1"
      | "address_line2"
      | "postal_code"
      | "city"
      | "country_code"
    >;
    establishment: Pick<FiscalEstablishment, "siret">;
  };
  number: string;
  issuedAt: Date;
  buyerName: string;
  credit: boolean;
  periodStart: Date;
  periodEnd: Date;
  sourceNumber?: string;
  sourceIssuedAt?: Date;
}) => {
  const { input, issuer } = params;
  const computed = computeInvoiceFiscal(input);
  const buyer = input.buyer;
  const amount = decimalAmount;
  const businessProcess =
    buyer.kind === "business"
      ? invoiceBusinessProcessType(
          input.operation_kind,
          computed,
          params.credit,
        )
      : null;
  const payload = {
    process_control: {
      specification_identifier: "urn:cen.eu:en16931:2017",
      ...(businessProcess ? { business_process_type: businessProcess } : {}),
    },
    number: params.number,
    issue_date: localDate(params.issuedAt),
    type_code: params.credit ? 381 : 380,
    currency_code: "EUR",
    seller: {
      name: issuer.entity.legal_name,
      legal_registration_identifier: {
        scheme: "0002",
        value: issuer.entity.siren,
      },
      identifiers: [{ scheme: "0009", value: issuer.establishment.siret }],
      ...(issuer.entity.vat_number
        ? { vat_identifier: issuer.entity.vat_number }
        : {}),
      postal_address: {
        address_line1: issuer.entity.address_line1,
        address_line2: issuer.entity.address_line2 || undefined,
        post_code: issuer.entity.postal_code,
        city: issuer.entity.city,
        country_code: issuer.entity.country_code,
      },
    },
    buyer: {
      name: params.buyerName,
      ...(buyer.siren
        ? {
            legal_registration_identifier: {
              scheme: "0002",
              value: buyer.siren,
            },
          }
        : {}),
      ...(buyer.vat_number ? { vat_identifier: buyer.vat_number } : {}),
      postal_address: {
        address_line1: buyer.address_line1,
        address_line2: buyer.address_line2 || undefined,
        post_code: buyer.postal_code,
        city: buyer.city,
        country_code: buyer.country_code,
      },
    },
    invoicing_period: {
      start_date: localDate(params.periodStart),
      end_date: localDate(params.periodEnd),
    },
    ...(params.credit
      ? {
          preceding_invoice_references: [
            {
              reference: params.sourceNumber,
              ...(params.sourceIssuedAt
                ? { issue_date: localDate(params.sourceIssuedAt) }
                : {}),
            },
          ],
        }
      : {}),
    ...(!params.credit && input.payment_due_date
      ? { payment_due_date: input.payment_due_date }
      : {}),
    ...(input.payment_terms ? { payment_terms: input.payment_terms } : {}),
    notes: invoicePaymentNotes(input),
    lines: computed.lines.map((line, index) => ({
      identifier: String(index + 1),
      invoiced_quantity: String(line.quantity),
      invoiced_quantity_code: line.unit,
      net_amount: amount(line.net_cents),
      item_information: { name: line.label },
      price_details: {
        ...netPriceDetails(line.net_cents, line.quantity),
        quantity_unit_code: line.unit,
      },
      vat_information: {
        invoiced_item_vat_category_code: line.vat_category,
        ...(line.vat_category !== "O"
          ? { invoiced_item_vat_rate: line.vat_rate.toFixed(2) }
          : {}),
        ...(line.exemption_reason
          ? { exemption_reason: line.exemption_reason }
          : {}),
      },
    })),
    vat_break_down: computed.breakdown.map((group) => ({
      vat_category_code: group.category,
      ...(group.category !== "O"
        ? { vat_category_rate: group.rate.toFixed(2) }
        : {}),
      vat_category_taxable_amount: amount(group.net_cents),
      vat_category_tax_amount: amount(group.vat_cents),
      ...(group.reason ? { vat_exemption_reason: group.reason } : {}),
    })),
    totals: {
      sum_invoice_lines_amount: amount(computed.net_cents),
      total_without_vat: amount(computed.net_cents),
      total_vat_amount: {
        value: amount(computed.vat_cents),
        currency_code: "EUR",
      },
      total_with_vat: amount(computed.total_with_vat_cents),
      rounding_amount: amount(computed.rounding_cents),
      paid_amount: amount(computed.paid_cents),
      amount_due_for_payment: amount(computed.due_cents),
    },
  };
  return {
    version: 1 as const,
    currency: "EUR",
    document_sign: params.credit ? -1 : 1,
    customer_kind: buyer.kind,
    operation_kind: input.operation_kind ?? "unknown",
    processing_rule_candidate:
      buyer.kind === "individual"
        ? "B2C"
        : buyer.country_code === "FR"
          ? "B2B"
          : "B2BInt",
    transport_ready: false,
    transport_blockers: [
      "Profil électronique et adresses d’annuaire à résoudre dans l’intégration SuperPDP.",
      "Conversion CII/UBL ou Factur-X et validation réglementaire complète non exécutées.",
    ],
    en_invoice_candidate: payload,
    calculation: computed,
  };
};

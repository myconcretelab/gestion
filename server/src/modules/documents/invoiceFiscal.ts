import {
  computeInvoiceFiscal,
  decimalAmount,
  emptyInvoiceFiscalInput,
  invoiceFiscalInputSchema,
  invoiceFiscalIssues,
  invoicePaymentNotes,
  invoiceBusinessProcessType,
  type InvoiceFiscalInput,
  type InvoiceFiscalLine,
  type InvoiceReservationDetail,
  type TouristTaxResult,
} from "@contrats/shared";
import type { FiscalEntity, FiscalEstablishment } from "@prisma/client";
import { fromJsonString } from "../../utils/jsonFields.js";
import type { ContractTotals, OptionsInput } from "../../services/contractCalculator.js";

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
    options?: unknown;
  },
  totals: ContractTotals,
): InvoiceFiscalInput => {
  const input = emptyInvoiceFiscalInput();
  if (totals.touristTaxes?.length) input.tourist_taxes = totals.touristTaxes;
  const items = fromJsonString<
    Array<
      InvoiceReservationDetail & {
        reservation_id?: string;
        nb_nuits?: number;
        gite_nom: string;
        montant: number;
        date_debut: string;
        date_fin: string;
      }
    >
  >(invoice.reservation_items, []);
  const fees = fromJsonString<Array<{ libelle: string; montant: number }>>(
    invoice.frais_supplementaires,
    [],
  );
  const add = (
    label: string,
    value: number,
    quantity = 1,
    source?: InvoiceFiscalLine["source"],
    unit: InvoiceFiscalLine["unit"] = quantity > 1 ? "DAY" : "C62",
    includeZero = false,
  ) => {
    if (value === 0 && !includeZero) return;
    input.lines.push({
      id: `line-${input.lines.length + 1}`,
      label,
      source,
      quantity,
      unit,
      unit_price_ttc: value,
      vat_category: "unknown",
      vat_rate: 0,
      exemption_reason: "",
    });
  };
  // Keep nightly quantities even when a discount cannot be divided evenly in cents.
  // At most two unit prices are needed; their sum is exactly the booked net amount.
  const addNights = (
    total: number,
    nights: number,
    discount: number,
    source?: InvoiceFiscalLine["source"],
  ) => {
    const count = Math.max(1, Math.round(nights));
    const cents = Math.round(total * 100);
    const low = Math.floor(cents / count);
    const remainder = cents - low * count;
    const label = `Location · nuitée${discount > 0 ? " (remise déjà déduite)" : ""}`;
    if (count - remainder > 0)
      add(label, low / 100, count - remainder, source, "DAY", true);
    if (remainder > 0)
      add(
        `${label} · ajustement au centime`,
        (low + 1) / 100,
        remainder,
        source ? { ...source, key: `${source.key}:rounding` } : undefined,
        "DAY",
      );
  };
  if (items.length >= 2) {
    items.forEach((item, index) => {
      // Historical snapshots contain only a total: retain it until explicitly rebuilt.
      if (
        item.montant_location === undefined ||
        !item.nb_nuits ||
        !item.services
      ) {
        add(
          `${item.gite_nom} · ${item.date_debut.slice(0, 10)} au ${item.date_fin.slice(0, 10)} (montant regroupé à ventiler si nécessaire)`,
          item.montant,
        );
        return;
      }
      const stayId = item.reservation_id ?? String(index);
      const source = {
        key: `${stayId}:location`,
        stay_id: stayId,
        stay_label: item.gite_nom,
        date_debut: item.date_debut.slice(0, 10),
        date_fin: item.date_fin.slice(0, 10),
        original_nightly_price: item.prix_par_nuit ?? 0,
        discount: item.remise_montant ?? 0,
      };
      addNights(item.montant_location, item.nb_nuits, source.discount, source);
      item.services.forEach((service) =>
        add(
          service.label,
          service.unit_price_ttc,
          service.quantity,
          { ...source, key: `${stayId}:${service.key}` },
          "C62",
          true,
        ),
      );
    });
  } else {
    addNights(
      totals.touristTaxes?.[0]?.accommodation_amount ?? totals.totalSansOptions,
      totals.nbNuits,
      Number(invoice.remise_montant ?? 0),
    );
    const labels = {
      draps: "Draps",
      linge: "Linge de toilette",
      menage: "Ménage",
      departTardif: "Départ tardif",
      chiens: "Animaux",
    };
    const options = fromJsonString<OptionsInput>(invoice.options, {});
    const quantities = {
      draps: options.draps?.nb_lits ?? 1,
      linge: options.linge_toilette?.nb_personnes ?? 1,
      menage: 1,
      departTardif: 1,
      chiens: (options.chiens?.nb ?? 1) * totals.nbNuits,
    };
    for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
      const optionKey =
        key === "linge"
          ? "linge_toilette"
          : key === "departTardif"
            ? "depart_tardif"
            : key;
      const offered = options[optionKey]?.enabled && options[optionKey]?.offert;
      const quantity = options[optionKey]?.enabled
        ? Math.max(1, quantities[key])
        : 1;
      add(
        `${labels[key]}${offered ? " · offert" : ""}`,
        Math.round((totals.optionsDetail[key] / quantity) * 100) / 100,
        quantity,
        undefined,
        "C62",
        Boolean(offered),
      );
    }
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
  touristTaxes?: TouristTaxResult[],
) => {
  const issues = invoiceFiscalIssues(input, total, {
    vatRegime: entity.vat_regime,
    sellerVatNumber: entity.vat_number,
    touristTax,
    touristTaxes,
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
  if ((input.tourist_taxes ?? []).some(tax => tax.host_amount > 0))
    throw Object.assign(new Error("L’export électronique des taxes de séjour collectées par le loueur nécessite un format dédié. Le PDF local reste disponible."), { status: 409 });
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

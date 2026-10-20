import assert from "node:assert/strict";
import { test } from "node:test";
import type { FiscalEntity, FiscalEstablishment } from "@prisma/client";
import { emptyInvoiceFiscalInput, invoicePaymentNotes } from "@contrats/shared";
import { buildStructuredInvoice } from "../src/modules/documents/invoiceFiscal.js";

const entity: FiscalEntity = {
  id: "fictitious-entity",
  organization_id: "fictitious-org",
  gestionnaire_id: null,
  legal_name: "Entreprise fictive",
  siren: "732829320",
  vat_number: "FR01732829320",
  vat_regime: "reel_normal",
  address_line1: "1 rue Exemple",
  address_line2: null,
  postal_code: "35000",
  city: "Rennes",
  country_code: "FR",
  email: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const establishment: FiscalEstablishment = {
  id: "fictitious-establishment",
  organization_id: entity.organization_id,
  fiscal_entity_id: entity.id,
  name: "Établissement fictif",
  siret: "73282932000074",
  address_line1: null,
  address_line2: null,
  postal_code: null,
  city: null,
  country_code: "FR",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const fiscal = () => {
  const input = emptyInvoiceFiscalInput();
  input.operation_kind = "services";
  input.buyer.kind = "business";
  input.b2b_payment_mentions = {
    late_payment_penalties: "Pénalités fictives <recette>.",
    recovery_fee: "Indemnité fictive de recette.",
    early_payment_discount: "Aucun escompte (recette).",
  };
  input.lines = [
    {
      id: "line-1",
      label: "Prestation fictive",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 120,
      vat_category: "S",
      vat_rate: 20,
      exemption_reason: "",
    },
  ];
  return input;
};
const build = (input = fiscal(), credit = false) =>
  buildStructuredInvoice({
    input,
    issuer: { entity, establishment },
    number: "RECETTE-NON-EMISE",
    issuedAt: new Date("2026-10-16T10:00:00Z"),
    buyerName: "Client fictif",
    credit,
    periodStart: new Date("2026-10-16"),
    periodEnd: new Date("2026-10-17"),
    ...(credit ? { sourceNumber: "RECETTE-SOURCE" } : {}),
  });

test("les prix nets respectent six décimales et les totaux, même pour les grandes quantités", () => {
  for (const [quantity, price] of [
    [1, 120],
    [3, 100],
    [1.125, 55],
    [0.001, 10],
    [100000, 0.01],
    [1, 0],
  ]) {
    const input = fiscal();
    Object.assign(input.lines[0], { quantity, unit_price_ttc: price });
    const before = structuredClone(input);
    const result = build(input);
    const line = result.en_invoice_candidate.lines[0];
    const details = line.price_details;
    assert.match(details.item_net_price, /^\d+\.\d{1,6}$/);
    assert.equal(
      Math.round(
        ((Number(details.item_net_price) * quantity) /
          Number(details.item_price_base_quantity)) *
          100,
      ),
      result.calculation.net_cents,
    );
    assert.equal(
      line.net_amount,
      (result.calculation.net_cents / 100).toFixed(2),
    );
    assert.deepEqual(input, before);
    if (quantity === 100000) {
      assert.equal(details.item_price_base_quantity, "100000");
      assert.equal(details.item_net_price, "833.33");
    }
  }
});

test("factures et avoirs reprennent exactement les mêmes notes de paiement B2B", () => {
  const input = fiscal();
  for (const credit of [false, true]) {
    const result = build(input, credit);
    assert.deepEqual(
      result.en_invoice_candidate.notes,
      invoicePaymentNotes(input),
    );
    assert.equal(
      result.en_invoice_candidate.lines[0].price_details.item_net_price,
      "100.000000",
    );
    assert.equal(result.en_invoice_candidate.totals.total_with_vat, "120.00");
  }
  input.buyer.kind = "individual";
  assert.deepEqual(build(input).en_invoice_candidate.notes, []);
});

test("le bloc PDF reprend les mentions structurées, échappe le HTML et préserve les documents historiques", async () => {
  const { buildInvoicePaymentTermsHtml } =
    await import("../src/services/pdfService.js");
  const input = fiscal();
  input.payment_terms = "Paiement <recette> uniquement.";
  for (const credit of [false, true]) {
    const html = buildInvoicePaymentTermsHtml(input, credit);
    assert.ok(html.includes("Pénalités fictives &lt;recette&gt;."));
    assert.ok(!html.includes("<recette>"));
    for (const { note } of invoicePaymentNotes(input).slice(1))
      assert.ok(html.includes(note));
    assert.equal((html.match(/<br>/g) ?? []).length, credit ? 2 : 3);
    assert.equal(
      html.includes("Paiement &lt;recette&gt; uniquement."),
      !credit,
    );
  }
  assert.equal(buildInvoicePaymentTermsHtml(null), "");
  const { b2b_payment_mentions: _mentions, ...legacy } = input;
  assert.equal(
    buildInvoicePaymentTermsHtml(legacy as typeof input),
    '<div class="box"><div class="section-title">Conditions de paiement</div><p>Paiement &lt;recette&gt; uniquement.</p></div>',
  );
  input.buyer.kind = "individual";
  assert.ok(!buildInvoicePaymentTermsHtml(input).includes("Pénalités"));
});

test("le choix et le mode sont figés pour biens, services et mixte ; aucun mode absent ou partiel n’est inventé", () => {
  for (const [operation_kind, prefix] of [
    ["goods", "B"],
    ["services", "S"],
    ["mixed", "M"],
  ] as const) {
    const input = fiscal();
    input.operation_kind = operation_kind;
    for (const [paid, code] of [
      [0, `${prefix}1`],
      [120, `${prefix}2`],
    ] as const) {
      input.paid_amount = paid;
      const result = build(input);
      assert.equal(result.operation_kind, operation_kind);
      assert.equal(
        result.en_invoice_candidate.process_control.business_process_type,
        code,
      );
    }
    input.paid_amount = 0;
    assert.equal(
      build(input, true).en_invoice_candidate.process_control
        .business_process_type,
      `${prefix}1`,
    );
    input.paid_amount = 30;
    assert.equal(
      build(input).en_invoice_candidate.process_control.business_process_type,
      undefined,
    );
  }
  const input = fiscal();
  input.operation_kind = "unknown";
  assert.equal(
    build(input).en_invoice_candidate.process_control.business_process_type,
    undefined,
  );
  input.operation_kind = "services";
  input.buyer.kind = "individual";
  assert.equal(
    build(input).en_invoice_candidate.process_control.business_process_type,
    undefined,
    "le mode B2C reste du ressort de son profil spécifique",
  );
});

test("le séjour propose des nuitées au prix unitaire tout en préservant les centimes après remise", async () => {
  const { proposeInvoiceFiscal } =
    await import("../src/modules/documents/invoiceFiscal.js");
  const totals = {
    nbNuits: 3,
    montantBase: 210,
    totalSansOptions: 210,
    optionsTotal: 20,
    taxeSejourCalculee: 0,
    solde: 230,
    totalGlobal: 230,
    optionsDetail: {
      draps: 0,
      linge: 0,
      menage: 20,
      departTardif: 0,
      chiens: 0,
    },
  };
  const input = proposeInvoiceFiscal({}, totals);
  assert.equal(input.lines[0].quantity, 3);
  assert.equal(input.lines[0].unit, "DAY");
  assert.equal(input.lines[0].unit_price_ttc, 70);
  assert.equal(input.lines[1].label, "Ménage");
  assert.equal(input.lines[1].quantity, 1);
  assert.equal(input.lines[0].vat_category, "unknown");
  for (const amount of [200, 201, 209.99, 210]) {
    const discounted = proposeInvoiceFiscal(
      { remise_montant: 210 - amount },
      { ...totals, totalSansOptions: amount },
    );
    assert.equal(
      Math.round(
        discounted.lines[0].quantity * discounted.lines[0].unit_price_ttc * 100,
      ),
      Math.round(amount * 100),
    );
  }
  const zero = proposeInvoiceFiscal(
    {},
    {
      ...totals,
      totalSansOptions: 0,
      optionsDetail: { ...totals.optionsDetail, menage: 0 },
    },
  );
  assert.equal(zero.lines.length, 1);
  assert.equal(zero.lines[0].unit_price_ttc, 0);
});

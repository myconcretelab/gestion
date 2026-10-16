import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeInvoiceFiscal,
  emptyInvoiceFiscalInput,
  invoiceFiscalInputSchema,
  invoiceFiscalIssues,
  invoicePaymentNotes,
  invoiceBusinessProcessType,
} from "../src/invoiceFiscal.js";

const sample = () => {
  const input = emptyInvoiceFiscalInput();
  input.buyer = {
    kind: "individual",
    address_line1: "1 rue Exemple",
    address_line2: "",
    postal_code: "35000",
    city: "Rennes",
    country_code: "FR",
    siren: "",
    vat_number: "",
  };
  input.lines = [
    {
      id: "stay",
      label: "Location remise déduite",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 110,
      vat_category: "S",
      vat_rate: 10,
      exemption_reason: "",
    },
    {
      id: "clean",
      label: "Ménage",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 24,
      vat_category: "S",
      vat_rate: 20,
      exemption_reason: "",
    },
  ];
  input.paid_amount = 30;
  input.payment_terms = "À réception";
  input.reviewed = true;
  input.tourist_tax_reviewed = true;
  return input;
};

test("le type d’opération reste inconnu sur les anciens brouillons et les valeurs non prévues sont refusées", () => {
  const { operation_kind: _operation, ...legacy } = sample();
  assert.equal(
    invoiceFiscalInputSchema.parse(legacy).operation_kind,
    "unknown",
  );
  for (const operation_kind of [null, "", "S1", "rental", "Services", 1])
    assert.equal(
      invoiceFiscalInputSchema.safeParse({ ...sample(), operation_kind })
        .success,
      false,
    );
  for (const operation_kind of ["unknown", "goods", "services", "mixed"])
    assert.ok(
      invoiceFiscalInputSchema.safeParse({ ...sample(), operation_kind })
        .success,
    );
});

test("le cadre ordinaire découle du choix explicite et des seuls montants figés, sans supposer un règlement", () => {
  for (const [operation, prefix] of [
    ["goods", "B"],
    ["services", "S"],
    ["mixed", "M"],
  ]) {
    assert.equal(
      invoiceBusinessProcessType(operation, { paid_cents: 0, due_cents: 100 }),
      `${prefix}1`,
    );
    assert.equal(
      invoiceBusinessProcessType(operation, { paid_cents: 100, due_cents: 0 }),
      `${prefix}2`,
    );
    assert.equal(
      invoiceBusinessProcessType(operation, { paid_cents: 0, due_cents: 0 }),
      `${prefix}1`,
    );
    assert.equal(
      invoiceBusinessProcessType(
        operation,
        { paid_cents: 0, due_cents: 100 },
        true,
      ),
      `${prefix}1`,
    );
    assert.equal(
      invoiceBusinessProcessType(operation, { paid_cents: 50, due_cents: 50 }),
      null,
    );
    assert.equal(
      invoiceBusinessProcessType(
        operation,
        { paid_cents: 100, due_cents: 0 },
        true,
      ),
      null,
    );
  }
  for (const operation of [undefined, null, "unknown", "rental", "toString"])
    assert.equal(
      invoiceBusinessProcessType(operation, { paid_cents: 0, due_cents: 100 }),
      null,
    );
  for (const paid_cents of [-1, NaN, 0.1, Infinity])
    assert.equal(
      invoiceBusinessProcessType("services", { paid_cents, due_cents: 100 }),
      null,
    );
});

test("qualification B2B requise avant émission, pas déduite des lignes ni exigée pour le parcours B2C existant", () => {
  const input = sample();
  input.buyer.kind = "business";
  input.buyer.siren = "732829320";
  input.paid_amount = 0;
  assert.match(invoiceFiscalIssues(input, 134).join(), /nature de l’opération/);
  input.operation_kind = "services";
  assert.ok(
    !invoiceFiscalIssues(input, 134).some((i) =>
      /nature de l’opération/.test(i),
    ),
  );
  input.paid_amount = 30;
  assert.match(invoiceFiscalIssues(input, 134).join(), /paiements partiels/);
  input.operation_kind = "unknown";
  input.paid_amount = 0;
  assert.ok(
    !invoiceFiscalIssues(input, -134, { credit: true }).some((i) =>
      /nature de l’opération/.test(i),
    ),
    "un avoir d’une ancienne facture peut rester non qualifié et non transmissible",
  );
  input.buyer.kind = "individual";
  input.buyer.siren = "";
  input.paid_amount = 30;
  assert.deepEqual(
    invoiceFiscalIssues(input, 134, { sellerVatNumber: "FR01732829320" }),
    [],
  );
});

test("calcul TTC conservé, plusieurs taux et sommes réellement reçues", () => {
  const input = sample();
  const result = computeInvoiceFiscal(input);
  assert.equal(result.net_cents, 12000);
  assert.equal(result.vat_cents, 1400);
  assert.equal(result.gross_cents, 13400);
  assert.equal(result.due_cents, 10400);
  assert.deepEqual(
    result.breakdown.map((group) => group.vat_cents),
    [1000, 400],
  );
  assert.deepEqual(
    invoiceFiscalIssues(input, 134, {
      sellerVatNumber: "FR01732829320",
      vatRegime: "reel_normal",
    }),
    [],
  );
});

test("arrondis monétaires déterministes et TVA arrondie par catégorie/taux", () => {
  const input = sample();
  input.lines = Array.from({ length: 3 }, (_, i) => ({
    ...input.lines[0],
    id: String(i),
    unit_price_ttc: 0.03,
    vat_rate: 20,
  }));
  input.paid_amount = 0;
  const totals = computeInvoiceFiscal(input);
  assert.equal(totals.net_cents, 9);
  assert.equal(totals.vat_cents, 2);
  assert.equal(totals.rounding_cents, -2);
  assert.equal(
    totals.total_with_vat_cents + totals.rounding_cents,
    totals.gross_cents,
  );
  assert.equal(totals.due_cents, 9);
  input.lines = [{ ...input.lines[0], quantity: 1.125, unit_price_ttc: 0.04 }];
  assert.equal(computeInvoiceFiscal(input).gross_cents, 5);
});

test("les brouillons sont partiels, les valeurs malformées sont refusées sans exception inattendue", () => {
  assert.ok(
    invoiceFiscalInputSchema.safeParse(emptyInvoiceFiscalInput()).success,
  );
  for (const date of ["2026-02-30", "2026-99-99", "pas une date"])
    assert.equal(
      invoiceFiscalInputSchema.safeParse({
        ...sample(),
        payment_due_date: date,
      }).success,
      false,
    );
  assert.equal(
    invoiceFiscalInputSchema.safeParse({ ...sample(), paid_amount: 0.001 })
      .success,
    false,
  );
  assert.equal(
    invoiceFiscalInputSchema.safeParse({
      ...sample(),
      lines: [sample().lines[0], sample().lines[0]],
    }).success,
    false,
  );
  assert.equal(
    invoiceFiscalInputSchema.safeParse({
      ...sample(),
      lines: [{ ...sample().lines[0], quantity: -1 }],
    }).success,
    false,
  );
  assert.equal(
    invoiceFiscalInputSchema.safeParse({
      ...sample(),
      lines: [{ ...sample().lines[0], vat_category: "AE" }],
    }).success,
    false,
  );
});

test("le rapprochement bloque tout écart de TTC et les trop-perçus", () => {
  const input = sample();
  assert.match(invoiceFiscalIssues(input, 133.99).join(), /total TTC/);
  input.paid_amount = 135;
  assert.match(invoiceFiscalIssues(input, 134).join(), /réellement reçu/);
});

test("franchise, exonération et taux zéro restent des catégories distinctes", () => {
  const input = sample();
  assert.match(
    invoiceFiscalIssues(input, 134, { vatRegime: "franchise_en_base" }).join(),
    /franchise/,
  );
  input.lines = [
    {
      ...input.lines[0],
      unit_price_ttc: 134,
      vat_category: "E",
      vat_rate: 0,
      exemption_reason: "TVA non applicable, article 293 B du CGI",
    },
  ];
  assert.deepEqual(
    invoiceFiscalIssues(input, 134, { vatRegime: "franchise_en_base" }),
    [],
  );
  assert.equal(computeInvoiceFiscal(input).vat_cents, 0);
  input.lines[0].exemption_reason = "";
  assert.match(invoiceFiscalIssues(input, 134).join(), /motif/);
});

test("hors champ ne se mélange pas avec d’autres catégories ni des identifiants TVA", () => {
  const input = sample();
  input.lines[0] = {
    ...input.lines[0],
    vat_category: "O",
    vat_rate: 0,
    exemption_reason: "Hors champ vérifié",
  };
  assert.match(invoiceFiscalIssues(input, 134).join(), /mélangé/);
  input.lines = [input.lines[0]];
  assert.match(
    invoiceFiscalIssues(input, 110, {
      sellerVatNumber: "FR01732829320",
    }).join(),
    /numéros de TVA/,
  );
});

test("clients professionnels français : SIREN et cohérence TVA obligatoires", () => {
  const input = sample();
  input.buyer.kind = "business";
  assert.match(invoiceFiscalIssues(input, 134).join(), /SIREN/);
  input.buyer.siren = "732829320";
  input.buyer.vat_number = "FR00123456789";
  assert.match(invoiceFiscalIssues(input, 134).join(), /correspondre/);
  input.buyer.country_code = "BE";
  input.buyer.siren = "";
  input.buyer.vat_number = "BE0123456789";
  assert.ok(
    !invoiceFiscalIssues(input, 134).some((issue) => /SIREN/.test(issue)),
  );
});

test("anciens brouillons lisibles, mais aucune mention B2B inventée ni déduite des conditions libres", () => {
  const { b2b_payment_mentions: _mentions, ...legacy } = sample();
  const parsed = invoiceFiscalInputSchema.parse(legacy);
  assert.deepEqual(parsed.b2b_payment_mentions, {
    late_payment_penalties: "",
    recovery_fee: "",
    early_payment_discount: "",
  });
  assert.deepEqual(invoicePaymentNotes(parsed), []);
  parsed.buyer.kind = "business";
  parsed.buyer.siren = "732829320";
  for (const credit of [false, true])
    assert.equal(
      invoiceFiscalIssues(parsed, 134, { credit }).filter((i) =>
        /mention «/.test(i),
      ).length,
      3,
    );
  assert.deepEqual(invoicePaymentNotes(parsed), []);
});

test("mentions B2B explicites, bornées et normalisées, sans application aux particuliers", () => {
  const input = sample();
  input.operation_kind = "services";
  input.paid_amount = 0;
  input.buyer.kind = "business";
  input.buyer.siren = "732829320";
  input.b2b_payment_mentions = {
    late_payment_penalties: " Pénalités convenues (recette). ",
    recovery_fee: "Indemnité convenue (recette).",
    early_payment_discount: "Aucun escompte (recette).",
  };
  const parsed = invoiceFiscalInputSchema.parse(input);
  assert.deepEqual(invoicePaymentNotes(parsed), [
    { subject_code: "PMD", note: "Pénalités convenues (recette)." },
    { subject_code: "PMT", note: "Indemnité convenue (recette)." },
    { subject_code: "AAB", note: "Aucun escompte (recette)." },
  ]);
  assert.deepEqual(
    invoiceFiscalIssues(parsed, 134, { sellerVatNumber: "FR01732829320" }),
    [],
  );
  for (const key of [
    "late_payment_penalties",
    "recovery_fee",
    "early_payment_discount",
  ] as const) {
    const incomplete = structuredClone(parsed);
    incomplete.b2b_payment_mentions[key] = " \n ";
    assert.equal(
      invoiceFiscalIssues(incomplete, 134).filter((i) => /mention «/.test(i))
        .length,
      1,
    );
    assert.equal(
      invoiceFiscalInputSchema.safeParse({
        ...parsed,
        b2b_payment_mentions: {
          ...parsed.b2b_payment_mentions,
          [key]: "x".repeat(501),
        },
      }).success,
      false,
    );
  }
  parsed.buyer.kind = "individual";
  assert.deepEqual(invoicePaymentNotes(parsed), []);
});

test("aucune TVA ni taxe de séjour supposée et revue explicite avant émission", () => {
  const input = sample();
  input.reviewed = false;
  input.tourist_tax_reviewed = false;
  input.lines[0].vat_category = "unknown";
  const issues = invoiceFiscalIssues(input, 134, { touristTax: 4 });
  assert.match(issues.join(), /traitement de TVA/);
  assert.match(issues.join(), /taxe de séjour/);
  assert.match(issues.join(), /Confirmez/);
  assert.match(invoiceFiscalIssues(null, 10).join(), /Préparez/);
});

test("les avoirs utilisent des montants positifs EN16931 sans acompte de la source", () => {
  const input = sample();
  assert.match(
    invoiceFiscalIssues(input, -134, { credit: true }).join(),
    /avoir intégral/,
  );
  input.paid_amount = 0;
  assert.deepEqual(
    invoiceFiscalIssues(input, -134, {
      credit: true,
      sellerVatNumber: "FR01732829320",
    }),
    [],
  );
});

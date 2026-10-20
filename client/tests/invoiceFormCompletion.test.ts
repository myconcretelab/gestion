import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyInvoiceFiscalInput } from "@contrats/shared";
import {
  invoiceFormCompletion,
  invoiceIssueTarget,
} from "../src/pages/shared/invoiceFormCompletion.ts";

const context = {
  name: "Client exemple",
  giteId: "gite",
  start: "2026-10-20",
  end: "2026-10-23",
  email: "",
};
const completeInput = () => {
  const input = emptyInvoiceFiscalInput();
  input.buyer = {
    ...input.buyer,
    kind: "individual",
    address_line1: "1 rue Exemple",
    postal_code: "35000",
    city: "Rennes",
    country_code: "FR",
  };
  input.lines = [
    {
      id: "line-1",
      label: "Location · nuitée",
      quantity: 3,
      unit: "DAY",
      unit_price_ttc: 70,
      vat_category: "E",
      vat_rate: 0,
      exemption_reason: "TVA non applicable, article 293 B du CGI",
    },
  ];
  input.payment_due_date = "2026-10-23";
  input.reviewed = true;
  return input;
};

test("un séjour complet de trois nuits est prêt et les changements requis restent guidés", () => {
  const input = completeInput();
  assert.deepEqual(
    invoiceFormCompletion(
      input,
      210,
      { vatRegime: "franchise_en_base" },
      context,
    ),
    [],
  );
  input.buyer.city = "";
  input.lines[0].vat_category = "unknown";
  input.reviewed = false;
  const items = invoiceFormCompletion(input, 210, {}, context);
  assert.ok(items.some((item) => item.target === "buyer-city"));
  assert.ok(items.some((item) => item.target === "invoice-line-vat"));
  assert.ok(items.some((item) => item.target === "invoice-reviewed"));
  assert.ok(!items.some((item) => /SIREN|mention «/.test(item.label)));
});

test("les exigences B2B, paiements, taxe et régime fiscal restent présentes", () => {
  const input = completeInput();
  input.buyer.kind = "business";
  input.payment_due_date = "";
  input.lines[0].exemption_reason = "Exonéré";
  const items = invoiceFormCompletion(
    input,
    210,
    { vatRegime: "franchise_en_base", touristTax: 3 },
    context,
  );
  for (const target of [
    "buyer-kind",
    "b2b-payment-mentions",
    "invoice-operation-kind",
    "invoice-line-vat",
    "payment-details",
    "tourist-tax-reviewed",
  ])
    assert.ok(
      items.some((item) => item.target === target),
      target,
    );
});

test("les liens ciblent chaque ligne et les valeurs invalides ne cassent pas l’assistant", () => {
  assert.equal(
    invoiceIssueTarget("Ligne 2 : choisissez le traitement de TVA."),
    "invoice-line-vat-1",
  );
  assert.equal(
    invoiceIssueTarget("Ligne 3 : renseignez un libellé."),
    "invoice-line-label-2",
  );
  const input = completeInput();
  input.lines[0].quantity = 0;
  const items = invoiceFormCompletion(
    input,
    210,
    {},
    { ...context, name: "", email: "invalide" },
  );
  assert.ok(items.some((item) => item.target === "invoice-buyer-name"));
  assert.ok(items.some((item) => item.target === "invoice-buyer-email"));
  assert.ok(items.some((item) => item.label.includes("Ligne 1")));
});

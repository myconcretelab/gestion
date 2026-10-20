import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyInvoiceFiscalInput,
  computeInvoiceFiscal,
  type InvoiceFiscalLine,
} from "@contrats/shared";
import { createInvoiceFormInput } from "../src/pages/shared/invoiceFormDefaults.ts";
import {
  reconcileInvoiceGeneratedLines,
  shouldSyncInvoiceGeneratedLines,
} from "../src/pages/shared/invoiceFormLines.ts";
import { invoiceCompletionProgress } from "../src/pages/shared/invoiceFormCompletion.ts";
import { countryOptions } from "../src/pages/shared/countryOptions.ts";
import { proposeInvoiceFiscal } from "../../server/src/modules/documents/invoiceFiscal.ts";

const line = (id: string, label: string, price: number): InvoiceFiscalLine => ({
  id,
  label,
  quantity: 1,
  unit: "C62",
  unit_price_ttc: price,
  vat_category: "unknown",
  vat_rate: 0,
  exemption_reason: "",
});

test("les nouvelles factures sont B2C/FR sans changer les données partagées ou une autre facture", () => {
  const first = createInvoiceFormInput();
  assert.equal(first.buyer.kind, "individual");
  assert.equal(first.buyer.country_code, "FR");
  first.buyer.kind = "business";
  first.buyer.country_code = "BE";
  assert.equal(createInvoiceFormInput().buyer.kind, "individual");
  assert.equal(createInvoiceFormInput().buyer.country_code, "FR");
  assert.equal(emptyInvoiceFiscalInput().buyer.kind, "unknown");
  assert.equal(new Set(countryOptions.map(({ code }) => code)).size, 249);
  for (const code of ["FR", "BE", "CH", "GB", "US", "JP"])
    assert.ok(countryOptions.some((country) => country.code === code));
});

test("une ligne issue du séjour reste recalculable après réouverture, une ventilation personnalisée est protégée", () => {
  const generated = [
    {
      ...line("line-1", "Location · nuitée", 70),
      quantity: 3,
      unit: "DAY" as const,
    },
  ];
  const saved = structuredClone(generated);
  saved[0].vat_category = "E";
  saved[0].exemption_reason = "Article 293 B";
  assert.equal(shouldSyncInvoiceGeneratedLines(true, saved, generated), true);
  assert.equal(
    shouldSyncInvoiceGeneratedLines(
      true,
      [{ ...saved[0], quantity: 1, unit_price_ttc: 210 }],
      generated,
    ),
    false,
  );
  assert.equal(
    shouldSyncInvoiceGeneratedLines(true, saved, generated, generated),
    false,
  );
  const updated = reconcileInvoiceGeneratedLines(
    saved,
    [
      {
        ...generated[0],
        unit_price_ttc: 80,
        label: "Location · nuitée (remise déjà déduite)",
      },
    ],
    generated,
  );
  assert.equal(updated[0].unit_price_ttc, 80);
  assert.equal(updated[0].vat_category, "E");
  const customLabel = reconcileInvoiceGeneratedLines(
    [{ ...saved[0], label: "Séjour de Camille" }],
    [{ ...generated[0], unit_price_ttc: 80 }],
    generated,
  );
  assert.equal(customLabel[0].label, "Séjour de Camille");
  assert.equal(customLabel[0].unit_price_ttc, 80);
  assert.equal(updated[0].label, "Location · nuitée (remise déjà déduite)");
});

test("retirer une option ne transfère pas sa TVA aux frais et ajouter une prestation ne lui invente pas de taux", () => {
  const baseline = [
    line("line-1", "Location · nuitée", 70),
    line("line-2", "Ménage", 40),
    line("line-3", "Panier", 20),
  ];
  const saved = structuredClone(baseline);
  Object.assign(saved[1], { vat_category: "S", vat_rate: 20 });
  Object.assign(saved[2], { vat_category: "S", vat_rate: 10 });
  const proposed = [
    baseline[0],
    line("line-2", "Panier", 25),
    line("line-3", "Transport", 15),
  ];
  const updated = reconcileInvoiceGeneratedLines(saved, proposed, baseline);
  assert.equal(updated[1].label, "Panier");
  assert.equal(updated[1].vat_rate, 10);
  assert.equal(updated[1].unit_price_ttc, 25);
  assert.equal(updated[2].vat_category, "unknown");
  assert.equal(saved[2].unit_price_ttc, 20);
});

test("les lignes fusionnées gardent exactement le total après remises, options et frais au centime", () => {
  const optionsDetail = {
    draps: 15,
    linge: 0,
    menage: 40,
    departTardif: 0,
    chiens: 0,
  };
  for (const remise of [0, 10, 21, 30.01]) {
    const totals = {
      nbNuits: 3,
      montantBase: 210,
      totalSansOptions: 210 - remise,
      optionsTotal: 55,
      taxeSejourCalculee: 0,
      solde: 0,
      totalGlobal: 265 - remise,
      optionsDetail,
    };
    const input = proposeInvoiceFiscal(
      {
        remise_montant: remise,
        frais_supplementaires: [{ libelle: "Panier", montant: 12.35 }],
      },
      totals,
    );
    assert.equal(
      computeInvoiceFiscal(input).gross_cents,
      Math.round((totals.totalGlobal + 12.35) * 100),
    );
  }
  const grouped = proposeInvoiceFiscal(
    {
      reservation_items: [
        {
          gite_nom: "Gîte A",
          date_debut: "2026-10-20",
          date_fin: "2026-10-23",
          montant: 210,
        },
        {
          gite_nom: "Gîte B",
          date_debut: "2026-11-01",
          date_fin: "2026-11-03",
          montant: 160,
        },
      ],
      frais_supplementaires: [{ libelle: "Panier", montant: 12.35 }],
    },
    {
      nbNuits: 5,
      montantBase: 370,
      totalSansOptions: 370,
      optionsTotal: 0,
      taxeSejourCalculee: 0,
      solde: 370,
      totalGlobal: 370,
      optionsDetail,
    },
  );
  assert.equal(computeInvoiceFiscal(grouped).gross_cents, 38235);
});

test("l’avancement utilise les validations et ne dépend pas du nombre de lignes de TVA", () => {
  assert.equal(invoiceCompletionProgress([]), 100);
  assert.equal(
    invoiceCompletionProgress([{ target: "buyer-address", label: "Adresse" }]),
    80,
  );
  assert.equal(
    invoiceCompletionProgress([
      { target: "invoice-line-vat", label: "TVA" },
      { target: "invoice-line-vat-1", label: "TVA" },
    ]),
    80,
  );
  assert.equal(
    invoiceCompletionProgress(
      [
        "buyer-address",
        "invoice-start",
        "invoice-fiscal",
        "payment-details",
        "invoice-reviewed",
      ].map((target) => ({ target, label: target })),
    ),
    0,
  );
});

test("deux frais portant le même libellé ne se transmettent pas leur TVA lors d’un retrait", () => {
  const baseline = [
    line("line-1", "Supplément", 10),
    line("line-2", "Supplément", 20),
  ];
  const previous = structuredClone(baseline);
  Object.assign(previous[0], { vat_category: "S", vat_rate: 20 });
  Object.assign(previous[1], { vat_category: "S", vat_rate: 10 });
  const unchanged = reconcileInvoiceGeneratedLines(
    previous,
    baseline,
    baseline,
  );
  assert.equal(unchanged[1].vat_rate, 10);
  const removed = reconcileInvoiceGeneratedLines(
    previous,
    [line("line-1", "Supplément", 20)],
    baseline,
  );
  assert.equal(removed[0].vat_category, "unknown");
});

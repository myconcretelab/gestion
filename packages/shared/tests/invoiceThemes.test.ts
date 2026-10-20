import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invoiceClausesSchema,
  invoiceThemeIds,
  invoiceThemes,
  resolveInvoiceTheme,
} from "../src/invoiceThemes.js";

test("le catalogue pilote les choix et conserve le modèle des factures existantes", () => {
  assert.equal(invoiceThemeIds.length, 3);
  for (const id of invoiceThemeIds) {
    assert.equal(resolveInvoiceTheme({ invoice_theme: id }), id);
    assert.ok(invoiceThemes[id].name);
  }
  for (const value of [
    null,
    undefined,
    {},
    { invoice_theme: "ancienne-valeur" },
  ])
    assert.equal(resolveInvoiceTheme(value), "heritage");
});

test("les réglages de présentation préservent les clauses et refusent les chemins arbitraires", () => {
  const clauses = {
    invoice_theme: "horizon",
    remise_raison: "Fidélité",
    texte_additionnel: "Merci",
    custom: { preserved: true },
  };
  assert.deepEqual(invoiceClausesSchema.parse(clauses), clauses);
  assert.equal(
    invoiceClausesSchema.safeParse({ invoice_theme: "../../secret" }).success,
    false,
  );
  assert.equal(
    invoiceClausesSchema.safeParse({ invoice_theme: "" }).success,
    false,
  );
});

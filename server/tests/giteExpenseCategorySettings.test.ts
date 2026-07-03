import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultGiteExpenseCategorySettings,
  normalizeGiteDynamicExpenseRules,
} from "../src/services/giteExpenseCategorySettings.ts";

test("les réglages de frais initialisent Urssaf à 6 % dans la catégorie Taxes", () => {
  const settings = buildDefaultGiteExpenseCategorySettings();

  assert.deepEqual(settings.dynamic_expenses, [
    {
      id: "urssaf",
      label: "Urssaf",
      category_id: "taxes",
      basis: "urssaf_revenue",
      rate: 0.06,
      enabled: true,
    },
  ]);
});

test("une règle dynamique est bornée et rattachée à une catégorie existante", () => {
  const categories = [{ id: "charges", name: "Charges", color: "#123456" }];
  const rules = normalizeGiteDynamicExpenseRules(
    [{ id: "urssaf", label: "Urssaf", category_id: "absente", rate: 4, enabled: false }],
    categories,
  );

  assert.deepEqual(rules[0], {
    id: "urssaf",
    label: "Urssaf",
    category_id: "charges",
    basis: "urssaf_revenue",
    rate: 1,
    enabled: false,
  });
});

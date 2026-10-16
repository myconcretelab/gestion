import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeReceiptAmount } from "../src/utils/electronicPayments.ts";

test("les encaissements saisis en euros sont normalisés exactement en deux décimales", () => {
  for (const [value, expected] of [
    ["60", "60.00"],
    ["60.1", "60.10"],
    ["27.50", "27.50"],
    ["0.01", "0.01"],
    ["060", "60.00"],
    ["000.10", "0.10"],
  ])
    assert.equal(normalizeReceiptAmount(value), expected);
});
test("une précision invalide n’est jamais arrondie ni transformée en encaissement plausible", () => {
  for (const value of ["60.001", "-20", "1e2", "", "abc", "20,50"])
    assert.equal(normalizeReceiptAmount(value), value);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  suggestPaymentTouristTax,
  paymentTouristTaxInputSchema,
  type ReservationPaymentTracking,
} from "../src/index.js";

const tracking: ReservationPaymentTracking = {
  managed: true,
  total: 106,
  deposit: 20,
  received: 0,
  remaining: 106,
  overpaid: 0,
  requires_review: false,
  entries: [],
  tourist_tax: {
    available: true,
    reason: null,
    expectedCents: 600,
    allocatedCents: 0,
    remainingCents: 600,
    sourceRevision: "a".repeat(64),
    needsReview: false,
    hasUnassignedPayments: false,
  },
};
test("le solde propose seulement la taxe restante comprise dans le règlement", () => {
  assert.deepEqual(suggestPaymentTouristTax(tracking, 106, "full"), {
    amountCents: 600,
    checked: true,
    sourceRevision: "a".repeat(64),
  });
  const partial = {
    ...tracking,
    tourist_tax: { ...tracking.tourist_tax!, remainingCents: 200 },
  };
  assert.equal(
    suggestPaymentTouristTax(partial, 106, "balance")!.amountCents,
    200,
  );
  assert.equal(
    suggestPaymentTouristTax(tracking, 3, "payment")!.amountCents,
    300,
  );
});
test("les arrhes et paiements historiques non ventilés exigent un choix explicite", () => {
  assert.equal(
    suggestPaymentTouristTax(tracking, 20, "deposit")!.checked,
    false,
  );
  assert.equal(
    suggestPaymentTouristTax(
      {
        ...tracking,
        tourist_tax: { ...tracking.tourist_tax!, hasUnassignedPayments: true },
      },
      106,
      "full",
    )!.checked,
    false,
  );
});
test("aucune proposition de collecte pour une plateforme, un barème à vérifier ou une taxe déjà affectée", () => {
  assert.equal(
    suggestPaymentTouristTax(
      { ...tracking, requires_review: true },
      106,
      "full",
    ),
    null,
  );
  assert.equal(
    suggestPaymentTouristTax(
      { ...tracking, tourist_tax: undefined },
      106,
      "full",
    ),
    null,
  );
  for (const patch of [
    { available: false },
    { needsReview: true },
    { remainingCents: 0 },
  ])
    assert.equal(
      suggestPaymentTouristTax(
        { ...tracking, tourist_tax: { ...tracking.tourist_tax!, ...patch } },
        106,
        "full",
      ),
      null,
    );
  assert.equal(
    paymentTouristTaxInputSchema.safeParse({
      amount_cents: -1,
      source_revision: "a".repeat(64),
    }).success,
    false,
  );
  assert.equal(
    paymentTouristTaxInputSchema.safeParse({
      amount_cents: 1.5,
      source_revision: "a".repeat(64),
    }).success,
    false,
  );
});

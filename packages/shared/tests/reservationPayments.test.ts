import assert from "node:assert/strict";
import test from "node:test";
import {
  getBookingSource,
  legacyPaymentMethod,
} from "../src/reservationPayments.js";

test("l'origine explicite reste indépendante du moyen historique", () => {
  assert.equal(
    getBookingSource({ booking_source: "Direct", source_paiement: "Chèque" }),
    "Direct",
  );
  assert.equal(
    getBookingSource({ booking_source: "Airbnb", source_paiement: "Virement" }),
    "Airbnb",
  );
});
test("les anciennes origines hors plateforme deviennent Direct sans changer le moyen historique", () => {
  assert.equal(getBookingSource({ source_paiement: "Airbnb" }), "Airbnb");
  for (const source_paiement of ["Direct", "Chèque", "Espèces", "Virement", "A définir", null]) {
    assert.equal(getBookingSource({ source_paiement }), "Direct");
  }
  for (const source_paiement of ["Abritel", "Gites de France", "HomeExchange"]) {
    assert.equal(getBookingSource({ source_paiement }), source_paiement);
  }
  assert.equal(getBookingSource({ booking_source: "À préciser", source_paiement: "Chèque" }), "À préciser");
});
test("une plateforme ou Stripe n'est pas assimilée à un moyen de paiement manuel", () => {
  assert.equal(legacyPaymentMethod("Chèque"), "Chèque");
  assert.equal(legacyPaymentMethod("Airbnb"), null);
  assert.equal(legacyPaymentMethod("Stripe"), null);
});

test("les arrhes fractionnées retiennent la date de complétion et ne prétendent pas à un moyen unique", async () => {
  const { getContractReceiptStatus } =
    await import("../src/reservationPayments.js");
  const entries = [
    {
      id: "1",
      amount: 100,
      method: "Chèque",
      purpose: "deposit",
      paid_on: "2026-10-01",
      note: null,
      origin: "manual" as const,
      voided_at: null,
    },
    {
      id: "2",
      amount: 100,
      method: "Virement",
      purpose: "deposit",
      paid_on: "2026-10-13",
      note: null,
      origin: "manual" as const,
      voided_at: null,
    },
  ];
  const result = getContractReceiptStatus(
    {
      managed: true,
      total: 1000,
      deposit: 200,
      received: 200,
      remaining: 800,
      overpaid: 0,
      requires_review: false,
      entries,
    },
    200,
    1000,
  );
  assert.equal(result.statut_paiement_arrhes, "recu");
  assert.equal(result.date_paiement_arrhes, "2026-10-13");
  assert.equal(result.mode_paiement_arrhes, null);
});

test("un solde d'un autre moyen ne change pas le moyen des arrhes déjà reçues", async () => {
  const { getContractReceiptStatus } =
    await import("../src/reservationPayments.js");
  const entries = [
    {
      id: "balance",
      amount: 800,
      method: "Virement",
      purpose: "balance",
      paid_on: "2026-10-13",
      note: null,
      origin: "manual" as const,
      voided_at: null,
    },
    {
      id: "deposit",
      amount: 200,
      method: "Chèque",
      purpose: "deposit",
      paid_on: "2026-10-13",
      note: null,
      origin: "manual" as const,
      voided_at: null,
    },
  ];
  const result = getContractReceiptStatus(
    {
      managed: true,
      total: 1000,
      deposit: 200,
      received: 1000,
      remaining: 0,
      overpaid: 0,
      requires_review: false,
      entries,
    },
    200,
    1000,
  );
  assert.equal(result.mode_paiement_arrhes, "Chèque");
  assert.equal(result.statut_paiement_solde, "regle");
});

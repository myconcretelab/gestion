import assert from "node:assert/strict";
import test from "node:test";
import {
  getBookingSource,
  legacyPaymentMethod,
  getSuggestedReservationPayment,
  getReservationPaymentShortcutValue,
} from "../src/reservationPayments.js";

test("les raccourcis encaissent le montant restant sans supposer des arrhes déjà reçues", () => {
  const tracking = {
    managed: false,
    total: 1000,
    deposit: 300,
    received: 0,
    remaining: 1000,
    overpaid: 0,
    requires_review: false,
    entries: [],
  };
  assert.deepEqual(
    getReservationPaymentShortcutValue(tracking, { target: "remaining" }),
    { purpose: "full", amount: 1000 },
  );
  assert.deepEqual(
    getReservationPaymentShortcutValue(tracking, { target: "deposit" }),
    { purpose: "deposit", amount: 300 },
  );
  const partial = { ...tracking, received: 100, remaining: 900 };
  assert.deepEqual(
    getReservationPaymentShortcutValue(partial, { target: "deposit" }),
    { purpose: "deposit", amount: 200 },
  );
  assert.deepEqual(
    getReservationPaymentShortcutValue(partial, { target: "remaining" }),
    { purpose: "balance", amount: 900 },
  );
  assert.equal(
    getReservationPaymentShortcutValue(
      { ...tracking, received: 300, remaining: 700 },
      { target: "deposit" },
    ).amount,
    0,
  );
  assert.equal(
    getReservationPaymentShortcutValue(
      { ...tracking, received: 1000, remaining: 0 },
      { target: "remaining" },
    ).amount,
    0,
  );
});

test("les raccourcis conservent les centimes et ne demandent pas d'arrhes aux plateformes", () => {
  const tracking = {
    managed: true,
    total: 1,
    deposit: 0.3,
    received: 0.1,
    remaining: 0.9,
    overpaid: 0,
    requires_review: false,
    entries: [],
  };
  assert.equal(
    getReservationPaymentShortcutValue(tracking, { target: "deposit" }).amount,
    0.2,
  );
  const platform = {
    ...tracking,
    total: 1060,
    deposit: 300,
    received: 1000,
    remaining: 60,
    platform: {
      source: "Airbnb",
      automatic: true,
      accommodation: 1000,
      expected: 0,
      extras_remaining: 60,
    },
  };
  assert.deepEqual(
    getReservationPaymentShortcutValue(platform, { target: "remaining" }),
    { purpose: "balance", amount: 60 },
  );
  assert.equal(
    getReservationPaymentShortcutValue(platform, { target: "deposit" }).amount,
    0,
  );
});

test("le premier règlement propose la totalité par défaut et les arrhes sur choix explicite", () => {
  const tracking = {
    managed: false,
    total: 190,
    deposit: 57,
    received: 0,
    remaining: 190,
    overpaid: 0,
    requires_review: false,
    entries: [],
  };
  assert.deepEqual(getSuggestedReservationPayment(tracking), {
    purpose: "full",
    amount: 190,
  });
  assert.deepEqual(
    getSuggestedReservationPayment({
      ...tracking,
      first_payment_default: "deposit",
    }),
    { purpose: "deposit", amount: 57 },
  );
  assert.deepEqual(
    getSuggestedReservationPayment({
      ...tracking,
      deposit: 0,
      first_payment_default: "deposit",
    }),
    { purpose: "full", amount: 190 },
  );
  assert.deepEqual(
    getSuggestedReservationPayment({
      ...tracking,
      received: 57,
      remaining: 133,
      first_payment_default: "deposit",
    }),
    { purpose: "balance", amount: 133 },
  );
});

test("la préférence pour les arrhes ne remplace pas les options restant dues sur une plateforme", () => {
  const tracking = {
    managed: false,
    total: 1060,
    deposit: 300,
    received: 1000,
    remaining: 60,
    overpaid: 0,
    requires_review: false,
    entries: [],
    first_payment_default: "deposit" as const,
    platform: {
      source: "Airbnb",
      automatic: true,
      accommodation: 1000,
      expected: 0,
      extras_remaining: 60,
    },
  };
  assert.deepEqual(getSuggestedReservationPayment(tracking), {
    purpose: "balance",
    amount: 60,
  });
});

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
  for (const source_paiement of [
    "Direct",
    "Chèque",
    "Espèces",
    "Virement",
    "A définir",
    null,
  ]) {
    assert.equal(getBookingSource({ source_paiement }), "Direct");
  }
  for (const source_paiement of [
    "Abritel",
    "Gites de France",
    "HomeExchange",
  ]) {
    assert.equal(getBookingSource({ source_paiement }), source_paiement);
  }
  assert.equal(
    getBookingSource({
      booking_source: "À préciser",
      source_paiement: "Chèque",
    }),
    "À préciser",
  );
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
  assert.equal(
    getContractReceiptStatus(
      {
        managed: true,
        total: 1000,
        deposit: 200,
        received: 200,
        remaining: 800,
        overpaid: 0,
        requires_review: false,
        entries: entries.map((entry) => ({
          ...entry,
          paid_on_estimated: true,
        })),
      },
      200,
      1000,
    ).date_paiement_arrhes,
    null,
  );
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

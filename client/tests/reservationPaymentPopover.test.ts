import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReservationPaymentPopover from "../src/pages/shared/ReservationPaymentPopover";
import { setCurrentAuthUser } from "../src/utils/auth";
import type { Reservation } from "../src/utils/types";

const reservation = {
  id: "payment-test",
  hote_nom: "Camille",
  prix_total: 1000,
  booking_source: "Direct",
  source_paiement: "Chèque",
  payment_tracking: {
    managed: true,
    total: 1000,
    deposit: 200,
    received: 200,
    remaining: 800,
    overpaid: 0,
    requires_review: false,
    entries: [],
  },
} as unknown as Reservation;
const render = (overrides: Partial<Reservation> = {}) =>
  renderToStaticMarkup(
    createElement(ReservationPaymentPopover, {
      reservation: { ...reservation, ...overrides },
      onUpdated() {},
    }),
  );

test("la cellule affiche le reste du séjour et la part réellement réglée", () => {
  const html = render();
  assert.match(html, /800,00/);
  assert.match(html, /Arrhes reçues/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-valuenow="20"/);
  assert.match(html, /width:20%/);
});
test("un séjour payé affiche zéro restant et une progression complète", () => {
  const html = render({
    payment_tracking: {
      ...reservation.payment_tracking!,
      received: 1000,
      remaining: 0,
    },
  });
  assert.match(html, />0,00/);
  assert.match(html, /✓ Payé/);
  assert.match(html, /aria-valuenow="100"/);
});
test("un ancien moyen sans encaissement garde un solde non renseigné", () => {
  const html = render({
    payment_tracking: {
      ...reservation.payment_tracking!,
      managed: false,
      received: 0,
      remaining: 1000,
    },
  });
  assert.match(html, /Non renseigné/);
  assert.doesNotMatch(html, /role="progressbar"/);
});
test("le montant et la progression ne sont pas révélés sans accès aux montants", () => {
  try {
    setCurrentAuthUser({
      permissions: { canViewAmounts: false, isOwner: false },
      pageAccess: [],
    } as any);
    const html = render();
    assert.match(html, /Montant masqué/);
    assert.doesNotMatch(html, /800,00|role="progressbar"|width:20%/);
  } finally {
    setCurrentAuthUser(null);
  }
});

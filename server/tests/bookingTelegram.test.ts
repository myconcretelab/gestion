import "./helpers/emailTestData.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBookingRequestCreatedMessage,
  buildBookingRequestApprovedTelegramMessage,
  buildBookingPaymentTelegramMessage,
} from "../src/services/telegramNotifications.js";

const payload = {
  id: "request-1",
  approved_reservation_id: "reservation-1",
  hote_nom: "Camille <Test>",
  email: "client@example.test",
  telephone: "0600000000",
  message_client: "Arrivée <tardive>",
  date_entree: "2027-02-10",
  date_sortie: "2027-02-14",
  hold_expires_at: "2027-02-09T12:00:00Z",
  nb_adultes: 2,
  nb_enfants_2_17: 1,
  gite: { id: "gite-1", nom: "Gîte & Jardin" },
  options: { chiens: { enabled: true, nb: 1 } },
  pricing_snapshot: {
    nb_nuits: 4,
    total_global: 360,
    options_detail: {
      draps: 0,
      linge: 0,
      menage: 0,
      depart_tardif: 0,
      chiens: 60,
    },
    options_unit_prices: {
      draps: 12,
      linge: 6,
      menage: 60,
      depart_tardif: 25,
      chiens: 15,
    },
  },
};
const payment = {
  purpose: "deposit",
  total_cents: 36000,
  paid_amount_cents: 9000,
  refunded_amount_cents: 0,
  status: "paid",
};

test("les demandes et approbations manuelles gardent leur statut et des liens directs", () => {
  const created = buildBookingRequestCreatedMessage({
    ...payload,
    approved_reservation_id: null,
  });
  assert.match(created, /en attente d’approbation manuelle/);
  assert.match(created, /\/demandes\/request-1/);
  assert.match(created, /Chiens : 15.*× 4 nuits = 60/);
  const approved = buildBookingRequestApprovedTelegramMessage(payload);
  assert.match(approved, /approuvée manuellement/);
  assert.match(approved, /Règlement<\/b>: sur place/);
  assert.match(
    approved,
    /year=2027&amp;month=2&amp;tab=gite-1&amp;focus=reservation-1/,
  );
  for (const message of [created, approved]) {
    assert.match(message, /Camille &lt;Test&gt;/);
    assert.match(message, /Gîte &amp; Jardin/);
    assert.doesNotMatch(message, /<Test>|<tardive>/);
  }
});
test("arrhes et totalité annoncent une confirmation automatique avec les bons montants", () => {
  const deposit = buildBookingPaymentTelegramMessage(payload, payment);
  assert.match(deposit, /confirmée après paiement en ligne/);
  assert.match(deposit, /Arrhes reçues<\/b>: 90,00/);
  assert.match(deposit, /Solde à régler sur place<\/b>: 270,00/);
  assert.match(deposit, /Chiens : 15.*× 4 nuits = 60/);
  assert.match(deposit, /focus=reservation-1/);
  assert.doesNotMatch(deposit, /en attente|Bonjour Camille|votre séjour/i);
  const full = buildBookingPaymentTelegramMessage(payload, {
    ...payment,
    purpose: "full",
    paid_amount_cents: 36000,
  });
  assert.match(full, /Paiement reçu<\/b>: 360,00/);
  assert.match(full, /réglé en totalité/);
  assert.match(full, /Solde à régler sur place<\/b>: 0,00/);
  assert.throws(
    () =>
      buildBookingPaymentTelegramMessage(payload, {
        ...payment,
        status: "pending",
      }),
    /pas encore/,
  );
});
test("un règlement à vérifier ou remboursé n’annonce pas une confirmation de séjour", () => {
  const review = buildBookingPaymentTelegramMessage(
    { ...payload, approved_reservation_id: null },
    {
      ...payment,
      status: "requires_review",
      review_reason: "Montant <différent>",
    },
  );
  assert.match(review, /Paiement à vérifier/);
  assert.match(review, /Montant &lt;différent&gt;/);
  assert.match(review, /\/demandes\/request-1/);
  assert.doesNotMatch(review, /Réservation confirmée|Solde à régler/);
  const refunded = buildBookingPaymentTelegramMessage(payload, {
    ...payment,
    status: "refunded",
    refunded_amount_cents: 9000,
  });
  assert.match(refunded, /Montant remboursé<\/b>: 90,00/);
  assert.match(refunded, /n’annule pas automatiquement/);
  assert.doesNotMatch(refunded, /Réservation confirmée|Solde à régler/);
});
test("le paiement par lien tient compte des règlements précédents et ouvre la réservation existante", () => {
  const receipt = buildBookingPaymentTelegramMessage(
    { ...payload, id: "existing-reservation" },
    { ...payment, remaining_cents: 18000 },
    true,
  );
  assert.match(receipt, /Paiement reçu sur une réservation/);
  assert.match(receipt, /Solde à régler sur place<\/b>: 180,00/);
  assert.match(receipt, /focus=existing-reservation/);
  assert.doesNotMatch(receipt, /confirmée après|Aucune approbation/);
});

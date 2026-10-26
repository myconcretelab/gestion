import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MobileReservationInfoDrawer from "../src/pages/shared/MobileReservationInfoDrawer";
import { ReservationPaymentDetails } from "../src/pages/shared/ReservationPaymentSummary";
import { setCurrentAuthUser } from "../src/utils/auth";

const reservation = {
  id: "reservation-test", date_entree: "2026-09-08", date_sortie: "2026-09-10", nb_nuits: 2,
  prix_total: 200, source_paiement: "Virement",
  options: { menage: { enabled: true }, draps: { enabled: false } },
  commentaire: "Arrivée à 18h", telephone: "0612345678",
  energy_cost_eur: 8, energy_live_cost_eur: 12,
};
const render = (overrides = {}) => renderToStaticMarkup(createElement(MobileReservationInfoDrawer, {
  open: true, title: "Camille", reservation, onClose() {}, onToggleSource() {}, ...overrides,
}));

test("le drawer commun affiche les options et les informations de la réservation", () => {
  const html = render();
  assert.match(html, /Options : Ménage/);
  assert.doesNotMatch(html, /title="Draps"/);
  assert.match(html, /2 nuits/);
  assert.match(html, /Arrivée à 18h/);
  assert.match(html, /href="tel:/);
  assert.match(html, /href="sms:/);
  assert.match(html, /12,00/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Non renseigné/);
  assert.doesNotMatch(html, /Détail du règlement/);
});

test("le total de la tuile reste celui du séjour complet dans le calendrier", () => {
  const html = render({ total: 100 });
  assert.match(html, /200/);
  assert.doesNotMatch(html, />100/);
  const detail = renderToStaticMarkup(createElement(ReservationPaymentDetails, {
    reservation, monthlyTotal: 100, detailsId: "payment-detail", onChangeSource() {},
  }));
  assert.match(detail, /Part du mois affiché/);
  assert.match(detail, /100,00/);
});

test("les données complémentaires peuvent arriver après l'ouverture du calendrier", () => {
  const html = render({ reservation: { ...reservation, options: undefined, telephone: undefined, energy_cost_eur: undefined, energy_live_cost_eur: undefined } });
  assert.doesNotMatch(html, /Options :|Conso|href="tel:/);
  assert.match(html, /2 nuits/);
});

test("le chargement et une erreur de lecture restent distincts d'un paiement non renseigné", () => {
  assert.match(render({ paymentLoading: true }), /Chargement…/);
  assert.match(render({ paymentError: "Lecture impossible" }), /Indisponible/);
});

test("un utilisateur sans accès aux montants ne voit pas la proportion payée", () => {
  try {
    setCurrentAuthUser({ permissions: { canViewAmounts: false, isOwner: false }, pageAccess: [] } as any);
    const html = render({ reservation: { ...reservation, payment_tracking: {}, linked_contract: {
      id: "c", arrhes_montant: 40, total_montant: 200,
      statut_paiement_arrhes: "recu", statut_paiement_solde: "non_regle",
    } } });
    assert.match(html, /Montant masqué/);
    assert.doesNotMatch(html, /reservation-payment-tile__track|width:20%/);
  } finally { setCurrentAuthUser(null); }
});


test("les arrhes Stripe restent compactes et leur détail affiche le montant et la carte", () => {
  const paidReservation = { ...reservation, online_payment: {
    amount_paid: 238.5, deposit: 238.5, total: 830, remaining: 591.5, paid_at: "2026-10-24T10:00:00Z",
    purpose: "deposit", status: "paid", refunded_amount: 0, request_id: "paid-request",
  } };
  const html = render({ reservation: paidReservation });
  assert.match(html, /Arrhes reçues/);
  assert.doesNotMatch(html, /591,50/);
  const detail = renderToStaticMarkup(createElement(ReservationPaymentDetails, {
    reservation: paidReservation, detailsId: "payment-detail", onChangeSource() {},
  }));
  assert.match(detail, /238,50/);
  assert.match(detail, /591,50/);
  assert.match(detail, /Carte · Stripe · 24\/10\/2026/);
  assert.match(detail, /href="\/demandes\/paid-request"/);
});

test("un solde réglé sur place n’est plus réclamé après les arrhes en ligne", () => {
  const paidReservation = { ...reservation, online_payment: {
    amount_paid: 90, deposit: 90, total: 360, remaining: 270, paid_at: "2026-10-24T10:00:00Z",
    purpose: "deposit", status: "paid", refunded_amount: 0, request_id: "paid-request",
  }, linked_contract: { id: "contract", statut_paiement_solde: "regle" } };
  const html = renderToStaticMarkup(createElement(ReservationPaymentDetails, {
    reservation: paidReservation as any, detailsId: "payment-detail", onChangeSource() {},
  }));
  assert.match(html, /Séjour payé/);
  assert.match(html, /Solde réglé/);
  assert.match(html, /Moyen non renseigné/);
  assert.match(html, /0,00/);
  assert.doesNotMatch(html, /Reste à payer/);
});

test("les arrhes par chèque montrent leur montant et leur date sans assimiler la source au paiement", () => {
  const html = renderToStaticMarkup(createElement(ReservationPaymentDetails, {
    reservation: { ...reservation, linked_contract: {
      id: "contract", numero_contrat: "TEST", statut_paiement_arrhes: "recu", statut_paiement_solde: "non_regle",
      arrhes_montant: 40, solde_montant: 160, total_montant: 200,
      mode_paiement_arrhes: "Chèque", date_paiement_arrhes: "2026-10-24T10:00:00Z",
    } }, detailsId: "payment-detail", onChangeSource() {},
  }));
  assert.match(html, /Chèque · 24\/10\/2026/);
  assert.match(html, /40,00/);
  assert.match(html, /160,00/);
  assert.match(html, /Information historique : Virement/);
  assert.match(html, /Modifier la source ou le moyen de paiement/);
});

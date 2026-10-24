import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { StaticRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import MobileReservationInfoDrawer from "../src/pages/shared/MobileReservationInfoDrawer";

const reservation = {
  date_entree: "2026-09-08", date_sortie: "2026-09-10", nb_nuits: 2,
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
  assert.match(html, /Modifier la source ou le moyen de paiement/);
});

test("le calendrier peut conserver son total mensuel sans perdre les options", () => {
  const html = render({ total: 100 });
  assert.match(html, /100/);
  assert.match(html, /Options : Ménage/);
});

test("les données complémentaires peuvent arriver après l'ouverture du calendrier", () => {
  const html = render({ reservation: { ...reservation, options: undefined, telephone: undefined, energy_cost_eur: undefined, energy_live_cost_eur: undefined } });
  assert.doesNotMatch(html, /Options :|Conso|href="tel:/);
  assert.match(html, /2 nuits/);
});


test("les arrhes Stripe affichent le paiement reçu et le solde exact du séjour", () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, {}, createElement(MobileReservationInfoDrawer, {
    open: true, title: "Client fictif", reservation: { ...reservation, id: "paid-stay", online_payment: {
      amount_paid: 238.5, deposit: 238.5, total: 830, remaining: 591.5, paid_at: "2026-10-24T10:00:00Z",
      purpose: "deposit", status: "paid", refunded_amount: 0, request_id: "paid-request",
    } }, onClose() {}, onToggleSource() {},
  })));
  assert.match(html, /Arrhes reçues par Stripe/);
  assert.match(html, /238,50/);
  assert.match(html, /591,50/);
  assert.match(html, /24\/10\/2026/);
  assert.match(html, /href="\/demandes\/paid-request"/);
});

test("un solde réglé sur place n’est plus réclamé après les arrhes en ligne", () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, {}, createElement(MobileReservationInfoDrawer, {
    open: true, title: "Client fictif", reservation: { ...reservation, id: "paid-stay", online_payment: {
      amount_paid: 90, deposit: 90, total: 360, remaining: 270, paid_at: "2026-10-24T10:00:00Z",
      purpose: "deposit", status: "paid", refunded_amount: 0, request_id: "paid-request",
    }, linked_contract: { statut_paiement_solde: "regle" } }, onClose() {}, onToggleSource() {},
  })));
  assert.match(html, /Arrhes reçues par Stripe/);
  assert.match(html, /90,00/);
  assert.match(html, /0,00/);
  assert.doesNotMatch(html, /270,00/);
});

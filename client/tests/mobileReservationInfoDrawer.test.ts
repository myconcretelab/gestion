import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
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

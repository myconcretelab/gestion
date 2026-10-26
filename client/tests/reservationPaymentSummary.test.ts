import assert from "node:assert/strict";
import test from "node:test";
import { getReservationPaymentSummary as summary } from "../src/utils/reservationPaymentSummary";

const contract = {
  id: "c", numero_contrat: "TEST", total_montant: 1400, arrhes_montant: 280, solde_montant: 1120,
  statut_paiement_arrhes: "recu" as const, statut_paiement_solde: "non_regle" as const,
  mode_paiement_arrhes: "Chèque" as const,
};
const online = {
  amount_paid: 280, total: 1400, remaining: 1120, deposit: 280, offline_received: 0,
  status: "paid", refunded_amount: 0, purpose: "deposit", paid_at: "2026-10-24", request_id: null,
};

test("un moyen prévu ne prouve pas un paiement et les frais et remises restent dans le total", () => {
  const result = summary({ prix_total: 1400, remise_montant: 100, frais_optionnels_montant: 70 });
  assert.equal(result.total, 1370);
  assert.equal(result.state, "unknown");
  assert.equal(result.remaining, null);
});

test("des arrhes attendues ne sont pas comptées comme reçues", () => {
  const result = summary({ prix_total: 1400, linked_contract: { ...contract, statut_paiement_arrhes: "non_recu" } });
  assert.equal(result.received, 0);
  assert.equal(result.remaining, 1400);
  assert.equal(result.label, "À régler");
});

test("les arrhes par chèque se distinguent du solde et remplissent 20 % de la jauge", () => {
  const result = summary({ prix_total: 1400, linked_contract: contract });
  assert.equal(result.received, 280);
  assert.equal(result.remaining, 1120);
  assert.equal(result.progress, 20);
  assert.equal(result.label, "Arrhes reçues");
});

test("le total contractuel reste disponible quand le solde hydraté vaut zéro", () => {
  const result = summary({ prix_total: 1000, linked_contract: { ...contract, solde_montant: 0, statut_paiement_solde: "regle" } });
  assert.equal(result.total, 1400);
  assert.equal(result.balanceReceived, 1120);
  assert.equal(result.remaining, 0);
  assert.equal(result.progress, 100);
  assert.equal(result.label, "Payé");
});

test("les arrhes Stripe reprises au contrat ne sont pas comptées deux fois", () => {
  const result = summary({ prix_total: 1400, online_payment: online, linked_contract: { ...contract, mode_paiement_arrhes: "Stripe" } });
  assert.equal(result.received, 280);
  assert.equal(result.remaining, 1120);
});

test("des arrhes sans moyen renseigné ne prouvent pas un versement distinct de Stripe", () => {
  const result = summary({ prix_total: 1400, online_payment: online,
    linked_contract: { ...contract, mode_paiement_arrhes: null } });
  assert.equal(result.received, 280);
  assert.equal(result.remaining, 1120);
});

test("un solde réglé ne masque pas des arrhes encore attendues", () => {
  const result = summary({ prix_total: 1400, linked_contract: {
    ...contract, statut_paiement_arrhes: "non_recu", statut_paiement_solde: "regle",
  } });
  assert.equal(result.received, 1120);
  assert.equal(result.balanceReceived, 1120);
  assert.equal(result.remaining, 280);
  assert.equal(result.label, "Paiement partiel");
});

test("un chèque puis un paiement Stripe se cumulent sans doubler la reprise hors ligne", () => {
  const result = summary({ prix_total: 1400, linked_contract: contract,
    online_payment: { ...online, amount_paid: 1120, offline_received: 280, remaining: 0, purpose: "balance" } });
  assert.equal(result.received, 1400);
  assert.equal(result.otherOffline, 0);
  assert.equal(result.label, "Payé");
});

test("un paiement partiel au-delà des arrhes est identifié comme tel", () => {
  const result = summary({ prix_total: 1400, online_payment: { ...online, amount_paid: 550, purpose: "balance" } });
  assert.equal(result.label, "Paiement partiel");
  assert.equal(result.remaining, 850);
});

test("un remboursement prime sur un contrat marqué réglé", () => {
  const result = summary({ prix_total: 1400, linked_contract: { ...contract, mode_paiement_arrhes: "Stripe", statut_paiement_solde: "regle" },
    online_payment: { ...online, amount_paid: 1300, refunded_amount: 100 } });
  assert.equal(result.state, "review");
  assert.equal(result.received, 1300);
  assert.equal(result.remaining, 100);
  assert.equal(result.balanceReceived, 0);
});

test("un règlement à vérifier ne devient pas payé via le statut du contrat", () => {
  const result = summary({ prix_total: 1400, linked_contract: { ...contract, mode_paiement_arrhes: "Stripe", statut_paiement_solde: "regle" },
    online_payment: { ...online, status: "requires_review" } });
  assert.equal(result.label, "À vérifier");
  assert.equal(result.remaining, 1120);
});

test("un total nul ne prouve pas que le séjour est payé", () => {
  assert.equal(summary({ prix_total: 0, linked_contract: { ...contract, total_montant: 0 } }).state, "unknown");
});

test("les centimes sont conservés et le reste à payer ne devient pas négatif", () => {
  const result = summary({ prix_total: 200, online_payment: { ...online, total: 830, amount_paid: 238.5, deposit: 238.5 } });
  assert.equal(result.remaining, 591.5);
  assert.equal(summary({ prix_total: 200, online_payment: { ...online, amount_paid: 1500 } }).remaining, 0);
});

test("le total inclut la taxe collectée par l'hôte sans doubler une taxe incluse", () => {
  const settings = { version: 1 as const, classified: true, stars: 3, included: false, fixed_rate: 1.5,
    percentage: 4, cap: 4, additional_percentage: 0, accommodation_vat_rate: 0, authority: "", effective_from: "2026-01-01" };
  const stay = { settings, collector: "host" as const, platform: "", infants: 0, exempt_adults: 0, exemption_reason: "" };
  const reservation = { prix_total: 200, frais_optionnels_montant: 50, date_entree: "2026-10-26", nb_nuits: 4, nb_adultes: 2,
    options: { tourist_tax: stay } };
  assert.equal(summary(reservation).total, 262);
  assert.equal(summary({ ...reservation, options: { tourist_tax: { ...stay, settings: { ...settings, included: true } } } }).total, 250);
  assert.equal(summary({ ...reservation, options: { tourist_tax: { ...stay, collector: "platform" } } }).total, 250);
});

test("le registre fait autorité sur des statuts de contrat anciens ou un snapshot Stripe", () => {
  const result = summary({ prix_total: 1000, linked_contract: { ...contract, statut_paiement_solde: "regle" }, online_payment: online,
    payment_tracking: { managed: true, total: 1000, received: 300, remaining: 700, deposit: 200, overpaid: 0, requires_review: false, entries: [] } });
  assert.equal(result.received, 300); assert.equal(result.remaining, 700); assert.equal(result.label, "Paiement partiel");
});
test("l'ancien moyen sans montant garde un état non renseigné tant que l'historique n'a pas été rapproché", () => {
  const result = summary({ prix_total: 1000, source_paiement: "Chèque",
    payment_tracking: { managed: false, total: 1000, received: 0, remaining: 1000, deposit: 200, overpaid: 0, requires_review: false, entries: [] } });
  assert.equal(result.label, "Non renseigné"); assert.equal(result.remaining, null);
});

test("les plateformes distinguent les options à encaisser du versement attendu", () => {
  const tracking = { managed: false, total: 1040, deposit: 200, received: 1000, remaining: 40, overpaid: 0, requires_review: false, entries: [],
    platform: { source: "Airbnb", automatic: true, accommodation: 1000, expected: 0, extras_remaining: 40 } };
  assert.equal(summary({ prix_total: 1000, payment_tracking: tracking }).label, "Options à régler");
  assert.equal(summary({ prix_total: 1000, source_paiement: "Chèque", payment_tracking: { ...tracking, received: 0, remaining: 1040,
    platform: { ...tracking.platform, automatic: false, expected: 1000 } } }).label, "Versement attendu");
});

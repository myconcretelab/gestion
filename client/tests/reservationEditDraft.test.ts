import assert from "node:assert/strict";
import test from "node:test";
import { createTouristTaxStay } from "@contrats/shared";
import type { Gite, Reservation } from "../src/utils/types";
import { buildReservationEditPayload, createReservationEditDraft, recalculateReservationEditPrice, reservationEditNights } from "../src/pages/shared/reservationEditDraft";

const gite = { id: "g1", options_menage_forfait: 40, options_draps_par_lit: 15, options_chiens_forfait: 5 } as Gite;
const original = {
  id: "r1", gite_id: "g1", hote_nom: "Camille", telephone: "0612345678", email: "camille@example.com",
  airbnb_url: "https://www.airbnb.fr/reservations/example", date_entree: "2026-10-27", date_sortie: "2026-10-30",
  nb_nuits: 3, nb_adultes: 2, nb_enfants_2_17: 1, prix_par_nuit: 33.33, prix_total: 100,
  frais_optionnels_montant: 65, frais_optionnels_libelle: "Ménage · Options complémentaires: Panier", frais_optionnels_declares: false,
  commentaire: "[ICAL_TO_VERIFY]\nArrivée à 18h", source_paiement: "Virement", booking_source: "Direct",
  options: { menage: { enabled: true, inclus: false }, regle_animaux_acceptes: true },
} as Reservation;

test("éditer les coordonnées conserve le prix global exact, les frais, les conditions et le marqueur iCal", () => {
  const draft = createReservationEditDraft(original, gite);
  draft.hote_nom = "Camille Martin";
  draft.email = "autre@example.com";
  const payload = buildReservationEditPayload(draft, original, gite);
  assert.equal(payload.prix_total, 100);
  assert.equal(payload.price_driver, "total");
  assert.equal(payload.frais_optionnels_montant, 65);
  assert.equal(payload.frais_optionnels_libelle, original.frais_optionnels_libelle);
  assert.equal(payload.source_paiement, "Virement");
  assert.equal(payload.airbnb_url, original.airbnb_url);
  assert.equal(payload.options.regle_animaux_acceptes, true);
  assert.equal(payload.commentaire, original.commentaire);
  assert.equal(payload.email, "autre@example.com");
});

test("modifier le prix par nuit ou le prix global respecte le dernier montant saisi et les nouvelles dates", () => {
  const draft = createReservationEditDraft(original, gite);
  const nightly = recalculateReservationEditPrice({ ...draft, prix_par_nuit: 80, price_driver: "nightly", date_sortie: "2026-10-31" });
  assert.equal(nightly.prix_total, 320);
  assert.equal(reservationEditNights(nightly), 4);
  const total = recalculateReservationEditPrice({ ...nightly, prix_total: 350.01, price_driver: "total" });
  assert.equal(total.prix_total, 350.01);
  assert.equal(total.prix_par_nuit, 87.5);
  assert.equal(buildReservationEditPayload(total, original, gite).prix_total, 350.01);
});

test("modifier les options ne compte pas deux fois les frais complémentaires et conserve le ménage inclus", () => {
  const draft = createReservationEditDraft(original, gite);
  assert.equal(draft.additionalFeesAmount, 25);
  assert.equal(draft.additionalFeesLabel, "Panier");
  draft.options = { ...draft.options, menage: { enabled: true, inclus: true }, draps: { enabled: true, nb_lits: 2, declared: true } };
  draft.feesChanged = true;
  const payload = buildReservationEditPayload(draft, original, gite);
  assert.equal(payload.frais_optionnels_montant, 55);
  assert.equal(payload.options.menage?.inclus, true);
  assert.match(payload.frais_optionnels_libelle!, /Panier/);
  assert.equal(payload.frais_optionnels_declares, false);
});

test("changer de gîte détache le placeholder sans perdre les autres données", () => {
  const draft = createReservationEditDraft({ ...original, gite_id: null, placeholder_id: "placeholder" }, null);
  draft.gite_id = "g2";
  const payload = buildReservationEditPayload(draft, original, gite);
  assert.equal(payload.gite_id, "g2");
  assert.equal(payload.placeholder_id, null);
  assert.equal(payload.nb_enfants_2_17, 1);
  assert.equal(payload.telephone, original.telephone);
});

test("les dates inversées, noms vides et montants négatifs ne peuvent pas être enregistrés", () => {
  const draft = createReservationEditDraft(original, gite);
  assert.throws(() => buildReservationEditPayload({ ...draft, date_sortie: draft.date_entree }, original, gite), /date de sortie/);
  assert.throws(() => buildReservationEditPayload({ ...draft, date_entree: "2026-02-30" }, original, gite), /date de sortie/);
  assert.throws(() => buildReservationEditPayload({ ...draft, hote_nom: " " }, original, gite), /nom/);
  assert.throws(() => buildReservationEditPayload({ ...draft, prix_total: -1 }, original, gite), /montants/);
  assert.throws(() => buildReservationEditPayload({ ...draft, nb_adultes: 1.5 }, original, gite), /voyageurs/);
});


test("une édition conserve le barème de taxe enregistré au séjour", () => {
  const tourist_tax = createTouristTaxStay({ version: 1, classified: true, stars: 3, included: false,
    fixed_rate: 1.5, percentage: 4, cap: 4, additional_percentage: 0, accommodation_vat_rate: 0,
    authority: "Collectivité fictive", effective_from: "2026-01-01" });
  const saved = { ...original, options: { ...original.options, tourist_tax: { ...tourist_tax, collector: "host" as const, infants: 1 } } };
  const draft = createReservationEditDraft(saved, gite);
  draft.telephone = "0699999999";
  const payload = buildReservationEditPayload(draft, saved, gite);
  assert.deepEqual(payload.options.tourist_tax, saved.options.tourist_tax);
  assert.equal(payload.frais_optionnels_montant, original.frais_optionnels_montant);
});

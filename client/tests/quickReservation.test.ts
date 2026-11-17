import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewQuickReservationDraft,
  buildQuickReservationDraftFromReservation,
  buildQuickReservationSavePayload,
  computeQuickReservationDerivedState,
  formatQuickReservationPhone,
  getQuickReservationSmsPhoneDigits,
  updateQuickReservationDraftField,
  type QuickReservationDraft,
} from "../src/pages/shared/quickReservation";
import type { Gite, Reservation } from "../src/utils/types";

const gite = {
  id: "g1",
  nom: "La Maison",
  adresse_ligne1: "1 rue des Lilas",
  adresse_ligne2: "",
  capacite_max: 6,
  options_draps_par_lit: 15,
  options_linge_toilette_par_personne: 5,
  options_menage_forfait: 60,
  options_depart_tardif_forfait: 25,
  options_chiens_forfait: 4,
  heure_arrivee_defaut: "17:00",
  heure_depart_defaut: "12:00",
} as Gite;

const draft: QuickReservationDraft = {
  hote_nom: "Client",
  telephone: "06 00 00 00 00",
  email: "",
  date_entree: "2026-07-10",
  date_sortie: "2026-07-12",
  nb_adultes: 2,
  prix_par_nuit: "100",
  source_paiement: "A définir",
  commentaire: "",
  option_menage: true,
  option_depart_tardif: false,
  option_draps: 2,
  option_serviettes: 2,
  option_chiens: 0,
};

test("la création mobile permet un email facultatif et supprime les espaces avant envoi", () => {
  const initial = buildNewQuickReservationDraft({
    startIso: draft.date_entree,
    exitIso: draft.date_sortie,
    defaultAdults: 2,
    nightlySuggestion: 100,
    gite,
  });
  assert.equal(initial.email, "");
  const withoutEmail = buildQuickReservationSavePayload({
    draft: { ...initial, hote_nom: "Client" }, gite, baseOptions: null,
  });
  assert.ok(withoutEmail.ok);
  assert.equal(withoutEmail.payload.email, null);

  const withEmail = updateQuickReservationDraftField({
    current: { ...initial, hote_nom: "Client" },
    field: "email", value: "  client+sejour@example.com  ", gite,
  });
  const saved = buildQuickReservationSavePayload({ draft: withEmail, gite, baseOptions: null });
  assert.ok(saved.ok);
  assert.equal(saved.payload.email, "client+sejour@example.com");
});

test("l'édition mobile préremplit l'email et permet de le modifier ou de l'effacer", () => {
  const reservation = { ...draft, id: "r1", email: "client@example.com" } as Reservation;
  const initial = buildQuickReservationDraftFromReservation({ reservation, gite });
  assert.equal(initial.email, "client@example.com");
  const unchanged = buildQuickReservationSavePayload({ draft: initial, gite, baseOptions: null });
  assert.ok(unchanged.ok);
  assert.equal(unchanged.payload.email, reservation.email);

  for (const [value, expected] of [["nouveau@example.com", "nouveau@example.com"], ["", null], ["   ", null]] as const) {
    const edited = updateQuickReservationDraftField({ current: initial, field: "email", value, gite });
    const saved = buildQuickReservationSavePayload({ draft: edited, gite, baseOptions: null });
    assert.ok(saved.ok);
    assert.equal(saved.payload.email, expected);
  }
  assert.equal(buildQuickReservationDraftFromReservation({ reservation: { ...reservation, email: null }, gite }).email, "");
});

test("la sauvegarde mobile signale une adresse email invalide", () => {
  for (const email of ["invalide", "client@", "client@example", "client @example.com"]) {
    const result = buildQuickReservationSavePayload({ draft: { ...draft, email }, gite, baseOptions: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorField, "email");
  }
});

test("computeQuickReservationDerivedState formule les options du SMS en français naturel", () => {
  const result = computeQuickReservationDerivedState({
    draft,
    editingReservation: null,
    gite,
    smsSnippets: [],
    smsSelection: [],
  });

  assert.match(
    result.smsText,
    /Options choisies : ménage \(60€\), draps pour 2 lits \(30€\), serviettes pour 2 personnes \(10€\)\./
  );
  assert.match(result.smsText, /Merci beaucoup,/);
});

test("conserve un numéro français international dans l'éditeur et le lien SMS", () => {
  const formattedPhone = formatQuickReservationPhone("+33 6 12 34 56 78");
  assert.equal(formattedPhone, "+33 6 12 34 56 78");
  assert.equal(getQuickReservationSmsPhoneDigits(formattedPhone), "+33612345678");

  const result = computeQuickReservationDerivedState({
    draft: { ...draft, telephone: formattedPhone },
    editingReservation: null,
    gite,
    smsSnippets: [],
    smsSelection: [],
  });

  assert.match(result.smsHref ?? "", /^sms:\+33612345678\?body=/);
});

test("ne tronque pas les numéros saisis au-delà de dix chiffres", () => {
  assert.equal(formatQuickReservationPhone("0033 6 12 34 56 78"), "00 33 6 12 34 56 78");
  assert.equal(getQuickReservationSmsPhoneDigits("0033 6 12 34 56 78"), "0033612345678");
});

test("le total et le SMS mobiles suivent la taxe collectée, comprise ou en supplément", () => {
  const settings = { version: 1 as const, classified: true, stars: 3, included: false, fixed_rate: 1.5, percentage: 4, cap: 4, additional_percentage: 0, accommodation_vat_rate: 0, authority: "", effective_from: "2026-01-01" };
  const stay = { settings, collector: "host" as const, platform: "", infants: 0, exempt_adults: 0, exemption_reason: "" };
  const params = { draft, editingReservation: null, gite, smsSnippets: [], smsSelection: [] };
  const extra = computeQuickReservationDerivedState({ ...params, touristTax: stay });
  assert.equal(extra.computedTotal, 306);
  const mixed = computeQuickReservationDerivedState({ ...params, touristTax: stay, quotedAccommodation: 250 });
  assert.equal(mixed.computedTotal, 356);
  assert.match(extra.smsText, /total du séjour est de 306€/);
  const included = computeQuickReservationDerivedState({ ...params, touristTax: { ...stay, settings: { ...settings, included: true } } });
  assert.equal(included.computedTotal, 300);
  const platform = computeQuickReservationDerivedState({ ...params, touristTax: { ...stay, collector: "platform", platform: "Plateforme fictive" } });
  assert.equal(platform.computedTotal, 300);
});

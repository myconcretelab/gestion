import assert from "node:assert/strict";
import test from "node:test";
import { getCleaningBillingMode, cleaningBillingPatch } from "@contrats/shared";
import { computeTotals } from "../src/utils/contractCalc";
import { computeReservationOptionsPreview } from "../src/utils/reservationOptions";
import { getReservationOptionBadges } from "../src/utils/reservationOptionBadges";
import { invoiceReservationPrefill } from "../src/pages/shared/invoiceReservationPrefill";
import {
  buildQuickReservationDraftFromReservation,
  buildQuickReservationSavePayload,
  computeQuickReservationDerivedState,
} from "../src/pages/shared/quickReservation";
import type { Gite, Reservation } from "../src/utils/types";

const gite = {
  id: "g1",
  nom: "Brocéliande",
  capacite_max: 6,
  nb_adultes_max: 6,
  options_menage_forfait: 60,
  options_draps_par_lit: 15,
} as Gite;
const reservation = {
  id: "r1",
  hote_nom: "Camille",
  date_entree: "2026-10-20",
  date_sortie: "2026-10-23",
  nb_nuits: 3,
  nb_adultes: 2,
  prix_par_nuit: 200,
  prix_total: 600,
  frais_optionnels_montant: 0,
  options: { menage: { enabled: true, inclus: true, declared: true } },
} as Reservation;

test("un ménage inclus reste actif après édition mobile, sans changer le prix ni le SMS en cadeau", () => {
  const draft = buildQuickReservationDraftFromReservation({
    reservation,
    gite,
  });
  assert.equal(draft.menage_facturation, "included");
  const result = computeQuickReservationDerivedState({
    draft,
    gite,
    editingReservation: reservation,
    smsSnippets: [],
    smsSelection: [],
  });
  assert.equal(result.computedTotal, 600);
  assert.equal(result.optionsPreview.byKey.menage, 0);
  assert.match(result.optionsPreview.label, /Ménage inclus/);
  assert.match(result.smsText, /ménage \(inclus dans le prix du séjour\)/);
  assert.doesNotMatch(result.smsText, /offert/);
  const saved = buildQuickReservationSavePayload({
    draft,
    gite,
    baseOptions: reservation.options,
  });
  assert.ok(saved.ok);
  assert.equal(saved.payload.options.menage.enabled, true);
  assert.equal(saved.payload.options.menage.inclus, true);
  assert.equal(saved.payload.options.menage.offert, false);
  assert.equal(saved.payload.options.menage.declared, true);
  assert.equal(saved.payload.frais_optionnels_montant, 0);
  const badges = getReservationOptionBadges(saved.payload.options);
  assert.equal(badges[0].letter, "M");
  assert.equal(badges[0].detail, "Inclus dans le prix du séjour");
});

test("changer la facturation conserve la déclaration et aligne aperçu, contrat et total mobile", () => {
  for (const [mode, supplement] of [
    ["extra", 60],
    ["included", 0],
    ["gift", 0],
  ] as const) {
    const options = {
      menage: { enabled: true, declared: true, ...cleaningBillingPatch(mode) },
    };
    const totals = computeTotals({
      dateDebut: "2026-10-20",
      dateFin: "2026-10-23",
      prixParNuit: 200,
      remiseMontant: 0,
      nbAdultes: 2,
      nbEnfants: 0,
      arrhesMontant: 100,
      options,
      gite,
    });
    assert.equal(totals.totalGlobal, 600 + supplement);
    assert.equal(totals.solde, 500 + supplement);
    assert.equal(
      computeReservationOptionsPreview(options, { nights: 3, gite }).total,
      supplement,
    );
    const draft = buildQuickReservationDraftFromReservation({
      reservation,
      gite,
    });
    const saved = buildQuickReservationSavePayload({
      draft: { ...draft, menage_facturation: mode },
      gite,
      baseOptions: reservation.options,
    });
    assert.ok(saved.ok);
    assert.equal(saved.payload.frais_optionnels_montant, supplement);
    assert.equal(getCleaningBillingMode(saved.payload.options.menage), mode);
    assert.equal(saved.payload.options.menage.declared, true);
  }
  assert.equal(getCleaningBillingMode({}), "extra");
  assert.equal(getCleaningBillingMode({ offert: true }), "gift");
});

test("la facture conserve le ménage inclus même si le tarif des autres options a changé", () => {
  const prefill = invoiceReservationPrefill(
    {
      ...reservation,
      frais_optionnels_montant: 20,
      options: { ...reservation.options, draps: { enabled: true, nb_lits: 2 } },
    },
    gite,
  );
  assert.equal(prefill.options.menage.enabled, true);
  assert.equal(prefill.options.menage.inclus, true);
  assert.equal(prefill.options.draps.enabled, false);
  assert.equal(prefill.fees[0].montant, 20);
});

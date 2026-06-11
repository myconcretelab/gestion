import assert from "node:assert/strict";
import test from "node:test";
import { computeQuickReservationDerivedState, type QuickReservationDraft } from "../src/pages/shared/quickReservation";
import type { Gite } from "../src/utils/types";

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
};

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

import assert from "node:assert/strict";
import test from "node:test";
import { computeTotals } from "../src/utils/contractCalc.ts";
import type { ContratOptions, Gite } from "../src/utils/types.ts";

const gite: Gite = {
  id: "g1",
  nom: "Gite test",
  prefixe_contrat: "GT",
  adresse_ligne1: "1 rue test",
  capacite_max: 6,
  proprietaires_noms: "Proprio",
  proprietaires_adresse: "Adresse proprio",
  telephones: [],
  taxe_sejour_par_personne_par_nuit: 1.5,
  iban: "FR0000000000000000000000000",
  titulaire: "Titulaire",
  regle_animaux_acceptes: true,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
  options_draps_par_lit: 12,
  options_linge_toilette_par_personne: 8,
  options_menage_forfait: 20,
  options_depart_tardif_forfait: 15,
  options_chiens_forfait: 5,
  heure_arrivee_defaut: "17:00",
  heure_depart_defaut: "12:00",
  caution_montant_defaut: 0,
  cheque_menage_montant_defaut: 0,
  arrhes_taux_defaut: 0.2,
};

const options: ContratOptions = {
  draps: { enabled: true, nb_lits: 2 },
  linge_toilette: { enabled: true, nb_personnes: 1 },
  menage: { enabled: true },
  depart_tardif: { enabled: false },
  chiens: { enabled: true, nb: 2 },
};

test("computeTotals client aligne le solde avec le back (options incluses)", () => {
  const totals = computeTotals({
    dateDebut: "2026-03-01",
    dateFin: "2026-03-04",
    prixParNuit: 100,
    remiseMontant: 10,
    nbAdultes: 2,
    nbEnfants: 1,
    arrhesMontant: 100,
    options,
    gite,
  });

  assert.equal(totals.nbNuits, 3);
  assert.equal(totals.totalSansOptions, 290);
  assert.equal(totals.optionsTotal, 82);
  assert.equal(totals.totalGlobal, 372);
  assert.equal(totals.solde, 272);
  assert.equal(totals.taxeSejour, 13.5);
});

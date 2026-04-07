import assert from "node:assert/strict";
import test from "node:test";
import { computeTotals } from "../src/services/contractCalculator.ts";

test("computeTotals calcule un solde incluant les options", () => {
  const totals = computeTotals({
    dateDebut: new Date("2026-03-01T00:00:00.000Z"),
    dateFin: new Date("2026-03-04T00:00:00.000Z"),
    prixParNuit: 100,
    remiseMontant: 10,
    nbAdultes: 2,
    nbEnfants: 1,
    arrhesMontant: 100,
    options: {
      draps: { enabled: true, nb_lits: 2 },
      linge_toilette: { enabled: true, nb_personnes: 1 },
      menage: { enabled: true },
      depart_tardif: { enabled: false },
      chiens: { enabled: true, nb: 2 },
    },
    gite: {
      taxe_sejour_par_personne_par_nuit: 1.5,
      options_draps_par_lit: 12,
      options_linge_toilette_par_personne: 8,
      options_menage_forfait: 20,
      options_depart_tardif_forfait: 15,
      options_chiens_forfait: 5,
    },
  });

  assert.equal(totals.nbNuits, 3);
  assert.equal(totals.totalSansOptions, 290);
  assert.equal(totals.optionsTotal, 82);
  assert.equal(totals.totalGlobal, 372);
  assert.equal(totals.solde, 272);
  assert.equal(totals.taxeSejourCalculee, 9);
});

test("computeTotals utilise le forfait personnalise du depart tardif", () => {
  const totals = computeTotals({
    dateDebut: new Date("2026-03-01T00:00:00.000Z"),
    dateFin: new Date("2026-03-04T00:00:00.000Z"),
    prixParNuit: 100,
    remiseMontant: 0,
    nbAdultes: 2,
    nbEnfants: 0,
    arrhesMontant: 0,
    options: {
      depart_tardif: { enabled: true, prix_forfait: 27.5 },
    },
    gite: {
      taxe_sejour_par_personne_par_nuit: 1.5,
      options_draps_par_lit: 12,
      options_linge_toilette_par_personne: 8,
      options_menage_forfait: 20,
      options_depart_tardif_forfait: 15,
      options_chiens_forfait: 5,
    },
  });

  assert.equal(totals.optionsDetail.departTardif, 27.5);
  assert.equal(totals.optionsTotal, 27.5);
  assert.equal(totals.totalGlobal, 327.5);
});

test("computeTotals utilise le tarif chien personnalise", () => {
  const totals = computeTotals({
    dateDebut: new Date("2026-03-01T00:00:00.000Z"),
    dateFin: new Date("2026-03-04T00:00:00.000Z"),
    prixParNuit: 100,
    remiseMontant: 0,
    nbAdultes: 2,
    nbEnfants: 0,
    arrhesMontant: 0,
    options: {
      chiens: { enabled: true, nb: 2, prix_unitaire: 7.5 },
    },
    gite: {
      taxe_sejour_par_personne_par_nuit: 1.5,
      options_draps_par_lit: 12,
      options_linge_toilette_par_personne: 8,
      options_menage_forfait: 20,
      options_depart_tardif_forfait: 15,
      options_chiens_forfait: 5,
    },
  });

  assert.equal(totals.optionsDetail.chiens, 45);
  assert.equal(totals.optionsTotal, 45);
  assert.equal(totals.totalGlobal, 345);
});

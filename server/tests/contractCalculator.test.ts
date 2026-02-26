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
  assert.equal(totals.taxeSejourCalculee, 13.5);
});

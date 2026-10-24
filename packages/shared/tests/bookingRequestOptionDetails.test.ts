import assert from "node:assert/strict";
import test from "node:test";
import { buildBookingRequestOptionsTemplateValues } from "../src/bookingRequestOptionDetails.js";

const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

test("les anciennes demandes détaillent un chien par nuit à partir du devis enregistré", () => {
  const request = {
    options: { chiens: { enabled: true, nb: 1, prix_unitaire: 999 } },
    pricing_snapshot: { nb_nuits: 4, options_detail: { chiens: 60 } },
  };
  assert.equal(
    plain(buildBookingRequestOptionsTemplateValues(request).optionsChiens),
    "Chiens : 15 € × 4 nuits = 60 €",
  );
});

test("plusieurs chiens, les draps, le linge et les forfaits ont leurs propres variables", () => {
  const values = buildBookingRequestOptionsTemplateValues({
    options: {
      chiens: { enabled: true, nb: 2 },
      draps: { enabled: true, nb_lits: 3 },
      linge_toilette: { enabled: true, nb_personnes: 2 },
      menage: { enabled: true },
      depart_tardif: { enabled: true },
    },
    pricing_snapshot: {
      nb_nuits: 4,
      options_detail: {
        chiens: 120,
        draps: 36,
        linge: 13,
        menage: 60,
        depart_tardif: 25,
      },
      options_unit_prices: { chiens: 15, draps: 12, linge: 6.5 },
    },
  });
  assert.equal(
    plain(values.optionsChiens),
    "Chiens : 15 € × 2 chiens × 4 nuits = 120 €",
  );
  assert.equal(plain(values.optionsDraps), "Draps : 12 € × 3 lits = 36 €");
  assert.equal(
    plain(values.optionsLingeToilette),
    "Linge de toilette : 6,5 € × 2 personnes = 13 €",
  );
  assert.equal(plain(values.optionsMenage), "Ménage : 60 € (forfait)");
  assert.equal(
    plain(values.optionsDepartTardif),
    "Départ tardif : 25 € (forfait)",
  );
  assert.equal(values.optionsSummary.split("\n").length, 6);
});

test("les options offertes et gratuites ne réintroduisent aucun supplément", () => {
  const values = buildBookingRequestOptionsTemplateValues({
    options: {
      chiens: { enabled: true, nb: 1, offert: true },
      draps: { enabled: true, nb_lits: 1 },
    },
    pricing_snapshot: {
      nb_nuits: 1,
      options_detail: { chiens: 0, draps: 0 },
      options_unit_prices: { chiens: 15, draps: 0 },
    },
  });
  assert.equal(values.optionsChiens, "Chiens : offert (1 chien, 1 nuit)");
  assert.equal(plain(values.optionsDraps), "Draps : 0 € × 1 lit = 0 €");
});

test("un ancien montant non reconstituable au centime affiche uniquement son total", () => {
  const values = buildBookingRequestOptionsTemplateValues({
    options: { chiens: { enabled: true, nb: 3 } },
    pricing_snapshot: { nb_nuits: 3, options_detail: { chiens: 10 } },
  });
  assert.equal(
    plain(values.optionsChiens),
    "Chiens (3 chiens, 3 nuits) : 10 €",
  );
  assert.ok(!values.optionsChiens.includes("="));
});

test("une ancienne demande sans montant reste lisible et les options absentes restent vides", () => {
  const values = buildBookingRequestOptionsTemplateValues({
    options: { draps: { enabled: true, nb_lits: 2 } },
    pricing_snapshot: { nb_nuits: 2 },
  });
  assert.equal(values.optionsDraps, "Draps (2 lits)");
  assert.equal(values.optionsChiens, "");
  assert.equal(
    buildBookingRequestOptionsTemplateValues({
      options: {},
      pricing_snapshot: { nb_nuits: 2 },
    }).optionsSummary,
    "",
  );
});

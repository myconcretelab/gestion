import assert from "node:assert/strict";
import { test } from "node:test";
import {
  giteFormCompletion,
  giteCompletionProgress,
  type GiteCompletionForm,
} from "../src/pages/shared/giteFormCompletion.ts";
import { formCompletionProgress } from "../src/pages/shared/formCompletion.ts";
import { invoiceCompletionProgress } from "../src/pages/shared/invoiceFormCompletion.ts";

const completeForm = (): GiteCompletionForm => ({
  nom: "Le Jardin",
  prefixe_contrat: "JA",
  adresse_ligne1: "1 rue du Jardin",
  proprietaires_noms: "Camille Exemple",
  proprietaires_adresse: "2 rue Exemple",
  fiscal_establishment_id: "establishment",
  email: "contact@example.test",
  telephones: "0102030405",
  iban: "FR761234",
  titulaire: "Camille Exemple",
  caracteristiques: "Maison avec jardin",
  date_debut_activite: "2026-01-01",
  capacite_max: 4,
  nb_adultes_max: 4,
  nb_adultes_habituel: 2,
  nb_enfants_max: 0,
  heure_arrivee_defaut: "17:00",
  heure_depart_defaut: "10:00",
  options_draps_par_lit: 0,
  options_linge_toilette_par_personne: 0,
  options_menage_forfait: 0,
  options_depart_tardif_forfait: 0,
  options_chiens_forfait: 0,
  caution_montant_defaut: 0,
  cheque_menage_montant_defaut: 0,
  arrhes_taux_defaut: 0,
  electricity_price_per_kwh: 0,
  prix_nuit_basse_saison: 100,
  prix_nuit_haute_saison: 150,
  min_nuits_toute_annee: 1,
  min_nuits_vacances_scolaires: 2,
  min_nuits_juillet_aout: 7,
  taxe_sejour_config: {
    version: 1,
    classified: false,
    stars: 0,
    included: false,
    fixed_rate: 0,
    percentage: 4,
    cap: 4,
    additional_percentage: 0,
    accommodation_vat_rate: 0,
    authority: "Collectivité exemple",
    effective_from: "2026-01-01",
  },
  public_is_published: false,
  public_slug: "",
  public_title: "",
  public_summary: "",
  public_description: "",
  public_web_info: { surface_m2: "", max_people: "", sleeping_capacity: "" },
});
const context = { photoCount: 0, billingSiret: "12345678900012" };

test("fiche complète sans intégrations ni publication : les valeurs zéro sont valides", () => {
  const items = giteFormCompletion(completeForm(), context);
  assert.deepEqual(items, []);
  assert.equal(giteCompletionProgress(items, false), 100);
});

test("les manques pointent vers les champs de leur rubrique, avec une progression stable", () => {
  const form = completeForm();
  form.iban = " ";
  form.titulaire = "";
  form.taxe_sejour_config = null;
  const items = giteFormCompletion(form, context);
  assert.deepEqual(
    items.map((item) => [item.target, item.group]),
    [
      ["gite-iban", "gestion-finance"],
      ["gite-titulaire", "gestion-finance"],
      ["gite-tax-configure", "gestion-finance"],
    ],
  );
  assert.equal(giteCompletionProgress(items, false), 83);
  assert.equal(giteCompletionProgress(items.slice(1), false), 83);
});

test("la taxe utilise le même validateur que le calcul et cible le plafond manquant", () => {
  const form = completeForm();
  form.taxe_sejour_config!.cap = 0;
  form.taxe_sejour_config!.authority = "";
  let items = giteFormCompletion(form, context);
  assert.ok(items.some((item) => item.target === "gite-tax-cap"));
  assert.ok(items.some((item) => item.target === "gite-tax-authority"));
  form.taxe_sejour_config!.classified = true;
  items = giteFormCompletion(form, context);
  assert.ok(items.some((item) => item.target === "gite-tax-stars"));
  assert.ok(!items.some((item) => item.target === "gite-tax-cap"));
});

test("la publication ajoute ses informations et les photos à la liste", () => {
  const form = completeForm();
  form.public_is_published = true;
  let items = giteFormCompletion(form, context);
  assert.equal(items.length, 8);
  assert.ok(
    items.some((item) => item.target === "gite-public_web_info-surface_m2"),
  );
  assert.ok(items.some((item) => item.target === "gite-editor-photos"));
  form.public_slug = "le-jardin";
  form.public_title = "Le Jardin";
  form.public_summary = "Un séjour au calme";
  form.public_description = "Maison indépendante";
  form.public_web_info = {
    surface_m2: 80,
    max_people: 4,
    sleeping_capacity: 4,
  };
  items = giteFormCompletion(form, { ...context, photoCount: 1 });
  assert.deepEqual(items, []);
  form.public_slug = "Adresse Invalide";
  assert.ok(
    giteFormCompletion(form, context).some(
      (item) => item.target === "gite-public_slug",
    ),
  );
});

test("capacités, saisies vides et heures incohérentes restent signalées", () => {
  const form = completeForm();
  form.nb_adultes_max = 5;
  form.nb_adultes_habituel = 6;
  form.options_menage_forfait = "";
  form.arrhes_taux_defaut = 1.2;
  form.min_nuits_toute_annee = 1.5;
  form.heure_depart_defaut = "26:00";
  const targets = giteFormCompletion(form, context).map((item) => item.target);
  for (const key of [
    "nb_adultes_max",
    "nb_adultes_habituel",
    "options_menage_forfait",
    "arrhes_taux_defaut",
    "min_nuits_toute_annee",
    "heure_depart_defaut",
  ])
    assert.ok(targets.includes(`gite-${key}`));
});

test("la facturation guide vers le rattachement puis le SIRET partagé", () => {
  const form = completeForm();
  assert.ok(
    giteFormCompletion(form, { photoCount: 0 }).some(
      (item) => item.target === "gite-billing-siret",
    ),
  );
  form.fiscal_establishment_id = "";
  const targets = giteFormCompletion(form, context).map((item) => item.target);
  assert.ok(targets.includes("gite-fiscal_establishment_id"));
  assert.ok(!targets.includes("gite-billing-siret"));
});

test("le moteur commun garde la pondération de l’assistant de facture", () => {
  assert.equal(formCompletionProgress([], []), 100);
  assert.equal(invoiceCompletionProgress([]), 100);
  assert.equal(
    invoiceCompletionProgress([
      { label: "TVA", target: "invoice-line-vat" },
      { label: "TVA ligne 2", target: "invoice-line-vat-1" },
      { label: "Ville", target: "buyer-city" },
    ]),
    60,
  );
});

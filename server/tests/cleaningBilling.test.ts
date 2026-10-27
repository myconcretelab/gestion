import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBookingRequestOptionsTemplateValues,
  computeInvoiceFiscal,
  invoiceReservationServices,
} from "@contrats/shared";
import { computeTotals } from "../src/services/contractCalculator.js";
import { optionsSchema } from "../src/routes/shared/rentalDocument.js";
import { proposeInvoiceFiscal } from "../src/modules/documents/invoiceFiscal.js";
import {
  buildInvoiceHtml,
  generateContractPreviewHtml,
  closeBrowser,
  type InvoiceRenderInput,
  type GiteLike,
} from "../src/services/pdfService.js";

const gite: GiteLike = {
  nom: "Brocéliande",
  adresse_ligne1: "Paimpont",
  proprietaires_noms: "Loueur",
  proprietaires_adresse: "Paimpont",
  capacite_max: 6,
  telephones: [],
  iban: "",
  titulaire: "Loueur",
  taxe_sejour_par_personne_par_nuit: 0,
  regle_animaux_acceptes: true,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
  options_menage_forfait: 60,
  options_draps_par_lit: 15,
  options_linge_toilette_par_personne: 5,
  options_depart_tardif_forfait: 20,
  options_chiens_forfait: 5,
};
const options = { menage: { enabled: true, inclus: true, declared: true } };
const totals = computeTotals({
  dateDebut: new Date("2026-10-20"),
  dateFin: new Date("2026-10-23"),
  prixParNuit: 200,
  remiseMontant: 0,
  nbAdultes: 2,
  nbEnfants: 0,
  arrhesMontant: 100,
  options,
  gite,
});
const invoice: InvoiceRenderInput = {
  numero_facture: "TEST-INCLUS",
  locataire_nom: "Camille",
  locataire_adresse: "",
  locataire_tel: "",
  nb_adultes: 2,
  nb_enfants_2_17: 0,
  date_debut: new Date("2026-10-20"),
  date_fin: new Date("2026-10-23"),
  heure_arrivee: "17:00",
  heure_depart: "10:00",
  prix_par_nuit: 200,
  remise_montant: 0,
  arrhes_montant: 100,
  arrhes_date_limite: new Date("2026-10-20"),
  solde_montant: 500,
  cheque_menage_montant: 0,
  caution_montant: 0,
  options,
};

test("l’API conserve inclus, refuse inclus et offert simultanés et accepte les anciennes options", () => {
  assert.deepEqual(optionsSchema.parse(options), options);
  assert.equal(
    optionsSchema.safeParse({
      menage: { enabled: true, inclus: true, offert: true },
    }).success,
    false,
  );
  assert.equal(
    optionsSchema.safeParse({ menage: { enabled: true, offert: true } })
      .success,
    true,
  );
  assert.equal(
    optionsSchema.safeParse({ menage: { enabled: true } }).success,
    true,
  );
  assert.equal(totals.totalGlobal, 600);
  assert.equal(totals.solde, 500);
  assert.equal(totals.optionsDetail.menage, 0);
});

test("les factures simples et regroupées distinguent inclus et offert sans ajouter de montant", async () => {
  const services = invoiceReservationServices(
    { nb_nuits: 3, frais_optionnels_montant: 0, options },
    gite,
  );
  assert.equal(services.useStructuredOptions, true);
  assert.deepEqual(services.services, [
    {
      key: "menage",
      label: "Ménage · inclus dans le prix du séjour",
      quantity: 1,
      unit_price_ttc: 0,
    },
  ]);
  const mismatch = invoiceReservationServices(
    {
      nb_nuits: 3,
      frais_optionnels_montant: 20,
      options: { ...options, draps: { enabled: true, nb_lits: 2 } },
    },
    gite,
  );
  assert.equal(mismatch.useStructuredOptions, false);
  assert.ok(
    mismatch.services.some(
      (row) => row.key === "menage" && row.unit_price_ttc === 0,
    ),
  );
  const fiscal = proposeInvoiceFiscal({ options }, totals);
  assert.equal(
    fiscal.lines.find((line) => line.label.startsWith("Ménage"))?.label,
    "Ménage · inclus dans le prix du séjour",
  );
  assert.equal(computeInvoiceFiscal(fiscal).gross_cents, 60000);
  for (const value of [undefined, fiscal]) {
    const html = await buildInvoiceHtml({
      invoice: { ...invoice, fiscal: value },
      totals,
      gite,
    });
    assert.match(html, /inclus dans le prix du séjour/);
    assert.doesNotMatch(html, /Option offerte|Ménage · offert/);
  }
  const email = buildBookingRequestOptionsTemplateValues({
    options,
    pricing_snapshot: { nb_nuits: 3, options_detail: { menage: 0 } },
  });
  assert.equal(email.optionsMenage, "Ménage : inclus dans le prix du séjour");
});

test("le contrat affiche le ménage inclus sans supplément ni remise cadeau", async () => {
  try {
    const preview = await generateContractPreviewHtml({
      contract: { ...invoice, numero_contrat: "TEST-INCLUS" },
      totals,
      gite,
    });
    assert.match(
      preview.html,
      /Ménage fin de séjour — inclus dans le prix du séjour/,
    );
    assert.doesNotMatch(preview.html, /Offre exeptionelle - Ménage/);
  } finally {
    await closeBrowser();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  computeInvoiceFiscal,
  invoiceFiscalInputSchema,
  invoiceReservationServices,
  invoiceThemeIds,
} from "@contrats/shared";
import { proposeInvoiceFiscal } from "../src/modules/documents/invoiceFiscal.js";
import {
  buildInvoiceHtml,
  generateInvoicePreviewHtml,
  generateInvoicePdf,
  closeBrowser,
  type InvoiceRenderInput,
  type GiteLike,
} from "../src/services/pdfService.js";
import type { ContractTotals } from "../src/services/contractCalculator.js";

const gite: GiteLike = {
  nom: "Le Chêne",
  adresse_ligne1: "1 rue des Chênes",
  proprietaires_noms: "Loueur fictif",
  proprietaires_adresse: "Paimpont",
  capacite_max: 6,
  telephones: [],
  iban: "",
  titulaire: "Loueur fictif",
  taxe_sejour_par_personne_par_nuit: 0,
  regle_animaux_acceptes: true,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
  options_draps_par_lit: 10,
  options_linge_toilette_par_personne: 5,
  options_menage_forfait: 40,
  options_depart_tardif_forfait: 20,
  options_chiens_forfait: 5,
};
const booking = {
  nb_nuits: 3,
  frais_optionnels_montant: 75,
  options: {
    draps: { enabled: true, nb_lits: 2 },
    menage: { enabled: true },
    linge_toilette: { enabled: true, nb_personnes: 2, offert: true },
    chiens: { enabled: true, nb: 1 },
  },
};
const items = [
  {
    reservation_id: "r1",
    gite_id: "g1",
    gite_nom: "Le Chêne <test>",
    hote_nom: "Camille",
    date_debut: "2026-10-20",
    date_fin: "2026-10-23",
    nb_nuits: 3,
    nb_adultes: 2,
    nb_enfants_2_17: 0,
    prix_par_nuit: 70,
    montant_location: 210,
    remise_montant: 0,
    montant: 285,
    services: invoiceReservationServices(booking, gite).services,
  },
  {
    reservation_id: "r2",
    gite_id: "g2",
    gite_nom: "La Forêt",
    hote_nom: "Alex",
    date_debut: "2026-11-01",
    date_fin: "2026-11-03",
    nb_nuits: 2,
    nb_adultes: 1,
    nb_enfants_2_17: 0,
    prix_par_nuit: 80,
    montant_location: 150.01,
    remise_montant: 9.99,
    montant: 180.01,
    services: invoiceReservationServices(
      {
        nb_nuits: 2,
        frais_optionnels_montant: 30,
        frais_optionnels_libelle: "Panier du terroir",
        options: {},
      },
      gite,
    ).services,
  },
];
const totals: ContractTotals = {
  nbNuits: 5,
  montantBase: 465.01,
  totalSansOptions: 465.01,
  optionsTotal: 0,
  totalGlobal: 477.36,
  solde: 477.36,
  taxeSejourCalculee: 0,
  optionsDetail: { draps: 0, linge: 0, menage: 0, departTardif: 0, chiens: 0 },
};
const proposal = () =>
  proposeInvoiceFiscal(
    {
      reservation_items: items,
      frais_supplementaires: [{ libelle: "Livraison", montant: 12.35 }],
    },
    totals,
  );

test("les séjours regroupés conservent nuitées, options offertes, frais et centimes de remise", () => {
  const input = proposal();
  assert.equal(invoiceFiscalInputSchema.safeParse(input).success, true);
  assert.equal(computeInvoiceFiscal(input).gross_cents, 47736);
  assert.equal(input.lines[0].quantity, 3);
  assert.equal(input.lines[0].unit_price_ttc, 70);
  assert.equal(input.lines[0].unit, "DAY");
  const first = input.lines.filter((line) => line.source?.stay_id === "r1");
  assert.equal(first.find((line) => line.label === "Draps")?.quantity, 2);
  assert.equal(
    first.find((line) => line.label === "Draps")?.unit_price_ttc,
    10,
  );
  assert.equal(
    first.find((line) => line.label.includes("offert"))?.unit_price_ttc,
    0,
  );
  const second = input.lines.filter((line) => line.source?.stay_id === "r2");
  assert.equal(
    second
      .filter((line) => line.unit === "DAY")
      .reduce((sum, line) => sum + line.quantity, 0),
    2,
  );
  assert.equal(second[0].source?.discount, 9.99);
  assert.equal(
    second.find((line) => line.label === "Panier du terroir")?.unit_price_ttc,
    30,
  );
  assert.equal(input.lines.at(-1)?.source, undefined);
});

test("un tarif d’option modifié ne change pas le montant enregistré de la réservation", () => {
  const lower = invoiceReservationServices(
    { ...booking, frais_optionnels_montant: 50 },
    gite,
  );
  assert.equal(lower.useStructuredOptions, false);
  assert.equal(
    lower.services.reduce(
      (sum, row) => sum + row.quantity * row.unit_price_ttc,
      0,
    ),
    50,
  );
  assert.match(lower.extraFee.libelle, /Draps × 2/);
  assert.match(lower.extraFee.libelle, /Ménage/);
  assert.ok(lower.services.some((row) => row.label.includes("offert")));
  const higher = invoiceReservationServices(
    {
      ...booking,
      frais_optionnels_montant: 95,
      frais_optionnels_libelle: "Supplément enregistré",
    },
    gite,
  );
  assert.equal(higher.useStructuredOptions, false);
  assert.equal(higher.extraFee.montant, 95);
  assert.equal(
    higher.services.reduce(
      (sum, row) => sum + row.quantity * row.unit_price_ttc,
      0,
    ),
    95,
  );
});

test("le PDF détaille chaque séjour et son prix unitaire, sans confondre nuitées et jours", async () => {
  const invoice: InvoiceRenderInput = {
    numero_facture: "BROUILLON",
    lifecycle_status: "draft",
    fiscal: proposal(),
    reservation_items: items,
    seller: {
      legal_name: "Loueur fictif",
      siren: null,
      siret: null,
      vat_number: null,
      address: "Paimpont",
      email: null,
    },
    locataire_nom: "Client fictif",
    locataire_adresse: "",
    locataire_tel: "",
    nb_adultes: 1,
    nb_enfants_2_17: 0,
    date_debut: new Date("2026-10-20"),
    date_fin: new Date("2026-11-03"),
    heure_arrivee: "17:00",
    heure_depart: "12:00",
    prix_par_nuit: 70,
    remise_montant: 0,
    arrhes_montant: 0,
    arrhes_date_limite: new Date("2026-11-03"),
    solde_montant: 477.36,
    cheque_menage_montant: 0,
    caution_montant: 0,
    options: {},
  };
  const html = await buildInvoiceHtml({ invoice, gite, totals });
  assert.match(html, /Le Chêne &lt;test&gt;/);
  assert.match(html, /3 nuitées × 70,00/);
  assert.match(html, /Draps/);
  assert.match(html, /2 unité\(s\) × 10,00/);
  assert.match(html, /Linge de toilette · offert/);
  assert.match(html, /remise de 9,99/);
  assert.match(html, /Panier du terroir/);
  assert.match(html, /Livraison/);
  assert.match(html, /477,36/);
  assert.equal(
    (html.match(/<tr class="invoice-stay-heading">/g) ?? []).length,
    2,
  );

  for (const theme of invoiceThemeIds) {
    const themed = await buildInvoiceHtml({
      invoice: { ...invoice, clauses: { invoice_theme: theme } },
      gite,
      totals,
    });
    const body = (value: string) =>
      value.split("</head>")[1].replace(/data-invoice-theme="[^"]*"/, "");
    assert.equal(
      body(themed),
      body(html),
      `${theme} conserve tout le contenu de la facture`,
    );
    assert.match(themed, new RegExp(`data-invoice-theme="${theme}"`));
  }

  const groupedItems = Array.from({ length: 6 }, (_, index) => ({
    ...items[index % 2],
    reservation_id: `r-${index}`,
  }));
  const detailedFiscal = proposeInvoiceFiscal(
    { reservation_items: groupedItems },
    totals,
  );
  const detailedTotal = computeInvoiceFiscal(detailedFiscal).gross_cents / 100;
  const detailed = {
    gite,
    invoice: {
      ...invoice,
      reservation_items: groupedItems,
      fiscal: detailedFiscal,
    },
    totals: { ...totals, totalGlobal: detailedTotal, solde: detailedTotal },
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "invoice-details-"));
  const previousSkip = process.env.SKIP_PDF_GENERATION;
  delete process.env.SKIP_PDF_GENERATION;
  try {
    for (const theme of invoiceThemeIds) {
      const params = {
        ...detailed,
        invoice: { ...detailed.invoice, clauses: { invoice_theme: theme } },
      };
      const preview = await generateInvoicePreviewHtml(params);
      assert.equal(preview.multiPage, true);
      assert.equal(preview.overflowAfter, false);
      assert.match(preview.html, /invoice-multipage/);
      assert.equal(
        (preview.html.match(/<tr class="invoice-stay-heading">/g) ?? []).length,
        6,
      );
      const outputPath = path.join(directory, `${theme}.pdf`);
      await generateInvoicePdf({ ...params, outputPath });
      const bytes = await readFile(outputPath);
      assert.match(bytes.toString("ascii", 0, 8), /^%PDF-/);
      assert.ok(
        (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length >=
          2,
      );
    }
    const small = await generateInvoicePreviewHtml({
      ...detailed,
      invoice: {
        ...invoice,
        reservation_items: [],
        fiscal: { ...detailedFiscal, lines: [detailedFiscal.lines[0]] },
      },
    });
    assert.equal(small.multiPage, false);
  } finally {
    if (previousSkip === undefined) delete process.env.SKIP_PDF_GENERATION;
    else process.env.SKIP_PDF_GENERATION = previousSkip;
    await closeBrowser();
    await rm(directory, { recursive: true, force: true });
  }
});

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
  generateContractPreviewHtml,
  generateInvoicePdf,
  closeBrowser,
  type InvoiceRenderInput,
  type GiteLike,
} from "../src/services/pdfService.js";
import type { ContractTotals } from "../src/services/contractCalculator.js";
import { computeTotals } from "../src/services/contractCalculator.js";

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

test("un séjour conserve les quantités et tarifs unitaires des draps et des autres options", async () => {
  for (const beds of [7, 10]) {
    for (const offered of [false, true]) {
      const options = {
        draps: { enabled: true, nb_lits: beds, prix_unitaire: 15, offert: offered },
        linge_toilette: { enabled: true, nb_personnes: 4 },
        menage: { enabled: true },
        depart_tardif: { enabled: true, prix_forfait: 25 },
        chiens: { enabled: true, nb: 2, prix_unitaire: 7.35 },
      };
      const singleTotals = computeTotals({
        dateDebut: new Date("2026-10-20"),
        dateFin: new Date("2026-10-23"),
        prixParNuit: 70,
        remiseMontant: 0,
        nbAdultes: 4,
        nbEnfants: 0,
        arrhesMontant: 0,
        options,
        gite,
      });
      // Options may come from a request object or the saved JSON column.
      const input = proposeInvoiceFiscal(
        { options: beds === 7 ? options : JSON.stringify(options) },
        singleTotals,
      );
      assert.equal(invoiceFiscalInputSchema.safeParse(input).success, true);
      const sheets = input.lines.find((line) => line.label.startsWith("Draps"))!;
      assert.equal(sheets.quantity, beds);
      assert.equal(sheets.unit, "C62");
      assert.equal(sheets.unit_price_ttc, offered ? 0 : 15);
      assert.equal(sheets.label, offered ? "Draps · offert" : "Draps");
      for (const [label, quantity, price] of [
        ["Linge de toilette", 4, 5],
        ["Ménage", 1, 40],
        ["Départ tardif", 1, 25],
        ["Animaux", 6, 7.35],
      ] as const) {
        const line = input.lines.find((line) => line.label === label)!;
        assert.equal(line.quantity, quantity);
        assert.equal(line.unit_price_ttc, price);
        assert.equal(line.unit, "C62");
      }
      assert.equal(
        computeInvoiceFiscal(input).gross_cents,
        Math.round(singleTotals.totalGlobal * 100),
      );
      const html = await buildInvoiceHtml({
        invoice: {
          numero_facture: "BROUILLON",
          lifecycle_status: "draft",
          fiscal: input,
          locataire_nom: "Client fictif",
          locataire_adresse: "",
          locataire_tel: "",
          nb_adultes: 4,
          nb_enfants_2_17: 0,
          date_debut: new Date("2026-10-20"),
          date_fin: new Date("2026-10-23"),
          heure_arrivee: "17:00",
          heure_depart: "12:00",
          prix_par_nuit: 70,
          remise_montant: 0,
          arrhes_montant: 0,
          arrhes_date_limite: new Date("2026-10-20"),
          solde_montant: singleTotals.totalGlobal,
          cheque_menage_montant: 0,
          caution_montant: 0,
          options,
        },
        gite,
        totals: singleTotals,
      });
      assert.match(html, new RegExp(`${beds} unité\\(s\\) × ${offered ? "0" : "15"},00`));
    }
  }
});

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

  // Fiscal PDFs must explain the reduction while their lines and VAT still
  // account for it exactly once, including allocations across nightly cents.
  for (const [nights, discount] of [
    [1, 90],
    [3, 10],
    [2, 70],
    [1, 350],
  ]) {
    const discountedTotals = computeTotals({
      dateDebut: new Date("2026-10-20"),
      dateFin: new Date(`2026-10-${20 + nights}`),
      prixParNuit: 350,
      remiseMontant: discount,
      nbAdultes: 1,
      nbEnfants: 0,
      arrhesMontant: 0,
      options: {},
      gite,
    });
    const discountedFiscal = proposeInvoiceFiscal(
      { remise_montant: discount },
      discountedTotals,
    );
    discountedFiscal.lines.forEach((line) => {
      line.vat_category = "S";
      line.vat_rate = 10;
    });
    const computed = computeInvoiceFiscal(discountedFiscal);
    assert.equal(computed.gross_cents, nights * 35000 - discount * 100);
    for (const theme of invoiceThemeIds) {
      const discountedHtml = await buildInvoiceHtml({
        gite,
        totals: discountedTotals,
        invoice: {
          ...invoice,
          reservation_items: [],
          fiscal: discountedFiscal,
          prix_par_nuit: 350,
          remise_montant: discount,
          clauses: {
            invoice_theme: theme,
            remise_raison: "Fidélité <client> & séjour",
          },
          date_fin: new Date(`2026-10-${20 + nights}`),
        },
      });
      assert.match(discountedHtml, /Fidélité &lt;client&gt; &amp; séjour/);
      assert.match(discountedHtml, /Location avant remise :/);
      assert.equal(
        (discountedHtml.match(/class="invoice-discount-detail"/g) ?? []).length,
        1,
      );
      assert.match(
        discountedHtml,
        /Remise déjà déduite des nuitées ci-dessous/,
      );
      if (nights === 1 && discount === 90) {
        assert.match(
          discountedHtml,
          /350,00[^<]*− remise : 90,00[^<]*= 260,00/,
        );
        assert.match(discountedHtml, /1 nuitée × 260,00/);
      }
    }
  }

  for (const included of [false, true]) {
    const options = {
      tourist_tax: {
        settings: {
          version: 1 as const,
          classified: true,
          stars: 3,
          included,
          fixed_rate: 1.5,
          percentage: 4,
          cap: 4,
          additional_percentage: 0,
          accommodation_vat_rate: 0,
          authority: "Collectivité <test>",
          effective_from: "2026-01-01",
        },
        collector: "host" as const,
        platform: "",
        infants: 0,
        exempt_adults: 0,
        exemption_reason: "",
      },
    };
    const taxTotals = computeTotals({
      dateDebut: new Date("2026-10-20"),
      dateFin: new Date("2026-10-21"),
      prixParNuit: 350,
      remiseMontant: 0,
      nbAdultes: 2,
      nbEnfants: 0,
      arrhesMontant: 0,
      options,
      gite,
    });
    const taxFiscal = proposeInvoiceFiscal({ options }, taxTotals);
    taxFiscal.lines.forEach((line) => {
      line.vat_category = "E";
      line.exemption_reason = "TVA non applicable, article 293 B du CGI";
    });
    assert.equal(
      computeInvoiceFiscal(taxFiscal).gross_cents,
      included ? 35000 : 35300,
    );
    const taxInvoice = {
      ...invoice,
      reservation_items: [],
      fiscal: taxFiscal,
      options,
      prix_par_nuit: 350,
      nb_adultes: 2,
      date_fin: new Date("2026-10-21"),
      solde_montant: taxTotals.totalGlobal,
    };
    for (const theme of invoiceThemeIds) {
      const taxHtml = await buildInvoiceHtml({
        invoice: { ...taxInvoice, clauses: { invoice_theme: theme } },
        gite,
        totals: taxTotals,
      });
      assert.match(taxHtml, /Taxe de séjour/);
      assert.match(
        taxHtml,
        /2 personne\(s\) taxable\(s\) × 1 nuit\(s\) × 1,50/,
      );
      assert.match(taxHtml, /Collectivité &lt;test&gt;/);
      assert.match(
        taxHtml,
        included ? /comprise dans le prix annoncé/ : /en supplément/,
      );
      assert.match(taxHtml, included ? /347,00/ : /353,00/);
    }
    const contractPreview = await generateContractPreviewHtml({
      contract: { ...taxInvoice, numero_contrat: "TEST-TAXE" },
      gite,
      totals: taxTotals,
    });
    assert.match(contractPreview.html, /hors taxe de séjour/);
    assert.match(
      contractPreview.html,
      /La taxe de séjour est détaillée séparément/,
    );
    assert.doesNotMatch(
      contractPreview.html,
      /Le prix comprend toutes les charges ainsi que la taxe de séjour/,
    );
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

import prisma from "../src/db/prisma.js";
import { computeTotals } from "../src/services/contractCalculator.js";
import { generateContractNumber } from "../src/services/contractNumber.js";
import { generateContractPdf, closeBrowser } from "../src/services/pdfService.js";
import { getPdfPaths } from "../src/utils/paths.js";
import { encodeJsonField } from "../src/utils/jsonFields.js";
import { generateIcalExportToken } from "../src/utils/reservationOrigin.js";

const seed = async () => {
  await prisma.contentTemplateVersion.deleteMany();
  await prisma.installationConfig.deleteMany();
  await prisma.appUser.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.reservationPlaceholder.deleteMany();
  await prisma.facture.deleteMany();
  await prisma.factureCounter.deleteMany();
  await prisma.contrat.deleteMany();
  await prisma.contratCounter.deleteMany();
  await prisma.gite.deleteMany();
  await prisma.gestionnaire.deleteMany();

  await prisma.installationConfig.create({
    data: {
      id: "default",
      setup_completed: true,
      organization_json: JSON.stringify({
        tradeName: "Locations Démonstration",
        legalName: "Société Démonstration",
        addressLine1: "10 rue des Démonstrations",
        addressLine2: "",
        postalCode: "44000",
        city: "Nantes",
        country: "FR",
        email: "location@example.test",
        phone: "06 00 00 00 00",
        website: "https://example.test",
        iban: "FR7630003000300030003000300",
        bic: "DEMOFRPP",
        bankAccountHolder: "Société Démonstration",
        locale: "fr-FR",
        currency: "EUR",
        timezone: "Europe/Paris",
        logoUrl: "",
        faviconUrl: "",
        primaryColor: "#315f4b",
        emailSignature: "L'équipe de démonstration",
        smsSignature: "Locations Démonstration",
        documentFooter: "Locations Démonstration",
        publicDisplayName: "Locations Démonstration",
        documentLocale: "fr-FR",
        documentDateFormat: "",
        documentPaymentTerms: "",
      }),
      modules_json: JSON.stringify({
        reservations: true, contracts: true, invoices: true, finances: true,
        personal_expenses: true, worker_planning: true, web_publication: false,
        ical: false, pump_airbnb: false, smart_life: false, sms: false,
        telegram: false, daily_email: false,
      }),
    },
  });

  const gestionnaireLea = await prisma.gestionnaire.create({
    data: {
      prenom: "Léa",
      nom: "Martin",
    },
  });
  const gestionnaireHugo = await prisma.gestionnaire.create({
    data: {
      prenom: "Hugo",
      nom: "Dubois",
    },
  });

  const giteLib = await prisma.gite.create({
    data: {
      ordre: 0,
      ical_export_token: generateIcalExportToken(),
      nom: "GÎTE DES HORIZONS",
      prefixe_contrat: "HOR",
      adresse_ligne1: "10 rue des Démonstrations, 44000 Nantes",
      adresse_ligne2: null,
      capacite_max: 6,
      nb_adultes_max: 6,
      nb_adultes_habituel: 6,
      nb_enfants_max: 0,
      proprietaires_noms: "Société Démonstration",
      proprietaires_adresse: "10 rue des Démonstrations, 44000 Nantes",
      site_web: "https://example.test",
      email: "location@example.test",
      telephones: encodeJsonField(["06 00 00 00 00", "02 99 00 00 00"]),
      taxe_sejour_par_personne_par_nuit: 0.6,
      iban: "FR76 3000 3000 3000 3000 3000 300",
      bic: "SOGEFRPP",
      titulaire: "Société Démonstration",
      caracteristiques: "Jardin clos\nCheminée\nTerrasse couverte",
      regle_animaux_acceptes: false,
      regle_bois_premiere_flambee: true,
      regle_tiers_personnes_info: true,
      options_draps_par_lit: 12,
      options_linge_toilette_par_personne: 6,
      options_menage_forfait: 60,
      options_depart_tardif_forfait: 35,
      options_chiens_forfait: 25,
      heure_arrivee_defaut: "16:00",
      heure_depart_defaut: "10:00",
      caution_montant_defaut: 400,
      cheque_menage_montant_defaut: 60,
      arrhes_taux_defaut: 0.2,
      prix_nuit_liste: encodeJsonField([120, 140, 160]),
      gestionnaire_id: gestionnaireLea.id,
    },
  });

  const gitePrairie = await prisma.gite.create({
    data: {
      ordre: 1,
      ical_export_token: generateIcalExportToken(),
      nom: "GÎTE DU JARDIN",
      prefixe_contrat: "JAR",
      adresse_ligne1: "20 avenue Exemple, 33000 Bordeaux",
      adresse_ligne2: null,
      capacite_max: 4,
      nb_adultes_max: 4,
      nb_adultes_habituel: 4,
      nb_enfants_max: 0,
      proprietaires_noms: "Société Démonstration",
      proprietaires_adresse: "10 rue des Démonstrations, 44000 Nantes",
      site_web: "https://example.test",
      email: "location@example.test",
      telephones: encodeJsonField(["06 11 22 33 44"]),
      taxe_sejour_par_personne_par_nuit: 0.8,
      iban: "FR76 1000 2000 3000 4000 5000 600",
      bic: "AGRIFRPP",
      titulaire: "Société Démonstration",
      caracteristiques: "Vue campagne\nParking privé\nCuisine équipée",
      regle_animaux_acceptes: true,
      regle_bois_premiere_flambee: false,
      regle_tiers_personnes_info: false,
      options_draps_par_lit: 10,
      options_linge_toilette_par_personne: 5,
      options_menage_forfait: 50,
      options_depart_tardif_forfait: 30,
      options_chiens_forfait: 20,
      heure_arrivee_defaut: "17:00",
      heure_depart_defaut: "10:00",
      caution_montant_defaut: 300,
      cheque_menage_montant_defaut: 50,
      arrhes_taux_defaut: 0.25,
      prix_nuit_liste: encodeJsonField([90, 110, 130]),
      gestionnaire_id: gestionnaireHugo.id,
    },
  });

  const createContract = async (params: {
    gite: typeof giteLib;
    locataire_nom: string;
    locataire_adresse: string;
    locataire_tel: string;
    nb_adultes: number;
    nb_enfants_2_17: number;
    date_debut: string;
    date_fin: string;
    heure_arrivee: string;
    heure_depart: string;
    prix_par_nuit: number;
    remise_montant: number;
    arrhes_date_limite: string;
    caution_montant: number;
    cheque_menage_montant: number;
    options: any;
  }) => {
    const dateDebut = new Date(params.date_debut);
    const dateFin = new Date(params.date_fin);
    const totals = computeTotals({
      dateDebut,
      dateFin,
      prixParNuit: params.prix_par_nuit,
      remiseMontant: params.remise_montant,
      nbAdultes: params.nb_adultes,
      nbEnfants: params.nb_enfants_2_17,
      arrhesMontant: 0,
      options: params.options,
      gite: params.gite,
    });
    const arrhesMontant = Math.round(totals.totalSansOptions * 0.2 * 100) / 100;
    const totalsFinal = computeTotals({
      dateDebut,
      dateFin,
      prixParNuit: params.prix_par_nuit,
      remiseMontant: params.remise_montant,
      nbAdultes: params.nb_adultes,
      nbEnfants: params.nb_enfants_2_17,
      arrhesMontant,
      options: params.options,
      gite: params.gite,
    });

    const numero = await generateContractNumber(
      params.gite.id,
      params.gite.prefixe_contrat,
      dateDebut.getFullYear()
    );

    const { relativePath: pdfRelativePath, absolutePath: pdfAbsolutePath } = getPdfPaths(numero, dateDebut);

    const contrat = await prisma.contrat.create({
      data: {
        numero_contrat: numero,
        gite_id: params.gite.id,
        locataire_nom: params.locataire_nom,
        locataire_adresse: params.locataire_adresse,
        locataire_tel: params.locataire_tel,
        nb_adultes: params.nb_adultes,
        nb_enfants_2_17: params.nb_enfants_2_17,
        date_debut: dateDebut,
        heure_arrivee: params.heure_arrivee,
        date_fin: dateFin,
        heure_depart: params.heure_depart,
        nb_nuits: totalsFinal.nbNuits,
        prix_par_nuit: params.prix_par_nuit,
        remise_montant: params.remise_montant,
        taxe_sejour_calculee: totalsFinal.taxeSejourCalculee,
        options: encodeJsonField(params.options),
        arrhes_montant: arrhesMontant,
        arrhes_date_limite: new Date(params.arrhes_date_limite),
        solde_montant: totalsFinal.solde,
        caution_montant: params.caution_montant,
        cheque_menage_montant: params.cheque_menage_montant,
        clauses: encodeJsonField({ texte_additionnel: "Merci de confirmer votre heure d'arrivée." }),
        pdf_path: pdfRelativePath,
        statut_paiement_arrhes: "non_recu",
      },
      include: { gite: true },
    });

    if (!process.env.SEED_SKIP_PDF) {
      await generateContractPdf({
        contract: contrat,
        gite: params.gite,
        totals: totalsFinal,
        outputPath: pdfAbsolutePath,
      });
    }
  };

  await createContract({
    gite: giteLib,
    locataire_nom: "Client Exemple",
    locataire_adresse: "1 rue Fictive, 75000 Paris",
    locataire_tel: "06 12 34 56 78",
    nb_adultes: 2,
    nb_enfants_2_17: 1,
    date_debut: "2026-06-12",
    date_fin: "2026-06-19",
    heure_arrivee: "16:00",
    heure_depart: "10:00",
    prix_par_nuit: 120,
    remise_montant: 0,
    arrhes_date_limite: "2026-05-15",
    caution_montant: 400,
    cheque_menage_montant: 60,
    options: {
      draps: { enabled: true, nb_lits: 3 },
      linge_toilette: { enabled: true, nb_personnes: 3 },
      menage: { enabled: false },
      depart_tardif: { enabled: false },
      chiens: { enabled: false },
    },
  });

  await createContract({
    gite: gitePrairie,
    locataire_nom: "Cliente Démonstration",
    locataire_adresse: "2 avenue Exemple, 69000 Lyon",
    locataire_tel: "06 98 76 54 32",
    nb_adultes: 2,
    nb_enfants_2_17: 0,
    date_debut: "2026-07-05",
    date_fin: "2026-07-10",
    heure_arrivee: "17:00",
    heure_depart: "10:00",
    prix_par_nuit: 95,
    remise_montant: 20,
    arrhes_date_limite: "2026-06-10",
    caution_montant: 300,
    cheque_menage_montant: 50,
    options: {
      draps: { enabled: false, nb_lits: 0 },
      linge_toilette: { enabled: false, nb_personnes: 0 },
      menage: { enabled: true },
      depart_tardif: { enabled: true },
      chiens: { enabled: true, nb: 1 },
    },
  });

  if (!process.env.SEED_SKIP_PDF) {
    await closeBrowser();
  }
};

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

type MockResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
  end: () => MockResponse;
};

const createMockResponse = (): MockResponse => {
  const response: MockResponse = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end() {
      return this;
    },
  };
  return response;
};

const restoreEnvVar = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const getRouteHandler = (router: any, method: "get" | "post" | "put" | "patch", routePath: string) => {
  const layer = router.stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
  );
  assert.ok(layer, `Route introuvable: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
};

test("API handlers calculent le solde correct sur create/update contrat/facture", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "contrats-handler-test-"));
  const envBackup = {
    DATA_DIR: process.env.DATA_DIR,
    SKIP_PDF_GENERATION: process.env.SKIP_PDF_GENERATION,
    BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD,
  };

  process.env.DATA_DIR = tempDir;
  process.env.SKIP_PDF_GENERATION = "1";
  process.env.BASIC_AUTH_PASSWORD = "";

  const prismaModule = await import("../src/db/prisma.ts");
  const prisma = prismaModule.default as any;

  const original = {
    giteFindUnique: prisma.gite.findUnique,
    contratCounterUpsert: prisma.contratCounter.upsert,
    factureCounterUpsert: prisma.factureCounter.upsert,
    contratCreate: prisma.contrat.create,
    contratFindUnique: prisma.contrat.findUnique,
    contratUpdate: prisma.contrat.update,
    factureCreate: prisma.facture.create,
    factureFindUnique: prisma.facture.findUnique,
    factureUpdate: prisma.facture.update,
    reservationFindUnique: prisma.reservation.findUnique,
    reservationFindMany: prisma.reservation.findMany,
    reservationCreate: prisma.reservation.create,
    reservationUpdate: prisma.reservation.update,
  };

  try {
    const mockedGite = {
      id: "g1",
      prefixe_contrat: "GT",
      arrhes_taux_defaut: 0.2,
      regle_animaux_acceptes: true,
      regle_bois_premiere_flambee: false,
      regle_tiers_personnes_info: false,
      taxe_sejour_par_personne_par_nuit: 1.5,
      options_draps_par_lit: 12,
      options_linge_toilette_par_personne: 8,
      options_menage_forfait: 20,
      options_depart_tardif_forfait: 15,
      options_chiens_forfait: 5,
    };
    let lastCreatedReservationData: any = null;
    let lastUpdatedReservationData: any = null;

    prisma.gite.findUnique = async () => mockedGite;
    prisma.contratCounter.upsert = async () => ({ lastNumber: 1 });
    prisma.factureCounter.upsert = async () => ({ lastNumber: 1 });
    prisma.contrat.create = async ({ data }: any) => ({ id: "c1", ...data });
    prisma.contrat.findUnique = async () => ({
      id: "c1",
      numero_contrat: "GT-2026-000001",
      arrhes_montant: 100,
      reservation_id: "r-contract",
    });
    prisma.contrat.update = async ({ data }: any) => ({ id: "c1", numero_contrat: "GT-2026-000001", ...data });
    prisma.facture.create = async ({ data }: any) => ({ id: "f1", ...data });
    prisma.facture.findUnique = async () => ({
      id: "f1",
      numero_facture: "GT-2026-01",
      arrhes_montant: 100,
      reservation_id: "r-invoice",
    });
    prisma.facture.update = async ({ data }: any) => ({ id: "f1", numero_facture: "GT-2026-01", ...data });
    prisma.reservation.findUnique = async ({ where }: any) => {
      if (where.id === "r-contract" || where.id === "r-invoice") {
        return { id: where.id, gite_id: "g1" };
      }
      return null;
    };
    prisma.reservation.findMany = async () => [];
    prisma.reservation.create = async ({ data }: any) => {
      lastCreatedReservationData = data;
      return { id: data.hote_nom === "Client Contrat" ? "r-contract-created" : "r-invoice-created" };
    };
    prisma.reservation.update = async ({ where, data }: any) => {
      lastUpdatedReservationData = { where, data };
      return { id: where.id };
    };

    const contractsRouterModule = await import("../src/routes/contracts.ts");
    const invoicesRouterModule = await import("../src/routes/invoices.ts");

    const contractPost = getRouteHandler(contractsRouterModule.default, "post", "/");
    const contractPut = getRouteHandler(contractsRouterModule.default, "put", "/:id");
    const invoicePost = getRouteHandler(invoicesRouterModule.default, "post", "/");
    const invoicePut = getRouteHandler(invoicesRouterModule.default, "put", "/:id");

    const baseOptions = {
      draps: { enabled: true, nb_lits: 2 },
      linge_toilette: { enabled: true, nb_personnes: 1 },
      menage: { enabled: true },
      depart_tardif: { enabled: false },
      chiens: { enabled: true, nb: 2 },
    };

    const contractPayload = {
      gite_id: "g1",
      locataire_nom: "Client Contrat",
      locataire_adresse: "Adresse",
      locataire_tel: "0700000000",
      nb_adultes: 2,
      nb_enfants_2_17: 1,
      date_debut: "2026-03-01",
      heure_arrivee: "17:00",
      date_fin: "2026-03-04",
      heure_depart: "12:00",
      prix_par_nuit: 100,
      remise_montant: 10,
      options: baseOptions,
      arrhes_montant: 100,
      arrhes_date_limite: "2026-02-15",
      caution_montant: 300,
      cheque_menage_montant: 80,
      afficher_caution_phrase: true,
      afficher_cheque_menage_phrase: true,
      clauses: {},
      notes: "note",
      statut_paiement_arrhes: "non_recu",
    };

    const createContractRes = createMockResponse();
    let nextError: unknown = null;
    await contractPost(
      { body: contractPayload, params: {}, query: {} },
      createContractRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal(createContractRes.statusCode, 201);
    assert.equal(Number((createContractRes.body as any).solde_montant), 272);
    assert.equal(Number(lastCreatedReservationData.prix_par_nuit), 100);
    assert.equal(Number(lastCreatedReservationData.prix_total), 300);
    assert.equal(Number(lastCreatedReservationData.remise_montant), 10);
    assert.equal((createContractRes.body as any).reservation_id, "r-contract-created");

    const updateContractRes = createMockResponse();
    nextError = null;
    await contractPut(
      {
        body: {
          ...contractPayload,
          prix_par_nuit: 120,
          arrhes_montant: 50,
          options: {
            ...baseOptions,
            menage: { enabled: false },
            depart_tardif: { enabled: true, prix_forfait: 27.5 },
            chiens: { enabled: false, nb: 0 },
          },
        },
        params: { id: "c1" },
        query: {},
      },
      updateContractRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal(updateContractRes.statusCode, 200);
    assert.equal(Number((updateContractRes.body as any).solde_montant), 359.5);
    assert.equal((updateContractRes.body as any).reservation_id, "r-contract");
    assert.equal((updateContractRes.body as any).options.depart_tardif.prix_forfait, 27.5);

    const invoicePayload = {
      gite_id: "g1",
      locataire_nom: "Client Facture",
      locataire_adresse: "Adresse",
      locataire_tel: "",
      locataire_email: "client.facture@example.com",
      nb_adultes: 2,
      nb_enfants_2_17: 1,
      date_debut: "2026-03-01",
      heure_arrivee: "17:00",
      date_fin: "2026-03-04",
      heure_depart: "12:00",
      prix_par_nuit: 100,
      remise_montant: 10,
      options: baseOptions,
      arrhes_montant: 100,
      arrhes_date_limite: "2026-02-15",
      caution_montant: 0,
      cheque_menage_montant: 0,
      afficher_caution_phrase: false,
      afficher_cheque_menage_phrase: false,
      clauses: {},
      notes: "note facture",
      statut_paiement: "non_reglee",
    };

    const createInvoiceRes = createMockResponse();
    nextError = null;
    await invoicePost(
      { body: invoicePayload, params: {}, query: {} },
      createInvoiceRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal(createInvoiceRes.statusCode, 201);
    assert.equal(Number((createInvoiceRes.body as any).solde_montant), 272);
    assert.equal((createInvoiceRes.body as any).reservation_id, "r-invoice-created");
    assert.equal(lastCreatedReservationData.telephone, null);
    assert.equal(lastCreatedReservationData.email, "client.facture@example.com");
    assert.equal(lastCreatedReservationData.frais_optionnels_libelle, "Draps x2 · Linge x1 · Ménage · Chiens x2");

    const updateInvoiceRes = createMockResponse();
    nextError = null;
    await invoicePut(
      {
        body: {
          ...invoicePayload,
          prix_par_nuit: 120,
          arrhes_montant: 50,
          options: {
            ...baseOptions,
            menage: { enabled: false },
            depart_tardif: { enabled: true, prix_forfait: 27.5 },
            chiens: { enabled: false, nb: 0 },
          },
        },
        params: { id: "f1" },
        query: {},
      },
      updateInvoiceRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal(updateInvoiceRes.statusCode, 200);
    assert.equal(Number((updateInvoiceRes.body as any).solde_montant), 359.5);
    assert.equal((updateInvoiceRes.body as any).reservation_id, "r-invoice");
    assert.deepEqual(lastUpdatedReservationData.where, { id: "r-invoice" });
    assert.equal(lastUpdatedReservationData.data.email, "client.facture@example.com");
    assert.equal(lastUpdatedReservationData.data.telephone, null);
    assert.equal(Number(lastUpdatedReservationData.data.prix_total), 360);
    assert.equal(lastUpdatedReservationData.data.frais_optionnels_libelle, "Draps x2 · Linge x1 · Départ tardif");
    assert.equal(Number(lastUpdatedReservationData.data.frais_optionnels_montant), 59.5);
    const updatedOptions =
      typeof lastUpdatedReservationData.data.options === "string"
        ? JSON.parse(lastUpdatedReservationData.data.options)
        : lastUpdatedReservationData.data.options;
    assert.equal(
      updatedOptions.depart_tardif.prix_forfait,
      27.5
    );
  } finally {
    prisma.gite.findUnique = original.giteFindUnique;
    prisma.contratCounter.upsert = original.contratCounterUpsert;
    prisma.factureCounter.upsert = original.factureCounterUpsert;
    prisma.contrat.create = original.contratCreate;
    prisma.contrat.findUnique = original.contratFindUnique;
    prisma.contrat.update = original.contratUpdate;
    prisma.facture.create = original.factureCreate;
    prisma.facture.findUnique = original.factureFindUnique;
    prisma.facture.update = original.factureUpdate;
    prisma.reservation.findUnique = original.reservationFindUnique;
    prisma.reservation.findMany = original.reservationFindMany;
    prisma.reservation.create = original.reservationCreate;
    prisma.reservation.update = original.reservationUpdate;

    restoreEnvVar("DATA_DIR", envBackup.DATA_DIR);
    restoreEnvVar("SKIP_PDF_GENERATION", envBackup.SKIP_PDF_GENERATION);
    restoreEnvVar("BASIC_AUTH_PASSWORD", envBackup.BASIC_AUTH_PASSWORD);

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("creation facture complete une reservation existante plutot que d'en creer une nouvelle", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "contrats-invoice-reservation-test-"));
  const envBackup = {
    DATA_DIR: process.env.DATA_DIR,
    SKIP_PDF_GENERATION: process.env.SKIP_PDF_GENERATION,
    BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD,
  };

  process.env.DATA_DIR = tempDir;
  process.env.SKIP_PDF_GENERATION = "1";
  process.env.BASIC_AUTH_PASSWORD = "";

  const prismaModule = await import("../src/db/prisma.ts");
  const prisma = prismaModule.default as any;

  const original = {
    giteFindUnique: prisma.gite.findUnique,
    factureCounterUpsert: prisma.factureCounter.upsert,
    factureCreate: prisma.facture.create,
    reservationFindUnique: prisma.reservation.findUnique,
    reservationFindMany: prisma.reservation.findMany,
    reservationCreate: prisma.reservation.create,
    reservationUpdate: prisma.reservation.update,
  };

  try {
    prisma.gite.findUnique = async () => ({
      id: "g1",
      prefixe_contrat: "GT",
      arrhes_taux_defaut: 0.2,
      regle_animaux_acceptes: true,
      regle_bois_premiere_flambee: false,
      regle_tiers_personnes_info: false,
      taxe_sejour_par_personne_par_nuit: 1.5,
      options_draps_par_lit: 12,
      options_linge_toilette_par_personne: 8,
      options_menage_forfait: 20,
      options_depart_tardif_forfait: 15,
      options_chiens_forfait: 5,
    });
    prisma.factureCounter.upsert = async () => ({ lastNumber: 1 });
    prisma.facture.create = async ({ data }: any) => ({ id: "f-overlap", ...data });
    prisma.reservation.findUnique = async () => null;
    prisma.reservation.findMany = async () => [
      {
        id: "r-existing",
        hote_nom: "Client Facture",
        date_entree: new Date("2026-07-10T00:00:00.000Z"),
        date_sortie: new Date("2026-07-15T00:00:00.000Z"),
      },
    ];

    let reservationCreateCalls = 0;
    let reservationUpdatePayload: any = null;
    prisma.reservation.create = async () => {
      reservationCreateCalls += 1;
      return { id: "r-created" };
    };
    prisma.reservation.update = async ({ where, data }: any) => {
      reservationUpdatePayload = { where, data };
      return { id: where.id };
    };

    const invoicesRouterModule = await import("../src/routes/invoices.ts");
    const invoicePost = getRouteHandler(invoicesRouterModule.default, "post", "/");

    const response = createMockResponse();
    let nextError: unknown = null;
    await invoicePost(
      {
        body: {
          gite_id: "g1",
          locataire_nom: "Client Facture",
          locataire_adresse: "Adresse",
          locataire_tel: "0611223344",
          locataire_email: "existing@example.com",
          nb_adultes: 2,
          nb_enfants_2_17: 0,
          date_debut: "2026-07-10",
          heure_arrivee: "17:00",
          date_fin: "2026-07-15",
          heure_depart: "12:00",
          prix_par_nuit: 110,
          remise_montant: 15,
          options: {
            menage: { enabled: true, declared: true },
          },
          arrhes_montant: 100,
          arrhes_date_limite: "2026-06-15",
          caution_montant: 0,
          cheque_menage_montant: 0,
          afficher_caution_phrase: false,
          afficher_cheque_menage_phrase: false,
          clauses: {},
          notes: null,
          statut_paiement: "non_reglee",
        },
        params: {},
        query: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 201);
    assert.equal((response.body as any).reservation_id, "r-existing");
    assert.equal(reservationCreateCalls, 0);
    assert.deepEqual(reservationUpdatePayload.where, { id: "r-existing" });
    assert.equal(reservationUpdatePayload.data.email, "existing@example.com");
    assert.equal(reservationUpdatePayload.data.telephone, "0611223344");
    assert.equal(reservationUpdatePayload.data.frais_optionnels_libelle, "Ménage");
    assert.equal(reservationUpdatePayload.data.frais_optionnels_declares, true);
  } finally {
    prisma.gite.findUnique = original.giteFindUnique;
    prisma.factureCounter.upsert = original.factureCounterUpsert;
    prisma.facture.create = original.factureCreate;
    prisma.reservation.findUnique = original.reservationFindUnique;
    prisma.reservation.findMany = original.reservationFindMany;
    prisma.reservation.create = original.reservationCreate;
    prisma.reservation.update = original.reservationUpdate;

    restoreEnvVar("DATA_DIR", envBackup.DATA_DIR);
    restoreEnvVar("SKIP_PDF_GENERATION", envBackup.SKIP_PDF_GENERATION);
    restoreEnvVar("BASIC_AUTH_PASSWORD", envBackup.BASIC_AUTH_PASSWORD);

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("API contrats conserve les dates de suivi lors des bascules de statuts", async () => {
  const prismaModule = await import("../src/db/prisma.ts");
  const prisma = prismaModule.default as any;

  const original = {
    contratFindUnique: prisma.contrat.findUnique,
    contratUpdate: prisma.contrat.update,
  };

  const baseContract = {
    id: "c1",
    numero_contrat: "GT-2026-000001",
    gite_id: "g1",
    date_creation: "2026-03-12T00:00:00.000Z",
    date_derniere_modif: "2026-03-13T00:00:00.000Z",
    locataire_nom: "Client Contrat",
    locataire_adresse: "Adresse",
    locataire_tel: "0700000000",
    locataire_email: "client@example.com",
    nb_adultes: 2,
    nb_enfants_2_17: 0,
    date_debut: "2026-03-08T00:00:00.000Z",
    heure_arrivee: "17:00",
    date_fin: "2026-03-13T00:00:00.000Z",
    heure_depart: "12:00",
    nb_nuits: 5,
    prix_par_nuit: 70,
    remise_montant: 0,
    taxe_sejour_calculee: 10,
    options: "{}",
    arrhes_montant: 100,
    arrhes_date_limite: "2026-02-15T00:00:00.000Z",
    solde_montant: 250,
    caution_montant: 500,
    cheque_menage_montant: 80,
    afficher_caution_phrase: true,
    afficher_cheque_menage_phrase: true,
    clauses: "{}",
    pdf_path: "test.pdf",
    date_envoi_email: null,
    statut_reception_contrat: "non_recu",
    date_reception_contrat: null,
    statut_paiement_arrhes: "non_recu",
    date_paiement_arrhes: null,
    notes: null,
    reservation_id: null,
    gite: null,
  };

  let contractState = { ...baseContract };

  try {
    prisma.contrat.findUnique = async () => ({ ...contractState });
    prisma.contrat.update = async ({ data }: any) => {
      contractState = { ...contractState, ...data };
      return { ...contractState };
    };

    const contractsRouterModule = await import("../src/routes/contracts.ts");
    const emailPatch = getRouteHandler(contractsRouterModule.default, "patch", "/:id/email-sent");
    const receptionPatch = getRouteHandler(contractsRouterModule.default, "patch", "/:id/reception");
    const arrhesPatch = getRouteHandler(contractsRouterModule.default, "patch", "/:id/arrhes");
    const trackingDatesPatch = getRouteHandler(contractsRouterModule.default, "patch", "/:id/tracking-dates");

    let nextError: unknown = null;

    const receptionOnRes = createMockResponse();
    await receptionPatch(
      { body: { statut_reception_contrat: "recu" }, params: { id: "c1" }, query: {} },
      receptionOnRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal((receptionOnRes.body as any).statut_reception_contrat, "recu");
    assert.ok((receptionOnRes.body as any).date_reception_contrat);
    const firstReceptionDate = (receptionOnRes.body as any).date_reception_contrat as Date;

    const receptionOffRes = createMockResponse();
    nextError = null;
    await receptionPatch(
      { body: { statut_reception_contrat: "non_recu" }, params: { id: "c1" }, query: {} },
      receptionOffRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal((receptionOffRes.body as any).date_reception_contrat.getTime(), firstReceptionDate.getTime());

    const emailRes = createMockResponse();
    nextError = null;
    await emailPatch(
      { body: {}, params: { id: "c1" }, query: {} },
      emailRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.ok((emailRes.body as any).date_envoi_email);

    const receptionOnAgainRes = createMockResponse();
    nextError = null;
    await receptionPatch(
      { body: { statut_reception_contrat: "recu" }, params: { id: "c1" }, query: {} },
      receptionOnAgainRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal((receptionOnAgainRes.body as any).date_reception_contrat.getTime(), firstReceptionDate.getTime());

    const arrhesOnRes = createMockResponse();
    nextError = null;
    await arrhesPatch(
      { body: { statut_paiement_arrhes: "recu" }, params: { id: "c1" }, query: {} },
      arrhesOnRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.ok((arrhesOnRes.body as any).date_paiement_arrhes);
    const firstArrhesDate = (arrhesOnRes.body as any).date_paiement_arrhes as Date;

    const arrhesOffRes = createMockResponse();
    nextError = null;
    await arrhesPatch(
      { body: { statut_paiement_arrhes: "non_recu" }, params: { id: "c1" }, query: {} },
      arrhesOffRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal((arrhesOffRes.body as any).date_paiement_arrhes.getTime(), firstArrhesDate.getTime());

    const trackingRes = createMockResponse();
    nextError = null;
    await trackingDatesPatch(
      {
        body: {
          date_reception_contrat: "2026-03-20",
          date_paiement_arrhes: "2026-03-21",
        },
        params: { id: "c1" },
        query: {},
      },
      trackingRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal((trackingRes.body as any).date_reception_contrat.toISOString(), new Date("2026-03-20").toISOString());
    assert.equal((trackingRes.body as any).date_paiement_arrhes.toISOString(), new Date("2026-03-21").toISOString());
  } finally {
    prisma.contrat.findUnique = original.contratFindUnique;
    prisma.contrat.update = original.contratUpdate;
  }
});

test("API hydrate les montants de contrat/facture en nombres", async () => {
  const prismaModule = await import("../src/db/prisma.ts");
  const prisma = prismaModule.default as any;

  const original = {
    contratFindUnique: prisma.contrat.findUnique,
    factureFindUnique: prisma.facture.findUnique,
  };

  try {
    prisma.contrat.findUnique = async () => ({
      id: "c1",
      numero_contrat: "GT-2026-000001",
      gite_id: "g1",
      date_creation: "2026-03-12T00:00:00.000Z",
      date_derniere_modif: "2026-03-13T00:00:00.000Z",
      locataire_nom: "Client Contrat",
      locataire_adresse: "Adresse",
      locataire_tel: "0700000000",
      nb_adultes: 2,
      nb_enfants_2_17: 0,
      date_debut: "2026-03-08T00:00:00.000Z",
      heure_arrivee: "17:00",
      date_fin: "2026-03-13T00:00:00.000Z",
      heure_depart: "12:00",
      nb_nuits: 5,
      prix_par_nuit: "70.00",
      remise_montant: "0.00",
      taxe_sejour_calculee: "10.00",
      options: "{}",
      arrhes_montant: "0.00",
      arrhes_date_limite: "2026-02-15T00:00:00.000Z",
      solde_montant: "350.00",
      caution_montant: "500.00",
      cheque_menage_montant: "500.00",
      afficher_caution_phrase: true,
      afficher_cheque_menage_phrase: true,
      clauses: "{}",
      pdf_path: "test.pdf",
      date_envoi_email: null,
      statut_reception_contrat: "non_recu",
      date_reception_contrat: null,
      statut_paiement_arrhes: "non_recu",
      date_paiement_arrhes: null,
      notes: null,
      reservation_id: null,
    });

    prisma.facture.findUnique = async () => ({
      id: "f1",
      numero_facture: "PH-2026-02",
      gite_id: "g1",
      date_creation: "2026-03-12T00:00:00.000Z",
      date_derniere_modif: "2026-03-13T00:00:00.000Z",
      locataire_nom: "Marie Motais",
      locataire_adresse: "Adresse",
      locataire_tel: "",
      nb_adultes: 2,
      nb_enfants_2_17: 0,
      date_debut: "2026-03-08T00:00:00.000Z",
      heure_arrivee: "17:00",
      date_fin: "2026-03-13T00:00:00.000Z",
      heure_depart: "12:00",
      nb_nuits: 5,
      prix_par_nuit: "70.00",
      remise_montant: "0.00",
      taxe_sejour_calculee: "10.00",
      options: "{}",
      arrhes_montant: "0.00",
      arrhes_date_limite: "2026-02-15T00:00:00.000Z",
      solde_montant: "350.00",
      caution_montant: "0.00",
      cheque_menage_montant: "0.00",
      afficher_caution_phrase: false,
      afficher_cheque_menage_phrase: false,
      clauses: "{}",
      pdf_path: "test.pdf",
      statut_paiement: "non_reglee",
      notes: null,
      reservation_id: null,
    });

    const contractsRouterModule = await import("../src/routes/contracts.ts");
    const invoicesRouterModule = await import("../src/routes/invoices.ts");

    const contractGet = getRouteHandler(contractsRouterModule.default, "get", "/:id");
    const invoiceGet = getRouteHandler(invoicesRouterModule.default, "get", "/:id");

    const contractRes = createMockResponse();
    let nextError: unknown = null;
    await contractGet(
      { body: {}, params: { id: "c1" }, query: {} },
      contractRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal(contractRes.statusCode, 200);
    assert.equal(typeof (contractRes.body as any).solde_montant, "number");
    assert.equal(typeof (contractRes.body as any).arrhes_montant, "number");
    assert.equal((contractRes.body as any).solde_montant + (contractRes.body as any).arrhes_montant, 350);

    const invoiceRes = createMockResponse();
    nextError = null;
    await invoiceGet(
      { body: {}, params: { id: "f1" }, query: {} },
      invoiceRes,
      (err) => {
        nextError = err ?? null;
      }
    );
    assert.equal(nextError, null);
    assert.equal(invoiceRes.statusCode, 200);
    assert.equal(typeof (invoiceRes.body as any).solde_montant, "number");
    assert.equal(typeof (invoiceRes.body as any).arrhes_montant, "number");
    assert.equal((invoiceRes.body as any).solde_montant + (invoiceRes.body as any).arrhes_montant, 350);
  } finally {
    prisma.contrat.findUnique = original.contratFindUnique;
    prisma.facture.findUnique = original.factureFindUnique;
  }
});

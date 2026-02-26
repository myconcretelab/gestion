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

const getRouteHandler = (router: any, method: "post" | "put", routePath: string) => {
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

    prisma.gite.findUnique = async () => mockedGite;
    prisma.contratCounter.upsert = async () => ({ lastNumber: 1 });
    prisma.factureCounter.upsert = async () => ({ lastNumber: 1 });
    prisma.contrat.create = async ({ data }: any) => ({ id: "c1", ...data });
    prisma.contrat.findUnique = async () => ({
      id: "c1",
      numero_contrat: "GT-2026-000001",
      arrhes_montant: 100,
    });
    prisma.contrat.update = async ({ data }: any) => ({ id: "c1", numero_contrat: "GT-2026-000001", ...data });
    prisma.facture.create = async ({ data }: any) => ({ id: "f1", ...data });
    prisma.facture.findUnique = async () => ({
      id: "f1",
      numero_facture: "GT-2026-01",
      arrhes_montant: 100,
    });
    prisma.facture.update = async ({ data }: any) => ({ id: "f1", numero_facture: "GT-2026-01", ...data });

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
    assert.equal(Number((updateContractRes.body as any).solde_montant), 332);

    const invoicePayload = {
      gite_id: "g1",
      locataire_nom: "Client Facture",
      locataire_adresse: "Adresse",
      locataire_tel: "0700000001",
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
    assert.equal(Number((updateInvoiceRes.body as any).solde_montant), 332);
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

    restoreEnvVar("DATA_DIR", envBackup.DATA_DIR);
    restoreEnvVar("SKIP_PDF_GENERATION", envBackup.SKIP_PDF_GENERATION);
    restoreEnvVar("BASIC_AUTH_PASSWORD", envBackup.BASIC_AUTH_PASSWORD);

    await rm(tempDir, { recursive: true, force: true });
  }
});

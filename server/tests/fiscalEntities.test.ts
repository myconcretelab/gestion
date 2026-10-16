import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-fiscal-test-"));
const serverRoot = path.resolve(
  process.cwd().endsWith(`${path.sep}server`)
    ? process.cwd()
    : path.join(process.cwd(), "server"),
);
const databaseUrl = `file:${path.join(temp, "test.db")}`;
const orgA = "org_fiscal_test_a";
const orgB = "org_fiscal_test_b";
let database: typeof import("../src/db/prisma.js");
let server: Server;
let origin: string;
let priorGite: Record<string, unknown>;
let priorInvoice: Record<string, unknown>;
let priorCounter: Record<string, unknown>;

const gitePayload = {
  nom: "Gîte conservé",
  prefixe_contrat: "OLD",
  adresse_ligne1: "1 rue Exemple",
  capacite_max: 2,
  nb_adultes_max: 2,
  nb_adultes_habituel: 2,
  proprietaires_noms: "Propriétaire historique",
  proprietaires_adresse: "Adresse historique",
  telephones: [],
  taxe_sejour_par_personne_par_nuit: 0.7,
  iban: "FR761234",
  titulaire: "Propriétaire historique",
};

const migrate = (schema: string) => {
  const result = spawnSync(
    process.execPath,
    ["scripts/prisma.mjs", "migrate", "deploy", "--schema", schema],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_URL_SQLITE: databaseUrl,
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
};
const request = async (
  url: string,
  method = "GET",
  body?: unknown,
  organizationId = orgA,
) => {
  const response = await fetch(`${origin}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-org": organizationId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL_SQLITE = databaseUrl;
  process.env.DATA_DIR = path.join(temp, "data");
  fs.writeFileSync(path.join(temp, "test.db"), "");
  const oldSchema = path.join(temp, "prisma", "schema.prisma");
  fs.mkdirSync(path.dirname(oldSchema), { recursive: true });
  fs.copyFileSync(
    path.join(serverRoot, "prisma", "schema.sqlite.prisma"),
    oldSchema,
  );
  fs.cpSync(
    path.join(serverRoot, "prisma", "migrations"),
    path.join(temp, "prisma", "migrations"),
    {
      recursive: true,
      filter: (file) =>
        !file.includes("20261016100000_fiscal_entities") &&
        !file.includes("20261016120000_invoice_lifecycle") &&
        !file.includes("20261016150000_invoice_fiscal_data") &&
        !file.includes("20261016170000_superpdp_oauth") &&
        !file.includes("20261016190000_superpdp_emission"),
    },
  );
  migrate(oldSchema);
  database = await import("../src/db/prisma.js");
  const db = database.systemPrisma;
  await db.gestionnaire.createMany({
    data: [
      {
        id: "manager-a",
        prenom: "Marie",
        nom: "Exemple",
        organization_id: orgA,
      },
      {
        id: "manager-b",
        prenom: "Jean",
        nom: "Exemple",
        organization_id: orgB,
      },
    ],
  });
  await db.gite.create({
    data: {
      ...gitePayload,
      telephones: "[]",
      id: "gite-old",
      organization_id: orgA,
    },
    select: { id: true },
  });
  const historicalInvoiceData = {
    id: "invoice-old",
    organization_id: orgA,
    numero_facture: "OLD-2026-001",
    gite_id: "gite-old",
    locataire_nom: "Client historique",
    locataire_adresse: "Adresse client",
    locataire_tel: "0102030405",
    nb_adultes: 2,
    nb_enfants_2_17: 0,
    date_debut: new Date("2026-10-01"),
    date_fin: new Date("2026-10-04"),
    heure_arrivee: "17:00",
    heure_depart: "12:00",
    nb_nuits: 3,
    prix_par_nuit: 100,
    options: "{}",
    arrhes_montant: 60,
    arrhes_date_limite: new Date("2026-09-01"),
    solde_montant: 240,
    caution_montant: 300,
    cheque_menage_montant: 0,
    clauses: "[]",
    pdf_path: "pdfs/2026/10/historical.pdf",
  };
  const historicalRow = {
    ...historicalInvoiceData,
    date_derniere_modif: new Date(),
  };
  const columns = Object.keys(historicalRow);
  await db.$executeRawUnsafe(
    `INSERT INTO "factures" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...Object.values(historicalRow),
  );
  await db.factureCounter.create({
    data: {
      id: "counter-old",
      organization_id: orgA,
      giteId: "gite-old",
      year: 2026,
      lastNumber: 7,
    },
  });
  [priorGite] = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT * FROM "gites" WHERE "id" = \'gite-old\'',
  );
  [priorInvoice] = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT * FROM "factures" WHERE "id" = \'invoice-old\'',
  );
  [priorCounter] = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT * FROM "facture_counters" WHERE "id" = \'counter-old\'',
  );
  await db.$disconnect();
  migrate(path.join(serverRoot, "prisma", "schema.sqlite.prisma"));

  const { runWithOrganization } =
    await import("../src/modules/organizations/context.js");
  const { default: fiscalRouter } =
    await import("../src/modules/fiscal/routes.js");
  const { default: gitesRouter } = await import("../src/routes/gites.js");
  const { default: managersRouter } = await import("../src/routes/managers.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) =>
    runWithOrganization(
      {
        organizationId: String(req.headers["x-test-org"] || orgA),
        source: "test",
      },
      next,
    ),
  );
  app.use("/fiscal-entities", fiscalRouter);
  app.use("/gites", gitesRouter);
  app.use("/managers", managersRouter);
  app.use(((error, _req, res, _next) => {
    res
      .status(error.name === "ZodError" ? 400 : (error.status ?? 500))
      .json({ error: error.message });
  }) as express.ErrorRequestHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (database) await database.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("la migration conserve les propriétaires, factures, PDF référencés et compteurs", async () => {
  const db = database.systemPrisma;
  const [gite] = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT * FROM "gites" WHERE "id" = \'gite-old\'',
  );
  const { fiscal_establishment_id, ...existing } = gite;
  assert.equal(fiscal_establishment_id, null);
  assert.deepEqual(existing, priorGite);
  const [migratedInvoice] = await db.$queryRawUnsafe<
    Array<Record<string, unknown>>
  >('SELECT * FROM "factures" WHERE "id" = \'invoice-old\'');
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(priorInvoice).map((key) => [key, migratedInvoice[key]]),
    ),
    priorInvoice,
  );
  assert.equal(migratedInvoice.lifecycle_status, "legacy");
  assert.equal(migratedInvoice.fiscal_data, null);
  assert.equal(migratedInvoice.issued_at, null);
  assert.deepEqual(
    (
      await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'SELECT * FROM "facture_counters" WHERE "id" = \'counter-old\'',
      )
    )[0],
    priorCounter,
  );
  assert.equal(await db.fiscalEntity.count(), 0);
  assert.equal(await db.fiscalEstablishment.count(), 0);
  assert.deepEqual(await db.$queryRawUnsafe("PRAGMA foreign_key_check"), []);
  const inventory = await request("/fiscal-entities/inventory");
  assert.deepEqual(inventory.body.gites[0].missing_fields, [
    "Établissement facturant",
  ]);
});

test("plusieurs entreprises et établissements par gestionnaire, avec rattachement et inventaire", async () => {
  const entityPayload = {
    legal_name: "Entreprise A",
    gestionnaire_id: "manager-a",
    siren: "732 829 320",
    vat_regime: "franchise_en_base",
    address_line1: "1 rue Exemple",
    postal_code: "35000",
    city: "Rennes",
  };
  const entity = await request("/fiscal-entities", "POST", entityPayload);
  assert.equal(entity.status, 201);
  assert.equal(entity.body.siren, "732829320");
  const second = await request("/fiscal-entities", "POST", {
    legal_name: "Entreprise B",
    gestionnaire_id: "manager-a",
    siren: "123456789",
  });
  assert.equal(second.status, 201);
  assert.equal((await request("/managers/manager-a", "DELETE")).status, 409);
  const base = `/fiscal-entities/${entity.body.id}`;
  assert.equal(
    (await request("/fiscal-entities", "POST", entityPayload)).status,
    409,
  );
  assert.equal(
    (
      await request(`${base}/establishments`, "POST", {
        name: "Erreur",
        siret: "12345678900001",
      })
    ).status,
    400,
  );
  const establishment = await request(`${base}/establishments`, "POST", {
    name: "Siège",
    siret: "73282932000074",
  });
  assert.equal(establishment.status, 201);
  assert.equal(
    (
      await request(`${base}/establishments`, "POST", {
        name: "Annexe",
        siret: "73282932000108",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(`${base}/establishments`, "POST", {
        name: "Doublon",
        siret: "73282932000074",
      })
    ).status,
    409,
  );
  assert.equal(
    (await request(base, "PUT", { ...entityPayload, siren: "123456789" }))
      .status,
    409,
  );
  assert.equal(
    (
      await request(base, "PUT", {
        ...entityPayload,
        legal_name: "Entreprise A modifiée",
      })
    ).status,
    200,
  );
  const establishmentPath = `${base}/establishments/${establishment.body.id}`;
  assert.equal(
    (
      await request(establishmentPath, "PUT", {
        name: "Siège modifié",
        siret: "73282932000074",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/fiscal-entities/${second.body.id}/establishments/${establishment.body.id}`,
        "PUT",
        { name: "Mauvais parent" },
      )
    ).status,
    404,
  );
  const gite = await request("/gites/gite-old", "PUT", {
    ...gitePayload,
    fiscal_establishment_id: establishment.body.id,
  });
  assert.equal(gite.status, 200);
  // Older clients and older exports omit the new property: preserve an existing link.
  assert.equal(
    (await request("/gites/gite-old", "PUT", gitePayload)).status,
    200,
  );
  assert.equal(
    (
      await database.systemPrisma.gite.findUniqueOrThrow({
        where: { id: "gite-old" },
      })
    ).fiscal_establishment_id,
    establishment.body.id,
  );
  const inventory = await request("/fiscal-entities/inventory");
  assert.deepEqual(inventory.body.gites[0].missing_fields, []);
  assert.equal(inventory.body.managers[0]._count.fiscal_entities, 2);
  const options = await request("/gites/fiscal-establishments");
  assert.equal(options.body.length, 2);
  assert.equal(
    options.body[0].fiscal_entity.legal_name,
    "Entreprise A modifiée",
  );
  assert.equal(
    (
      await request("/gites/import", "POST", {
        gites: [{ ...gitePayload, id: "gite-old" }],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await database.systemPrisma.gite.findUniqueOrThrow({
        where: { id: "gite-old" },
      })
    ).fiscal_establishment_id,
    establishment.body.id,
  );
  assert.equal(
    (
      await request("/gites/gite-old", "PUT", {
        ...gitePayload,
        fiscal_establishment_id: null,
      })
    ).status,
    200,
  );
});

test("l’isolation est vérifiée par les API et les clés étrangères composites", async () => {
  const entity = await request("/fiscal-entities", "POST", {
    legal_name: "Privée A",
    siren: "111111111",
    gestionnaire_id: "manager-a",
  });
  const establishment = await request(
    `/fiscal-entities/${entity.body.id}/establishments`,
    "POST",
    { name: "Privé A", siret: "11111111100001" },
  );
  assert.equal(
    (
      await request(
        "/fiscal-entities",
        "POST",
        {
          legal_name: "Même SIREN autre compte",
          siren: "111111111",
          gestionnaire_id: "manager-b",
        },
        orgB,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await request(
        "/fiscal-entities",
        "POST",
        { legal_name: "Contact autre compte", gestionnaire_id: "manager-a" },
        orgB,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/fiscal-entities/${entity.body.id}`,
        "PUT",
        { legal_name: "Volée" },
        orgB,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/fiscal-entities/${entity.body.id}/establishments`,
        "POST",
        { name: "Volé" },
        orgB,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/fiscal-entities/${entity.body.id}/establishments/${establishment.body.id}`,
        "PUT",
        { name: "Volé" },
        orgB,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/gites",
        "POST",
        { ...gitePayload, fiscal_establishment_id: establishment.body.id },
        orgB,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/gites/import",
        "POST",
        {
          gites: [
            { ...gitePayload, fiscal_establishment_id: establishment.body.id },
          ],
        },
        orgB,
      )
    ).status,
    400,
  );
  const otherEntities = await request(
    "/fiscal-entities",
    "GET",
    undefined,
    orgB,
  );
  assert.equal(otherEntities.body.length, 1);
  assert.equal(
    (await request("/gites/fiscal-establishments", "GET", undefined, orgB)).body
      .length,
    0,
  );
  const tenantB = database.getTenantPrisma(orgB);
  await assert.rejects(
    () =>
      tenantB.fiscalEstablishment.create({
        data: { name: "Foreign entity", fiscal_entity_id: entity.body.id },
      }),
    { code: "P2003" },
  );
  await assert.rejects(
    () =>
      tenantB.fiscalEntity.create({
        data: { legal_name: "Foreign manager", gestionnaire_id: "manager-a" },
      }),
    { code: "P2003" },
  );
  await assert.rejects(
    () =>
      tenantB.gite.create({
        data: {
          ...gitePayload,
          telephones: "[]",
          fiscal_establishment_id: establishment.body.id,
        },
      }),
    { code: "P2003" },
  );
});

import assert from "node:assert/strict";
import { before, after, test, type TestContext } from "node:test";
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
      filter: (file) => {
        const migration = path
          .relative(path.join(serverRoot, "prisma", "migrations"), file)
          .split(path.sep)[0];
        // Freeze the pre-fiscal baseline, including when later dependent migrations are added.
        return (
          !/^\d{14}_/.test(migration) ||
          migration < "20261016100000_fiscal_entities"
        );
      },
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

let linkFixtureIndex = 0;
const linkFixture = async (t: TestContext) => {
  const index = ++linkFixtureIndex;
  const siren = `8${String(index).padStart(8, "0")}`;
  const entity = await request("/fiscal-entities", "POST", {
    legal_name: `Test rattachement ${index}`,
    siren,
  });
  assert.equal(entity.status, 201);
  const ids = [`link-${index}-a`, `link-${index}-b`];
  t.after(async () => {
    await database.systemPrisma.gite.deleteMany({ where: { id: { in: ids } } });
    await database.systemPrisma.fiscalEstablishment.deleteMany({
      where: { fiscal_entity_id: entity.body.id },
    });
    await database.systemPrisma.fiscalEntity.delete({
      where: { id: entity.body.id },
    });
  });
  for (const id of ids)
    await database.systemPrisma.gite.create({
      data: {
        ...gitePayload,
        id,
        organization_id: orgA,
        nom: id,
        prefixe_contrat: id,
        telephones: "[]",
      },
    });
  return {
    base: `/fiscal-entities/${entity.body.id}`,
    entityId: entity.body.id,
    ids,
    siret: `${siren}00001`,
  };
};
const attach = (
  id: string,
  expected: string | null = null,
  confirmed = false,
) => ({
  gite_id: id,
  expected_establishment_id: expected,
  attach: true,
  confirm_reassignment: confirmed,
});

test("l’établissement et plusieurs gîtes sont enregistrés ensemble, sans dupliquer les gîtes", async (t) => {
  const fixture = await linkFixture(t);
  const prior = await database.systemPrisma.facture.findUniqueOrThrow({
    where: { id: "invoice-old" },
  });
  const created = await request(`${fixture.base}/establishments`, "POST", {
    name: "Gîtes existants",
    siret: fixture.siret,
    gite_links: fixture.ids.map((id) => attach(id)),
  });
  assert.equal(created.status, 201);
  const rows = await database.systemPrisma.gite.findMany({
    where: { id: { in: fixture.ids } },
  });
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((row) => row.fiscal_establishment_id === created.body.id),
  );
  const inventory = await request("/fiscal-entities/inventory");
  const gite = inventory.body.gites.find(
    (item: { id: string }) => item.id === fixture.ids[0],
  );
  assert.equal(gite.adresse_ligne1, gitePayload.adresse_ligne1);
  assert.equal(gite.fiscal_establishment.siret, fixture.siret);
  const removed = await request(
    `${fixture.base}/establishments/${created.body.id}`,
    "PUT",
    {
      name: "Un gîte conservé",
      siret: fixture.siret,
      expected_updated_at: created.body.updatedAt,
      gite_links: [
        { ...attach(fixture.ids[0], created.body.id), attach: false },
      ],
    },
  );
  assert.equal(removed.status, 200);
  assert.equal(
    (
      await database.systemPrisma.gite.findUniqueOrThrow({
        where: { id: fixture.ids[0] },
      })
    ).fiscal_establishment_id,
    null,
  );
  assert.equal(
    (
      await database.systemPrisma.gite.findUniqueOrThrow({
        where: { id: fixture.ids[1] },
      })
    ).fiscal_establishment_id,
    created.body.id,
  );
  assert.deepEqual(
    await database.systemPrisma.facture.findUniqueOrThrow({
      where: { id: "invoice-old" },
    }),
    prior,
  );
  const staleGiteSave = await request(`/gites/${fixture.ids[1]}`, "PUT", {
    ...gitePayload,
    fiscal_establishment_id: null,
    expected_fiscal_establishment_id: null,
  });
  assert.equal(staleGiteSave.status, 409);
  assert.equal(
    (
      await database.systemPrisma.gite.findUniqueOrThrow({
        where: { id: fixture.ids[1] },
      })
    ).fiscal_establishment_id,
    created.body.id,
  );
});

test("une sélection périmée ou inaccessible annule tout, y compris la création de l’établissement", async (t) => {
  const fixture = await linkFixture(t);
  const count = await database.systemPrisma.fiscalEstablishment.count();
  for (const [link, expectedStatus] of [
    [attach(fixture.ids[1], "stale"), 409],
    [attach("missing-gite"), 404],
  ] as const) {
    const result = await request(`${fixture.base}/establishments`, "POST", {
      name: "Ne pas créer",
      siret: fixture.siret,
      gite_links: [attach(fixture.ids[0]), link],
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(
      await database.systemPrisma.fiscalEstablishment.count(),
      count,
    );
    assert.equal(
      (
        await database.systemPrisma.gite.findUniqueOrThrow({
          where: { id: fixture.ids[0] },
        })
      ).fiscal_establishment_id,
      null,
    );
  }
  const duplicate = await request(`${fixture.base}/establishments`, "POST", {
    name: "Doublon",
    gite_links: [attach(fixture.ids[0]), attach(fixture.ids[0])],
  });
  assert.equal(duplicate.status, 400);
  await database.systemPrisma.gite.create({
    data: {
      ...gitePayload,
      id: "foreign-link-gite",
      organization_id: orgB,
      telephones: "[]",
    },
  });
  t.after(async () => {
    await database.systemPrisma.gite.delete({
      where: { id: "foreign-link-gite" },
    });
  });
  const foreign = await request(`${fixture.base}/establishments`, "POST", {
    name: "Autre compte",
    gite_links: [attach(fixture.ids[0]), attach("foreign-link-gite")],
  });
  assert.equal(foreign.status, 404);
  assert.equal(await database.systemPrisma.fiscalEstablishment.count(), count);
});

test("un changement d’établissement demande confirmation et les modifications concurrentes sont refusées", async (t) => {
  const fixture = await linkFixture(t);
  const first = await request(`${fixture.base}/establishments`, "POST", {
    name: "Premier",
    siret: fixture.siret,
    gite_links: [attach(fixture.ids[0])],
  });
  assert.equal(first.status, 201);
  const nextFixture = await linkFixture(t);
  const path = `${nextFixture.base}/establishments`;
  const refused = await request(path, "POST", {
    name: "Deuxième",
    gite_links: [attach(fixture.ids[0], first.body.id)],
  });
  assert.equal(refused.status, 409);
  const changed = await request(path, "POST", {
    name: "Deuxième",
    gite_links: [attach(fixture.ids[0], first.body.id, true)],
  });
  assert.equal(changed.status, 201);
  const failedUpdate = await request(`${path}/${changed.body.id}`, "PUT", {
    name: "Ne pas garder",
    gite_links: [attach(fixture.ids[1]), attach("missing-gite")],
  });
  assert.equal(failedUpdate.status, 404);
  assert.equal(
    (
      await database.systemPrisma.fiscalEstablishment.findUniqueOrThrow({
        where: { id: changed.body.id },
      })
    ).name,
    "Deuxième",
  );
  assert.equal(
    (
      await database.systemPrisma.gite.findUniqueOrThrow({
        where: { id: fixture.ids[1] },
      })
    ).fiscal_establishment_id,
    null,
  );
  const foreignDetach = await request(
    `${fixture.base}/establishments/${first.body.id}`,
    "PUT",
    {
      name: "Premier",
      siret: fixture.siret,
      gite_links: [
        { ...attach(fixture.ids[0], changed.body.id), attach: false },
      ],
    },
  );
  assert.equal(foreignDetach.status, 409);
  const stale = await request(`${path}/${changed.body.id}`, "PUT", {
    name: "Écrasement",
    expected_updated_at: "2000-01-01T00:00:00.000Z",
    gite_links: [attach(fixture.ids[1])],
  });
  assert.equal(stale.status, 409);
  assert.equal(
    (
      await database.systemPrisma.fiscalEstablishment.findUniqueOrThrow({
        where: { id: changed.body.id },
      })
    ).name,
    "Deuxième",
  );
  const invalidIdentity = await request(`${path}/${changed.body.id}`, "PUT", {
    name: "Identité erronée",
    siret: fixture.siret,
    gite_links: [attach(fixture.ids[1])],
  });
  assert.equal(invalidIdentity.status, 400);
  assert.equal(
    (
      await database.systemPrisma.gite.findUniqueOrThrow({
        where: { id: fixture.ids[1] },
      })
    ).fiscal_establishment_id,
    null,
  );
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

test("un même compte gère quatre gîtes et deux émetteurs sans confondre contact et entreprise facturante", async () => {
  // Synthetic identities live only in this test's temporary database, never in localhost.
  const secondManagerId = "manager-shared-account";
  await database.systemPrisma.gestionnaire.create({
    data: {
      id: secondManagerId,
      organization_id: orgA,
      prenom: "Contact",
      nom: "Fictif",
    },
  });
  const companies: Array<{
    id: string;
    establishmentId: string;
    name: string;
  }> = [];
  for (const [index, managerId] of ["manager-a", secondManagerId].entries()) {
    const siren = index === 0 ? "222222222" : "333333333";
    const name = `Émetteur fictif ${index + 1}`;
    const entity = await request("/fiscal-entities", "POST", {
      legal_name: name,
      gestionnaire_id: managerId,
      siren,
      vat_regime: "franchise_en_base",
      address_line1: "1 rue Exemple",
      postal_code: "35000",
      city: "Rennes",
    });
    assert.equal(entity.status, 201);
    const establishment = await request(
      `/fiscal-entities/${entity.body.id}/establishments`,
      "POST",
      { name: `Siège fictif ${index + 1}`, siret: `${siren}00001` },
    );
    assert.equal(establishment.status, 201);
    companies.push({
      id: entity.body.id,
      establishmentId: establishment.body.id,
      name,
    });
  }

  const gites: Array<{
    id: string;
    companyIndex: number;
    payload: Record<string, unknown>;
  }> = [];
  for (let index = 0; index < 4; index++) {
    const companyIndex = index < 2 ? 0 : 1;
    const payload = {
      ...gitePayload,
      nom: `Gîte fictif partagé ${index + 1}`,
      prefixe_contrat: `SHARED${index + 1}`,
      // A common contact for all four gîtes must not make them share one issuer.
      gestionnaire_id: "manager-a",
      fiscal_establishment_id: companies[companyIndex].establishmentId,
    };
    const created = await request("/gites", "POST", payload);
    assert.equal(created.status, 201);
    gites.push({ id: created.body.id, companyIndex, payload });
  }

  const updated = await request(`/gites/${gites[0].id}`, "PUT", {
    ...gites[0].payload,
    gestionnaire_id: secondManagerId,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.gestionnaire_id, secondManagerId);
  assert.equal(
    updated.body.fiscal_establishment_id,
    companies[0].establishmentId,
  );

  const listed = await request("/fiscal-entities");
  assert.equal(listed.status, 200);
  for (const [index, company] of companies.entries()) {
    const actual = listed.body.find(
      (item: { id: string }) => item.id === company.id,
    );
    assert.ok(actual);
    assert.deepEqual(
      actual.establishments
        .flatMap((item: { gites: Array<{ id: string }> }) =>
          item.gites.map((gite) => gite.id),
        )
        .sort(),
      gites
        .filter((gite) => gite.companyIndex === index)
        .map((gite) => gite.id)
        .sort(),
    );
  }
  const inventory = await request("/fiscal-entities/inventory");
  assert.equal(inventory.status, 200);
  for (const gite of gites) {
    const actual = inventory.body.gites.find(
      (item: { id: string }) => item.id === gite.id,
    );
    assert.equal(
      actual.fiscal_establishment_id,
      companies[gite.companyIndex].establishmentId,
    );
    assert.equal(
      actual.fiscal_establishment.fiscal_entity.legal_name,
      companies[gite.companyIndex].name,
    );
    assert.deepEqual(actual.missing_fields, []);
  }
  const foreignInventory = await request(
    "/fiscal-entities/inventory",
    "GET",
    undefined,
    orgB,
  );
  assert.ok(
    foreignInventory.body.gites.every(
      (item: { id: string }) => !gites.some((gite) => gite.id === item.id),
    ),
  );
  assert.deepEqual(
    await database.systemPrisma.$queryRawUnsafe("PRAGMA foreign_key_check"),
    [],
  );
});

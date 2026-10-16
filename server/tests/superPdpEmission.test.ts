import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "contrats-superpdp-emission-"),
);
const root = path.resolve(
  process.cwd().endsWith(`${path.sep}server`)
    ? process.cwd()
    : path.join(process.cwd(), "server"),
);
const postgresUrl = process.env.TEST_EMISSION_POSTGRES_URL;
const databaseUrl = postgresUrl ?? `file:${path.join(temp, "test.db")}`;
const orgA = "org_emission_a",
  orgB = "org_emission_b";
const companyId = "9007199254740993123";
const publicOrigin = "http://localhost:5173";
let db: typeof import("../src/db/prisma.js");
let runtime: typeof import("../src/config/env.js");
let service: InstanceType<
  typeof import("../src/modules/superpdp/emission.js").SuperPdpEmission
>;
let runWithOrganization: typeof import("../src/modules/organizations/context.js").runWithOrganization;
let server: Server,
  origin: string,
  cookieA: string,
  cookieB: string,
  cookieWorker: string;
const within = <T>(work: () => T, org = orgA) =>
  runWithOrganization({ organizationId: org, source: "test" }, work);
const convertedPdf = Buffer.from(
  "%PDF-1.7\nSIMULATED FACTUR-X FOR CONTRACT TESTS ONLY\n%%EOF",
);
const calls: string[] = [];
const remoteInvoices = new Map<
  string,
  {
    id: string;
    company_id: string;
    external_id: string;
    direction: "out";
    processing_rule: string;
  }
>();
let serial = 0,
  mode = "ok",
  sendCount = 0,
  eventsMode = "normal";
let remoteEvents: Array<{
  id: string;
  invoice_id: string;
  status_code: string;
  created_at: string;
  status_text: string;
  details?: Array<{ reason: string }>;
}> = [];
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.superpdp.tech");
  assert.equal(init?.redirect, "error");
  calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === "/v1.beta/oauth2_sessions/me")
    return json({
      client_id: "fake-client",
      company_verification_status: "verified",
    });
  if (url.pathname === "/v1.beta/companies/me")
    return json({
      id: companyId,
      env: mode === "production" ? "production" : "sandbox",
      number_scheme: "sandbox",
      number: "fake-company-a",
      formal_name: "Entreprise fictive A",
    });
  if (url.pathname === "/v1.beta/directory_entries")
    return json({
      data: [
        {
          company: { id: companyId },
          identifier:
            mode === "wrong-address" ? "9999:other-seller" : "9999:fake-seller",
          status: "created",
        },
      ],
    });
  if (url.pathname === "/oauth2/revoke") return json({});
  if (url.pathname === "/v1.beta/invoices/convert") {
    assert.equal(init?.method, "POST");
    assert.equal(url.searchParams.get("from"), "json");
    assert.equal(url.searchParams.get("to"), "factur-x");
    assert.equal(
      new Headers(init?.headers).has("authorization"),
      false,
      "Public converter never needs the OAuth token",
    );
    const form = init?.body as FormData;
    const candidate = JSON.parse(await (form.get("invoice") as Blob).text());
    assert.equal(
      candidate.process_control.specification_identifier,
      "urn:cen.eu:en16931:2017",
    );
    assert.equal(candidate.seller.electronic_address.value, "fake-seller");
    assert.match(
      await (form.get("pdf") as Blob).text(),
      /ORIGINAL FICTITIOUS INVOICE/,
    );
    if (mode === "convert-error")
      return json({ error: "private-remote-error-must-not-leak" }, 500);
    return new Response(convertedPdf, {
      headers: { "content-type": "application/pdf" },
    });
  }
  if (url.pathname === "/v1.beta/validation_reports") {
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    const file = (init?.body as FormData).get("file") as Blob;
    assert.equal(file.size, convertedPdf.length);
    if (mode === "empty-validation") return json({ data: [] });
    return json({
      data: [
        {
          file_name: "invoice.pdf",
          file_size: file.size,
          is_valid: mode !== "invalid",
          duration: 12,
          format: "Factur-X",
          conformance_level: "EN16931",
          subreports: [
            {
              validator: "TestSchematron",
              checks_count: 10,
              failures:
                mode === "invalid"
                  ? [
                      {
                        message: "BT-49 à vérifier",
                        raw: "raw discarded",
                        location: "/buyer",
                      },
                    ]
                  : [],
              messages: [],
            },
          ],
        },
      ],
    });
  }
  if (url.pathname === "/v1.beta/invoices" && init?.method === "POST") {
    ++sendCount;
    assert.equal(url.searchParams.get("processing_rule"), "B2B");
    assert.equal(url.searchParams.has("disable_pre_check"), false);
    assert.equal(
      new Headers(init.headers).get("content-type"),
      "application/pdf",
    );
    assert.deepEqual(Buffer.from(init.body as Uint8Array), convertedPdf);
    const externalId = url.searchParams.get("external_id")!;
    assert.equal(externalId.length, 36);
    const remote = {
      id: String(9007199254740993000n + BigInt(++serial)),
      company_id: companyId,
      direction: "out" as const,
      external_id: externalId,
      processing_rule: "B2B",
    };
    remoteInvoices.set(remote.id, remote);
    if (mode === "lost-send")
      throw new Error(
        "private-remote-error-must-not-leak: response lost after acceptance",
      );
    if (mode === "http-send")
      return json({ error: "private-remote-error-must-not-leak" }, 500);
    // Numeric wire identifiers deliberately exceed JavaScript's safe integer range.
    return new Response(
      JSON.stringify(remote)
        .replace(`"${remote.id}"`, remote.id)
        .replace(`"${companyId}"`, companyId),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (url.pathname === "/v1.beta/invoices") {
    assert.equal(url.searchParams.get("direction"), "out");
    if (mode === "unfindable") return json({ data: [], has_after: false });
    const cursor = url.searchParams.get("starting_after_id");
    const rows = [...remoteInvoices.values()].filter(
      (row) => !cursor || BigInt(row.id) > BigInt(cursor),
    );
    return json({ data: rows.slice(0, 100), has_after: rows.length > 100 });
  }
  if (/^\/v1.beta\/invoices\/\d+$/.test(url.pathname))
    return json(remoteInvoices.get(url.pathname.split("/").at(-1)!) ?? {});
  if (url.pathname === "/v1.beta/invoice_events") {
    const cursor = url.searchParams.get("starting_after_id");
    const rows = remoteEvents.filter(
      (event) =>
        event.invoice_id === url.searchParams.get("invoice_id") &&
        (!cursor || BigInt(event.id) > BigInt(cursor)),
    );
    if (eventsMode === "wrong-invoice")
      return json({
        data: [
          {
            id: "99",
            invoice_id: "123",
            created_at: new Date().toISOString(),
            status_code: "api:sent",
            status_text: "Unexpected invoice",
          },
        ],
        has_after: false,
      });
    return json({ data: rows.slice(0, 100), has_after: rows.length > 100 });
  }
  throw new Error(
    `Unexpected endpoint ${url.pathname}; no B2C, payments, reception, or directory mutation allowed`,
  );
};
const request = async (
  id: string,
  action = "",
  body?: unknown,
  cookie = cookieA,
  withOrigin = true,
) => {
  const response = await fetch(
    `${origin}/api/invoices/${id}/electronic${action ? `/${action}` : ""}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        ...(withOrigin ? { origin: publicOrigin } : {}),
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return {
    status: response.status,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
  };
};
const actor = { userId: "emission-owner-a", sessionHash: "unit-test-service" };
const input = {
  revision: 0,
  seller_address: "9999:fake-seller",
  buyer_address: "9999:fake-buyer",
  confirm_test_data: true,
};
const newInvoice = async (overrides: Record<string, unknown> = {}) => {
  mode = "ok";
  eventsMode = "normal";
  const id = `invoice-${++serial}`;
  const { buildStructuredInvoice } =
    await import("../src/modules/documents/invoiceFiscal.js");
  const { emptyInvoiceFiscalInput } = await import("@contrats/shared");
  const entity = await db.systemPrisma.fiscalEntity.findUniqueOrThrow({
    where: { id: "entity-a" },
  });
  const establishment =
    await db.systemPrisma.fiscalEstablishment.findUniqueOrThrow({
      where: { id: "establishment-a" },
    });
  const fiscal = emptyInvoiceFiscalInput();
  Object.assign(fiscal.buyer, {
    kind: "business",
    siren: "552100554",
    country_code: "FR",
    address_line1: "2 rue fictive",
    postal_code: "35000",
    city: "Rennes",
  });
  fiscal.lines = [
    {
      id: "1",
      label: "Séjour fictif",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 120,
      vat_category: "S",
      vat_rate: 20,
      exemption_reason: "",
    },
  ];
  const structured = buildStructuredInvoice({
    input: fiscal,
    issuer: { entity, establishment },
    number: `F-2026-732829320-${serial}`,
    issuedAt: new Date("2026-10-16T08:00:00Z"),
    buyerName: "Client fictif",
    credit: false,
    periodStart: new Date("2026-10-01"),
    periodEnd: new Date("2026-10-02"),
  });
  const pdf = Buffer.from(`%PDF-1.4\nORIGINAL FICTITIOUS INVOICE ${id}\n%%EOF`);
  const pdfDir = path.join(temp, "data", "organizations", orgA, "pdfs");
  fs.mkdirSync(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, `${id}.pdf`);
  fs.writeFileSync(pdfPath, pdf);
  await db.systemPrisma.facture.create({
    data: {
      id,
      organization_id: orgA,
      lifecycle_status: "issued",
      issued_at: new Date(),
      fiscal_entity_id: entity.id,
      fiscal_establishment_id: establishment.id,
      numero_facture: `F-${id}`,
      gite_id: "gite-a",
      locataire_nom: "Client fictif",
      locataire_adresse: "Adresse fictive",
      locataire_tel: "",
      nb_adultes: 1,
      nb_enfants_2_17: 0,
      date_debut: new Date("2026-10-01"),
      date_fin: new Date("2026-10-02"),
      heure_arrivee: "17:00",
      heure_depart: "10:00",
      nb_nuits: 1,
      prix_par_nuit: 120,
      options: "{}",
      clauses: "{}",
      arrhes_montant: 0,
      arrhes_date_limite: new Date(),
      solde_montant: 120,
      caution_montant: 0,
      cheque_menage_montant: 0,
      pdf_path: pdfPath,
      pdf_sha256: crypto.createHash("sha256").update(pdf).digest("hex"),
      immutable_snapshot: JSON.stringify({
        issuer: { entity },
        structured_invoice: structured,
      }),
      ...overrides,
    },
  });
  return { id, pdf, pdfPath, structured };
};
const prepare = async (id: string) => {
  const view = await within(() => service.prepare(id, input, actor));
  await within(() =>
    service.processPrepare(view.transmission!.id, view.revision),
  );
  return within(() => service.view(id));
};
const enqueueSend = (id: string, revision: number) =>
  within(() => service.send(id, { revision, confirm_test_data: true }, actor));
const row = (id: string) =>
  db.systemPrisma.electronicInvoiceTransmission.findFirstOrThrow({
    where: { invoice_id: id },
  });

before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    DATABASE_URL_SQLITE: databaseUrl,
    ...(postgresUrl ? { DATABASE_URL_POSTGRES: postgresUrl } : {}),
    DATA_DIR: path.join(temp, "data"),
    SUPERPDP_SANDBOX_ENABLED: "true",
    SUPERPDP_SANDBOX_EMISSION_ENABLED: "true",
    SUPERPDP_SECRETS_KEY: crypto.randomBytes(32).toString("base64"),
    SUPERPDP_SANDBOX_REDIRECT_URI:
      publicOrigin + "/api/fiscal-entities/superpdp/oauth/callback",
    APP_PUBLIC_URL: publicOrigin,
    CLIENT_ORIGIN: publicOrigin,
    BOOTSTRAP_ADMIN_LOGIN: "",
    BOOTSTRAP_ADMIN_PASSWORD: "",
    BASIC_AUTH_PASSWORD: "",
  });
  if (!postgresUrl) fs.writeFileSync(path.join(temp, "test.db"), "");
  const migration = spawnSync(
    process.execPath,
    [
      "scripts/prisma.mjs",
      "migrate",
      "deploy",
      ...(postgresUrl ? ["--schema", "prisma/postgres/schema.prisma"] : []),
    ],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  db = await import("../src/db/prisma.js");
  runtime = await import("../src/config/env.js");
  ({ runWithOrganization } =
    await import("../src/modules/organizations/context.js"));
  const { seal } = await import("../src/modules/superpdp/secrets.js");
  for (const [org, suffix] of [
    [orgA, "a"],
    [orgB, "b"],
  ]) {
    await db.systemPrisma.organization.create({
      data: { id: org, name: org, slug: org },
    });
    await db.systemPrisma.appUser.create({
      data: {
        id: `emission-owner-${suffix}`,
        organization_id: org,
        display_name: "Owner fictif",
        login_id: `emission-owner-${suffix}`,
        is_owner: true,
        is_active: true,
        roles: '["owner"]',
        status: "owner",
        password_hash: "fake-test",
        password_salt: "fake-test",
      },
    });
    await db.systemPrisma.fiscalEntity.create({
      data: {
        id: `entity-${suffix}`,
        organization_id: org,
        legal_name: "Entreprise fictive",
        siren: "732829320",
        vat_regime: "reel_normal",
        vat_number: "FR44732829320",
        address_line1: "1 rue fictive",
        city: "Rennes",
        postal_code: "35000",
      },
    });
    await db.systemPrisma.fiscalEstablishment.create({
      data: {
        id: `establishment-${suffix}`,
        organization_id: org,
        fiscal_entity_id: `entity-${suffix}`,
        name: "Siège",
        siret: "73282932000074",
      },
    });
    await db.systemPrisma.gite.create({
      data: {
        id: `gite-${suffix}`,
        organization_id: org,
        nom: "Gîte fictif",
        prefixe_contrat: "FX",
        adresse_ligne1: "1 rue fictive",
        capacite_max: 2,
        nb_adultes_max: 2,
        proprietaires_noms: "Fictif",
        proprietaires_adresse: "Fictif",
        telephones: "[]",
        iban: "",
        titulaire: "Fictif",
        fiscal_establishment_id: `establishment-${suffix}`,
        taxe_sejour_par_personne_par_nuit: 0,
      },
    });
  }
  await db.systemPrisma.appUser.create({
    data: {
      id: "emission-worker",
      organization_id: orgA,
      display_name: "Worker",
      is_owner: false,
      page_access: '["invoices"]',
    },
  });
  const context = {
    organization_id: orgA,
    fiscal_entity_id: "entity-a",
    environment: "sandbox",
  };
  await db.systemPrisma.superPdpConnection.create({
    data: {
      ...context,
      id: "connection-a",
      status: "connected",
      local_siren: "732829320",
      client_id: "fake-client",
      expected_number: "fake-company-a",
      remote_company_id: companyId,
      encrypted_client_secret: seal("fake-secret", context, "client_secret"),
      encrypted_tokens: seal(
        JSON.stringify({
          access_token: "fake-access",
          refresh_token: "fake-refresh",
          expires_at: Date.now() + 3600_000,
        }),
        context,
        "tokens",
      ),
    },
  });
  const { createServerAuthSession, getServerAuthSessionFromRequest } =
    await import("../src/services/serverAuth.js");
  cookieA = `contrats_session=${(await createServerAuthSession("emission-owner-a")).id}`;
  cookieB = `contrats_session=${(await createServerAuthSession("emission-owner-b")).id}`;
  cookieWorker = `contrats_session=${(await createServerAuthSession("emission-worker")).id}`;
  const { SuperPdpProvider } =
    await import("../src/modules/superpdp/provider.js");
  const { SuperPdpService } =
    await import("../src/modules/superpdp/service.js");
  const { SuperPdpTransport } =
    await import("../src/modules/superpdp/transport.js");
  const { SuperPdpEmission } =
    await import("../src/modules/superpdp/emission.js");
  service = new SuperPdpEmission(
    new SuperPdpService(new SuperPdpProvider(fakeFetch)),
    new SuperPdpTransport(fakeFetch),
  );
  const { createSuperPdpEmissionRouter } =
    await import("../src/modules/superpdp/emissionRoutes.js");
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const session = await getServerAuthSessionFromRequest(req);
    runWithOrganization(
      { organizationId: session?.organizationId ?? orgA, source: "test" },
      next,
    );
  });
  app.use("/api/invoices", createSuperPdpEmissionRouter(service));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (db) await db.systemPrisma.$disconnect();
  if (!postgresUrl) fs.rmSync(temp, { recursive: true, force: true });
});

test("administrateur authentifié, origine obligatoire, isolement des comptes et interrupteur d’émission", async () => {
  const invoice = await newInvoice();
  assert.equal((await request(invoice.id, "", undefined, "")).status, 401);
  assert.equal(
    (await request(invoice.id, "", undefined, cookieWorker)).status,
    403,
  );
  assert.equal((await request(invoice.id, "", undefined, cookieB)).status, 404);
  assert.equal(
    (await request(invoice.id, "prepare", input, cookieA, false)).status,
    403,
  );
  runtime.env.SUPERPDP_SANDBOX_EMISSION_ENABLED = false;
  assert.equal((await request(invoice.id)).body.available, false);
  assert.equal((await request(invoice.id, "prepare", input)).status, 503);
  runtime.env.SUPERPDP_SANDBOX_EMISSION_ENABLED = true;
});
test("préparation asynchrone : PDF source inchangé, projection figée, validation et empreinte de l’archive", async () => {
  const invoice = await newInvoice();
  const before = await db.systemPrisma.facture.findUnique({
    where: { id: invoice.id },
  });
  const response = await request(invoice.id, "prepare", input);
  assert.equal(response.status, 202);
  assert.equal(response.body.transmission.status, "queued_prepare");
  const queued = (
    await db.systemPrisma.organizationJob.findMany({
      where: { type: "superpdp.prepare" },
    })
  ).find((job) => {
    const value =
      typeof job.payload_json === "string"
        ? JSON.parse(job.payload_json)
        : job.payload_json;
    return (
      value &&
      typeof value === "object" &&
      "transmission_id" in value &&
      value.transmission_id === response.body.transmission.id
    );
  });
  assert.ok(queued);
  assert.equal(JSON.stringify(queued).includes("fake-access"), false);
  await within(() =>
    service.processPrepare(
      response.body.transmission.id,
      response.body.revision,
    ),
  );
  const view = await within(() => service.view(invoice.id));
  assert.equal(view.transmission?.status, "ready");
  assert.equal(sendCount, 0);
  assert.deepEqual(
    await within(() => service.artifact(invoice.id)),
    convertedPdf,
  );
  assert.equal(
    view.transmission?.artifact_sha256,
    crypto.createHash("sha256").update(convertedPdf).digest("hex"),
  );
  assert.deepEqual(fs.readFileSync(invoice.pdfPath), invoice.pdf);
  assert.deepEqual(
    await db.systemPrisma.facture.findUnique({ where: { id: invoice.id } }),
    before,
  );
  assert.equal(JSON.stringify(view).includes("fake-secret"), false);
  assert.equal(JSON.stringify(view).includes("raw discarded"), false);
});
test("rejet des brouillons, historiques, données manquantes, B2C et B2B international", async () => {
  for (const overrides of [
    { lifecycle_status: "draft" },
    { lifecycle_status: "legacy" },
    { immutable_snapshot: null },
  ]) {
    const invoice = await newInvoice(overrides);
    await assert.rejects(
      within(() => service.prepare(invoice.id, input, actor)),
      /Seul un document/,
    );
  }
  for (const rule of ["B2C", "B2BInt"]) {
    const invoice = await newInvoice();
    const stored = await db.systemPrisma.facture.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const snapshot = JSON.parse(stored.immutable_snapshot!);
    snapshot.structured_invoice.processing_rule_candidate = rule;
    await db.systemPrisma.facture.update({
      where: { id: invoice.id },
      data: { immutable_snapshot: JSON.stringify(snapshot) },
    });
    await assert.rejects(
      within(() => service.prepare(invoice.id, input, actor)),
      /Seul un document/,
    );
  }
});
test("saisie stricte, confirmation des données fictives, révision et adresse acheteur", async () => {
  const invoice = await newInvoice();
  for (const payload of [
    { ...input, confirm_test_data: false },
    { ...input, environment: "production" },
    { ...input, seller_address: "https://evil.test" },
  ])
    assert.equal((await request(invoice.id, "prepare", payload)).status, 400);
  assert.equal(
    (
      await request(invoice.id, "prepare", {
        ...input,
        buyer_address: "0225:123456789",
      })
    ).status,
    409,
  );
  const view = await within(() => service.prepare(invoice.id, input, actor));
  await assert.rejects(
    within(() => service.prepare(invoice.id, input, actor)),
    /préparation a changé/,
  );
  assert.equal(view.revision, 1);
});
test("échecs de validation détaillés conservés et aucun dépôt possible", async () => {
  const invoice = await newInvoice();
  const view = await within(() => service.prepare(invoice.id, input, actor));
  mode = "invalid";
  await within(() =>
    service.processPrepare(view.transmission!.id, view.revision),
  );
  const failed = await within(() => service.view(invoice.id));
  assert.equal(failed.transmission?.status, "validation_failed");
  assert.equal(
    failed.transmission?.validation?.data[0].subreports[0].failures[0].message,
    "BT-49 à vérifier",
  );
  await assert.rejects(
    enqueueSend(invoice.id, failed.revision),
    /préparée et validée/,
  );
  mode = "ok";
  const retry = await within(() =>
    service.prepare(invoice.id, { ...input, revision: failed.revision }, actor),
  );
  await within(() =>
    service.processPrepare(retry.transmission!.id, retry.revision),
  );
  const events = await db.systemPrisma.electronicInvoiceEvent.count({
    where: {
      transmission_id: retry.transmission!.id,
      status_code: "local:validation_completed",
    },
  });
  assert.equal(events, 2);
});
test("réponse vide ou conversion en échec : erreur expurgée et aucun envoi", async () => {
  for (const failureMode of ["empty-validation", "convert-error"]) {
    const invoice = await newInvoice();
    const view = await within(() => service.prepare(invoice.id, input, actor));
    mode = failureMode;
    await assert.rejects(
      within(() =>
        service.processPrepare(view.transmission!.id, view.revision),
      ),
      (error: Error) => !error.message.includes("private-remote-error"),
    );
    const stored = await row(invoice.id);
    assert.equal(stored.status, "prepare_failed");
    assert.equal(stored.validation_valid, false);
  }
});
test("vérification d’annuaire vendeur : une adresse étrangère bloque la conversion", async () => {
  const invoice = await newInvoice();
  const view = await within(() => service.prepare(invoice.id, input, actor));
  const count = calls.length;
  mode = "wrong-address";
  await assert.rejects(
    within(() => service.processPrepare(view.transmission!.id, view.revision)),
    /préparation de test/,
  );
  assert.equal(
    calls.slice(count).some((call) => call.includes("/convert")),
    false,
  );
});
test("contrôle des empreintes : ni PDF source modifié ni Factur-X altéré ne sont déposés", async () => {
  const source = await newInvoice();
  const queued = await within(() => service.prepare(source.id, input, actor));
  fs.appendFileSync(source.pdfPath, "tampered");
  await assert.rejects(
    within(() =>
      service.processPrepare(queued.transmission!.id, queued.revision),
    ),
  );
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  const stored = await row(invoice.id);
  const artifact = path.join(
    temp,
    "data",
    "organizations",
    orgA,
    stored.artifact_path!,
  );
  fs.appendFileSync(artifact, "tampered");
  const before = sendCount;
  await enqueueSend(invoice.id, view.revision);
  await within(() => service.processSend(stored.id, stored.revision));
  assert.equal(sendCount, before);
  assert.equal((await row(invoice.id)).post_started_at, null);
});
test("dépôt manuel unique avec identifiant 64 bits, original et paiement inchangés", async () => {
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  const before = sendCount;
  await enqueueSend(invoice.id, view.revision);
  await Promise.allSettled([
    within(() => service.processSend(view.transmission!.id, view.revision)),
    within(() => service.processSend(view.transmission!.id, view.revision)),
  ]);
  const stored = await row(invoice.id);
  assert.equal(sendCount, before + 1);
  assert.equal(stored.status, "submitted");
  assert.match(stored.remote_invoice_id!, /^900719925474099/);
  await within(() => service.processSend(stored.id, stored.revision));
  assert.equal(sendCount, before + 1);
  await assert.rejects(enqueueSend(invoice.id, view.revision));
  assert.equal(
    (
      await db.systemPrisma.facture.findUniqueOrThrow({
        where: { id: invoice.id },
      })
    ).statut_paiement,
    "non_reglee",
  );
});
test("réponse de dépôt perdue : rapprochement par external_id sans rejouer le POST", async () => {
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  await enqueueSend(invoice.id, view.revision);
  const before = sendCount;
  mode = "lost-send";
  await within(() => service.processSend(view.transmission!.id, view.revision));
  const unknown = await row(invoice.id);
  assert.equal(unknown.status, "send_unknown");
  assert.ok(unknown.post_started_at);
  await within(() => service.processSend(unknown.id, unknown.revision));
  assert.equal(sendCount, before + 1);
  mode = "ok";
  await within(() => service.processReconcile(unknown.id));
  const found = await row(invoice.id);
  assert.equal(found.status, "submitted");
  assert.ok(found.remote_invoice_id);
  assert.equal(sendCount, before + 1);
});
test("absence dans la recherche ou erreur HTTP après POST : le renvoi reste interdit", async () => {
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  await enqueueSend(invoice.id, view.revision);
  mode = "http-send";
  await within(() => service.processSend(view.transmission!.id, view.revision));
  mode = "unfindable";
  await within(() => service.processReconcile(view.transmission!.id));
  const stored = await row(invoice.id);
  assert.equal(stored.status, "send_unknown");
  assert.equal(stored.reconcile_cursor, null);
  await assert.rejects(enqueueSend(invoice.id, view.revision));
  await assert.rejects(
    within(() =>
      service.prepare(
        invoice.id,
        { ...input, revision: stored.revision },
        actor,
      ),
    ),
  );
});
test("événements paginés append-only, inconnus préservés, curseur atomique et paiement distinct", async () => {
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  await enqueueSend(invoice.id, view.revision);
  await within(() => service.processSend(view.transmission!.id, view.revision));
  const stored = await row(invoice.id);
  remoteEvents = Array.from({ length: 103 }, (_, i) => ({
    id: String(9007199254740993000n + BigInt(i)),
    invoice_id: stored.remote_invoice_id!,
    status_code: i === 102 ? "fr:212" : "future:unknown",
    status_text: "Événement fictif",
    created_at: "2026-10-16T08:00:00Z",
    details: [{ reason: "TEST_REASON" }],
  }));
  await within(() => service.processReconcile(stored.id));
  assert.equal(
    await db.systemPrisma.electronicInvoiceEvent.count({
      where: {
        transmission_id: stored.id,
        event_key: { startsWith: "remote:" },
      },
    }),
    100,
  );
  await within(() => service.processReconcile(stored.id));
  await within(() => service.processReconcile(stored.id));
  assert.equal(
    await db.systemPrisma.electronicInvoiceEvent.count({
      where: {
        transmission_id: stored.id,
        event_key: { startsWith: "remote:" },
      },
    }),
    103,
  );
  assert.equal(
    (
      await db.systemPrisma.facture.findUniqueOrThrow({
        where: { id: invoice.id },
      })
    ).statut_paiement,
    "non_reglee",
  );
  const cursor = (await row(invoice.id)).events_cursor;
  eventsMode = "wrong-invoice";
  await assert.rejects(within(() => service.processReconcile(stored.id)));
  assert.equal((await row(invoice.id)).events_cursor, cursor);
});
test("un dépôt marqué en cours après crash n’est jamais refait", async () => {
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  const stored = await row(invoice.id);
  await db.systemPrisma.electronicInvoiceTransmission.update({
    where: { id: stored.id },
    data: {
      status: "sending",
      post_started_at: new Date(),
      operation_id: "interrupted",
      operation_expires_at: new Date(Date.now() - 1),
    },
  });
  const before = sendCount;
  await within(() => service.processSend(stored.id, view.revision));
  assert.equal(sendCount, before);
  assert.equal((await row(invoice.id)).status, "send_unknown");
});
test("un changement d’identité, de compte ou de droits avant exécution bloque les effets distants", async () => {
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  await enqueueSend(invoice.id, view.revision);
  await db.systemPrisma.appUser.update({
    where: { id: actor.userId },
    data: { is_active: false },
  });
  const before = sendCount;
  await within(() => service.processSend(view.transmission!.id, view.revision));
  assert.equal(sendCount, before);
  await db.systemPrisma.appUser.update({
    where: { id: actor.userId },
    data: { is_active: true },
  });
  await assert.rejects(
    within(
      () => service.processPrepare(view.transmission!.id, view.revision),
      orgB,
    ),
    /Transmission introuvable/,
  );
  const stored = await row(invoice.id);
  await assert.rejects(
    db.systemPrisma.electronicInvoiceTransmission.update({
      where: { id: stored.id },
      data: { fiscal_entity_id: "entity-b" },
    }),
  );
});
test("une adhésion au compte suspendue bloque aussi une demande déjà en file", async () => {
  const invoice = await newInvoice();
  const view = await within(() => service.prepare(invoice.id, input, actor));
  const userId = "identity-emission-owner";
  await db.systemPrisma.user.create({ data: { id: userId, login_id: userId } });
  await db.systemPrisma.membership.create({
    data: {
      user_id: userId,
      organization_id: orgA,
      role: "owner",
      status: "suspended",
    },
  });
  await db.systemPrisma.appUser.update({
    where: { id: actor.userId },
    data: { user_id: userId },
  });
  const before = calls.length;
  try {
    await assert.rejects(
      within(() =>
        service.processPrepare(view.transmission!.id, view.revision),
      ),
    );
    assert.equal(calls.length, before);
    assert.equal(
      (await row(invoice.id)).last_error_code,
      "SUPERPDP_OWNER_REQUIRED",
    );
  } finally {
    await db.systemPrisma.appUser.update({
      where: { id: actor.userId },
      data: { user_id: null },
    });
  }
});

test("la file persistante réutilisée traite la préparation sans émission implicite", async () => {
  await db.systemPrisma.organizationJob.updateMany({
    data: { status: "completed" },
  });
  const invoice = await newInvoice();
  const view = await within(() => service.prepare(invoice.id, input, actor));
  const before = sendCount;
  const { runOrganizationJobBatch } =
    await import("../src/modules/system/jobs.js");
  const { createEmissionJobHandlers } =
    await import("../src/modules/superpdp/worker.js");
  const outcomes = await runOrganizationJobBatch({
    workerId: "test-worker",
    leaseMs: 300_000,
    maxAttempts: 3,
    handlers: createEmissionJobHandlers(service),
    limit: 5,
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "succeeded");
  assert.equal((await row(invoice.id)).status, "ready");
  assert.equal(sendCount, before);
  assert.equal(view.transmission?.status, "queued_prepare");
});

test("un worker à bail court ne reprend pas les tâches SuperPDP du worker dédié", async () => {
  const stamp = crypto.randomUUID();
  const created = [];
  for (const type of ["billing.reconcile", "superpdp.prepare"])
    created.push(
      await db.systemPrisma.organizationJob.create({
        data: {
          organization_id: orgA,
          type,
          idempotency_key: `lease-test:${type}:${stamp}`,
          status: "running",
          attempts: 1,
          locked_at: new Date(Date.now() - 70_000),
          lock_owner: "another-worker",
        },
      }),
    );
  const { claimNextOrganizationJob } =
    await import("../src/modules/system/jobs.js");
  await claimNextOrganizationJob({
    workerId: "short-lease-worker",
    leaseMs: 60_000,
    maxAttempts: 3,
    types: ["billing.reconcile"],
  });
  const protectedJob = await db.systemPrisma.organizationJob.findUniqueOrThrow({
    where: { id: created[1].id },
  });
  assert.equal(protectedJob.status, "running");
  assert.equal(protectedJob.lock_owner, "another-worker");
  await db.systemPrisma.organizationJob.updateMany({
    where: { id: { in: created.map((job) => job.id) } },
    data: { status: "completed" },
  });
});

test(
  "sauvegarde SQLite : archives de chaque compte et historique conservés, secrets retirés et reprise suspendue",
  { skip: !!postgresUrl },
  async () => {
    const invoice = await newInvoice();
    const view = await prepare(invoice.id);
    await enqueueSend(invoice.id, view.revision);
    const stored = await row(invoice.id);
    const archive = path.join(temp, "backup.tar.gz");
    const extracted = path.join(temp, "extracted");
    fs.mkdirSync(extracted);
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/installation-data.mjs"), "backup", archive],
      { env: process.env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      spawnSync("tar", ["-xzf", archive, "-C", extracted]).status,
      0,
    );
    assert.deepEqual(
      fs.readFileSync(
        path.join(
          extracted,
          "files",
          "organizations",
          orgA,
          stored.artifact_path!,
        ),
      ),
      convertedPdf,
    );
    const query = spawnSync(
      "sqlite3",
      [
        path.join(extracted, "database", "database.sqlite"),
        [
          "SELECT count(*) FROM superpdp_connections WHERE encrypted_tokens IS NOT NULL OR encrypted_client_secret IS NOT NULL;",
          "SELECT count(*) FROM electronic_invoice_transmissions WHERE status <> 'paused_after_restore' OR next_sync_at IS NOT NULL;",
          "SELECT count(*) FROM organization_jobs WHERE type LIKE 'superpdp.%' AND status IN ('queued','running');",
          "PRAGMA foreign_key_check;",
        ].join(" "),
      ],
      { encoding: "utf8" },
    );
    assert.equal(query.status, 0, query.stderr);
    assert.equal(query.stdout.trim(), "0\n0\n0");
    assert.equal((await row(invoice.id)).status, "queued_send");
    assert.ok(
      (
        await db.systemPrisma.superPdpConnection.findUniqueOrThrow({
          where: { id: "connection-a" },
        })
      ).encrypted_tokens,
    );
  },
);

test("une préparation restaurée reste bloquée même sans marqueur de dépôt dans l’ancienne sauvegarde", async () => {
  const invoice = await newInvoice();
  const view = await prepare(invoice.id);
  await db.systemPrisma.electronicInvoiceTransmission.update({
    where: { id: view.transmission!.id },
    data: { status: "paused_after_restore", next_sync_at: null },
  });
  const before = calls.length;
  await assert.rejects(
    within(() =>
      service.prepare(invoice.id, { ...input, revision: view.revision }, actor),
    ),
  );
  await assert.rejects(enqueueSend(invoice.id, view.revision));
  await within(() =>
    service.processPrepare(view.transmission!.id, view.revision),
  );
  await within(() => service.processSend(view.transmission!.id, view.revision));
  assert.equal(calls.length, before);
});

test("une entreprise de production retournée lors de l’exécution reste refusée avant conversion ou dépôt", async () => {
  const invoice = await newInvoice();
  const view = await within(() => service.prepare(invoice.id, input, actor));
  const before = calls.length;
  mode = "production";
  await assert.rejects(
    within(() => service.processPrepare(view.transmission!.id, view.revision)),
  );
  assert.equal(
    calls
      .slice(before)
      .some((call) => /\/convert|POST \/v1.beta\/invoices$/.test(call)),
    false,
  );
  const connection = await db.systemPrisma.superPdpConnection.findUniqueOrThrow(
    { where: { id: "connection-a" } },
  );
  assert.equal(connection.status, "identity_rejected");
  assert.equal(connection.encrypted_tokens, null);
});

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
let paymentsService: InstanceType<
  typeof import("../src/modules/superpdp/payments.js").SuperPdpPayments
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
let vatRegime = "monthly",
  onDebits = false,
  paymentSendCount = 0;
let remoteEvents: Array<
  import("../src/modules/superpdp/transport.js").RemoteEvent
> = [];
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
      vat_regime: vatRegime,
      has_vat_on_debits: onDebits,
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
    assert.equal(url.searchParams.get("from"), "en16931");
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
    assert.ok(
      ["B2B", "B2C"].includes(url.searchParams.get("processing_rule")!),
    );
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
      processing_rule: url.searchParams.get("processing_rule")!,
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
    if (init?.method === "POST") {
      paymentSendCount++;
      const raw = String(init.body);
      const body = JSON.parse(
        raw.replace(/"invoice_id":(\d+)/, '"invoice_id":"$1"'),
      );
      assert.match(raw, new RegExp(`"invoice_id":${body.invoice_id},`));
      assert.equal(body.status_code, "fr:212");
      assert.ok(body.details[0].reported_data.length);
      for (const data of body.details[0].reported_data) {
        assert.equal(data.type_code, "MEN");
        assert.equal(data.currency_code, "EUR");
      }
      const event = {
        id: String(9007199254740993300n + BigInt(++serial)),
        invoice_id: body.invoice_id,
        status_code: "fr:212",
        status_text: "Encaissée",
        created_at: "2026-10-16T10:00:00Z",
        details: body.details,
      };
      remoteEvents.push(event);
      if (mode === "lost-payment") throw new Error("private-response-lost");
      if (mode === "mismatch-payment")
        return json({ ...event, invoice_id: "1" });
      if (mode === "normalized-payment")
        return json({
          ...event,
          details: [
            {
              reported_data: body.details[0].reported_data.map(
                (d: Record<string, string>) => ({
                  date: d.date,
                  value_percent: String(Number(d.value_percent)),
                  type_code: d.type_code,
                  currency_code: d.currency_code,
                  amount: `${d.amount}00`,
                }),
              ),
            },
          ],
        });
      return new Response(
        JSON.stringify(event)
          .replace(`"${event.id}"`, event.id)
          .replace(`"${body.invoice_id}"`, body.invoice_id),
        { headers: { "content-type": "application/json" } },
      );
    }
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
const newInvoice = async (
  overrides: Record<string, unknown> = {},
  options: {
    b2c?: boolean;
    multi?: boolean;
    paid?: number;
    credit?: boolean;
    category?: "E" | "O";
  } = {},
) => {
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
  if (options.b2c)
    Object.assign(fiscal.buyer, { kind: "individual", siren: "" });
  if (options.multi)
    fiscal.lines.push({
      ...fiscal.lines[0],
      id: "2",
      unit_price_ttc: 55,
      vat_rate: 10,
    });
  if (options.category)
    Object.assign(fiscal.lines[0], {
      vat_category: options.category,
      vat_rate: 0,
      exemption_reason: "Exonération fictive",
    });
  fiscal.paid_amount = options.paid ?? 0;
  fiscal.b2b_payment_mentions = {
    late_payment_penalties: "Pénalités de retard fictives de recette.",
    recovery_fee: "Indemnité forfaitaire de recouvrement fictive de recette.",
    early_payment_discount: "Aucun escompte pour paiement anticipé (recette).",
  };
  const structured = buildStructuredInvoice({
    input: fiscal,
    issuer: { entity, establishment },
    number: `F-2026-732829320-${serial}`,
    issuedAt: new Date("2026-10-16T08:00:00Z"),
    buyerName: "Client fictif",
    credit: options.credit ?? false,
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

test("les anciennes factures B2B sans mentions figées restent intactes et ne sont pas préparées", async () => {
  for (const missing of ["all", "PMD", "PMT", "AAB", "blank"]) {
    const invoice = await newInvoice();
    const original = await db.systemPrisma.facture.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const snapshot = JSON.parse(original.immutable_snapshot!);
    const source = snapshot.structured_invoice.en_invoice_candidate;
    if (missing === "all") delete source.notes;
    else if (missing === "blank") source.notes[0].note = " \n ";
    else
      source.notes = source.notes.filter(
        (note: { subject_code: string }) => note.subject_code !== missing,
      );
    await db.systemPrisma.facture.update({
      where: { id: invoice.id },
      data: { immutable_snapshot: JSON.stringify(snapshot) },
    });
    const before = await db.systemPrisma.facture.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const beforeCalls = calls.length;
    await assert.rejects(
      within(() => service.prepare(invoice.id, input, actor)),
      { code: "SUPERPDP_PAYMENT_MENTIONS_REQUIRED" },
    );
    assert.equal(calls.length, beforeCalls);
    assert.equal(
      await db.systemPrisma.electronicInvoiceTransmission.count({
        where: { invoice_id: invoice.id },
      }),
      0,
    );
    assert.deepEqual(
      await db.systemPrisma.facture.findUniqueOrThrow({
        where: { id: invoice.id },
      }),
      before,
    );
    assert.deepEqual(fs.readFileSync(invoice.pdfPath), invoice.pdf);
  }
});
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
  const { SuperPdpPayments } =
    await import("../src/modules/superpdp/payments.js");
  paymentsService = new SuperPdpPayments(
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
  app.use(
    "/api/invoices",
    createSuperPdpEmissionRouter(service, paymentsService),
  );
  const { createSuperPdpRouter } =
    await import("../src/modules/superpdp/routes.js");
  app.use(
    "/api/fiscal-entities",
    createSuperPdpRouter(new SuperPdpService(new SuperPdpProvider(fakeFetch))),
  );
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
test("une connexion OAuth sandbox sans SIREN ne permet aucune préparation de facture", async () => {
  const invoice = await newInvoice();
  const connection = await db.systemPrisma.superPdpConnection.findFirstOrThrow({
    where: { fiscal_entity_id: "entity-a" },
  });
  const beforeCalls = calls.length;
  const beforeJobs = await db.systemPrisma.organizationJob.count();
  await db.systemPrisma.superPdpConnection.update({
    where: { id: connection.id },
    data: { local_siren: null },
  });
  try {
    // Also reject a malformed historical snapshot with a missing SIREN: null must not match null.
    for (const siren of ["732829320", null]) {
      const stored = await db.systemPrisma.facture.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      const snapshot = JSON.parse(stored.immutable_snapshot!);
      snapshot.issuer.entity.siren = siren;
      await db.systemPrisma.facture.update({
        where: { id: invoice.id },
        data: { immutable_snapshot: JSON.stringify(snapshot) },
      });
      assert.equal((await request(invoice.id, "prepare", input)).status, 409);
    }
    assert.equal(calls.length, beforeCalls);
    assert.equal(await db.systemPrisma.organizationJob.count(), beforeJobs);
    assert.equal(
      await db.systemPrisma.electronicInvoiceTransmission.count({
        where: { invoice_id: invoice.id },
      }),
      0,
    );
  } finally {
    await db.systemPrisma.superPdpConnection.update({
      where: { id: connection.id },
      data: { local_siren: connection.local_siren },
    });
  }
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
      /Seul un document|B2C de test|profil B2C/,
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

const b2cProfile = {
  operation: "services" as const,
  vat_regime: "monthly" as const,
  has_vat_on_debits: false,
  confirm_no_other_reporting: true as const,
};
const b2cInput = {
  revision: 0,
  seller_address: input.seller_address,
  confirm_test_data: true,
  b2c: b2cProfile,
};
const b2cInvoice = async (
  options: Parameters<typeof newInvoice>[1] = {},
  profile = b2cProfile,
) => {
  runtime.env.SUPERPDP_SANDBOX_B2C_ENABLED = true;
  vatRegime = profile.vat_regime;
  onDebits = profile.has_vat_on_debits;
  const invoice = await newInvoice({}, { ...options, b2c: true });
  const prepared = await within(() =>
    service.prepare(invoice.id, { ...b2cInput, b2c: profile }, actor),
  );
  await within(() =>
    service.processPrepare(prepared.transmission!.id, prepared.revision),
  );
  assert.equal((await row(invoice.id)).status, "ready");
  await enqueueSend(invoice.id, prepared.revision);
  await within(() =>
    service.processSend(prepared.transmission!.id, prepared.revision),
  );
  assert.equal((await row(invoice.id)).status, "submitted");
  return invoice;
};
const receipt = (
  revision = 0,
  reference = "BANK-FAKE-1",
  amount = "60.00",
) => ({
  revision,
  reference,
  payment_date: "2026-10-15",
  allocations: [{ vat_rate: "20.00", amount }],
  confirm_received: true,
  confirm_test_data: true,
});
const recordReceipt = async (id: string, data = receipt()) =>
  within(() => paymentsService.record(id, data, actor));
const sendReceipt = async (id: string, paymentId: string) => {
  await within(() => paymentsService.send(id, paymentId, actor));
  await within(() => paymentsService.process(paymentId));
  return within(() => paymentsService.view(id));
};

test("B2C : confirmation explicite, note BAR, cadre S1/B1, pas d’adresse de particulier ni mutation du PDF", async () => {
  runtime.env.SUPERPDP_SANDBOX_B2C_ENABLED = true;
  const invoice = await newInvoice({}, { b2c: true });
  const before = await db.systemPrisma.facture.findUniqueOrThrow({
    where: { id: invoice.id },
  });
  for (const invalid of [
    input,
    { ...b2cInput, buyer_address: input.buyer_address },
    { ...b2cInput, b2c: { ...b2cProfile, operation: "mixed" } },
    { ...b2cInput, b2c: { ...b2cProfile, confirm_no_other_reporting: false } },
    { ...b2cInput, b2c: { ...b2cProfile, vat_regime: "simplified" } },
  ])
    await assert.rejects(
      within(() => service.prepare(invoice.id, invalid, actor)),
    );
  const prepared = await within(() =>
    service.prepare(invoice.id, b2cInput, actor),
  );
  const stored = await row(invoice.id);
  const candidate = JSON.parse(stored.payload_json);
  assert.deepEqual(candidate.notes, [{ subject_code: "BAR", note: "B2C" }]);
  assert.equal(candidate.process_control.business_process_type, "S1");
  assert.equal(candidate.vat_point_date_code, "432");
  assert.equal(candidate.buyer.electronic_address, undefined);
  assert.equal(prepared.processing_rule, "B2C");
  assert.equal(prepared.transmission!.buyer_address, "");
  assert.deepEqual(
    await db.systemPrisma.facture.findUniqueOrThrow({
      where: { id: invoice.id },
    }),
    before,
  );
  assert.deepEqual(fs.readFileSync(invoice.pdfPath), invoice.pdf);
  runtime.env.SUPERPDP_SANDBOX_B2C_ENABLED = false;
  const beforeCalls = calls.length;
  await assert.rejects(
    within(() => service.processPrepare(stored.id, stored.revision)),
  );
  assert.equal(calls.length, beforeCalls + 2); // OAuth identity probe precedes the guarded converter.
  assert.equal((await within(() => service.view(invoice.id))).available, false);
  runtime.env.SUPERPDP_SANDBOX_B2C_ENABLED = true;
});

test("B2C : vérification distante du régime et de l’option débits avant conversion et dépôt", async () => {
  const invoice = await newInvoice({}, { b2c: true });
  const prepared = await within(() =>
    service.prepare(invoice.id, b2cInput, actor),
  );
  vatRegime = "";
  const count = calls.filter((c) => c.endsWith("/convert")).length;
  await assert.rejects(
    within(() =>
      service.processPrepare(prepared.transmission!.id, prepared.revision),
    ),
  );
  assert.equal(calls.filter((c) => c.endsWith("/convert")).length, count);
  vatRegime = "monthly";
  const reprepare = await within(() =>
    service.prepare(
      invoice.id,
      { ...b2cInput, revision: prepared.revision },
      actor,
    ),
  );
  await within(() =>
    service.processPrepare(reprepare.transmission!.id, reprepare.revision),
  );
  await enqueueSend(invoice.id, reprepare.revision);
  onDebits = true;
  const before = sendCount;
  await within(() =>
    service.processSend(reprepare.transmission!.id, reprepare.revision),
  );
  assert.equal(sendCount, before);
  assert.equal((await row(invoice.id)).post_started_at, null);
  onDebits = false;
});

test("B2C : encaissements partiels TTC multi-taux, centimes exacts, reçu 64 bits et aucune modification comptable", async () => {
  const invoice = await b2cInvoice({ multi: true });
  const before = await db.systemPrisma.facture.findUniqueOrThrow({
    where: { id: invoice.id },
  });
  const local = await recordReceipt(invoice.id, {
    ...receipt(),
    allocations: [
      { vat_rate: "20.00", amount: "60.00" },
      { vat_rate: "10.00", amount: "27.50" },
    ],
  });
  assert.equal(local.payments[0].amount, "87.50");
  assert.equal(local.needs_reporting, true);
  assert.equal(paymentSendCount, 0);
  const submitted = await sendReceipt(invoice.id, local.payments[0].id);
  assert.equal(submitted.payments[0].status, "submitted");
  assert.ok(submitted.payments[0].remote_event_id);
  assert.ok(
    BigInt(submitted.payments[0].remote_event_id!) >
      BigInt(Number.MAX_SAFE_INTEGER),
  );
  const stored = await row(invoice.id);
  const wire = await db.systemPrisma.electronicInvoicePayment.findUniqueOrThrow(
    { where: { id: local.payments[0].id } },
  );
  assert.deepEqual(JSON.parse(wire.payload_json)[0].reported_data, [
    {
      amount: "27.50",
      currency_code: "EUR",
      type_code: "MEN",
      value_percent: "10.00",
      date: "2026-10-15",
    },
    {
      amount: "60.00",
      currency_code: "EUR",
      type_code: "MEN",
      value_percent: "20.00",
      date: "2026-10-15",
    },
  ]);
  await within(() => service.processReconcile(stored.id));
  assert.equal(
    await db.systemPrisma.electronicInvoiceEvent.count({
      where: {
        transmission_id: stored.id,
        event_key: `remote:${submitted.payments[0].remote_event_id}`,
      },
    }),
    1,
  );
  const next = await recordReceipt(invoice.id, {
    ...receipt(1, "BANK-FAKE-2"),
    allocations: [
      { vat_rate: "20.00", amount: "60.00" },
      { vat_rate: "10.00", amount: "27.50" },
    ],
  });
  assert.equal(
    (await sendReceipt(invoice.id, next.payments[1].id)).payments[1].status,
    "submitted",
  );
  await assert.rejects(
    recordReceipt(invoice.id, receipt(2, "BANK-EXCESS", "0.01")),
    /dépasse/,
  );
  assert.deepEqual(
    await db.systemPrisma.facture.findUniqueOrThrow({
      where: { id: invoice.id },
    }),
    before,
  );
  assert.deepEqual(fs.readFileSync(invoice.pdfPath), invoice.pdf);
});

test("encaissements : idempotence locale, références uniques, dates explicites et validation stricte", async () => {
  const invoice = await b2cInvoice();
  for (const payload of [
    { ...receipt(), payment_date: "2026-02-30" },
    { ...receipt(), payment_date: "2099-01-01" },
    { ...receipt(), allocations: [] },
    { ...receipt(), confirm_received: false },
    { ...receipt(), allocations: [{ vat_rate: "20.00", amount: "0.001" }] },
    { ...receipt(), allocations: [{ vat_rate: "20.00", amount: "-1.00" }] },
    { ...receipt(), allocations: [{ vat_rate: "5.50", amount: "1.00" }] },
    {
      ...receipt(),
      allocations: [
        { vat_rate: "20.00", amount: "1.00" },
        { vat_rate: "20.00", amount: "1.00" },
      ],
    },
  ])
    await assert.rejects(
      within(() => paymentsService.record(invoice.id, payload, actor)),
    );
  const first = await recordReceipt(invoice.id);
  const twice = await recordReceipt(invoice.id);
  assert.equal(twice.payments.length, 1);
  assert.equal(twice.payments[0].id, first.payments[0].id);
  await assert.rejects(
    recordReceipt(invoice.id, receipt(1, "BANK-FAKE-1", "59.00")),
    /référence/,
  );
  await assert.rejects(
    recordReceipt(invoice.id, receipt(0, "BANK-NEW", "1.00")),
    /journal a changé/,
  );
  assert.equal(
    (await within(() => paymentsService.view(invoice.id))).payments.length,
    1,
  );
});

test("encaissements : authentification propriétaire, origine, absence de secrets et isolement des comptes", async () => {
  const invoice = await b2cInvoice();
  assert.equal(
    (await request(invoice.id, "payments", undefined, "")).status,
    401,
  );
  assert.equal(
    (await request(invoice.id, "payments", undefined, cookieWorker)).status,
    403,
  );
  assert.equal(
    (await request(invoice.id, "payments", undefined, cookieB)).status,
    404,
  );
  assert.equal(
    (await request(invoice.id, "payments", receipt(), cookieA, false)).status,
    403,
  );
  const recorded = await request(invoice.id, "payments", receipt());
  assert.equal(recorded.status, 201);
  const id = recorded.body.payments[0].id;
  assert.equal(
    (
      await request(invoice.id, `payments/${id}/send`, {
        confirm_send: false,
        confirm_test_data: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        invoice.id,
        `payments/${id}/send`,
        { confirm_send: true, confirm_test_data: true },
        cookieB,
      )
    ).status,
    404,
  );
  assert.equal(JSON.stringify(recorded.body).includes("fake-access"), false);
  assert.equal(
    await within(() => db.default.electronicInvoicePayment.count(), orgB),
    0,
  );
  await assert.rejects(
    db.systemPrisma.electronicInvoicePayment.create({
      data: {
        organization_id: orgB,
        transmission_id: (await row(invoice.id)).id,
        reference: "TENANT-ATTACK",
        payment_date: "2026-10-15",
        amount_cents: 1,
        allocations_json: "[]",
        payload_json: "[]",
        payload_sha256: "fake",
        requested_by: "emission-owner-b",
      },
    }),
    /Foreign key|foreign key/,
  );
  const wrongTransmission = await b2cInvoice();
  await assert.rejects(
    within(() => paymentsService.send(wrongTransmission.id, id, actor)),
  );
});

test("encaissements : option débits et biens restent dans le journal local, sans appel 212", async () => {
  const before = paymentSendCount;
  for (const profile of [
    { ...b2cProfile, has_vat_on_debits: true },
    { ...b2cProfile, operation: "goods" as const },
  ]) {
    const invoice = await b2cInvoice({}, profile as typeof b2cProfile);
    const journal = await recordReceipt(invoice.id);
    assert.equal(journal.needs_reporting, false);
    await assert.rejects(
      within(() =>
        paymentsService.send(invoice.id, journal.payments[0].id, actor),
      ),
    );
    const projected = JSON.parse((await row(invoice.id)).payload_json);
    assert.equal(
      projected.process_control.business_process_type,
      profile.operation === "goods" ? "B1" : "S1",
    );
    assert.equal(
      projected.vat_point_date_code,
      profile.operation === "goods" ? "35" : "3",
    );
  }
  assert.equal(paymentSendCount, before);
});

test("B2C : franchise et simplifié vérifiés, avoirs/exonérations/hors TVA/acompte déduit bloqués pour le journal", async () => {
  for (const [local, remote] of [
    ["franchise_en_base", "vat_exemption"],
    ["reel_simplifie", "simplified"],
    ["reel_normal", "quarterly"],
  ]) {
    const { assertLocalRegime } =
      await import("../src/modules/superpdp/reporting.js");
    assert.doesNotThrow(() =>
      assertLocalRegime(local, {
        ...b2cProfile,
        vat_regime: remote as typeof b2cProfile.vat_regime,
      }),
    );
  }
  for (const options of [
    { credit: true },
    { category: "E" as const },
    { category: "O" as const },
  ]) {
    const invoice = await b2cInvoice(options);
    assert.equal(
      (await within(() => paymentsService.view(invoice.id))).available,
      false,
    );
    await assert.rejects(recordReceipt(invoice.id));
  }
  const paid = await b2cInvoice({ paid: 120 });
  assert.equal(
    JSON.parse((await row(paid.id)).payload_json).process_control
      .business_process_type,
    "S2",
  );
  assert.equal(
    (await within(() => paymentsService.view(paid.id))).payments.length,
    0,
    "paid_amount is never an automatic receipt",
  );
  const advance = await newInvoice({}, { b2c: true, paid: 30 });
  await assert.rejects(
    within(() => service.prepare(advance.id, b2cInput, actor)),
    /acomptes/,
  );
});

test("encaissements : réponse perdue ou reçue pour une autre facture bloque définitivement le POST et les doublons", async () => {
  for (const failureMode of ["lost-payment", "mismatch-payment"]) {
    const invoice = await b2cInvoice();
    const recorded = await recordReceipt(invoice.id);
    const id = recorded.payments[0].id;
    const before = paymentSendCount;
    mode = failureMode;
    const unknown = await sendReceipt(invoice.id, id);
    assert.equal(unknown.payments[0].status, "send_unknown");
    assert.equal(paymentSendCount, before + 1);
    mode = "ok";
    await within(() => paymentsService.process(id));
    await assert.rejects(
      within(() => paymentsService.send(invoice.id, id, actor)),
    );
    await within(async () =>
      service.processReconcile((await row(invoice.id)).id),
    );
    assert.equal(
      (await within(() => paymentsService.view(invoice.id))).payments[0].status,
      "send_unknown",
      "a similar amount/date is never sufficient proof",
    );
    const second = await recordReceipt(
      invoice.id,
      receipt(1, "BANK-FAKE-SECOND", "10.00"),
    );
    const blocked = await sendReceipt(invoice.id, second.payments[1].id);
    assert.equal(blocked.payments[1].status, "recorded");
    assert.equal(
      blocked.payments[1].last_error_code,
      "SUPERPDP_PAYMENT_HISTORY",
    );
    assert.equal(paymentSendCount, before + 1);
  }
});

test("encaissements : crash après intention durable, administrateur désactivé et paramètres distants modifiés", async () => {
  const invoice = await b2cInvoice();
  const view = await recordReceipt(invoice.id);
  const id = view.payments[0].id;
  const before = paymentSendCount;
  await within(() => paymentsService.send(invoice.id, id, actor));
  onDebits = true;
  await within(() => paymentsService.process(id));
  assert.equal(
    (await within(() => paymentsService.view(invoice.id))).payments[0].status,
    "recorded",
  );
  onDebits = false;
  await within(() => paymentsService.send(invoice.id, id, actor));
  await db.systemPrisma.appUser.update({
    where: { id: actor.userId },
    data: { is_active: false },
  });
  await within(() => paymentsService.process(id));
  await db.systemPrisma.appUser.update({
    where: { id: actor.userId },
    data: { is_active: true },
  });
  assert.equal(
    (await within(() => paymentsService.view(invoice.id))).payments[0]
      .last_error_code,
    "SUPERPDP_OWNER_REQUIRED",
  );
  await db.systemPrisma.electronicInvoicePayment.update({
    where: { id },
    data: {
      status: "sending",
      post_started_at: new Date(),
      operation_id: "crashed",
      operation_expires_at: new Date(0),
    },
  });
  await within(() => paymentsService.process(id));
  assert.equal(
    (await within(() => paymentsService.view(invoice.id))).payments[0].status,
    "send_unknown",
  );
  assert.equal(paymentSendCount, before);
});

test(
  "encaissements : sauvegarde assainie conserve le journal mais suspend les messages et tâches",
  { skip: !!postgresUrl },
  async () => {
    const invoice = await b2cInvoice();
    const recorded = await recordReceipt(invoice.id);
    const id = recorded.payments[0].id;
    await within(() => paymentsService.send(invoice.id, id, actor));
    const archive = path.join(temp, "b2c-backup.tar.gz");
    const backup = spawnSync(
      process.execPath,
      ["scripts/installation-data.mjs", "backup", archive],
      { cwd: root, env: process.env, encoding: "utf8" },
    );
    assert.equal(backup.status, 0, backup.stderr + backup.stdout);
    const extracted = path.join(temp, "b2c-extracted");
    fs.mkdirSync(extracted);
    assert.equal(
      spawnSync("tar", ["-xzf", archive, "-C", extracted]).status,
      0,
    );
    const query = spawnSync(
      "sqlite3",
      [
        path.join(extracted, "database", "database.sqlite"),
        `SELECT reference,status FROM electronic_invoice_payments WHERE id='${id}'; SELECT count(*) FROM organization_jobs WHERE type='superpdp.payment' AND status IN ('queued','running'); PRAGMA foreign_key_check;`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(query.status, 0, query.stderr);
    assert.equal(query.stdout.trim(), "BANK-FAKE-1|paused_after_restore\n0");
    assert.equal(
      (await within(() => paymentsService.view(invoice.id))).payments[0].status,
      "queued",
      "source database is unchanged",
    );
    await db.systemPrisma.electronicInvoicePayment.update({
      where: { id },
      data: { status: "paused_after_restore" },
    });
    const before = calls.length;
    await within(() => paymentsService.process(id));
    await assert.rejects(
      within(() => paymentsService.send(invoice.id, id, actor)),
    );
    assert.equal(calls.length, before);
  },
);

test("encaissements : garde serveur B2C et tâche versionnée sans secret ni appel automatique désactivé", async () => {
  const invoice = await b2cInvoice();
  const recorded = await recordReceipt(invoice.id);
  const id = recorded.payments[0].id;
  const { createPaymentJobHandlers } =
    await import("../src/modules/superpdp/worker.js");
  const handlers = createPaymentJobHandlers(paymentsService);
  await within(() => paymentsService.send(invoice.id, id, actor));
  const job = await db.systemPrisma.organizationJob.findFirstOrThrow({
    where: {
      type: "superpdp.payment",
      idempotency_key: { startsWith: `superpdp.payment:${id}:` },
    },
  });
  assert.equal(JSON.stringify(job).includes("fake-access"), false);
  runtime.env.SUPERPDP_SANDBOX_B2C_ENABLED = false;
  const before = calls.length;
  await assert.rejects(within(() => handlers["superpdp.payment"](job)));
  assert.equal(calls.length, before);
  assert.equal(
    (await within(() => paymentsService.view(invoice.id))).available,
    false,
  );
  runtime.env.SUPERPDP_SANDBOX_B2C_ENABLED = true;
  await within(() => handlers["superpdp.payment"](job));
  assert.equal(
    (await within(() => paymentsService.view(invoice.id))).payments[0].status,
    "submitted",
  );
  assert.equal(
    calls.some((c) => /b2c_transactions|b2c_payments/.test(c)),
    false,
    "no duplicate direct e-reporting path",
  );
});

test("encaissements : réponse normalisée sémantiquement, pas dépendante de l’ordre JSON ou des zéros décimaux", async () => {
  const invoice = await b2cInvoice();
  const recorded = await recordReceipt(invoice.id);
  mode = "normalized-payment";
  assert.equal(
    (await sendReceipt(invoice.id, recorded.payments[0].id)).payments[0].status,
    "submitted",
  );
  mode = "ok";
});

test("encaissements : deux saisies concurrentes ne peuvent dépasser le total TTC", async () => {
  const invoice = await b2cInvoice();
  const results = await Promise.allSettled([
    recordReceipt(invoice.id, receipt(0, "BANK-CONCURRENT-A", "70.00")),
    recordReceipt(invoice.id, receipt(0, "BANK-CONCURRENT-B", "70.00")),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const journal = await within(() => paymentsService.view(invoice.id));
  assert.equal(journal.payments.length, 1);
  assert.equal(journal.payments[0].amount, "70.00");
});

test("encaissements : rejet distant et message 212 externe bloquent un nouveau paiement sans effet distant", async () => {
  for (const status of [
    "api:invalid",
    "fr:213",
    "ppf:payment-received-rejected",
    "fr:212",
  ]) {
    const invoice = await b2cInvoice();
    const recorded = await recordReceipt(invoice.id);
    const stored = await row(invoice.id);
    remoteEvents.push({
      id: String(9007199254740993300n + BigInt(++serial)),
      invoice_id: stored.remote_invoice_id!,
      status_code: status,
      created_at: "2026-10-16T10:00:00Z",
      status_text: "Événement fictif",
    });
    const before = paymentSendCount;
    const blocked = await sendReceipt(invoice.id, recorded.payments[0].id);
    assert.equal(blocked.payments[0].status, "recorded");
    assert.equal(
      blocked.payments[0].last_error_code,
      "SUPERPDP_PAYMENT_HISTORY",
    );
    assert.equal(paymentSendCount, before);
  }
});

test("encaissements : un avoir local émis bloque les nouveaux mouvements et les envois en attente", async () => {
  const invoice = await b2cInvoice();
  const recorded = await recordReceipt(invoice.id);
  const id = recorded.payments[0].id;
  await within(() => paymentsService.send(invoice.id, id, actor));
  await newInvoice({ credited_invoice_id: invoice.id }, { credit: true });
  const before = paymentSendCount;
  assert.equal(
    (await within(() => paymentsService.view(invoice.id))).available,
    false,
  );
  await assert.rejects(
    recordReceipt(invoice.id, receipt(1, "BANK-AFTER-CREDIT", "1.00")),
    /avoir/,
  );
  await within(() => paymentsService.process(id));
  const journal = await within(() => paymentsService.view(invoice.id));
  assert.equal(journal.payments[0].status, "recorded");
  assert.equal(
    journal.payments[0].last_error_code,
    "SUPERPDP_PAYMENT_CREDITED",
  );
  assert.equal(paymentSendCount, before);
});

const readiness = async (entityId = "entity-a", cookie = cookieA) => {
  const response = await fetch(
    `${origin}/api/fiscal-entities/${entityId}/superpdp/readiness`,
    { headers: cookie ? { cookie } : {} },
  );
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
};

test("bilan de recette : lecture propriétaire, isolement des comptes et réponses privées", async () => {
  assert.equal((await readiness("entity-a", "")).status, 401);
  assert.equal((await readiness("entity-a", cookieWorker)).status, 403);
  assert.equal((await readiness("entity-a", cookieB)).status, 404);
  assert.equal((await readiness("entity-b", cookieA)).status, 404);
  const own = await readiness("entity-b", cookieB);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get("cache-control"), "no-store");
  assert.equal(own.headers.get("referrer-policy"), "no-referrer");
  assert.equal(own.body.fiscal_entity_id, "entity-b");
  assert.equal(own.body.counts.transmissions.total, 0);
  assert.equal(own.body.counts.payments.total, 0);
  assert.equal(own.body.production.enabled, false);
  assert.equal(own.body.read_only, true);
});

test("bilan de recette : aucun appel fournisseur, aucun déchiffrement requis ni écriture métier", async () => {
  const originalFetch = globalThis.fetch;
  const providerCalls = calls.length;
  const before = await db.systemPrisma.superPdpConnection.findUniqueOrThrow({
    where: { id: "connection-a" },
  });
  const jobs = await db.systemPrisma.organizationJob.count();
  const audits = await db.systemPrisma.auditLog.count();
  let result: Awaited<ReturnType<typeof readiness>>;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(
        new URL(String(input)).origin,
        origin,
        "Readiness must never call a provider endpoint",
      );
      return originalFetch(input, init);
    };
    result = await readiness();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(result!.status, 200);
  assert.equal(calls.length, providerCalls);
  assert.deepEqual(
    await db.systemPrisma.superPdpConnection.findUniqueOrThrow({
      where: { id: "connection-a" },
    }),
    before,
  );
  assert.equal(await db.systemPrisma.organizationJob.count(), jobs);
  assert.equal(await db.systemPrisma.auditLog.count(), audits);
  const serialized = JSON.stringify(result!.body);
  for (const secret of [
    "fake-secret",
    "fake-access",
    "fake-refresh",
    "encrypted_tokens",
    "encrypted_client_secret",
    "client_id",
    "payload_json",
    companyId,
  ])
    assert.equal(serialized.includes(secret), false);
  assert.equal(
    result!.body.manual_checks.every(
      (c: { state: string }) => c.state === "not_verified",
    ),
    true,
  );
  assert.equal(result!.body.production.status, "blocked");
});

test("bilan de recette : comptages par entreprise, incertitudes et suspensions jamais transformées en feu vert", async () => {
  const transmission =
    await db.systemPrisma.electronicInvoiceTransmission.findFirstOrThrow({
      where: { organization_id: orgA, fiscal_entity_id: "entity-a" },
    });
  await db.systemPrisma.electronicInvoiceEvent.create({
    data: {
      organization_id: orgA,
      transmission_id: transmission.id,
      event_key: "remote:999999",
      status_code: "api:invalid",
      occurred_at: new Date(),
      payload_json: "{}",
    },
  });
  // Explicit fixture: the SQLite-only backup scenario must not be a dependency of this test.
  const pausedPayment =
    await db.systemPrisma.electronicInvoicePayment.findFirstOrThrow({
      where: { organization_id: orgA },
    });
  await db.systemPrisma.electronicInvoicePayment.update({
    where: { id: pausedPayment.id },
    data: { status: "paused_after_restore" },
  });
  const report = (await readiness()).body;
  assert.equal(
    report.counts.transmissions.total,
    await db.systemPrisma.electronicInvoiceTransmission.count({
      where: {
        organization_id: orgA,
        fiscal_entity_id: "entity-a",
        environment: "sandbox",
      },
    }),
  );
  assert.ok(report.counts.transmissions.uncertain > 0);
  assert.ok(report.counts.transmissions.paused > 0);
  assert.ok(report.counts.payments.uncertain > 0);
  assert.ok(report.counts.payments.paused > 0);
  assert.ok(report.counts.transmissions.historical_remote_errors > 0);
  assert.equal(
    report.checks.find((c: { id: string }) => c.id === "transmissions").state,
    "action_required",
  );
  assert.equal(
    report.checks.find((c: { id: string }) => c.id === "payments").state,
    "action_required",
  );
  assert.equal(report.production.enabled, false);
});

test("bilan de recette : gardes désactivées et clé invalide restent consultables sans dévoiler la configuration", async () => {
  const saved = {
    key: runtime.env.SUPERPDP_SECRETS_KEY,
    sandbox: runtime.env.SUPERPDP_SANDBOX_ENABLED,
    worker: runtime.env.ORGANIZATION_JOB_WORKER_ENABLED,
  };
  try {
    runtime.env.SUPERPDP_SANDBOX_ENABLED = false;
    runtime.env.ORGANIZATION_JOB_WORKER_ENABLED = false;
    let result = await readiness();
    assert.equal(result.status, 200);
    assert.equal(result.body.capabilities.sandbox_enabled, false);
    assert.equal(
      result.body.checks.find((c: { id: string }) => c.id === "configuration")
        .state,
      "action_required",
    );
    assert.equal(
      result.body.checks.find((c: { id: string }) => c.id === "worker").state,
      "action_required",
    );
    runtime.env.SUPERPDP_SANDBOX_ENABLED = true;
    runtime.env.SUPERPDP_SECRETS_KEY = "INVALID-SECRET-MUST-NOT-APPEAR";
    result = await readiness();
    assert.equal(result.status, 200);
    assert.equal(
      JSON.stringify(result.body).includes(runtime.env.SUPERPDP_SECRETS_KEY),
      false,
    );
    assert.equal(result.body.production.enabled, false);
  } finally {
    runtime.env.SUPERPDP_SECRETS_KEY = saved.key;
    runtime.env.SUPERPDP_SANDBOX_ENABLED = saved.sandbox;
    runtime.env.ORGANIZATION_JOB_WORKER_ENABLED = saved.worker;
  }
});

test("bilan de recette : une configuration locale sans anomalie ne certifie jamais la production", async () => {
  const entityId = "readiness-clean-entity";
  await db.systemPrisma.fiscalEntity.create({
    data: {
      id: entityId,
      organization_id: orgA,
      siren: "552100554",
      legal_name: "Recette fictive",
      vat_regime: "reel_normal",
      vat_number: "FR80552100554",
      address_line1: "1 rue fictive",
      postal_code: "35000",
      city: "Rennes",
    },
  });
  await db.systemPrisma.fiscalEstablishment.create({
    data: {
      organization_id: orgA,
      fiscal_entity_id: entityId,
      name: "Siège fictif",
      siret: "55210055400013",
    },
  });
  await db.systemPrisma.superPdpConnection.create({
    data: {
      organization_id: orgA,
      fiscal_entity_id: entityId,
      local_siren: "552100554",
      client_id: "fake-client",
      expected_number: "fake-number",
      encrypted_client_secret: "UNREADABLE-SECRET-NOT-LOADED",
      encrypted_tokens: "UNREADABLE-TOKENS-NOT-LOADED",
      status: "connected",
      remote_company_id: "99991",
      verification_status: "verified",
      last_checked_at: new Date(),
    },
  });
  const worker = runtime.env.ORGANIZATION_JOB_WORKER_ENABLED;
  runtime.env.ORGANIZATION_JOB_WORKER_ENABLED = true;
  try {
    const report = (await readiness(entityId)).body;
    assert.equal(report.summary.local_actions, 0);
    assert.equal(report.summary.state, "manual_checks_required");
    assert.equal(report.production.enabled, false);
    assert.equal(report.production.status, "blocked");
    assert.equal(
      report.manual_checks.every(
        (c: { state: string }) => c.state === "not_verified",
      ),
      true,
    );
    assert.equal(
      report.checks.find((c: { id: string }) => c.id === "connection").state,
      "observed",
    );
    assert.equal(JSON.stringify(report).includes("UNREADABLE-"), false);
    await db.systemPrisma.superPdpConnection.updateMany({
      where: { fiscal_entity_id: entityId },
      data: { last_checked_at: new Date(Date.now() - 25 * 3_600_000) },
    });
    assert.equal(
      (await readiness(entityId)).body.checks.find(
        (c: { id: string }) => c.id === "connection",
      ).state,
      "action_required",
    );
    await db.systemPrisma.superPdpConnection.updateMany({
      where: { fiscal_entity_id: entityId },
      data: { last_checked_at: new Date(), encrypted_tokens: null },
    });
    assert.equal(
      (await readiness(entityId)).body.checks.find(
        (c: { id: string }) => c.id === "connection",
      ).state,
      "action_required",
    );
  } finally {
    runtime.env.ORGANIZATION_JOB_WORKER_ENABLED = worker;
  }
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

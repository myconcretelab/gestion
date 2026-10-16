import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-superpdp-inbox-"));
const root = path.resolve(
  process.cwd().endsWith(`${path.sep}server`)
    ? process.cwd()
    : path.join(process.cwd(), "server"),
);
const postgresUrl = process.env.TEST_INBOX_POSTGRES_URL;
const databaseUrl = postgresUrl ?? `file:${path.join(temp, "test.db")}`;
const orgA = "org_inbox_a",
  orgB = "org_inbox_b";
const companies = {
  [orgA]: "9007199254740993100",
  [orgB]: "9007199254740993200",
};
let db: typeof import("../src/db/prisma.js"),
  runtime: typeof import("../src/config/env.js");
let service: InstanceType<
  typeof import("../src/modules/superpdp/inbox.js").SuperPdpInbox
>;
let runWithOrganization: typeof import("../src/modules/organizations/context.js").runWithOrganization;
let server: Server,
  origin: string,
  cookieA: string,
  cookieB: string,
  cookieWorker: string;
let serial = 0,
  mode = "ok";
const calls: string[] = [];
let onOriginal: (() => Promise<void>) | null = null;
const within = <T>(work: () => T, org = orgA) =>
  runWithOrganization({ organizationId: org, source: "test" }, work);
const actor = (org = orgA) => ({
  userId: `owner-${org}`,
  sessionHash: "local-test-only",
});
type Remote = {
  id: string;
  company_id: string;
  direction: string;
  created_at: string;
  en_invoice: Record<string, unknown> | null;
  original: Buffer;
};
const invoices: Remote[] = [];
const events: Array<{
  id: string;
  invoice_id: string;
  status_code: string;
  created_at: string;
  status_text: string;
  company_id: string;
}> = [];
const structured = () => ({
  number: `SUPPLIER-${serial}`,
  issue_date: "2026-10-16",
  type_code: 380,
  currency_code: "EUR",
  seller: {
    name: "Fournisseur fictif",
    postal_address: { country_code: "FR" },
  },
  buyer: { name: "Acheteur fictif" },
  totals: {
    total_without_vat: "100.00",
    total_vat_amount: { value: "20.00", currency_code: "EUR" },
    total_with_vat: "120.00",
  },
  lines: [{ identifier: "1", net_amount: "100.00" }],
});
const newRemote = (org = orgA, overrides: Partial<Remote> = {}) => {
  mode = "ok";
  const id = String(9007199254740994000n + BigInt(++serial));
  const invoice = {
    id,
    company_id: companies[org],
    direction: "in",
    created_at: "2026-10-16T08:00:00Z",
    en_invoice: structured(),
    original: Buffer.from(`%PDF-1.7\nFICTITIOUS PURCHASE ${id}\n%%EOF`),
    ...overrides,
  };
  invoices.push(invoice);
  return invoice;
};
const wire = (value: unknown, status = 200) =>
  new Response(
    JSON.stringify(value).replace(
      /"(id|company_id|invoice_id)":"(\d+)"/g,
      '"$1":$2',
    ),
    { status, headers: { "content-type": "application/json" } },
  );
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.superpdp.tech");
  assert.equal(init?.redirect, "error");
  calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  // No invoice/event/directory mutation, conversion, payment or e-reporting in reception.
  assert.ok(
    !init?.method || init.method === "GET" || url.pathname === "/oauth2/revoke",
  );
  const token = new Headers(init?.headers).get("authorization")?.slice(7);
  const org = token === "access-b" ? orgB : orgA;
  const company = companies[org];
  if (url.pathname === "/v1.beta/oauth2_sessions/me")
    return wire({
      client_id: `fake-client-${org}`,
      company_verification_status: "verified",
    });
  if (url.pathname === "/v1.beta/companies/me")
    return wire({
      id: company,
      number: `fake-${org}`,
      number_scheme: "sandbox",
      env: mode === "production" ? "production" : "sandbox",
      formal_name: `Entreprise fictive ${org}`,
    });
  if (url.pathname === "/oauth2/revoke") return wire({});
  if (url.pathname === "/v1.beta/invoices") {
    assert.equal(url.searchParams.get("direction"), "in");
    assert.equal(url.searchParams.get("order"), "asc");
    assert.equal(url.searchParams.get("limit"), "1");
    const cursor = url.searchParams.get("starting_after_id");
    const data = invoices.filter(
      (invoice) =>
        invoice.company_id === company &&
        (!cursor || BigInt(invoice.id) > BigInt(cursor)),
    );
    if (mode === "stalled-page") return wire({ data: [], has_after: true });
    const first = data.slice(0, 1).map(({ id, company_id, direction }) => ({
      id,
      company_id: mode === "wrong-company" ? companies[orgB] : company_id,
      direction,
    }));
    return wire({ data: first, has_after: data.length > 1 });
  }
  if (url.pathname === "/v1.beta/invoice_events") {
    const cursor = url.searchParams.get("starting_after_id");
    assert.equal(
      url.searchParams.has("invoice_id"),
      false,
      "Company-wide cursor, not one cursor for an arbitrary invoice",
    );
    const data = events.filter(
      (event) =>
        event.company_id === company &&
        (!cursor || BigInt(event.id) > BigInt(cursor)),
    );
    return wire({ data: data.slice(0, 100), has_after: data.length > 100 });
  }
  const remote = invoices.find(
    (invoice) => invoice.id === url.pathname.split("/").at(-1),
  );
  assert.ok(remote, "Unknown invoice endpoint");
  assert.equal(remote.company_id, company);
  if (url.searchParams.get("format") === "original") {
    const hook = onOriginal;
    onOriginal = null;
    if (hook) await hook();
    if (mode === "original-error")
      throw new Error("private-access-body-do-not-log");
    return new Response(
      mode === "bad-format" ? "not a document" : remote.original,
      { headers: { "content-type": "application/octet-stream" } },
    );
  }
  assert.equal(url.searchParams.get("format"), "en16931");
  const { original: _original, ...detail } = remote;
  return wire(detail);
};
const request = async (
  pathname: string,
  method = "GET",
  payload?: unknown,
  cookie = cookieA,
  withOrigin = true,
) => {
  const response = await fetch(origin + pathname, {
    method,
    headers: {
      cookie,
      "content-type": "application/json",
      ...(withOrigin ? { origin: "http://localhost:5173" } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return {
    status: response.status,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
};
const configPath = (org = orgA) =>
  `/api/fiscal-entities/entity-${org}/superpdp/inbox`;
const currentSync = (org = orgA) =>
  db.systemPrisma.superPdpInboxSync.findFirstOrThrow({
    where: { fiscal_entity_id: `entity-${org}` },
  });
const once = async (org = orgA) => {
  const sync = await currentSync(org);
  await within(() => service.process(sync.id, sync.revision), org);
};
const localInvoice = (remote: Remote) =>
  db.systemPrisma.incomingInvoice.findFirstOrThrow({
    where: { remote_invoice_id: remote.id },
  });
const imported = async (overrides: Partial<Remote> = {}) => {
  const remote = newRemote(orgA, overrides);
  await once();
  return { remote, local: await localInvoice(remote) };
};
const expense = (overrides: Record<string, unknown> = {}) =>
  db.systemPrisma.intervenantExpense.create({
    data: {
      organization_id: orgA,
      label: "Frais fournisseur fictif",
      scope: "gite",
      gite_id: `gite-${orgA}`,
      year: 2026,
      month: 10,
      amount: 120,
      ...overrides,
    },
  });
const matchPayload = (
  invoice: { revision: number },
  target: { id: string; updatedAt: Date },
) => ({
  revision: invoice.revision,
  expense_id: target.id,
  expense_updated_at: target.updatedAt.toISOString(),
  confirm_match: true,
});

before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    DATABASE_URL_SQLITE: databaseUrl,
    ...(postgresUrl ? { DATABASE_URL_POSTGRES: postgresUrl } : {}),
    DATA_DIR: path.join(temp, "data"),
    SUPERPDP_SANDBOX_ENABLED: "true",
    SUPERPDP_SANDBOX_RECEPTION_ENABLED: "true",
    SUPERPDP_SANDBOX_EMISSION_ENABLED: "false",
    SUPERPDP_SECRETS_KEY: crypto.randomBytes(32).toString("base64"),
    SUPERPDP_SANDBOX_REDIRECT_URI:
      "http://localhost:5173/api/fiscal-entities/superpdp/oauth/callback",
    APP_PUBLIC_URL: "http://localhost:5173",
    CLIENT_ORIGIN: "http://localhost:5173",
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
  for (const org of [orgA, orgB]) {
    await db.systemPrisma.organization.create({
      data: { id: org, name: org, slug: org },
    });
    await db.systemPrisma.appUser.create({
      data: {
        id: actor(org).userId,
        organization_id: org,
        display_name: "Administrateur fictif",
        login_id: actor(org).userId,
        roles: '["owner"]',
        status: "owner",
        is_owner: true,
        is_active: true,
        password_hash: "fake-test",
        password_salt: "fake-test",
      },
    });
    await db.systemPrisma.fiscalEntity.create({
      data: {
        id: `entity-${org}`,
        organization_id: org,
        legal_name: "Entreprise fictive",
        siren: "732829320",
        vat_regime: "reel_normal",
      },
    });
    await db.systemPrisma.fiscalEstablishment.create({
      data: {
        id: `establishment-${org}`,
        organization_id: org,
        fiscal_entity_id: `entity-${org}`,
        name: "Siège fictif",
        siret: "73282932000074",
      },
    });
    await db.systemPrisma.gite.create({
      data: {
        id: `gite-${org}`,
        organization_id: org,
        fiscal_establishment_id: `establishment-${org}`,
        nom: "Gîte fictif",
        prefixe_contrat: "FX",
        adresse_ligne1: "Adresse fictive",
        capacite_max: 2,
        nb_adultes_max: 2,
        proprietaires_noms: "Fictif",
        proprietaires_adresse: "Fictif",
        telephones: "[]",
        iban: "",
        titulaire: "Fictif",
        taxe_sejour_par_personne_par_nuit: 0,
      },
    });
    const context = {
      organization_id: org,
      fiscal_entity_id: `entity-${org}`,
      environment: "sandbox",
    };
    await db.systemPrisma.superPdpConnection.create({
      data: {
        ...context,
        id: `connection-${org}`,
        local_siren: "732829320",
        status: "connected",
        remote_company_id: companies[org],
        client_id: `fake-client-${org}`,
        expected_number: `fake-${org}`,
        encrypted_client_secret: seal("fake-secret", context, "client_secret"),
        encrypted_tokens: seal(
          JSON.stringify({
            access_token: org === orgA ? "access-a" : "access-b",
            refresh_token: "fake-refresh",
            expires_at: Date.now() + 86400_000,
          }),
          context,
          "tokens",
        ),
      },
    });
  }
  await db.systemPrisma.appUser.create({
    data: {
      id: "worker-inbox",
      organization_id: orgA,
      display_name: "Intervenant",
      is_owner: false,
    },
  });
  const { SuperPdpProvider } =
    await import("../src/modules/superpdp/provider.js");
  const { SuperPdpService } =
    await import("../src/modules/superpdp/service.js");
  const { SuperPdpTransport } =
    await import("../src/modules/superpdp/transport.js");
  const { SuperPdpInbox } = await import("../src/modules/superpdp/inbox.js");
  service = new SuperPdpInbox(
    new SuperPdpService(new SuperPdpProvider(fakeFetch)),
    new SuperPdpTransport(fakeFetch),
  );
  for (const org of [orgA, orgB])
    await within(
      () =>
        service.configure(
          `entity-${org}`,
          { revision: 0, enabled: true, confirm_sandbox: true },
          actor(org),
        ),
      org,
    );
  const auth = await import("../src/services/serverAuth.js");
  cookieA = `contrats_session=${(await auth.createServerAuthSession(actor().userId)).id}`;
  cookieB = `contrats_session=${(await auth.createServerAuthSession(actor(orgB).userId)).id}`;
  cookieWorker = `contrats_session=${(await auth.createServerAuthSession("worker-inbox")).id}`;
  const { createSuperPdpInboxRouter, createInboxConfigRouter } =
    await import("../src/modules/superpdp/inboxRoutes.js");
  const { default: professionalExpenses } =
    await import("../src/routes/professionalExpenses.js");
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const session = await auth.getServerAuthSessionFromRequest(req);
    runWithOrganization(
      { organizationId: session?.organizationId ?? orgA, source: "test" },
      next,
    );
  });
  app.use("/api/fiscal-entities", createInboxConfigRouter(service));
  app.use("/api/purchase-invoices", createSuperPdpInboxRouter(service));
  app.use("/api/professional-expenses", professionalExpenses);
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

test("accès propriétaire authentifié, origine obligatoire et interrupteur indépendant de l’émission", async () => {
  assert.equal(
    (await request("/api/purchase-invoices", "GET", undefined, "")).status,
    401,
  );
  assert.equal(
    (await request("/api/purchase-invoices", "GET", undefined, cookieWorker))
      .status,
    403,
  );
  assert.equal(
    (await request(configPath(), "POST", {}, cookieA, false)).status,
    404,
  );
  assert.equal(
    (await request(`${configPath()}/sync`, "POST", {}, cookieA, false)).status,
    403,
  );
  runtime.env.SUPERPDP_SANDBOX_RECEPTION_ENABLED = false;
  assert.equal((await request(configPath())).body.available, false);
  assert.equal((await request(`${configPath()}/sync`, "POST", {})).status, 503);
  runtime.env.SUPERPDP_SANDBOX_RECEPTION_ENABLED = true;
  assert.equal(runtime.env.SUPERPDP_SANDBOX_EMISSION_ENABLED, false);
});
test("import de l’original et de toutes les données structurées sans écriture comptable", async () => {
  const { remote, local } = await imported();
  const sync = await currentSync();
  assert.equal(sync.invoices_cursor, remote.id);
  assert.equal(local.total_with_vat, "120.00");
  assert.equal(local.supplier_name, "Fournisseur fictif");
  assert.deepEqual(
    (await within(() => service.original(local.id))).contents,
    remote.original,
  );
  assert.deepEqual(
    await within(() => service.structured(local.id)),
    remote.en_invoice,
  );
  assert.equal(await db.systemPrisma.intervenantExpense.count(), 0);
  assert.equal(await db.systemPrisma.expenseEntry.count(), 0);
  assert.equal(await db.systemPrisma.facture.count(), 0);
  const download = await request(`/api/purchase-invoices/${local.id}/original`);
  assert.equal(
    download.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.match(download.headers.get("content-disposition")!, /attachment/);
  assert.deepEqual(download.body, remote.original);
  const view = await request(`/api/purchase-invoices/${local.id}`);
  assert.equal(JSON.stringify(view).includes("fake-secret"), false);
  assert.equal(JSON.stringify(view).includes("original_path"), false);
});
test("pagination par identifiants 64 bits, reprise idempotente et isolation de deux entreprises", async () => {
  const a = newRemote();
  const b = newRemote();
  const other = newRemote(orgB);
  await once();
  assert.equal((await currentSync()).invoices_cursor, a.id);
  await once();
  assert.equal((await currentSync()).invoices_cursor, b.id);
  await once();
  assert.equal(
    await db.systemPrisma.incomingInvoice.count({
      where: { remote_invoice_id: b.id },
    }),
    1,
  );
  await once(orgB);
  assert.equal((await currentSync(orgB)).invoices_cursor, other.id);
  const local = await localInvoice(a);
  assert.equal(
    (
      await request(
        `/api/purchase-invoices/${local.id}`,
        "GET",
        undefined,
        cookieB,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/api/purchase-invoices/${local.id}/original`,
        "GET",
        undefined,
        cookieB,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/api/purchase-invoices/${local.id}/structured`,
        "GET",
        undefined,
        cookieB,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request("/api/purchase-invoices", "GET", undefined, cookieB)).body
      .count,
    1,
  );
});
test("échec réseau sur l’original : aucun curseur ne progresse et le document est repris", async () => {
  const remote = newRemote();
  const before = await currentSync();
  mode = "original-error";
  await assert.rejects(
    once(),
    (error: Error) => !error.message.includes("private-access-body"),
  );
  const after = await currentSync();
  assert.equal(after.invoices_cursor, before.invoices_cursor);
  assert.equal(after.events_cursor, before.events_cursor);
  assert.equal(
    await db.systemPrisma.incomingInvoice.count({
      where: { remote_invoice_id: remote.id },
    }),
    0,
  );
  mode = "ok";
  await once();
  assert.ok(await localInvoice(remote));
});
test("une page vide annoncée non terminée ou une entreprise inattendue bloque la pagination", async () => {
  const remote = newRemote();
  const before = (await currentSync()).invoices_cursor;
  mode = "stalled-page";
  await assert.rejects(once());
  assert.equal((await currentSync()).invoices_cursor, before);
  mode = "wrong-company";
  await assert.rejects(once());
  assert.equal((await currentSync()).invoices_cursor, before);
  mode = "ok";
  await once();
  assert.ok(await localInvoice(remote));
});
test("les événements arrivés avant leur facture sont conservés et associés après l’import", async () => {
  const futureId = String(9007199254740994000n + BigInt(serial + 1));
  events.push({
    id: "9007199254740999000",
    invoice_id: futureId,
    company_id: companies[orgA],
    status_code: "future:unknown",
    created_at: "2026-10-16T08:00:00Z",
    status_text: "Événement anticipé fictif",
  });
  await once();
  assert.equal((await currentSync()).events_cursor, "9007199254740999000");
  const remote = newRemote();
  assert.equal(remote.id, futureId);
  await once();
  const local = await localInvoice(remote);
  const detail = await within(() => service.detail(local.id));
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].status_code, "future:unknown");
  await once();
  assert.equal(
    await db.systemPrisma.superPdpInboxEvent.count({
      where: { remote_event_id: "9007199254740999000" },
    }),
    1,
  );
});
test("journal global paginé sans dépendre des factures déjà présentes, y compris les événements de vente", async () => {
  for (let i = 1; i <= 102; i++)
    events.push({
      id: String(9007199254740999000n + BigInt(i)),
      invoice_id: "999",
      company_id: companies[orgA],
      status_code: "api:uploaded",
      created_at: "2026-10-16T08:00:00Z",
      status_text: "Événement hors boîte entrante",
    });
  await once();
  const first = (await currentSync()).events_cursor;
  await once();
  assert.ok(BigInt((await currentSync()).events_cursor!) > BigInt(first!));
  assert.equal(
    await db.systemPrisma.superPdpInboxEvent.count({
      where: { sync_id: (await currentSync()).id },
    }),
    103,
  );
  assert.equal(await db.systemPrisma.facture.count(), 0);
});
test("extraction tardive : original conservé, détails complétés sans perdre le curseur", async () => {
  const remote = newRemote(orgA, { en_invoice: null });
  await once();
  const local = await localInvoice(remote);
  assert.ok(local.details_next_check_at);
  assert.equal(local.structured_json, null);
  remote.en_invoice = structured();
  await db.systemPrisma.incomingInvoice.update({
    where: { id: local.id },
    data: { details_next_check_at: new Date(Date.now() - 1) },
  });
  await once();
  const updated = await localInvoice(remote);
  assert.equal(updated.details_next_check_at, null);
  assert.equal(updated.total_with_vat, "120.00");
  assert.equal(updated.original_sha256, local.original_sha256);
});
test("archivage XML sans exécution, formats inconnus refusés et empreinte vérifiée au téléchargement", async () => {
  const { remote, local } = await imported({
    original: Buffer.from(
      '<?xml version="1.0"?><Invoice><ID>fictif</ID></Invoice>',
    ),
  });
  const download = await request(`/api/purchase-invoices/${local.id}/original`);
  assert.match(download.headers.get("content-disposition")!, /\.xml/);
  assert.deepEqual(download.body, remote.original);
  const target = path.join(
    temp,
    "data",
    "organizations",
    orgA,
    local.original_path,
  );
  fs.appendFileSync(target, "tampered");
  await assert.rejects(within(() => service.original(local.id)));
  fs.writeFileSync(target, remote.original);
  const bad = newRemote();
  mode = "bad-format";
  const before = (await currentSync()).invoices_cursor;
  await assert.rejects(once());
  assert.equal((await currentSync()).invoices_cursor, before);
  mode = "ok";
  await once();
  assert.ok(await localInvoice(bad));
});
test("arrêt et révision : anciennes tâches ignorées, arrêt possible lorsque le connecteur est désactivé", async () => {
  const sync = await currentSync();
  runtime.env.SUPERPDP_SANDBOX_RECEPTION_ENABLED = false;
  const stopped = await within(() =>
    service.configure(
      `entity-${orgA}`,
      { revision: sync.revision, enabled: false, confirm_sandbox: true },
      actor(),
    ),
  );
  assert.equal(stopped.sync?.enabled, false);
  runtime.env.SUPERPDP_SANDBOX_RECEPTION_ENABLED = true;
  const before = calls.length;
  await within(() => service.process(sync.id, sync.revision));
  assert.equal(calls.length, before);
  await assert.rejects(
    within(() =>
      service.configure(
        `entity-${orgA}`,
        { revision: sync.revision, enabled: true, confirm_sandbox: true },
        actor(),
      ),
    ),
  );
  await within(() =>
    service.configure(
      `entity-${orgA}`,
      { revision: stopped.revision, enabled: true, confirm_sandbox: true },
      actor(),
    ),
  );
});
test("un arrêt pendant le téléchargement empêche le commit et préserve les curseurs", async () => {
  const remote = newRemote();
  const before = await currentSync();
  onOriginal = async () => {
    await within(() =>
      service.configure(
        `entity-${orgA}`,
        { revision: before.revision, enabled: false, confirm_sandbox: true },
        actor(),
      ),
    );
  };
  await assert.rejects(once());
  const stopped = await currentSync();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.invoices_cursor, before.invoices_cursor);
  assert.equal(
    await db.systemPrisma.incomingInvoice.count({
      where: { remote_invoice_id: remote.id },
    }),
    0,
  );
  await within(() =>
    service.configure(
      `entity-${orgA}`,
      { revision: stopped.revision, enabled: true, confirm_sandbox: true },
      actor(),
    ),
  );
  await once();
  assert.ok(await localInvoice(remote));
});

test("changer d’entreprise distante ne réattribue pas une boîte historique", async () => {
  const sync = await currentSync();
  const connectionId = `connection-${orgA}`;
  await db.systemPrisma.superPdpConnection.update({
    where: { id: connectionId },
    data: { remote_company_id: "9007199254740993333" },
  });
  try {
    const state = await within(() => service.state(`entity-${orgA}`));
    assert.equal(state.available, false);
    await assert.rejects(
      within(() =>
        service.configure(
          `entity-${orgA}`,
          { revision: sync.revision, enabled: true, confirm_sandbox: true },
          actor(),
        ),
      ),
      /historique/,
    );
    assert.equal((await currentSync()).remote_company_id, companies[orgA]);
  } finally {
    await db.systemPrisma.superPdpConnection.update({
      where: { id: connectionId },
      data: { remote_company_id: companies[orgA] },
    });
  }
});

test("synchronisations concurrentes : un seul import et des curseurs cohérents", async () => {
  const remote = newRemote();
  await Promise.allSettled([once(), once()]);
  assert.equal(
    await db.systemPrisma.incomingInvoice.count({
      where: { remote_invoice_id: remote.id },
    }),
    1,
  );
});
test("rapprochement manuel intégral : dépense inchangée, lien réversible et audit sans secret", async () => {
  const { local } = await imported();
  const target = await expense();
  const before = await db.systemPrisma.intervenantExpense.findUnique({
    where: { id: target.id },
  });
  const candidates = await within(() => service.candidates(local.id));
  assert.ok(candidates.items.some((item) => item.id === target.id));
  assert.equal(
    typeof candidates.items.find((item) => item.id === target.id)!.amount,
    "number",
  );
  const response = await request(
    `/api/purchase-invoices/${local.id}/match`,
    "PUT",
    matchPayload(local, target),
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.invoice.expense.id, target.id);
  assert.equal(typeof response.body.invoice.expense.amount, "number");
  assert.equal(response.body.invoice.expense_changed, false);
  assert.deepEqual(
    await db.systemPrisma.intervenantExpense.findUnique({
      where: { id: target.id },
    }),
    before,
  );
  assert.equal(
    (await request(`/api/professional-expenses/one-off/${target.id}`, "DELETE"))
      .status,
    409,
  );
  const unlink = await request(
    `/api/purchase-invoices/${local.id}/match`,
    "DELETE",
    { revision: response.body.invoice.revision, confirm_unlink: true },
  );
  assert.equal(unlink.status, 200);
  assert.equal(unlink.body.invoice.expense, null);
  assert.deepEqual(
    await db.systemPrisma.intervenantExpense.findUnique({
      where: { id: target.id },
    }),
    before,
  );
});
test("une dépense ne peut pas justifier deux factures, même avec deux requêtes concurrentes", async () => {
  const first = await imported(),
    second = await imported();
  const target = await expense();
  const results = await Promise.all([
    request(
      `/api/purchase-invoices/${first.local.id}/match`,
      "PUT",
      matchPayload(first.local, target),
    ),
    request(
      `/api/purchase-invoices/${second.local.id}/match`,
      "PUT",
      matchPayload(second.local, target),
    ),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(
    await db.systemPrisma.incomingInvoice.count({
      where: { expense_id: target.id },
    }),
    1,
  );
});
test("rapprochement refusé pour un autre compte, un autre montant, une dépense périmée ou une confirmation absente", async () => {
  const { local } = await imported();
  const foreign = await expense({
    organization_id: orgB,
    gite_id: `gite-${orgB}`,
  });
  assert.equal(
    (
      await request(
        `/api/purchase-invoices/${local.id}/match`,
        "PUT",
        matchPayload(local, foreign),
      )
    ).status,
    409,
  );
  const wrongAmount = await expense({ amount: 121 });
  assert.equal(
    (
      await request(
        `/api/purchase-invoices/${local.id}/match`,
        "PUT",
        matchPayload(local, wrongAmount),
      )
    ).status,
    409,
  );
  if (!postgresUrl) {
    const fractional = await expense({ amount: 120.001 });
    assert.equal(
      (
        await request(
          `/api/purchase-invoices/${local.id}/match`,
          "PUT",
          matchPayload(local, fractional),
        )
      ).status,
      409,
    );
  }
  const target = await expense();
  const payload = matchPayload(local, target);
  assert.equal(
    (
      await request(`/api/purchase-invoices/${local.id}/match`, "PUT", {
        ...payload,
        confirm_match: false,
      })
    ).status,
    400,
  );
  await db.systemPrisma.intervenantExpense.update({
    where: { id: target.id },
    data: {
      notes: "Modification concurrente",
      updatedAt: new Date(target.updatedAt.getTime() + 1000),
    },
  });
  assert.equal(
    (await request(`/api/purchase-invoices/${local.id}/match`, "PUT", payload))
      .status,
    409,
  );
});
test("un autre SIREN dans le même compte ne peut pas recevoir le rapprochement d’un gîte", async () => {
  const { local } = await imported();
  await db.systemPrisma.fiscalEntity.create({
    data: {
      id: "secondary-entity",
      organization_id: orgA,
      legal_name: "Autre entreprise fictive",
      siren: "552100554",
    },
  });
  await db.systemPrisma.fiscalEstablishment.create({
    data: {
      id: "secondary-establishment",
      organization_id: orgA,
      fiscal_entity_id: "secondary-entity",
      name: "Autre établissement",
    },
  });
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    ...base
  } = await db.systemPrisma.gite.findUniqueOrThrow({
    where: { id: `gite-${orgA}` },
  });
  await db.systemPrisma.gite.create({
    data: {
      ...base,
      id: "secondary-gite",
      prefixe_contrat: "OT",
      fiscal_establishment_id: "secondary-establishment",
    },
  });
  const target = await expense({ gite_id: "secondary-gite" });
  assert.equal(
    (await within(() => service.candidates(local.id))).items.some(
      (item) => item.id === target.id,
    ),
    false,
  );
  assert.equal(
    (
      await request(
        `/api/purchase-invoices/${local.id}/match`,
        "PUT",
        matchPayload(local, target),
      )
    ).status,
    409,
  );
});

test("avoirs, devises étrangères et montants non représentables en centimes ne sont pas rapprochés automatiquement", async () => {
  for (const changes of [
    { type_code: 381 },
    { currency_code: "USD" },
    { totals: { total_without_vat: "100", total_with_vat: "120.001" } },
  ]) {
    const { local } = await imported({
      en_invoice: { ...structured(), ...changes },
    });
    const candidates = await within(() => service.candidates(local.id));
    assert.equal(candidates.items.length, 0);
  }
});
test("une modification ultérieure de la dépense est signalée sans réécrire le document reçu", async () => {
  const { local } = await imported();
  const target = await expense();
  await within(() =>
    service.match(local.id, matchPayload(local, target), actor()),
  );
  await db.systemPrisma.intervenantExpense.update({
    where: { id: target.id },
    data: { amount: 130 },
  });
  const detail = await within(() => service.detail(local.id));
  assert.equal(detail.invoice.expense_changed, true);
  assert.equal(detail.invoice.total_with_vat, "120.00");
});
test("les clés étrangères empêchent les liens documentaires entre comptes", async () => {
  const { local } = await imported();
  const foreign = await expense({
    organization_id: orgB,
    gite_id: `gite-${orgB}`,
  });
  await assert.rejects(
    db.systemPrisma.incomingInvoice.update({
      where: { id: local.id },
      data: { expense_id: foreign.id },
    }),
  );
  await assert.rejects(
    db.systemPrisma.incomingInvoice.update({
      where: { id: local.id },
      data: { sync_id: (await currentSync(orgB)).id },
    }),
  );
  await assert.rejects(
    db.systemPrisma.incomingInvoice.update({
      where: { id: local.id },
      data: { remote_company_id: companies[orgB] },
    }),
  );
});
test("un worker concurrent occupé ne désactive pas la synchronisation de l’autre worker", async () => {
  await db.systemPrisma.organizationJob.updateMany({
    data: { status: "completed" },
  });
  const sync = await currentSync();
  await db.systemPrisma.superPdpInboxSync.update({
    where: { id: sync.id },
    data: { next_sync_at: new Date(Date.now() - 1000) },
  });
  const { SuperPdpInbox } = await import("../src/modules/superpdp/inbox.js");
  const { runSuperPdpJobBatch } =
    await import("../src/modules/superpdp/worker.js");
  const originalSchedule = SuperPdpInbox.prototype.schedule;
  try {
    SuperPdpInbox.prototype.schedule = async () => {
      throw Object.assign(new Error("Concurrent worker"), {
        code: "SUPERPDP_BUSY",
      });
    };
    await runSuperPdpJobBatch("concurrent-inbox-worker");
    const unchanged = await currentSync();
    assert.equal(unchanged.enabled, true);
    assert.equal(unchanged.revision, sync.revision);
  } finally {
    SuperPdpInbox.prototype.schedule = originalSchedule;
    await db.systemPrisma.superPdpInboxSync.update({
      where: { id: sync.id },
      data: { next_sync_at: new Date(Date.now() + 300_000) },
    });
  }
});

test("la file persistante traite la réception même quand l’émission est désactivée", async () => {
  await db.systemPrisma.organizationJob.updateMany({
    data: { status: "completed" },
  });
  const remote = newRemote();
  await within(() => service.schedule(`entity-${orgA}`));
  // A previous job from this five-second scheduling bucket may already exist; enqueue one explicit test key.
  const sync = await currentSync();
  await db.systemPrisma.organizationJob.create({
    data: {
      organization_id: orgA,
      type: "superpdp.inbox",
      idempotency_key: `test-inbox:${crypto.randomUUID()}`,
      payload_json: JSON.stringify({
        sync_id: sync.id,
        revision: sync.revision,
      }),
    },
  });
  const { runSuperPdpJobBatch } =
    await import("../src/modules/superpdp/worker.js");
  const originalFetch = globalThis.fetch;
  let result: Awaited<ReturnType<typeof runSuperPdpJobBatch>>;
  try {
    globalThis.fetch = fakeFetch;
    result = await runSuperPdpJobBatch("inbox-test-worker");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(result.some((job) => job.status === "succeeded"));
  assert.ok(await localInvoice(remote));
  assert.equal(runtime.env.SUPERPDP_SANDBOX_EMISSION_ENABLED, false);
});
test(
  "la copie SQLite conserve achats et fichiers, supprime les secrets et suspend les imports",
  { skip: !!postgresUrl },
  async () => {
    const { local, remote } = await imported();
    const archive = path.join(temp, "backup.tar.gz"),
      extracted = path.join(temp, "extracted");
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
          local.original_path,
        ),
      ),
      remote.original,
    );
    const query = spawnSync(
      "sqlite3",
      [
        path.join(extracted, "database", "database.sqlite"),
        "SELECT count(*) FROM superpdp_inbox_syncs WHERE enabled=1 OR next_sync_at IS NOT NULL; SELECT count(*) FROM superpdp_connections WHERE encrypted_tokens IS NOT NULL OR encrypted_client_secret IS NOT NULL; PRAGMA foreign_key_check;",
      ],
      { encoding: "utf8" },
    );
    assert.equal(query.status, 0, query.stderr);
    assert.equal(query.stdout.trim(), "0\n0");
    assert.equal((await currentSync()).enabled, true);
  },
);
test("une entreprise de production est refusée avant toute récupération de facture", async () => {
  mode = "production";
  const before = calls.length;
  await assert.rejects(once());
  assert.equal(
    calls.slice(before).some((call) => call.includes("/v1.beta/invoices")),
    false,
  );
});

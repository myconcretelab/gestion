import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-superpdp-test-"));
const serverRoot = path.resolve(
  process.cwd().endsWith(`${path.sep}server`)
    ? process.cwd()
    : path.join(process.cwd(), "server"),
);
const postgresUrl = process.env.TEST_SUPERPDP_POSTGRES_URL;
const databaseUrl = postgresUrl ?? `file:${path.join(temp, "test.db")}`;
const publicOrigin = "http://localhost:5173";
const callbackPath = "/api/fiscal-entities/superpdp/oauth/callback";
const orgA = "org_superpdp_a",
  orgB = "org_superpdp_b";
let database: typeof import("../src/db/prisma.js");
let auth: typeof import("../src/services/serverAuth.js");
let secrets: typeof import("../src/modules/superpdp/secrets.js");
let runtime: typeof import("../src/config/env.js");
let server: Server;
let origin: string;
let cookieA: string,
  cookieB: string,
  cookieOtherSession: string,
  cookieWorker: string;
let serial = 0;

type Grant = {
  clientId: string;
  number: string;
  numberScheme: string;
  environment: string;
  verification: string;
  challenge: string;
  redirect: string;
  companyId: string;
};
const codes = new Map<string, Grant>();
const access = new Map<string, Grant>();
const refresh = new Map<string, Grant>();
const calls: string[] = [];
let failRefresh = false,
  failRevoke = false,
  wrongClient = false;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const issueTokens = (grant: Grant) => {
  const nonce = ++serial;
  const accessToken = `fake-access-${nonce}`,
    refreshToken = `fake-refresh-${nonce}`;
  access.set(accessToken, grant);
  refresh.set(refreshToken, grant);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 1800,
  };
};
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.superpdp.tech");
  assert.equal(init?.redirect, "error");
  calls.push(url.pathname);
  const headers = new Headers(init?.headers);
  if (url.pathname === "/oauth2/token") {
    const clientId = decodeURIComponent(
      Buffer.from(headers.get("authorization")!.slice(6), "base64")
        .toString()
        .split(":")[0],
    );
    const form = new URLSearchParams(String(init?.body));
    if (form.get("grant_type") === "authorization_code") {
      const code = form.get("code")!;
      const grant = codes.get(code);
      if (!grant || grant.clientId !== clientId)
        return response(
          {
            error: "invalid_grant",
            error_description: "Never echo provider-secret-material",
          },
          400,
        );
      assert.equal(form.get("redirect_uri"), grant.redirect);
      assert.equal(
        crypto
          .createHash("sha256")
          .update(form.get("code_verifier")!)
          .digest("base64url"),
        grant.challenge,
      );
      codes.delete(code);
      return response(issueTokens(grant));
    }
    assert.equal(form.get("grant_type"), "refresh_token");
    const previous = form.get("refresh_token")!;
    const grant = refresh.get(previous);
    if (!grant)
      return response(
        {
          error: "invalid_grant",
          error_description: "Never echo provider-secret-material",
        },
        400,
      );
    refresh.delete(previous);
    const next = issueTokens(grant);
    if (failRefresh)
      throw new Error(
        "Never echo provider-secret-material: simulated lost rotating response",
      );
    return response(next);
  }
  if (url.pathname === "/oauth2/revoke") {
    if (failRevoke) return response({ error: "server_error" }, 500);
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("token_type_hint"), "refresh_token");
    refresh.delete(form.get("token")!);
    return response({});
  }
  const token = headers.get("authorization")?.slice(7);
  const grant = access.get(token ?? "");
  if (!grant) return response({ error: "invalid_token" }, 401);
  if (url.pathname === "/v1.beta/oauth2_sessions/me")
    return response({
      client_id: wrongClient ? "another-client" : grant.clientId,
      company_verification_status: grant.verification,
      created_at: new Date().toISOString(),
    });
  assert.equal(
    url.pathname,
    "/v1.beta/companies/me",
    "No invoice, directory or reporting calls are allowed in phase 4",
  );
  // Deliberately serialize a 64-bit integer without rounding it through a JS Number.
  return new Response(
    `{"id":${grant.companyId},"env":"${grant.environment}","number_scheme":"${grant.numberScheme}","number":"${grant.number}","formal_name":"Entreprise fictive ${grant.number}"}`,
    { headers: { "content-type": "application/json" } },
  );
};

const request = async (
  url: string,
  method = "GET",
  body?: unknown,
  cookie = cookieA,
  requestOrigin: string | null = publicOrigin,
) => {
  const result = await fetch(origin + url, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const isJson = result.headers
    .get("content-type")
    ?.includes("application/json");
  return {
    status: result.status,
    body: isJson ? await result.json() : null,
    location: result.headers.get("location"),
    cache: result.headers.get("cache-control"),
  };
};
const endpoint = (id: string) => `/api/fiscal-entities/${id}/superpdp`;
const createEntity = async (organizationId = orgA) => {
  const n = ++serial;
  return database.systemPrisma.fiscalEntity.create({
    data: {
      id: `fiscal-${n}`,
      organization_id: organizationId,
      legal_name: `Entreprise locale ${n}`,
      siren: String(100000000 + n),
    },
  });
};
const configure = async (
  id: string,
  options: { cookie?: string; number?: string } = {},
) => {
  const status = await request(
    endpoint(id),
    "GET",
    undefined,
    options.cookie ?? cookieA,
  );
  const result = await request(
    endpoint(id) + "/config",
    "PUT",
    {
      revision: status.body.revision,
      client_id: `test-client-${id}`,
      client_secret: "fake-client-secret-for-testing-only",
      sandbox_number: options.number ?? `sandbox-${id}`,
    },
    options.cookie ?? cookieA,
  );
  assert.equal(result.status, 200, result.body?.code);
  return result.body;
};
const begin = async (
  id: string,
  options: {
    cookie?: string;
    environment?: string;
    numberScheme?: string;
    number?: string;
    companyId?: string;
    verification?: string;
  } = {},
) => {
  const result = await request(
    endpoint(id) + "/connect",
    "POST",
    {},
    options.cookie ?? cookieA,
  );
  assert.equal(result.status, 200, result.body?.code);
  const url = new URL(result.body.authorization_url);
  const code = `fake-code-${++serial}`;
  const grant: Grant = {
    clientId: url.searchParams.get("client_id")!,
    number: options.number ?? url.searchParams.get("superpdp_company_number")!,
    numberScheme: options.numberScheme ?? "sandbox",
    environment: options.environment ?? "sandbox",
    verification: options.verification ?? "verified",
    challenge: url.searchParams.get("code_challenge")!,
    redirect: url.searchParams.get("redirect_uri")!,
    companyId: options.companyId ?? String(1000 + serial),
  };
  codes.set(code, grant);
  return {
    url,
    code,
    grant,
    path: `${callbackPath}?${new URLSearchParams({ state: url.searchParams.get("state")!, code }).toString()}`,
  };
};
const connect = async (
  id: string,
  options: Parameters<typeof begin>[1] = {},
) => {
  const authorization = await begin(id, options);
  const result = await request(
    authorization.path,
    "GET",
    undefined,
    options?.cookie ?? cookieA,
  );
  assert.equal(result.status, 303);
  assert.ok(
    result.location?.startsWith(publicOrigin + "/parametres/entreprises?"),
  );
  return {
    ...authorization,
    result,
    view: (
      await request(endpoint(id), "GET", undefined, options?.cookie ?? cookieA)
    ).body,
  };
};
const stored = (id: string) =>
  database.systemPrisma.superPdpConnection.findFirstOrThrow({
    where: { fiscal_entity_id: id, environment: "sandbox" },
  });
const expire = async (id: string) => {
  const row = await stored(id);
  const tokens = JSON.parse(
    secrets.unseal(row.encrypted_tokens!, row, "tokens"),
  );
  tokens.expires_at = Date.now() - 1000;
  await database.systemPrisma.superPdpConnection.update({
    where: { id: row.id },
    data: {
      encrypted_tokens: secrets.seal(JSON.stringify(tokens), row, "tokens"),
      access_expires_at: new Date(tokens.expires_at),
    },
  });
};

before(async () => {
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    DATABASE_URL_SQLITE: databaseUrl,
    ...(postgresUrl ? { DATABASE_URL_POSTGRES: postgresUrl } : {}),
    DATA_DIR: path.join(temp, "data"),
    NODE_ENV: "test",
    SUPERPDP_SANDBOX_ENABLED: "true",
    SUPERPDP_SECRETS_KEY: crypto.randomBytes(32).toString("base64"),
    SUPERPDP_SANDBOX_REDIRECT_URI: publicOrigin + callbackPath,
    APP_PUBLIC_URL: publicOrigin,
    CLIENT_ORIGIN: publicOrigin,
    BOOTSTRAP_ADMIN_LOGIN: "",
    BOOTSTRAP_ADMIN_PASSWORD: "",
    BASIC_AUTH_PASSWORD: "",
  });
  if (!postgresUrl) fs.writeFileSync(path.join(temp, "test.db"), "");
  const migrated = spawnSync(
    process.execPath,
    [
      "scripts/prisma.mjs",
      "migrate",
      "deploy",
      ...(postgresUrl ? ["--schema", "prisma/postgres/schema.prisma"] : []),
    ],
    { cwd: serverRoot, env: process.env, encoding: "utf8" },
  );
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  database = await import("../src/db/prisma.js");
  auth = await import("../src/services/serverAuth.js");
  secrets = await import("../src/modules/superpdp/secrets.js");
  runtime = await import("../src/config/env.js");
  await database.systemPrisma.organization.createMany({
    data: [
      { id: orgA, slug: orgA, name: "Compte A" },
      { id: orgB, slug: orgB, name: "Compte B" },
    ],
  });
  for (const [id, organizationId, owner] of [
    ["owner-a", orgA, true],
    ["owner-b", orgB, true],
    ["worker-a", orgA, false],
  ] as const) {
    await database.systemPrisma.appUser.create({
      data: {
        id,
        organization_id: organizationId,
        login_id: id,
        display_name: id,
        is_owner: owner,
        roles: JSON.stringify(owner ? ["owner"] : ["worker"]),
        status: owner ? "owner" : "worker",
        page_access: JSON.stringify(["settings"]),
        password_hash: "fake-test-only",
        password_salt: "fake-test-only",
        is_active: true,
      },
    });
  }
  cookieA = `contrats_session=${(await auth.createServerAuthSession("owner-a")).id}`;
  cookieB = `contrats_session=${(await auth.createServerAuthSession("owner-b")).id}`;
  cookieWorker = `contrats_session=${(await auth.createServerAuthSession("worker-a")).id}`;
  cookieOtherSession = `contrats_session=${(await auth.createServerAuthSession("owner-a")).id}`;
  const { runWithOrganization } =
    await import("../src/modules/organizations/context.js");
  const { SuperPdpProvider } =
    await import("../src/modules/superpdp/provider.js");
  const { SuperPdpService } =
    await import("../src/modules/superpdp/service.js");
  const { createSuperPdpRouter } =
    await import("../src/modules/superpdp/routes.js");
  const { default: fiscalRoutes } =
    await import("../src/modules/fiscal/routes.js");
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    try {
      const session = await auth.getServerAuthSessionFromRequest(req);
      runWithOrganization(
        { organizationId: session?.organizationId ?? orgA, source: "test" },
        next,
      );
    } catch (error) {
      next(error);
    }
  });
  app.use(
    "/api/fiscal-entities",
    createSuperPdpRouter(new SuperPdpService(new SuperPdpProvider(fakeFetch))),
  );
  app.use("/api/fiscal-entities", fiscalRoutes);
  app.use(((error, _req, res, _next) =>
    res
      .status(error.status ?? 500)
      .json({ error: error.message })) as express.ErrorRequestHandler);
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

test("configuration chiffrée, désactivation par défaut et administration authentifiée obligatoire", async () => {
  const entity = await createEntity();
  assert.equal(
    (await request(endpoint(entity.id), "GET", undefined, "")).status,
    401,
  );
  assert.equal(
    (await request(endpoint(entity.id), "GET", undefined, cookieWorker)).status,
    403,
  );
  const missingOrigin = await request(
    endpoint(entity.id) + "/config",
    "PUT",
    {},
    cookieA,
    null,
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal(
    (
      await request(
        endpoint(entity.id) + "/config",
        "PUT",
        {},
        cookieA,
        "https://attacker.invalid",
      )
    ).status,
    403,
  );
  runtime.env.SUPERPDP_SANDBOX_ENABLED = false;
  assert.equal((await request(endpoint(entity.id))).body.available, false);
  assert.equal(
    (await request(endpoint(entity.id) + "/config", "PUT", {})).status,
    503,
  );
  runtime.env.SUPERPDP_SANDBOX_ENABLED = true;
  const view = await configure(entity.id);
  assert.equal(view.configured, true);
  assert.equal(view.environment, "sandbox");
  const row = await stored(entity.id);
  assert.notEqual(
    row.encrypted_client_secret,
    "fake-client-secret-for-testing-only",
  );
  assert.equal(
    secrets.unseal(row.encrypted_client_secret!, row, "client_secret"),
    "fake-client-secret-for-testing-only",
  );
  assert.ok(!JSON.stringify(view).includes("encrypted"));
  assert.ok(!JSON.stringify(view).includes("client_secret"));
  const unsafe = await request(endpoint(entity.id) + "/config", "PUT", {
    revision: view.revision,
    client_id: view.client_id,
    sandbox_number: view.sandbox_number,
    environment: "production",
  });
  assert.equal(unsafe.status, 400);
});

test("OAuth sandbox sans SIREN : numéro exact, secrets chiffrés et identité fiscale toujours incomplète", async () => {
  const created = await request("/api/fiscal-entities", "POST", {
    legal_name: "Burger Queen — entreprise fictive",
    address_line1: "809 avenue du Languedoc",
    postal_code: "12100",
    city: "Millau",
  });
  assert.equal(created.status, 201);
  const entity = created.body;
  assert.equal(entity.siren, null);
  const before = calls.length;
  const configured = await configure(entity.id, { number: "000000002" });
  assert.equal(configured.status, "configured");
  assert.equal(configured.sandbox_number, "000000002");
  assert.equal(
    calls.length,
    before,
    "Configurer ne contacte pas le fournisseur.",
  );
  const row = await stored(entity.id);
  assert.equal(row.local_siren, null);
  assert.equal(row.expected_number, "000000002");
  assert.ok(row.encrypted_client_secret?.startsWith("v1."));
  assert.equal(row.encrypted_tokens, null);
  assert.throws(() =>
    secrets.unseal(
      row.encrypted_client_secret!,
      {
        ...row,
        organization_id: orgB,
      },
      "client_secret",
    ),
  );
  assert.equal(
    (await request(endpoint(entity.id), "GET", undefined, cookieB)).status,
    404,
  );
  const connected = await connect(entity.id);
  assert.equal(
    connected.url.searchParams.get("superpdp_company_number"),
    "000000002",
  );
  assert.equal(
    connected.url.searchParams.get("superpdp_company_number_scheme"),
    "sandbox",
  );
  assert.equal(connected.view.status, "connected");
  assert.equal(connected.view.remote_company.number, "000000002");
  assert.equal((await stored(entity.id)).local_siren, null);
  assert.equal(
    (
      await database.systemPrisma.fiscalEntity.findUniqueOrThrow({
        where: { id: entity.id },
      })
    ).siren,
    null,
  );
  const report = await request(endpoint(entity.id) + "/readiness");
  assert.equal(report.status, 200);
  assert.equal(
    report.body.checks.find((c: { id: string }) => c.id === "connection").state,
    "observed",
  );
  assert.equal(
    report.body.checks.find((c: { id: string }) => c.id === "identity").state,
    "action_required",
  );
  assert.match(
    report.body.checks.find((c: { id: string }) => c.id === "identity").detail,
    /SIREN/,
  );
  assert.equal(report.body.production.enabled, false);
  assert.equal(
    JSON.stringify(connected.view).includes("fake-client-secret"),
    false,
  );
  assert.equal(JSON.stringify(connected.view).includes("fake-access"), false);

  const changed = await request(`/api/fiscal-entities/${entity.id}`, "PUT", {
    legal_name: entity.legal_name,
    siren: "732829320",
  });
  assert.equal(
    changed.status,
    409,
    "Ajouter un SIREN exige aussi une déconnexion.",
  );
  await database.systemPrisma.fiscalEntity.update({
    where: { id: entity.id },
    data: { siren: "732829320" },
  });
  const reconfigured = await request(endpoint(entity.id) + "/config", "PUT", {
    revision: connected.view.revision,
    client_id: connected.view.client_id,
    sandbox_number: "000000002",
  });
  assert.equal(reconfigured.status, 409);
  assert.equal(reconfigured.body.code, "SUPERPDP_DISCONNECT_FIRST");
  await database.systemPrisma.fiscalEntity.update({
    where: { id: entity.id },
    data: { siren: null },
  });
  assert.equal(
    (await request(endpoint(entity.id), "DELETE")).body.status,
    "disconnected",
  );
  assert.equal(
    (
      await request(`/api/fiscal-entities/${entity.id}`, "PUT", {
        legal_name: entity.legal_name,
        siren: "732829320",
      })
    ).status,
    200,
  );
  await configure(entity.id, { number: "000000002" });
  assert.equal((await stored(entity.id)).local_siren, "732829320");
});

test("sans SIREN, production, schéma français et mauvaise entreprise distante restent refusés", async () => {
  for (const options of [
    { environment: "production" },
    { numberScheme: "fr_siren" },
    { number: "another-sandbox-company" },
  ]) {
    const entity = await createEntity();
    await database.systemPrisma.fiscalEntity.update({
      where: { id: entity.id },
      data: { siren: null },
    });
    await configure(entity.id, { number: "000000002" });
    const result = await connect(entity.id, options);
    assert.equal(result.view.status, "identity_rejected");
    assert.equal((await stored(entity.id)).encrypted_tokens, null);
  }
});

test("un SIREN ajouté hors parcours invalide aussi un retour OAuth commencé sans SIREN", async () => {
  const entity = await createEntity();
  await database.systemPrisma.fiscalEntity.update({
    where: { id: entity.id },
    data: { siren: null },
  });
  await configure(entity.id);
  const pending = await begin(entity.id);
  await database.systemPrisma.fiscalEntity.update({
    where: { id: entity.id },
    data: { siren: "987654321" },
  });
  const before = calls.length;
  assert.ok((await request(pending.path)).location?.includes("superpdp=error"));
  assert.equal(calls.length, before);
  assert.equal((await stored(entity.id)).encrypted_tokens, null);
});

test("la base n’accepte pas de connexion sans SIREN hors sandbox", async () => {
  const entity = await createEntity();
  await assert.rejects(() =>
    database.systemPrisma.superPdpConnection.create({
      data: {
        organization_id: orgA,
        fiscal_entity_id: entity.id,
        environment: "production",
        local_siren: null,
      },
    }),
  );
});

test("chiffrement authentifié lié au compte, à l’entreprise, à l’environnement et au champ", async () => {
  const row = await stored(
    (
      await database.systemPrisma.fiscalEntity.findFirstOrThrow({
        where: { organization_id: orgA },
      })
    ).id,
  );
  for (const [context, purpose] of [
    [{ ...row, organization_id: orgB }, "client_secret"],
    [{ ...row, fiscal_entity_id: "other" }, "client_secret"],
    [{ ...row, environment: "production" }, "client_secret"],
    [row, "tokens"],
  ] as const) {
    assert.throws(
      () => secrets.unseal(row.encrypted_client_secret!, context, purpose),
      { code: "SUPERPDP_DECRYPTION" },
    );
  }
  assert.throws(
    () =>
      secrets.unseal(
        row.encrypted_client_secret!.slice(0, -10),
        row,
        "client_secret",
      ),
    { code: "SUPERPDP_DECRYPTION" },
  );
});

test("consentement PKCE S256 sans scope, state hashé à usage unique et jetons jamais exposés", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  const begun = await begin(entity.id, { companyId: "9223372036854775807" });
  assert.equal(begun.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(begun.url.searchParams.has("scope"), false);
  assert.equal(
    begun.url.searchParams.get("superpdp_company_number_scheme"),
    "sandbox",
  );
  assert.equal(begun.url.searchParams.get("superpdp_send_and_receive"), "send");
  const state = begun.url.searchParams.get("state")!;
  assert.equal(
    await database.systemPrisma.superPdpOAuthState.findUnique({
      where: { id: state },
    }),
    null,
  );
  const stateRow =
    await database.systemPrisma.superPdpOAuthState.findUniqueOrThrow({
      where: { id: secrets.digest(state) },
    });
  assert.ok(stateRow.encrypted_verifier!.startsWith("v1."));
  const callback = await request(begun.path);
  assert.equal(callback.status, 303);
  assert.ok(callback.location?.includes("superpdp=connected"));
  assert.ok(!callback.location?.includes(begun.code));
  assert.ok(!callback.location?.includes(state));
  const row = await stored(entity.id);
  assert.equal(row.status, "connected");
  assert.equal(row.remote_company_id, "9223372036854775807");
  assert.ok(!row.encrypted_tokens!.includes("fake-access"));
  const tokens = JSON.parse(
    secrets.unseal(row.encrypted_tokens!, row, "tokens"),
  );
  const dto = await request(endpoint(entity.id));
  assert.equal(dto.cache, "no-store");
  for (const value of [
    tokens.access_token,
    tokens.refresh_token,
    row.encrypted_tokens,
    row.encrypted_client_secret,
  ])
    assert.ok(!JSON.stringify(dto.body).includes(value));
  assert.equal(
    (
      await database.systemPrisma.superPdpOAuthState.findUniqueOrThrow({
        where: { id: stateRow.id },
      })
    ).encrypted_verifier,
    null,
  );
  const countBefore = calls.length;
  assert.ok((await request(begun.path)).location?.includes("superpdp=error"));
  assert.equal(calls.length, countBefore);
});

test("un retour OAuth ne peut pas traverser un compte, une session ou une expiration", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  let begun = await begin(entity.id);
  const beforeCalls = calls.length;
  assert.ok(
    (await request(begun.path, "GET", undefined, cookieB)).location?.includes(
      "superpdp=error",
    ),
  );
  assert.ok(
    (
      await request(begun.path, "GET", undefined, cookieOtherSession)
    ).location?.includes("superpdp=error"),
  );
  assert.equal(calls.length, beforeCalls);
  assert.ok(
    (await request(begun.path)).location?.includes("superpdp=connected"),
  );
  const other = await createEntity();
  await configure(other.id);
  begun = await begin(other.id);
  await database.systemPrisma.superPdpOAuthState.update({
    where: { id: secrets.digest(begun.url.searchParams.get("state")!) },
    data: { expires_at: new Date(Date.now() - 1) },
  });
  assert.ok((await request(begun.path)).location?.includes("superpdp=error"));
  assert.equal((await stored(other.id)).encrypted_tokens, null);
  assert.equal(
    (await request(endpoint(entity.id), "GET", undefined, cookieB)).status,
    404,
  );
  assert.equal(
    (await request(endpoint(entity.id) + "/check", "POST", {}, cookieB)).status,
    404,
  );
});

test("les retours concurrents échangent le code une seule fois", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  const begun = await begin(entity.id);
  const countBefore = calls.filter((p) => p === "/oauth2/token").length;
  const results = await Promise.all([
    request(begun.path),
    request(begun.path),
    request(begun.path),
  ]);
  assert.equal(
    results.filter((result) => result.location?.includes("superpdp=connected"))
      .length,
    1,
  );
  assert.equal(
    calls.filter((p) => p === "/oauth2/token").length - countBefore,
    1,
  );
});

test("la production, une mauvaise entreprise et une application inattendue sont refusées et révoquées", async () => {
  for (const scenario of [
    { environment: "production" },
    { number: "wrong-sandbox-company" },
    { wrongClient: true },
  ]) {
    const entity = await createEntity();
    await configure(entity.id);
    wrongClient = "wrongClient" in scenario;
    try {
      const result = await connect(entity.id, scenario);
      assert.equal(result.view.status, "identity_rejected");
      const row = await stored(entity.id);
      assert.equal(row.encrypted_tokens, null);
      assert.equal(row.remote_company_id, null);
      assert.ok(
        [
          "SUPERPDP_ENVIRONMENT_MISMATCH",
          "SUPERPDP_IDENTITY_MISMATCH",
        ].includes(row.last_error_code!),
      );
    } finally {
      wrongClient = false;
    }
  }
});

test("un consentement non vérifié est mis en attente sans accès aux données de l’entreprise", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  const beforeCompanies = calls.filter(
    (p) => p === "/v1.beta/companies/me",
  ).length;
  const result = await connect(entity.id, { verification: "not_verified" });
  assert.equal(result.view.status, "verification_pending");
  assert.equal(result.view.remote_company, null);
  assert.equal(
    calls.filter((p) => p === "/v1.beta/companies/me").length,
    beforeCompanies,
  );
  result.grant.verification = "verified";
  const checked = await request(endpoint(entity.id) + "/check", "POST", {});
  assert.equal(checked.status, 200);
  assert.equal(checked.body.status, "connected");
});

test("le renouvellement fait tourner le refresh token une seule fois même avec deux requêtes", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  await connect(entity.id);
  await expire(entity.id);
  const before = await stored(entity.id);
  const previousTokens = JSON.parse(
    secrets.unseal(before.encrypted_tokens!, before, "tokens"),
  );
  const tokenCalls = calls.filter((p) => p === "/oauth2/token").length;
  const results = await Promise.all([
    request(endpoint(entity.id) + "/check", "POST", {}),
    request(endpoint(entity.id) + "/check", "POST", {}),
  ]);
  assert.ok(results.some((result) => result.status === 200));
  assert.ok(results.every((result) => [200, 409].includes(result.status)));
  assert.equal(
    calls.filter((p) => p === "/oauth2/token").length - tokenCalls,
    1,
  );
  const after = await stored(entity.id);
  const nextTokens = JSON.parse(
    secrets.unseal(after.encrypted_tokens!, after, "tokens"),
  );
  assert.notEqual(nextTokens.refresh_token, previousTokens.refresh_token);
  assert.equal(refresh.has(previousTokens.refresh_token), false);
});

test("une rotation non confirmée exige une nouvelle autorisation sans réutiliser l’ancien refresh", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  await connect(entity.id);
  await expire(entity.id);
  failRefresh = true;
  try {
    const result = await request(endpoint(entity.id) + "/check", "POST", {});
    assert.equal(result.status, 409);
    assert.ok(
      !JSON.stringify(result.body).includes("provider-secret-material"),
    );
  } finally {
    failRefresh = false;
  }
  assert.equal((await stored(entity.id)).status, "reauthorization_required");
  const countBefore = calls.length;
  assert.equal(
    (await request(endpoint(entity.id) + "/check", "POST", {})).status,
    409,
  );
  assert.equal(calls.length, countBefore);
});

test("déconnexion : révocation distante confirmée puis effacement, échec conservé en quarantaine", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  await connect(entity.id);
  failRevoke = true;
  try {
    const rejected = await request(endpoint(entity.id), "DELETE");
    assert.equal(rejected.body.status, "revocation_pending");
    assert.ok((await stored(entity.id)).encrypted_tokens);
    const countBefore = calls.length;
    assert.equal(
      (await request(endpoint(entity.id) + "/check", "POST", {})).status,
      409,
    );
    assert.equal(calls.length, countBefore);
  } finally {
    failRevoke = false;
  }
  const result = await request(endpoint(entity.id), "DELETE");
  assert.equal(result.body.status, "disconnected");
  const row = await stored(entity.id);
  assert.equal(row.encrypted_tokens, null);
  assert.equal(row.encrypted_client_secret, null);
  assert.equal(row.client_id, null);
});

test("les verrous interrompus et configurations concurrentes ne réutilisent jamais un jeton incertain", async () => {
  const entity = await createEntity();
  const view = await configure(entity.id);
  await connect(entity.id);
  const oldRevision = await request(endpoint(entity.id) + "/config", "PUT", {
    revision: view.revision,
    client_id: view.client_id,
    sandbox_number: view.sandbox_number,
  });
  assert.equal(oldRevision.status, 409);
  const row = await stored(entity.id);
  await database.systemPrisma.superPdpConnection.update({
    where: { id: row.id },
    data: {
      operation_id: "abandoned-lock",
      operation_expires_at: new Date(Date.now() - 1),
    },
  });
  assert.equal(
    (await request(endpoint(entity.id))).body.status,
    "operation_interrupted",
  );
  const countBefore = calls.length;
  assert.equal(
    (await request(endpoint(entity.id) + "/check", "POST", {})).status,
    409,
  );
  assert.equal((await stored(entity.id)).status, "reauthorization_required");
  assert.equal(calls.length, countBefore);
});

test("identités locales verrouillées et clés étrangères multi-comptes protégées", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  const changed = await request(`/api/fiscal-entities/${entity.id}`, "PUT", {
    legal_name: entity.legal_name,
    siren: "732829320",
  });
  assert.equal(changed.status, 409);
  await assert.rejects(
    () =>
      database.systemPrisma.superPdpConnection.create({
        data: {
          organization_id: orgB,
          fiscal_entity_id: entity.id,
          local_siren: entity.siren!,
        },
      }),
    { code: "P2003" },
  );
  const before = calls.length;
  assert.equal(
    (await request(endpoint(entity.id), "DELETE", undefined, cookieWorker))
      .status,
    403,
  );
  assert.equal(calls.length, before);
  const audit = await database.systemPrisma.auditLog.findMany({
    where: { action: { startsWith: "superpdp." } },
  });
  assert.ok(audit.length > 0);
  assert.ok(!JSON.stringify(audit).includes("fake-client-secret"));
  assert.ok(!JSON.stringify(audit).includes("fake-access"));
  assert.ok(!JSON.stringify(audit).includes("fake-refresh"));
});

test("un nouveau consentement invalide le précédent, et un refus ne divulgue aucun détail OAuth", async () => {
  const entity = await createEntity();
  await configure(entity.id);
  const first = await begin(entity.id);
  const latest = await begin(entity.id);
  const countBefore = calls.length;
  assert.ok((await request(first.path)).location?.includes("superpdp=error"));
  assert.equal(calls.length, countBefore);
  const denied = `${callbackPath}?${new URLSearchParams({ state: latest.url.searchParams.get("state")!, error: "access_denied", error_description: "provider-secret-material" })}`;
  const result = await request(denied);
  assert.equal(result.status, 303);
  assert.ok(!result.location?.includes("provider-secret-material"));
  assert.equal((await stored(entity.id)).encrypted_tokens, null);
  assert.equal(calls.length, countBefore);
  const pending = await begin(entity.id);
  const beforeDisconnect = await request(endpoint(entity.id), "DELETE");
  assert.equal(beforeDisconnect.body.status, "disconnected");
  assert.ok((await request(pending.path)).location?.includes("superpdp=error"));
  assert.equal(calls.length, countBefore);
});

test("une entreprise distante ne peut pas être associée à deux entreprises locales du même compte", async () => {
  const first = await createEntity();
  await configure(first.id);
  await connect(first.id, { companyId: "900001" });
  const second = await createEntity();
  await configure(second.id);
  const result = await connect(second.id, { companyId: "900001" });
  assert.equal(result.view.status, "identity_rejected");
  assert.equal(result.view.last_error_code, "SUPERPDP_DUPLICATE_COMPANY");
  assert.equal((await stored(first.id)).status, "connected");
  assert.equal((await stored(second.id)).encrypted_tokens, null);
});

test("clé manquante, URL non sûre et consentement sur une identité locale modifiée restent fermés", async () => {
  const originalKey = runtime.env.SUPERPDP_SECRETS_KEY;
  const originalRedirect = runtime.env.SUPERPDP_SANDBOX_REDIRECT_URI;
  try {
    runtime.env.SUPERPDP_SECRETS_KEY = "";
    assert.equal(secrets.sandboxAvailability().available, false);
    runtime.env.SUPERPDP_SECRETS_KEY = originalKey;
    runtime.env.SUPERPDP_SANDBOX_REDIRECT_URI =
      "http://untrusted.invalid" + callbackPath;
    assert.equal(secrets.sandboxAvailability().available, false);
    runtime.env.SUPERPDP_SANDBOX_REDIRECT_URI =
      "https://trusted.example" + callbackPath + "?redirect=bad";
    assert.equal(secrets.sandboxAvailability().available, false);
  } finally {
    runtime.env.SUPERPDP_SECRETS_KEY = originalKey;
    runtime.env.SUPERPDP_SANDBOX_REDIRECT_URI = originalRedirect;
  }
  const entity = await createEntity();
  await configure(entity.id);
  const begun = await begin(entity.id);
  await database.systemPrisma.fiscalEntity.update({
    where: { id: entity.id },
    data: { siren: "222333444" },
  });
  const countBefore = calls.length;
  assert.ok((await request(begun.path)).location?.includes("superpdp=error"));
  assert.equal(calls.length, countBefore);
});

test(
  "les sauvegardes SQLite assainies retirent les secrets OAuth sans modifier la base source",
  { skip: !!postgresUrl },
  async () => {
    const connectionCount =
      await database.systemPrisma.superPdpConnection.count();
    assert.ok(connectionCount > 0);
    const archive = path.join(temp, "sanitized.tar.gz");
    const monorepo = path.dirname(serverRoot);
    const saved = spawnSync(
      process.execPath,
      ["server/scripts/installation-data.mjs", "backup", archive],
      { cwd: monorepo, env: process.env, encoding: "utf8" },
    );
    assert.equal(saved.status, 0, saved.stdout + saved.stderr);
    const extraction = path.join(temp, "extracted");
    fs.mkdirSync(extraction);
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", extraction], {
      encoding: "utf8",
    });
    assert.equal(extracted.status, 0, extracted.stderr);
    const result = spawnSync(
      "sqlite3",
      [
        path.join(extraction, "database", "database.sqlite"),
        'SELECT COUNT(*) FROM "superpdp_connections"; SELECT COUNT(*) FROM "superpdp_oauth_states";',
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "0\n0");
    assert.equal(
      await database.systemPrisma.superPdpConnection.count(),
      connectionCount,
    );
  },
);

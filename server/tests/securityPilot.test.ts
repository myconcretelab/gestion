import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import { createApp } from "../src/app.ts";
import { shouldRefuseProductionStart, updateUserCredentials } from "../src/services/serverAuth.ts";
import { createApiToken, revokeApiToken, verifyScopedApiToken } from "../src/services/apiTokens.ts";

test("une production sans compte protégé reste fermée", () => {
  assert.equal(shouldRefuseProductionStart("production", 0), true);
  assert.equal(shouldRefuseProductionStart("production", 1), false);
  assert.equal(shouldRefuseProductionStart("development", 0), false);
});

test("un jeton d'intégration est hashé, limité à ses scopes et révocable", async () => {
  const created = await createApiToken({ name: "Test", scopes: ["reservations:write"], expiresAt: new Date(Date.now() + 60_000) });
  try {
    const stored = await prisma.apiToken.findUniqueOrThrow({ where: { id: created.id } });
    assert.notEqual(stored.token_hash, created.token);
    const request = { headers: { authorization: `Bearer ${created.token}` } } as never;
    assert.equal(await verifyScopedApiToken(request, "reservations:write"), true);
    assert.equal(await verifyScopedApiToken(request, "cron:run"), false);
    assert.equal(await revokeApiToken(created.id), true);
    assert.equal(await verifyScopedApiToken(request, "reservations:write"), false);
  } finally {
    await prisma.apiToken.deleteMany({ where: { id: created.id } });
  }
});

test("un PDF privé, la liste de comptes et les API hors rôle sont refusés", async () => {
  const suffix = crypto.randomUUID();
  const loginId = `pilot-worker-${suffix}`;
  const user = await prisma.appUser.create({ data: {
    display_name: "Pilote Worker", first_name: "Pilote", last_name: "Worker",
    login_id: loginId, roles: JSON.stringify(["worker"]), status: "worker",
    page_access: JSON.stringify(["planning_relay"]), can_write: true, can_view_amounts: false,
    is_owner: false, is_active: true,
  } });
  await updateUserCredentials(user.id, { loginId, password: "PilotPassword123!" });
  const server = createApp().listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const pdf = await fetch(`${origin}/api/contracts/private-id/pdf`);
    assert.equal(pdf.status, 401);
    assert.equal(pdf.headers.get("cache-control"), null);

    const users = await fetch(`${origin}/api/auth/users`);
    assert.equal(users.status, 404);

    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginId, password: "PilotPassword123!" }),
    });
    assert.equal(login.status, 200);
    const setCookies = (login.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [String(login.headers.get("set-cookie") ?? "")];
    const cookie = String(setCookies.find((value) => value.startsWith("contrats_session=")) ?? "").split(";")[0];
    assert.match(cookie, /^contrats_session=/);

    const forbiddenPage = await fetch(`${origin}/api/contracts`, { headers: { cookie } });
    assert.equal(forbiddenPage.status, 403);

    const borrowedIdentity = await fetch(`${origin}/api/interventions`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ userId: "another-user" }),
    });
    assert.equal(borrowedIdentity.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.appUser.delete({ where: { id: user.id } });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import prisma from "../src/db/prisma.ts";
import {
  createServerAuthSession,
  getServerAuthSessionFromRequest,
  findUserForLogin,
  revokeUserSessions,
  resetPasswordWithToken,
  setServerAuthCookie,
  updateUserCredentials,
  verifyServerPassword,
} from "../src/services/serverAuth.ts";

const createMockResponse = () => {
  const headers = new Map<string, string | string[]>();
  return { getHeader: (name: string) => headers.get(name), setHeader: (name: string, value: string | string[]) => headers.set(name, value), headers };
};

test("serverAuth utilise un mot de passe individuel robuste et révoque les sessions de l'utilisateur", async () => {
  const suffix = crypto.randomUUID();
  const user = await prisma.appUser.create({ data: {
    display_name: `Test Auth ${suffix}`,
    first_name: "Test",
    last_name: "Auth",
    email: `Test.Auth.${suffix}@Example.test`,
    login_id: `test-auth-${suffix}`,
    roles: "[]",
    page_access: "[]",
    is_active: true,
  } });
  try {
    await updateUserCredentials(user.id, { loginId: `test-auth-${suffix}`, password: "InitialPass123!" });
    const stored = await prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(stored.password_hash);
    assert.ok(stored.password_salt);
    assert.notEqual(stored.password_hash, "InitialPass123!");
    assert.equal(await verifyServerPassword("InitialPass123!", user.id), true);
    assert.equal(await verifyServerPassword("wrong-password", user.id), false);
    assert.equal((await findUserForLogin(`test.auth.${suffix}@example.test`))?.id, user.id);

    const sessionA = await createServerAuthSession(user.id);
    const sessionB = await createServerAuthSession(user.id);
    assert.notEqual(sessionA.id, sessionB.id);
    assert.equal(await prisma.authSession.findUnique({ where: { id: sessionA.id } }), null, "le jeton brut ne doit jamais être stocké");

    await revokeUserSessions(user.id, sessionA.id);
    assert.ok(await getServerAuthSessionFromRequest({ headers: { cookie: `contrats_session=${sessionA.id}` } }));
    assert.equal(await getServerAuthSessionFromRequest({ headers: { cookie: `contrats_session=${sessionB.id}` } }), null);

    const httpResponse = createMockResponse();
    setServerAuthCookie({ headers: {}, socket: {} } as never, httpResponse as never, sessionA);
    assert.match(String(httpResponse.headers.get("Set-Cookie")), /HttpOnly/);
    assert.doesNotMatch(String(httpResponse.headers.get("Set-Cookie")), /Secure/);

    const httpsResponse = createMockResponse();
    setServerAuthCookie({ headers: { "x-forwarded-proto": "https" }, socket: {} } as never, httpsResponse as never, sessionA);
    assert.match(String(httpsResponse.headers.get("Set-Cookie")), /Secure/);
  } finally {
    await prisma.appUser.delete({ where: { id: user.id } });
  }
});

test("un lien de récupération est hashé, à usage unique et révoque les sessions", async () => {
  const suffix = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const user = await prisma.appUser.create({ data: {
    display_name: `Test Reset ${suffix}`,
    first_name: "Test",
    last_name: "Reset",
    email: `reset-${suffix}@example.test`,
    login_id: `test-reset-${suffix}`,
    roles: "[]",
    page_access: "[]",
    is_active: true,
  } });
  try {
    await updateUserCredentials(user.id, { loginId: `test-reset-${suffix}`, password: "InitialPass123!" });
    const session = await createServerAuthSession(user.id);
    await prisma.passwordResetToken.create({ data: {
      id: tokenHash,
      user_id: user.id,
      expires_at: new Date(Date.now() + 60_000),
    } });

    await resetPasswordWithToken(rawToken, "ReplacementPass123!");
    assert.equal(await verifyServerPassword("InitialPass123!", user.id), false);
    assert.equal(await verifyServerPassword("ReplacementPass123!", user.id), true);
    assert.equal(await getServerAuthSessionFromRequest({ headers: { cookie: `contrats_session=${session.id}` } }), null);
    assert.ok((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: tokenHash } })).used_at);
    await assert.rejects(() => resetPasswordWithToken(rawToken, "AnotherPassword123!"), /invalide ou expiré/);
  } finally {
    await prisma.appUser.delete({ where: { id: user.id } });
  }
});

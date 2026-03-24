import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const restoreEnvVar = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const createMockResponse = () => {
  const headers = new Map<string, string | string[]>();
  return {
    getHeader(name: string) {
      return headers.get(name);
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name, value);
    },
    headers,
  };
};

test("serverAuth hash le mot de passe bootstrap et renouvelle les sessions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "contrats-server-auth-"));
  const envBackup = {
    DATA_DIR: process.env.DATA_DIR,
    BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD,
  };

  process.env.DATA_DIR = tempDir;
  process.env.BASIC_AUTH_PASSWORD = "InitialPass123!";

  try {
    const auth = await import("../src/services/serverAuth.ts");

    await auth.ensureServerAuthInitialized();

    const settings = await auth.readServerAuthSettings();
    assert.equal(settings.sessionDurationHours, 24 * 7);
    assert.ok(settings.passwordHash);
    assert.ok(settings.passwordSalt);
    assert.notEqual(settings.passwordHash, process.env.BASIC_AUTH_PASSWORD);
    assert.equal(await auth.verifyServerPassword("InitialPass123!"), true);
    assert.equal(await auth.verifyServerPassword("wrong-password"), false);

    const settingsFile = JSON.parse(await readFile(path.join(tempDir, "server-auth-settings.json"), "utf-8")) as {
      passwordHash?: string;
    };
    assert.notEqual(settingsFile.passwordHash, "InitialPass123!");

    const sessionA = await auth.createServerAuthSession();
    const sessionB = await auth.createServerAuthSession();

    const stateA = await auth.buildServerAuthSessionState({
      headers: { cookie: `contrats_session=${sessionA.id}` },
    });
    assert.equal(stateA.required, true);
    assert.equal(stateA.authenticated, true);

    const update = await auth.updateServerSecuritySettings(
      {
        currentPassword: "InitialPass123!",
        newPassword: "UpdatedPass456!",
        sessionDurationHours: 48,
      },
      sessionA.id
    );

    assert.ok(update.session);
    assert.equal(update.settings.sessionDurationHours, 48);
    assert.equal(await auth.verifyServerPassword("UpdatedPass456!"), true);
    assert.equal(await auth.verifyServerPassword("InitialPass123!"), false);

    const refreshedSession = await auth.getServerAuthSessionFromRequest({
      headers: { cookie: `contrats_session=${sessionA.id}` },
    });
    const revokedSession = await auth.getServerAuthSessionFromRequest({
      headers: { cookie: `contrats_session=${sessionB.id}` },
    });

    assert.ok(refreshedSession);
    assert.equal(refreshedSession?.id, sessionA.id);
    assert.equal(revokedSession, null);

    const httpResponse = createMockResponse();
    auth.setServerAuthCookie(
      {
        headers: {},
        socket: {},
      } as never,
      httpResponse as never,
      sessionA
    );
    const httpCookie = String(httpResponse.headers.get("Set-Cookie"));
    assert.match(httpCookie, /HttpOnly/);
    assert.doesNotMatch(httpCookie, /Secure/);

    const httpsResponse = createMockResponse();
    auth.setServerAuthCookie(
      {
        headers: { "x-forwarded-proto": "https" },
        socket: {},
      } as never,
      httpsResponse as never,
      sessionA
    );
    const httpsCookie = String(httpsResponse.headers.get("Set-Cookie"));
    assert.match(httpsCookie, /Secure/);
  } finally {
    restoreEnvVar("DATA_DIR", envBackup.DATA_DIR);
    restoreEnvVar("BASIC_AUTH_PASSWORD", envBackup.BASIC_AUTH_PASSWORD);
    await rm(tempDir, { recursive: true, force: true });
  }
});

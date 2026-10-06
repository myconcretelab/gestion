import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DEFAULT_MODULES, getModuleForApiPath, organizationProfileSchema } from "../src/services/installationConfig.ts";

const serverRoot = path.resolve(process.cwd().endsWith(`${path.sep}server`) ? process.cwd() : path.join(process.cwd(), "server"));
const repoRoot = path.dirname(serverRoot);
const nodeWithTsx = path.join(repoRoot, "node_modules", ".bin", "tsx");

test("une installation vierge est neutre et tous les modules sont désactivés", () => {
  const organization = organizationProfileSchema.parse({});
  assert.equal(organization.tradeName, "");
  assert.equal(organization.publicDisplayName, "");
  assert.ok(Object.values(DEFAULT_MODULES).every((enabled) => enabled === false));
  assert.equal(getModuleForApiPath("/contracts/abc"), "contracts");
  assert.equal(getModuleForApiPath("/settings/organization"), null);
  assert.equal(getModuleForApiPath("/settings/message-channels"), null);
  assert.equal(getModuleForApiPath("/settings/smartlife/run"), "smart_life");
});

test("l'assistant crée une installation complète depuis une base vide", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-fresh-install-"));
  const database = path.join(temp, "fresh.db");
  fs.writeFileSync(database, "");
  const childEnv = { ...process.env, NODE_ENV: "test", DATABASE_URL: `file:${database}`, DATA_DIR: path.join(temp, "data"), SETUP_TOKEN: "fresh-install-token-32-characters-long" };
  try {
    const migrate = spawnSync(process.execPath, ["scripts/prisma.mjs", "migrate", "deploy"], { cwd: serverRoot, env: childEnv, encoding: "utf8" });
    assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout);
    const script = `
      import assert from "node:assert/strict";
      import { createApp } from "./src/app.ts";
      import prisma from "./src/db/prisma.ts";
      const server = createApp().listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      const address = server.address();
      const origin = "http://127.0.0.1:" + address.port;
      const before = await fetch(origin + "/api/installation/public-config").then((r) => r.json());
      assert.equal(before.setupComplete, false);
      assert.equal(before.organization.tradeName, "");
      const response = await fetch(origin + "/api/installation/setup", { method: "POST", headers: { "content-type": "application/json", "x-setup-token": process.env.SETUP_TOKEN }, body: JSON.stringify({
        administrator: { displayName: "Admin Exemple", email: "admin@example.test", loginId: "admin", password: "A-secure-demo-password!" },
        organization: { tradeName: "Maison Exemple", legalName: "Exemple SARL", country: "FR", locale: "fr-FR", currency: "EUR", timezone: "Europe/Paris", primaryColor: "#315f4b" },
        firstGite: { name: "Gîte Exemple", address: "1 rue Fictive", capacity: 4, contractPrefix: "EX" },
        modules: { reservations: true, contracts: true }
      }) });
      assert.equal(response.status, 201, await response.text());
      assert.equal(await prisma.appUser.count({ where: { password_hash: { not: null } } }), 1);
      assert.equal(await prisma.gite.count(), 1);
      assert.equal((await prisma.installationConfig.findUniqueOrThrow({ where: { id: "default" } })).setup_completed, true);
      await prisma.$disconnect();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    `;
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: serverRoot, env: childEnv, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("une sauvegarde standard est validée puis restaurée sans secrets", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-backup-test-"));
  const database = path.join(temp, "source.db"); const dataDir = path.join(temp, "data"); const archive = path.join(temp, "backup.tar.gz");
  fs.mkdirSync(path.join(dataDir, "pdfs"), { recursive: true });
  const schema = [
    "CREATE TABLE business_data(value TEXT); INSERT INTO business_data VALUES ('database-original');",
    "CREATE TABLE ical_sources(url TEXT, is_active INTEGER); INSERT INTO ical_sources VALUES ('https://secret.example/token', 1);",
    "CREATE TABLE gites(ical_export_token TEXT, airbnb_listing_id TEXT); INSERT INTO gites VALUES ('secret-token', 'listing');",
    "CREATE TABLE planning_relay_periods(share_nonce TEXT, public_code_hash TEXT, public_origin TEXT); INSERT INTO planning_relay_periods VALUES ('nonce', 'hash', 'https://example.test');",
    "CREATE TABLE auth_sessions(id TEXT); CREATE TABLE api_tokens(id TEXT); CREATE TABLE document_shares(id TEXT); CREATE TABLE password_reset_tokens(id TEXT); CREATE TABLE security_throttles(id TEXT);",
  ].join(" ");
  assert.equal(spawnSync("sqlite3", [database, schema]).status, 0);
  fs.writeFileSync(path.join(dataDir, "pdfs", "sample.pdf"), "pdf"); fs.writeFileSync(path.join(dataDir, "server-auth-settings.json"), "secret");
  const env = { ...process.env, DATABASE_URL: `file:${database}`, DATA_DIR: dataDir };
  try {
    const backup = spawnSync(process.execPath, ["scripts/installation-data.mjs", "backup", archive], { cwd: serverRoot, env, encoding: "utf8" }); assert.equal(backup.status, 0, backup.stderr || backup.stdout);
    const preview = spawnSync(process.execPath, ["scripts/installation-data.mjs", "preview", archive], { cwd: serverRoot, env, encoding: "utf8" }); assert.equal(preview.status, 0, preview.stderr || preview.stdout); assert.match(preview.stdout, /"secretsIncluded": false/); assert.doesNotMatch(preview.stdout, /server-auth-settings/);
    assert.equal(spawnSync("sqlite3", [database, "UPDATE business_data SET value='changed';"]).status, 0);
    const restore = spawnSync(process.execPath, ["scripts/installation-data.mjs", "restore", archive, "--apply", "--confirm-replace"], { cwd: serverRoot, env, encoding: "utf8" }); assert.equal(restore.status, 0, restore.stderr || restore.stdout);
    assert.equal(spawnSync("sqlite3", [database, "SELECT value FROM business_data;"], { encoding: "utf8" }).stdout.trim(), "database-original");
    assert.equal(spawnSync("sqlite3", [database, "SELECT url FROM ical_sources;"], { encoding: "utf8" }).stdout.trim(), "redacted://not-exported");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("une sauvegarde PostgreSQL refuse de produire un dump non chiffré", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-postgres-backup-test-"));
  const archive = path.join(temp, "backup.tar.gz");
  const env = {
    ...process.env,
    DATABASE_URL: "postgresql://example:example@127.0.0.1:1/example",
    DATA_DIR: path.join(temp, "data"),
  };
  delete env.INSTALLATION_BACKUP_PASSPHRASE;
  try {
    const backup = spawnSync(process.execPath, ["scripts/installation-data.mjs", "backup", archive], { cwd: serverRoot, env, encoding: "utf8" });
    assert.notEqual(backup.status, 0);
    assert.match(backup.stderr, /INSTALLATION_BACKUP_PASSPHRASE/);
    assert.equal(fs.existsSync(archive), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [, , command, archiveArg, ...flags] = process.argv;
const root = path.resolve(process.cwd().endsWith(`${path.sep}server`) ? path.join(process.cwd(), "..") : process.cwd());
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "server", "data"));
const databaseUrl = process.env.DATABASE_URL || `file:${path.join(root, "server", "prisma", "dev.db")}`;
const allowedAssetRoots = ["pdfs", "uploads", "signed", "photos"];
const tenantAssetRoots = ["pdfs", "uploads", "signed", "signed-contracts", "photos"];
// Include tenant-scoped electronic archives, without exporting arbitrary configuration files.
const tenantAssetPaths = (base) => {
  const organizations = path.join(base, "organizations");
  if (!fs.existsSync(organizations)) return [];
  return fs.readdirSync(organizations, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap((entry) => tenantAssetRoots.map((name) => path.join("organizations", entry.name, name)));
};

const fail = (message) => { console.error(message); process.exit(1); };
const run = (bin, args, options = {}) => {
  const result = spawnSync(bin, args, { stdio: "inherit", ...options });
  if (result.status !== 0) fail(`${bin} a échoué (${result.status ?? "signal"}).`);
};
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const listFiles = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  : [];
const sqlitePath = () => {
  if (!databaseUrl.startsWith("file:")) return null;
  const raw = databaseUrl.slice(5);
  return path.resolve(root, raw.replace(/^\.\//, ""));
};

const postgresDumpUrl = () => {
  const url = new URL(databaseUrl);
  // `schema` is a Prisma-only option; libpq (and therefore pg_dump) rejects it.
  url.searchParams.delete("schema");
  return url.toString();
};

const postgresBackupPassphrase = () => {
  const value = process.env.INSTALLATION_BACKUP_PASSPHRASE || "";
  if (value.length < 24) {
    fail("INSTALLATION_BACKUP_PASSPHRASE (24 caractères minimum) est requis pour chiffrer une sauvegarde PostgreSQL.");
  }
  return value;
};

const cryptPostgresDump = (mode, source, destination) => {
  postgresBackupPassphrase();
  const decryptArgs = mode === "decrypt" ? ["-d"] : [];
  run("openssl", [
    "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt",
    ...decryptArgs,
    "-in", source,
    "-out", destination,
    "-pass", "env:INSTALLATION_BACKUP_PASSPHRASE",
  ], { env: process.env });
};

const backup = () => {
  const destination = path.resolve(archiveArg || path.join(root, `installation-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-backup-"));
  fs.chmodSync(staging, 0o700);
  try {
    const dbDir = path.join(staging, "database"); fs.mkdirSync(dbDir, { recursive: true });
    const sqlite = sqlitePath();
    let databaseFormat;
    if (sqlite) {
      if (!fs.existsSync(sqlite)) fail(`Base SQLite introuvable: ${sqlite}`);
      const copiedDatabase = path.join(dbDir, "database.sqlite");
      fs.copyFileSync(sqlite, copiedDatabase);
      run("sqlite3", [copiedDatabase, [
        "UPDATE ical_sources SET url = 'redacted://not-exported/' || rowid, is_active = 0;",
        "UPDATE gites SET ical_export_token = NULL, airbnb_listing_id = NULL;",
        "UPDATE planning_relay_periods SET share_nonce = lower(hex(randomblob(32))), public_code_hash = NULL, public_origin = NULL;",
        "DELETE FROM auth_sessions; DELETE FROM api_tokens; DELETE FROM document_shares; DELETE FROM password_reset_tokens; DELETE FROM security_throttles;",
      ].join(" ")]);
      const oauthTables = spawnSync("sqlite3", [copiedDatabase, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('superpdp_connections', 'superpdp_oauth_states', 'electronic_invoice_transmissions', 'superpdp_inbox_syncs', 'electronic_invoice_payments');"], { encoding: "utf8" });
      if (oauthTables.status !== 0) fail("Impossible de vérifier les tables OAuth de la copie de sauvegarde.");
      const presentOauthTables = new Set(oauthTables.stdout.trim().split("\n"));
      if (presentOauthTables.has("electronic_invoice_payments")) run("sqlite3", [copiedDatabase, "UPDATE electronic_invoice_payments SET status='paused_after_restore', operation_id=NULL, operation_expires_at=NULL, last_error_code='SUPERPDP_DATABASE_MOVED'; UPDATE organization_jobs SET status='failed', locked_at=NULL, lock_owner=NULL, last_error='SUPERPDP_DATABASE_MOVED' WHERE type='superpdp.payment' AND status IN ('queued','running');"]);
      if (presentOauthTables.has("electronic_invoice_transmissions")) {
        run("sqlite3", [copiedDatabase, "UPDATE electronic_invoice_transmissions SET status='paused_after_restore', operation_id=NULL, operation_expires_at=NULL, next_sync_at=NULL; UPDATE organization_jobs SET status='failed', locked_at=NULL, lock_owner=NULL, last_error='SUPERPDP_DATABASE_MOVED' WHERE type IN ('superpdp.prepare','superpdp.send','superpdp.reconcile','superpdp.inbox') AND status IN ('queued','running');"]);
        // Keep non-secret connection keys referenced by immutable transmission history.
        run("sqlite3", [copiedDatabase, "UPDATE superpdp_connections SET encrypted_client_secret=NULL, encrypted_tokens=NULL, client_id=NULL, expected_number=NULL, access_expires_at=NULL, operation_id=NULL, operation_expires_at=NULL, generation=generation+1, status='disconnected';"]);
      }
      if (presentOauthTables.has("superpdp_inbox_syncs")) run("sqlite3", [copiedDatabase, "UPDATE superpdp_inbox_syncs SET enabled=0, revision=revision+1, operation_id=NULL, operation_expires_at=NULL, next_sync_at=NULL, last_error_code='SUPERPDP_DATABASE_MOVED';"]);
      for (const table of ["superpdp_oauth_states", "superpdp_connections"]) {
        const references = ["electronic_invoice_transmissions", "superpdp_inbox_syncs"].filter((name) => presentOauthTables.has(name));
        const where = table === "superpdp_connections" && references.length ? ` WHERE ${references.map((name) => `id NOT IN (SELECT connection_id FROM ${name})`).join(" AND ")}` : "";
        if (presentOauthTables.has(table)) run("sqlite3", [copiedDatabase, `DELETE FROM "${table}"${where};`]);
      }
      databaseFormat = "sqlite-sanitized";
    } else {
      postgresBackupPassphrase();
      const clearDump = path.join(staging, "database.clear.dump");
      try {
        run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", clearDump, postgresDumpUrl()]);
        cryptPostgresDump("encrypt", clearDump, path.join(dbDir, "database.dump.enc"));
      } finally {
        fs.rmSync(clearDump, { force: true });
      }
      databaseFormat = "postgresql-custom-encrypted";
    }
    const assetsDir = path.join(staging, "files"); fs.mkdirSync(assetsDir, { recursive: true });
    for (const name of [...allowedAssetRoots, ...tenantAssetPaths(dataDir)]) {
      const source = path.join(dataDir, name);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(assetsDir, name), { recursive: true });
    }
    const files = listFiles(staging).map((file) => ({ path: path.relative(staging, file), size: fs.statSync(file).size, sha256: sha256(file) }));
    const sqliteSanitized = databaseFormat === "sqlite-sanitized";
    const manifest = {
      format: "rental-manager-installation",
      version: 1,
      createdAt: new Date().toISOString(),
      databaseFormat,
      secretsIncluded: false,
      secretProtection: sqliteSanitized ? "sanitized" : "encrypted-at-rest",
      excludedSecrets: sqliteSanitized
        ? ["environment", "sessions", "apiTokens", "documentShares", "passwordResetTokens", "icalUrls", "publicLinkTokens", "integrationState"]
        : ["environment"],
      protectedSecrets: sqliteSanitized ? [] : ["database fields"],
      files,
    };
    fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
    run("tar", ["-czf", destination, "-C", staging, "."]);
    fs.chmodSync(destination, 0o600);
    console.log(JSON.stringify({ archive: destination, databaseFormat, files: files.length, secretsIncluded: false }, null, 2));
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
};

const extractAndValidate = () => {
  if (!archiveArg) fail("Chemin de l'archive requis.");
  const archive = path.resolve(archiveArg); if (!fs.existsSync(archive)) fail("Archive introuvable.");
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-restore-"));
  run("tar", ["-xzf", archive, "-C", staging]);
  const manifestPath = path.join(staging, "manifest.json"); if (!fs.existsSync(manifestPath)) fail("Manifeste absent.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== "rental-manager-installation" || manifest.version !== 1 || manifest.secretsIncluded !== false) fail("Archive incompatible ou contenant des secrets.");
  for (const item of manifest.files) {
    const resolved = path.resolve(staging, item.path);
    if (!resolved.startsWith(`${staging}${path.sep}`) || !fs.existsSync(resolved) || sha256(resolved) !== item.sha256) fail(`Fichier invalide: ${item.path}`);
  }
  return { staging, manifest, archive };
};

const preview = () => {
  const result = extractAndValidate();
  try { console.log(JSON.stringify({ archive: result.archive, ...result.manifest }, null, 2)); }
  finally { fs.rmSync(result.staging, { recursive: true, force: true }); }
};

const restore = () => {
  if (!flags.includes("--apply") || !flags.includes("--confirm-replace")) fail("Restauration refusée. Relancez avec --apply --confirm-replace après avoir examiné l'aperçu.");
  const result = extractAndValidate();
  try {
    const safetyDir = path.join(dataDir, "restore-safety"); fs.mkdirSync(safetyDir, { recursive: true });
    const sqlite = sqlitePath();
    if (result.manifest.databaseFormat === "sqlite-sanitized" && sqlite) {
      fs.mkdirSync(path.dirname(sqlite), { recursive: true });
      if (fs.existsSync(sqlite)) fs.copyFileSync(sqlite, path.join(safetyDir, `database-${Date.now()}.sqlite`));
      fs.copyFileSync(path.join(result.staging, "database", "database.sqlite"), sqlite);
    } else if (result.manifest.databaseFormat === "postgresql-custom-encrypted" && !sqlite) {
      const schemaName = new URL(databaseUrl).searchParams.get("schema") || "public";
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schemaName)) fail("Nom de schéma PostgreSQL non pris en charge pour une restauration sécurisée.");
      const oauthStatesTable = `"${schemaName}"."superpdp_oauth_states"`;
      const oauthConnectionsTable = `"${schemaName}"."superpdp_connections"`;
      const transmissionsTable = `"${schemaName}"."electronic_invoice_transmissions"`;
      const jobsTable = `"${schemaName}"."organization_jobs"`;
      const inboxSyncTable = `"${schemaName}"."superpdp_inbox_syncs"`;
      const paymentsTable = `"${schemaName}"."electronic_invoice_payments"`;
      const clearDump = path.join(result.staging, "database", "database.restore.clear.dump");
      try {
        cryptPostgresDump("decrypt", path.join(result.staging, "database", "database.dump.enc"), clearDump);
        run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", postgresDumpUrl(), clearDump]);
        // A restored rotating grant must not run simultaneously with its source server.
        run("psql", ["--dbname", postgresDumpUrl(), "--set", "ON_ERROR_STOP=1", "--command", `DO $oauth_restore$
          BEGIN
            IF to_regclass('${oauthStatesTable}') IS NOT NULL THEN
              DELETE FROM ${oauthStatesTable};
            END IF;
            IF to_regclass('${oauthConnectionsTable}') IS NOT NULL THEN
              UPDATE ${oauthConnectionsTable} SET "operation_id" = NULL, "operation_expires_at" = NULL,
                "generation" = "generation" + 1, "status" = 'reauthorization_required', "last_error_code" = 'SUPERPDP_DATABASE_MOVED'
                WHERE "encrypted_tokens" IS NOT NULL;
            END IF;
            IF to_regclass('${transmissionsTable}') IS NOT NULL THEN
              UPDATE ${transmissionsTable} SET "status"='paused_after_restore', "operation_id"=NULL, "operation_expires_at"=NULL, "next_sync_at"=NULL;
              UPDATE ${jobsTable} SET "status"='failed', "locked_at"=NULL, "lock_owner"=NULL, "last_error"='SUPERPDP_DATABASE_MOVED'
                WHERE "type" IN ('superpdp.prepare','superpdp.send','superpdp.reconcile','superpdp.inbox') AND "status" IN ('queued','running');
            END IF;
            IF to_regclass('${inboxSyncTable}') IS NOT NULL THEN
              UPDATE ${inboxSyncTable} SET "enabled"=false, "revision"="revision"+1, "operation_id"=NULL, "operation_expires_at"=NULL, "next_sync_at"=NULL, "last_error_code"='SUPERPDP_DATABASE_MOVED';
            END IF;
            IF to_regclass('${paymentsTable}') IS NOT NULL THEN
              UPDATE ${paymentsTable} SET "status"='paused_after_restore', "operation_id"=NULL, "operation_expires_at"=NULL, "last_error_code"='SUPERPDP_DATABASE_MOVED';
              UPDATE ${jobsTable} SET "status"='failed', "locked_at"=NULL, "lock_owner"=NULL, "last_error"='SUPERPDP_DATABASE_MOVED'
                WHERE "type"='superpdp.payment' AND "status" IN ('queued','running');
            END IF;
          END $oauth_restore$;`]);
      } finally {
        fs.rmSync(clearDump, { force: true });
      }
    } else fail("Le type de base de l'archive ne correspond pas à l'installation cible.");
    for (const name of [...allowedAssetRoots, ...tenantAssetPaths(path.join(result.staging, "files"))]) {
      const source = path.join(result.staging, "files", name); if (!fs.existsSync(source)) continue;
      const target = path.join(dataDir, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(source, target, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ restored: true, archive: result.archive, safetyDir }, null, 2));
  } finally { fs.rmSync(result.staging, { recursive: true, force: true }); }
};

if (command === "backup") backup();
else if (command === "preview") preview();
else if (command === "restore") restore();
else fail("Commande attendue: backup, preview ou restore.");

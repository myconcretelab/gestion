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
        "UPDATE ical_sources SET url = 'redacted://not-exported', is_active = 0;",
        "UPDATE gites SET ical_export_token = NULL, airbnb_listing_id = NULL;",
        "UPDATE planning_relay_periods SET share_nonce = lower(hex(randomblob(32))), public_code_hash = NULL, public_origin = NULL;",
        "DELETE FROM auth_sessions; DELETE FROM api_tokens; DELETE FROM document_shares; DELETE FROM security_throttles;",
      ].join(" ")]);
      databaseFormat = "sqlite-sanitized";
    } else {
      postgresBackupPassphrase();
      const clearDump = path.join(staging, "database.clear.dump");
      try {
        run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", clearDump, databaseUrl]);
        cryptPostgresDump("encrypt", clearDump, path.join(dbDir, "database.dump.enc"));
      } finally {
        fs.rmSync(clearDump, { force: true });
      }
      databaseFormat = "postgresql-custom-encrypted";
    }
    const assetsDir = path.join(staging, "files"); fs.mkdirSync(assetsDir, { recursive: true });
    for (const name of allowedAssetRoots) {
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
        ? ["environment", "sessions", "apiTokens", "documentShares", "icalUrls", "publicLinkTokens", "integrationState"]
        : ["environment"],
      protectedSecrets: sqliteSanitized ? [] : ["database fields"],
      files,
    };
    fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
    run("tar", ["-czf", destination, "-C", staging, "."]);
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
      const clearDump = path.join(result.staging, "database", "database.restore.clear.dump");
      try {
        cryptPostgresDump("decrypt", path.join(result.staging, "database", "database.dump.enc"), clearDump);
        run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", databaseUrl, clearDump]);
      } finally {
        fs.rmSync(clearDump, { force: true });
      }
    } else fail("Le type de base de l'archive ne correspond pas à l'installation cible.");
    for (const name of allowedAssetRoots) {
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

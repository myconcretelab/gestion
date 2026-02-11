import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient as SqliteClient } from "../generated/sqlite-client/index.js";
import { PrismaClient as PostgresClient } from "../generated/postgres-client/index.js";

const args = process.argv.slice(2);

const hasFlag = (name: string) => args.includes(`--${name}`);
const getArgValue = (name: string, fallback?: string) => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  return match.slice(prefix.length);
};

if (hasFlag("help") || hasFlag("h")) {
  console.log(`Usage: tsx scripts/migrate-sqlite-to-postgres.ts [options]

Options:
  --from=sqlite          Source database (default: sqlite)
  --to=postgres          Target database (default: postgres)
  --from-url=URL         Override source URL
  --to-url=URL           Override target URL
  --wipe                 Delete target data before import
  --dry-run              Read-only, no writes
`);
  process.exit(0);
}

const from = getArgValue("from", "sqlite");
const to = getArgValue("to", "postgres");
const wipe = hasFlag("wipe");
const dryRun = hasFlag("dry-run") || hasFlag("dryrun");

const envPaths = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", ".env"),
].filter(Boolean) as string[];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const resolveDatabaseUrl = (value: string | undefined) => {
  if (!value) return value;
  if (!value.startsWith("file:")) return value;
  if (value.startsWith("file:/")) return value;
  const rawPath = value.slice("file:".length);
  const absPath = path.resolve(process.cwd(), rawPath);
  return `file:${absPath}`;
};

const inferSqliteUrl = () => {
  if (process.env.DATABASE_URL_SQLITE) return process.env.DATABASE_URL_SQLITE;
  if (process.env.DATABASE_URL?.startsWith("file:")) return process.env.DATABASE_URL;
  return `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
};

const inferPostgresUrl = () => {
  if (process.env.DATABASE_URL_POSTGRES) return process.env.DATABASE_URL_POSTGRES;
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
    return process.env.DATABASE_URL;
  }
  return undefined;
};

const sqliteUrl = resolveDatabaseUrl(getArgValue("from-url") ?? inferSqliteUrl());
const postgresUrl = getArgValue("to-url") ?? inferPostgresUrl();

if (from !== "sqlite" || to !== "postgres") {
  console.error("Seul le mode --from=sqlite --to=postgres est supporte.");
  process.exit(1);
}

if (!sqliteUrl) {
  console.error("URL SQLite introuvable. Definissez DATABASE_URL_SQLITE ou DATABASE_URL.");
  process.exit(1);
}

if (!postgresUrl) {
  console.error("URL PostgreSQL introuvable. Definissez DATABASE_URL_POSTGRES ou DATABASE_URL.");
  process.exit(1);
}

const maskUrl = (url: string) => url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const main = async () => {
  console.log("Migration SQLite -> PostgreSQL");
  console.log(`Source: ${maskUrl(sqliteUrl)}`);
  console.log(`Cible: ${maskUrl(postgresUrl)}`);
  console.log(`Mode: ${dryRun ? "dry-run" : wipe ? "wipe" : "upsert"}`);

  const sqlite = new SqliteClient({
    datasources: { db: { url: sqliteUrl } },
  });
  const postgres = new PostgresClient({
    datasources: { db: { url: postgresUrl } },
  });

  try {
    const [gites, counters, contrats] = await Promise.all([
      sqlite.gite.findMany(),
      sqlite.contratCounter.findMany(),
      sqlite.contrat.findMany(),
    ]);

    console.log(`Gites: ${gites.length}`);
    console.log(`Compteurs: ${counters.length}`);
    console.log(`Contrats: ${contrats.length}`);

    if (dryRun) return;

    if (wipe) {
      console.log("Suppression des donnees cibles...");
      await postgres.$transaction([
        postgres.contrat.deleteMany(),
        postgres.contratCounter.deleteMany(),
        postgres.gite.deleteMany(),
      ]);
    }

    for (const gite of gites) {
      const { id, telephones, prix_nuit_liste, ...rest } = gite;
      const data = {
        id,
        telephones: parseJson(telephones, [] as string[]),
        prix_nuit_liste: parseJson(prix_nuit_liste, null as number[] | null),
        ...rest,
      };

      const { id: _, ...update } = data;
      await postgres.gite.upsert({
        where: { id },
        create: data,
        update,
      });
    }

    for (const counter of counters) {
      const { id, ...rest } = counter;
      await postgres.contratCounter.upsert({
        where: { id },
        create: { id, ...rest },
        update: rest,
      });
    }

    for (const contrat of contrats) {
      const { id, options, clauses, ...rest } = contrat;
      const data = {
        id,
        options: parseJson(options, {}),
        clauses: parseJson(clauses, {}),
        ...rest,
      };
      const { id: _, ...update } = data;
      await postgres.contrat.upsert({
        where: { id },
        create: data,
        update,
      });
    }

    console.log("Migration terminee.");
  } finally {
    await sqlite.$disconnect();
    await postgres.$disconnect();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

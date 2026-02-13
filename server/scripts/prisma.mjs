import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const args = process.argv.slice(2);
const schemaArgIndex = args.findIndex((arg) => arg === "--schema" || arg.startsWith("--schema="));
let schemaPath;
if (schemaArgIndex !== -1) {
  const schemaArg = args[schemaArgIndex];
  if (schemaArg === "--schema") {
    schemaPath = args[schemaArgIndex + 1];
  } else {
    schemaPath = schemaArg.split("=")[1];
  }
}
if (process.env.PRISMA_SCHEMA && schemaArgIndex === -1) {
  args.push("--schema", process.env.PRISMA_SCHEMA);
  schemaPath = process.env.PRISMA_SCHEMA;
}

const envPaths = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", ".env"),
].filter(Boolean);

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const resolveDatabaseUrl = (value) => {
  if (!value) return value;
  if (value.startsWith("file:/")) return value;
  if (!value.startsWith("file:")) return value;

  const rawPath = value.slice("file:".length);
  const normalizedRawPath = rawPath.replace(/^[./]+/, "");
  const shouldResolveFromMonorepoRoot =
    path.basename(process.cwd()) === "server" && normalizedRawPath.startsWith("server/");
  const absPath = shouldResolveFromMonorepoRoot
    ? path.resolve(process.cwd(), "..", normalizedRawPath)
    : path.resolve(process.cwd(), rawPath);
  return `file:${absPath}`;
};

const fallbackUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const wantsPostgres = Boolean(schemaPath && schemaPath.includes("postgres"));
const rawDatabaseUrl = wantsPostgres
  ? process.env.DATABASE_URL_POSTGRES ?? process.env.DATABASE_URL
  : process.env.DATABASE_URL_SQLITE ?? process.env.DATABASE_URL ?? fallbackUrl;
const databaseUrl = resolveDatabaseUrl(rawDatabaseUrl);
if (wantsPostgres) {
  if (!databaseUrl) {
    console.error("DATABASE_URL (or DATABASE_URL_POSTGRES) is required for Postgres schema.");
    process.exit(1);
  }
  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    console.error("DATABASE_URL (or DATABASE_URL_POSTGRES) must start with postgresql:// or postgres://.");
    process.exit(1);
  }
}
const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl ?? process.env.DATABASE_URL,
  },
});

process.exit(result.status ?? 1);

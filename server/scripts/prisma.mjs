import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const args = process.argv.slice(2);
const schemaArgIndex = args.findIndex((arg) => arg === "--schema" || arg.startsWith("--schema="));
if (process.env.PRISMA_SCHEMA && schemaArgIndex === -1) {
  args.push("--schema", process.env.PRISMA_SCHEMA);
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
  const absPath = path.resolve(process.cwd(), rawPath);
  return `file:${absPath}`;
};

const fallbackUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL ?? fallbackUrl);
const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl ?? process.env.DATABASE_URL,
  },
});

process.exit(result.status ?? 1);

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
const candidates = [
  path.join(process.cwd(), "node_modules", ".bin", "tsx"),
  path.join(process.cwd(), "..", "node_modules", ".bin", "tsx"),
];
const tsxCli = candidates.find((candidate) => fs.existsSync(candidate));
if (!tsxCli) {
  console.error("tsx introuvable. Lancez d'abord `npm install`.");
  process.exit(1);
}

const seedScript = path.join(process.cwd(), "prisma", "seed.ts");

const result = spawnSync(tsxCli, [seedScript], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl ?? process.env.DATABASE_URL,
  },
});

process.exit(result.status ?? 1);

import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target || !["sqlite", "postgres"].includes(target)) {
  console.error("Usage: node scripts/use-schema.mjs <sqlite|postgres>");
  process.exit(1);
}

const root = process.cwd();
const prismaDir = path.join(root, "prisma");

const copyFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

if (target === "sqlite") {
  const source = path.join(prismaDir, "schema.sqlite.prisma");
  const dest = path.join(prismaDir, "schema.prisma");
  if (!fs.existsSync(source)) {
    console.error(`Schema introuvable: ${source}`);
    process.exit(1);
  }
  copyFile(source, dest);
  console.log("Schema SQLite synchronise.");
}

if (target === "postgres") {
  const source = path.join(prismaDir, "schema.postgres.prisma");
  const dest = path.join(prismaDir, "postgres", "schema.prisma");
  if (!fs.existsSync(source)) {
    console.error(`Schema introuvable: ${source}`);
    process.exit(1);
  }
  const content = fs.readFileSync(source, "utf8");
  const adjusted = content.replace(
    "output   = \"../generated/postgres-client\"",
    "output   = \"../../generated/postgres-client\""
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, adjusted, "utf8");
  console.log("Schema PostgreSQL synchronise.");
}

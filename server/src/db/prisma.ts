import "../config/env.js";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const resolveDatabaseUrl = (value: string | undefined) => {
  if (!value) return value;
  if (!value.startsWith("file:")) return value;
  if (value.startsWith("file:/")) return value;

  const rawPath = value.slice("file:".length);
  const absPath = path.resolve(process.cwd(), rawPath);
  return `file:${absPath}`;
};

const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  if (databaseUrl.startsWith("file:")) {
    const rawPath = databaseUrl.slice("file:".length);
    const dir = path.dirname(rawPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

const prisma = new PrismaClient();

export default prisma;

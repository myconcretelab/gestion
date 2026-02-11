import dotenv from "dotenv";
import path from "path";
import fs from "fs";

const dotenvPaths = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", ".env"),
].filter(Boolean) as string[];

for (const envPath of dotenvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const port = Number(process.env.PORT ?? 4000);

export const env = {
  PORT: Number.isNaN(port) ? 4000 : port,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD ?? "",
  DEFAULT_ARRHES_RATE: Number(process.env.DEFAULT_ARRHES_RATE ?? 0.2),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  DATA_DIR: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  PDF_SUBDIR: process.env.PDF_SUBDIR ?? "pdfs",
};

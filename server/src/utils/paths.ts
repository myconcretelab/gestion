import path from "path";
import { env } from "../config/env.js";

export const resolveDataDir = () =>
  path.isAbsolute(env.DATA_DIR) ? env.DATA_DIR : path.join(process.cwd(), env.DATA_DIR);

const normalizeDateReference = (value: Date | string) => {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const getPdfPaths = (numeroContrat: string, dateReference: Date | string) => {
  const resolvedDate = normalizeDateReference(dateReference);
  const year = numeroContrat.split("-")[1] ?? String(resolvedDate.getFullYear());
  const month = String(resolvedDate.getMonth() + 1).padStart(2, "0");
  const absolutePath = path.join(resolveDataDir(), env.PDF_SUBDIR, year, month, `${numeroContrat}.pdf`);
  const relativePath = path.relative(process.cwd(), absolutePath);
  return { absolutePath, relativePath };
};

export const getSentPdfPaths = (numeroContrat: string, dateReference: Date | string) => {
  const resolvedDate = normalizeDateReference(dateReference);
  const year = numeroContrat.split("-")[1] ?? String(resolvedDate.getFullYear());
  const month = String(resolvedDate.getMonth() + 1).padStart(2, "0");
  const absolutePath = path.join(resolveDataDir(), env.PDF_SUBDIR, year, month, `${numeroContrat}--envoye.pdf`);
  const relativePath = path.relative(process.cwd(), absolutePath);
  return { absolutePath, relativePath };
};

export const getSignedContractPaths = (
  numeroContrat: string,
  dateReference: Date | string,
  extension: string
) => {
  const resolvedDate = normalizeDateReference(dateReference);
  const year = numeroContrat.split("-")[1] ?? String(resolvedDate.getFullYear());
  const month = String(resolvedDate.getMonth() + 1).padStart(2, "0");
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const absolutePath = path.join(
    resolveDataDir(),
    "signed-contracts",
    year,
    month,
    `${numeroContrat}--signe${normalizedExtension.toLowerCase()}`
  );
  const relativePath = path.relative(process.cwd(), absolutePath);
  return { absolutePath, relativePath };
};

import path from "path";
import fs from "fs";
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

export const getGitePhotoPaths = (giteId: string, photoId: string, extension: string) => {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const absolutePath = path.join(resolveDataDir(), "gites", giteId, "photos", `${photoId}${normalizedExtension.toLowerCase()}`);
  const relativePath = path.relative(process.cwd(), absolutePath);
  return { absolutePath, relativePath };
};

export const resolveStoredDataFilePath = (storedRelativePath: string) => {
  const normalizedInput = String(storedRelativePath ?? "").trim().replace(/\\/g, "/");
  if (!normalizedInput) return null;

  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };

  const dataDir = resolveDataDir();
  const dataDirName = path.basename(dataDir);
  const normalizedRelativePath = path.normalize(normalizedInput);

  addCandidate(path.resolve(process.cwd(), normalizedRelativePath));
  addCandidate(path.resolve(process.cwd(), "..", normalizedRelativePath));

  const segments = normalizedInput.split("/").filter(Boolean);
  const dataDirIndex = segments.indexOf(dataDirName);
  if (dataDirIndex >= 0 && dataDirIndex < segments.length - 1) {
    addCandidate(path.join(dataDir, ...segments.slice(dataDirIndex + 1)));
  }

  const isInside = (parentPath: string, childPath: string) => {
    const relative = path.relative(parentPath, childPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  const isDataCandidate = (candidate: string) => {
    if (isInside(dataDir, candidate)) return true;
    const parts = candidate.split(path.sep).filter(Boolean);
    const candidateDataDirIndex = parts.lastIndexOf(dataDirName);
    return candidateDataDirIndex >= 0 && parts[candidateDataDirIndex + 1] === "gites";
  };
  const safeCandidates = candidates.filter(isDataCandidate);

  return safeCandidates.find((candidate) => fs.existsSync(candidate)) ?? safeCandidates[0] ?? null;
};

import path from "path";
import { env } from "../config/env.js";

const resolveDataDir = () =>
  path.isAbsolute(env.DATA_DIR) ? env.DATA_DIR : path.join(process.cwd(), env.DATA_DIR);

export const getPdfPaths = (numeroContrat: string, dateReference: Date) => {
  const year = numeroContrat.split("-")[1] ?? String(dateReference.getFullYear());
  const month = String(dateReference.getMonth() + 1).padStart(2, "0");
  const absolutePath = path.join(resolveDataDir(), env.PDF_SUBDIR, year, month, `${numeroContrat}.pdf`);
  const relativePath = path.relative(process.cwd(), absolutePath);
  return { absolutePath, relativePath };
};

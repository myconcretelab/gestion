import fs from "node:fs";
import path from "node:path";
import prisma from "../db/prisma.js";
import {
  importLegacyRevenueWorkbook,
  LegacyRevenueConflictError,
  type LegacyRevenueImportReport,
} from "../services/legacyRevenueDatabaseImport.js";
import { readLegacyRevenueWorkbook } from "../services/legacyRevenueImport.js";

type CliOptions = {
  filePath: string | null;
  apply: boolean;
  allowExistingConflicts: boolean;
  help: boolean;
};

const parseArgs = (args: string[]): CliOptions => {
  let filePath: string | null = null;
  let apply = false;
  let allowExistingConflicts = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--allow-existing-conflicts") allowExistingConflicts = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--file") {
      filePath = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--file=")) filePath = arg.slice("--file=".length);
    else if (!arg.startsWith("-") && !filePath) filePath = arg;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  return { filePath, apply, allowExistingConflicts, help };
};

const printHelp = () => {
  console.log(`Import des revenus historiques 2015 et 2017 à 2020

Usage:
  npm run import:revenus -w server -- --file "/chemin/Phonsine 2015.xlsx"
  npm run import:revenus -w server -- --file "/chemin/Revenus Gites 2020.xlsx" --apply

Options:
  --apply                       Applique les créations/mises à jour (aperçu seulement par défaut)
  --allow-existing-conflicts    Autorise les chevauchements avec des réservations déjà en base
  --help                        Affiche cette aide
`);
};

const formatEuro = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);

const printReport = (report: LegacyRevenueImportReport) => {
  console.log(`Année détectée: ${report.year}`);
  for (const gite of report.gites) {
    console.log(
      `- ${gite.giteName}: ${gite.stays} séjour(s), ${gite.nights} nuit(s), ${formatEuro(gite.revenue)}`
    );
  }
  console.log(
    `Total: ${report.totalStays} séjour(s), ${report.totalNights} nuit(s), ${formatEuro(report.totalRevenue)}`
  );
  console.log(`Lignes ignorées: ${report.skippedRows}`);
  if (report.warnings.length > 0) {
    console.log(`Avertissements (${report.warnings.length}):`);
    report.warnings.forEach((warning) => console.log(`  - ${warning}`));
  }
  if (report.conflicts.length > 0) {
    console.log(`Conflits avec la base (${report.conflicts.length}):`);
    report.conflicts.forEach((conflict) => console.log(`  - ${conflict}`));
  }
  console.log(`Base ciblée: ${report.createCount} création(s), ${report.updateCount} mise(s) à jour.`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.filePath) {
    throw new Error("Le fichier Excel est requis. Utilisez --file \"/chemin/Revenus Gites 2019.xlsx\".");
  }

  const filePath = path.resolve(options.filePath);
  if (!fs.existsSync(filePath)) throw new Error(`Fichier introuvable: ${filePath}`);

  const parsed = await readLegacyRevenueWorkbook(filePath);
  try {
    const report = await importLegacyRevenueWorkbook(parsed, {
      apply: options.apply,
      allowExistingConflicts: options.allowExistingConflicts,
    });
    console.log(`Fichier: ${filePath}`);
    printReport(report);
    console.log(
      report.applied
        ? `Import terminé: ${report.createCount} créée(s), ${report.updateCount} mise(s) à jour.`
        : "APERÇU UNIQUEMENT — aucune donnée modifiée. Relancez avec --apply pour importer."
    );
  } catch (error) {
    if (error instanceof LegacyRevenueConflictError) printReport(error.report);
    throw error;
  }
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

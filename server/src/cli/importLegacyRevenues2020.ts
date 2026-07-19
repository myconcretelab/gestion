import fs from "node:fs";
import path from "node:path";
import { readSheet } from "read-excel-file/node";
import prisma from "../db/prisma.js";
import {
  LEGACY_REVENUE_2020_SHEETS,
  parseLegacyRevenue2020Sheets,
  type LegacyRevenueRecord,
} from "../services/legacyRevenueImport.js";

type CliOptions = {
  filePath: string | null;
  apply: boolean;
  allowExistingConflicts: boolean;
  help: boolean;
};

const normalizeTextKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const parseArgs = (args: string[]): CliOptions => {
  let filePath: string | null = null;
  let apply = false;
  let allowExistingConflicts = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--allow-existing-conflicts") {
      allowExistingConflicts = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--file") {
      filePath = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--file=")) {
      filePath = arg.slice("--file=".length);
    } else if (!arg.startsWith("-") && !filePath) {
      filePath = arg;
    } else {
      throw new Error(`Argument inconnu: ${arg}`);
    }
  }

  return { filePath, apply, allowExistingConflicts, help };
};

const printHelp = () => {
  console.log(`Import des revenus historiques 2020

Usage:
  npm run import:revenus-2020 -w server -- --file "/chemin/Revenus Gites 2020.xlsx"
  npm run import:revenus-2020 -w server -- --file "/chemin/Revenus Gites 2020.xlsx" --apply

Options:
  --apply                       Applique les créations/mises à jour (aperçu seulement par défaut)
  --allow-existing-conflicts    Autorise les chevauchements avec des réservations déjà en base
  --help                        Affiche cette aide
`);
};

const formatEuro = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const groupByGite = (records: LegacyRevenueRecord[]) => {
  const result = new Map<string, LegacyRevenueRecord[]>();
  for (const record of records) {
    const current = result.get(record.giteName) ?? [];
    current.push(record);
    result.set(record.giteName, current);
  }
  return result;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.filePath) {
    throw new Error("Le fichier Excel est requis. Utilisez --file \"/chemin/Revenus Gites 2020.xlsx\".");
  }

  const filePath = path.resolve(options.filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fichier introuvable: ${filePath}`);
  }

  const workbookSheets = await Promise.all(
    LEGACY_REVENUE_2020_SHEETS.map(async (config) => ({
      sheet: config.sheetName,
      data: await readSheet(filePath, config.sheetName),
    }))
  );
  const parsed = parseLegacyRevenue2020Sheets(workbookSheets);
  const recordsByGite = groupByGite(parsed.records);

  console.log(`Fichier: ${filePath}`);
  for (const config of LEGACY_REVENUE_2020_SHEETS) {
    const records = recordsByGite.get(config.giteName) ?? [];
    const nights = records.reduce((sum, record) => sum + record.nights, 0);
    const revenue = records.reduce((sum, record) => sum + record.revenue, 0);
    console.log(
      `- ${config.giteName}: ${records.length} séjour(s), ${nights} nuit(s), ${formatEuro(revenue)}`
    );
  }
  console.log(
    `Total: ${parsed.records.length} séjour(s), ${formatEuro(parsed.records.reduce((sum, record) => sum + record.revenue, 0))}`
  );
  console.log(`Lignes ignorées: ${parsed.skippedRows}`);
  if (parsed.warnings.length > 0) {
    console.log(`Avertissements (${parsed.warnings.length}):`);
    parsed.warnings.forEach((warning) => console.log(`  - ${warning}`));
  }

  const dbGites = await prisma.gite.findMany({
    select: {
      id: true,
      nom: true,
      date_debut_activite: true,
    },
  });
  const gitesByName = new Map(dbGites.map((gite) => [normalizeTextKey(gite.nom), gite]));
  const missingGites = LEGACY_REVENUE_2020_SHEETS.filter(
    (config) => !gitesByName.has(normalizeTextKey(config.giteName))
  );
  if (missingGites.length > 0) {
    throw new Error(`Gîte(s) introuvable(s): ${missingGites.map((config) => config.giteName).join(", ")}.`);
  }

  const originReferences = parsed.records.map((record) => record.originReference);
  const existingImports = await prisma.reservation.findMany({
    where: {
      origin_system: "legacy",
      origin_reference: { in: originReferences },
    },
    select: {
      id: true,
      origin_reference: true,
    },
  });
  const importsByReference = new Map<string, { id: string }>();
  for (const reservation of existingImports) {
    const reference = reservation.origin_reference ?? "";
    if (importsByReference.has(reference)) {
      throw new Error(`Doublon déjà présent en base pour la référence ${reference}.`);
    }
    importsByReference.set(reference, reservation);
  }

  const mappedRecords = parsed.records.map((record) => ({
    ...record,
    giteId: gitesByName.get(normalizeTextKey(record.giteName))!.id,
  }));
  const earliestArrival = new Date(Math.min(...mappedRecords.map((record) => record.arrival.getTime())));
  const latestDeparture = new Date(Math.max(...mappedRecords.map((record) => record.departure.getTime())));
  const importedReferenceSet = new Set(originReferences);
  const existingPeriodReservations = await prisma.reservation.findMany({
    where: {
      gite_id: { in: [...new Set(mappedRecords.map((record) => record.giteId))] },
      date_entree: { lt: latestDeparture },
      date_sortie: { gt: earliestArrival },
    },
    select: {
      id: true,
      gite_id: true,
      hote_nom: true,
      date_entree: true,
      date_sortie: true,
      origin_system: true,
      origin_reference: true,
    },
  });

  const conflicts: string[] = [];
  for (const record of mappedRecords) {
    for (const existing of existingPeriodReservations) {
      if (existing.gite_id !== record.giteId) continue;
      if (
        existing.origin_system === "legacy" &&
        existing.origin_reference &&
        importedReferenceSet.has(existing.origin_reference)
      ) {
        continue;
      }
      if (
        existing.date_entree.getTime() < record.departure.getTime() &&
        existing.date_sortie.getTime() > record.arrival.getTime()
      ) {
        conflicts.push(
          `${record.giteName} ${formatDate(record.arrival)} (${record.sheetName} ligne ${record.rowNumber}) ` +
            `chevauche la réservation existante "${existing.hote_nom}" (${existing.id}).`
        );
      }
    }
  }

  if (conflicts.length > 0) {
    console.log(`Conflits avec la base (${conflicts.length}):`);
    conflicts.forEach((conflict) => console.log(`  - ${conflict}`));
    if (!options.allowExistingConflicts) {
      throw new Error(
        "Import arrêté: utilisez --allow-existing-conflicts uniquement après vérification manuelle."
      );
    }
  }

  const toCreate = mappedRecords.filter((record) => !importsByReference.has(record.originReference)).length;
  const toUpdate = mappedRecords.length - toCreate;
  console.log(`Base ciblée: ${toCreate} création(s), ${toUpdate} mise(s) à jour.`);
  if (!options.apply) {
    console.log("APERÇU UNIQUEMENT — aucune donnée modifiée. Relancez avec --apply pour importer.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const record of mappedRecords) {
      const data = {
        gite_id: record.giteId,
        origin_system: "legacy",
        origin_reference: record.originReference,
        export_to_ical: false,
        hote_nom: record.guestName,
        date_entree: record.arrival,
        date_sortie: record.departure,
        nb_nuits: record.nights,
        nb_adultes: record.adults,
        nb_enfants_2_17: 0,
        prix_par_nuit: record.nightlyPrice,
        prix_total: record.revenue,
        source_paiement: record.paymentSource,
        commentaire: `Import historique 2020 — ${record.sheetName} ligne ${record.rowNumber}`,
      };
      const existing = importsByReference.get(record.originReference);
      if (existing) {
        await tx.reservation.update({ where: { id: existing.id }, data });
      } else {
        await tx.reservation.create({ data });
      }
    }

    for (const [giteName, records] of recordsByGite) {
      const gite = gitesByName.get(normalizeTextKey(giteName))!;
      const firstArrival = new Date(Math.min(...records.map((record) => record.arrival.getTime())));
      if (!gite.date_debut_activite || firstArrival.getTime() < gite.date_debut_activite.getTime()) {
        await tx.gite.update({
          where: { id: gite.id },
          data: { date_debut_activite: firstArrival },
        });
      }
    }
  });

  console.log(`Import terminé: ${toCreate} créée(s), ${toUpdate} mise(s) à jour.`);
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

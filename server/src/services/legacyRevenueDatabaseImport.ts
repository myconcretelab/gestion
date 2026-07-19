import prisma from "../db/prisma.js";
import type { LegacyRevenueParseResult, LegacyRevenueRecord } from "./legacyRevenueImport.js";

const normalizeTextKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

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

export type LegacyRevenueImportReport = {
  year: number;
  gites: Array<{
    giteName: string;
    stays: number;
    nights: number;
    revenue: number;
  }>;
  totalStays: number;
  totalNights: number;
  totalRevenue: number;
  skippedRows: number;
  warnings: string[];
  conflicts: string[];
  createCount: number;
  updateCount: number;
  applied: boolean;
};

export class LegacyRevenueConflictError extends Error {
  report: LegacyRevenueImportReport;

  constructor(report: LegacyRevenueImportReport) {
    super("Import arrêté à cause de chevauchements avec des réservations existantes.");
    this.name = "LegacyRevenueConflictError";
    this.report = report;
  }
}

export const importLegacyRevenueWorkbook = async (
  parsed: LegacyRevenueParseResult,
  options: { apply: boolean; allowExistingConflicts?: boolean }
): Promise<LegacyRevenueImportReport> => {
  const recordsByGite = groupByGite(parsed.records);
  const dbGites = await prisma.gite.findMany({
    select: { id: true, nom: true, date_debut_activite: true },
  });
  const gitesByName = new Map(dbGites.map((gite) => [normalizeTextKey(gite.nom), gite]));
  const missingGites = parsed.sheetConfigs.filter(
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
    select: { id: true, origin_reference: true },
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
  if (mappedRecords.length === 0) {
    throw new Error("Le classeur ne contient aucun séjour importable.");
  }

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

  const report: LegacyRevenueImportReport = {
    year: parsed.year,
    gites: [...recordsByGite.entries()].map(([giteName, records]) => ({
      giteName,
      stays: records.length,
      nights: records.reduce((sum, record) => sum + record.nights, 0),
      revenue: records.reduce((sum, record) => sum + record.revenue, 0),
    })),
    totalStays: parsed.records.length,
    totalNights: parsed.records.reduce((sum, record) => sum + record.nights, 0),
    totalRevenue: parsed.records.reduce((sum, record) => sum + record.revenue, 0),
    skippedRows: parsed.skippedRows,
    warnings: parsed.warnings,
    conflicts,
    createCount: mappedRecords.filter((record) => !importsByReference.has(record.originReference)).length,
    updateCount: mappedRecords.filter((record) => importsByReference.has(record.originReference)).length,
    applied: false,
  };

  if (!options.apply) return report;
  if (conflicts.length > 0 && !options.allowExistingConflicts) {
    throw new LegacyRevenueConflictError(report);
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
        commentaire: `Import historique ${record.year} — ${record.sheetName} ligne ${record.rowNumber}`,
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

  return { ...report, applied: true };
};

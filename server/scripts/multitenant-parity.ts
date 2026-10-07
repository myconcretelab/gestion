import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TABLES = [
  "installation_config", "content_template_versions", "gites", "gite_photos", "wordpress_webhook_jobs",
  "gestionnaires", "app_users", "auth_sessions", "password_reset_tokens", "api_tokens", "document_shares",
  "expense_categories", "expense_recurring_rules", "expense_entries", "urssaf_declarations",
  "guest_night_declarations", "ical_sources", "contrats", "contrat_counters", "factures", "facture_counters",
  "reservation_placeholders", "planning_relay_periods", "planning_relay_workers", "intervenant_hour_entries",
  "user_interventions", "intervenant_expenses", "planning_relay_assignments", "reservations", "gite_season_rates",
  "booking_requests", "gite_monthly_energy_readings",
] as const;

const scalar = async (sql: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, bigint | number | string | null>>>(sql);
  const value = Object.values(rows[0] ?? {})[0];
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
};

const rowCounts = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [
  table, await scalar(`SELECT COUNT(*) AS value FROM "${table}"`),
])));

const orphanChecks = {
  reservationsWithoutGite: await scalar('SELECT COUNT(*) AS value FROM "reservations" r LEFT JOIN "gites" g ON g."id" = r."gite_id" WHERE r."gite_id" IS NOT NULL AND g."id" IS NULL'),
  contractsWithoutGite: await scalar('SELECT COUNT(*) AS value FROM "contrats" c LEFT JOIN "gites" g ON g."id" = c."gite_id" WHERE g."id" IS NULL'),
  invoicesWithoutGite: await scalar('SELECT COUNT(*) AS value FROM "factures" f LEFT JOIN "gites" g ON g."id" = f."gite_id" WHERE g."id" IS NULL'),
  membershipsWithoutUser: await scalar('SELECT COUNT(*) AS value FROM "memberships" m LEFT JOIN "users" u ON u."id" = m."user_id" WHERE u."id" IS NULL'),
  membershipsWithoutOrganization: await scalar('SELECT COUNT(*) AS value FROM "memberships" m LEFT JOIN "organizations" o ON o."id" = m."organization_id" WHERE o."id" IS NULL'),
};

const financialSums = {
  reservationTotal: await scalar('SELECT COALESCE(SUM("prix_total"), 0) AS value FROM "reservations"'),
  contractBalance: await scalar('SELECT COALESCE(SUM("solde_montant"), 0) AS value FROM "contrats"'),
  invoiceBalance: await scalar('SELECT COALESCE(SUM("solde_montant"), 0) AS value FROM "factures"'),
  expenseTotal: await scalar('SELECT COALESCE(SUM("amount"), 0) AS value FROM "expense_entries"'),
};

const documentRows = await prisma.$queryRawUnsafe<Array<{ id: string; file_path: string }>>(`
  SELECT "id", "pdf_path" AS "file_path" FROM "contrats"
  UNION ALL SELECT "id", "pdf_path" AS "file_path" FROM "factures"
  UNION ALL SELECT "id", "signed_document_path" AS "file_path" FROM "contrats" WHERE "signed_document_path" IS NOT NULL
`);
const resolveStoredPath = (storedPath: string) => {
  const direct = path.resolve(process.cwd(), storedPath);
  const parent = path.resolve(process.cwd(), "..", storedPath);
  return fs.existsSync(direct) ? direct : fs.existsSync(parent) ? parent : direct;
};
const presentDocuments = documentRows.filter((row) => fs.existsSync(resolveStoredPath(row.file_path))).length;

const samples = (await Promise.all([
  prisma.$queryRawUnsafe<Array<{ kind: string; id: string; invariant: string }>>('SELECT \'reservation\' AS "kind", "id", CAST("prix_total" AS TEXT) || \':\' || CAST("date_entree" AS TEXT) AS "invariant" FROM "reservations" ORDER BY "id" LIMIT 5'),
  prisma.$queryRawUnsafe<Array<{ kind: string; id: string; invariant: string }>>('SELECT \'contract\' AS "kind", "id", "numero_contrat" || \':\' || CAST("solde_montant" AS TEXT) AS "invariant" FROM "contrats" ORDER BY "id" LIMIT 5'),
  prisma.$queryRawUnsafe<Array<{ kind: string; id: string; invariant: string }>>('SELECT \'invoice\' AS "kind", "id", "numero_facture" || \':\' || CAST("solde_montant" AS TEXT) AS "invariant" FROM "factures" ORDER BY "id" LIMIT 5'),
])).flat();

const report = {
  generatedAt: new Date().toISOString(),
  rowCounts,
  orphanChecks,
  financialSums,
  documents: { referenced: documentRows.length, present: presentDocuments, missing: documentRows.length - presentDocuments },
  activeUsers: await scalar('SELECT COUNT(*) AS value FROM "app_users" WHERE "is_active" = true'),
  coreCounts: { reservations: rowCounts.reservations, contracts: rowCounts.contrats, invoices: rowCounts.factures },
  deterministicSamples: samples.map(({ kind, id, invariant }) => ({
    kind,
    fingerprint: crypto.createHash("sha256").update(`${kind}:${id}:${invariant}`).digest("hex"),
  })),
};

console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();

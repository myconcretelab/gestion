import {
  buildNightOperations,
  evaluateReport,
  reportNightValue,
  reportDefinitionSchema,
  type NightSummaryResponse,
} from "@contrats/shared";
import prisma from "../../../db/prisma.js";
import { getOrganizationId } from "../../organizations/context.js";
import { readReportConfiguration } from "./configuration.js";
import { buildReportScope } from "./scope.js";
import { REPORT_CACHE_VERSION } from "./cache.js";
import { fromJsonString } from "../../../utils/jsonFields.js";

type SavedSummary = {
  revision: number;
  version: number;
  data: NightSummaryResponse;
};
const reads = new Map<string, Promise<NightSummaryResponse>>();
/** A year of calendar nights, independently of the payment/financial workspace. */
export function getNightSummaries(year: number): Promise<NightSummaryResponse> {
  const key = `${getOrganizationId()}:${year}`;
  const pending = reads.get(key);
  if (pending) return pending;
  const calculate = () =>
    prisma.$transaction(
      async (db) => {
        const cache = await db.financeReportCache.findFirst({
          select: { source_revision: true, night_summaries_json: true },
        });
        const saved = fromJsonString<Record<string, SavedSummary>>(
          cache?.night_summaries_json,
          {},
        );
        if (
          saved[year]?.revision === cache?.source_revision &&
          saved[year]?.version === REPORT_CACHE_VERSION
        )
          return saved[year].data;
        const [gites, managers] = await Promise.all([
          db.gite.findMany({
            select: {
              id: true,
              nom: true,
              gestionnaire_id: true,
              fiscal_establishment: {
                select: {
                  fiscal_entity_id: true,
                  fiscal_entity: { select: { id: true, legal_name: true } },
                },
              },
            },
          }),
          db.gestionnaire.findMany({
            select: { id: true, nom: true, prenom: true },
          }),
        ]);
        const scope = buildReportScope(gites, managers);
        const { config } = await readReportConfiguration(db, scope);
        const report =
          config.reports.find(
            (row) => row.kind === "tourist" && row.nightReference,
          ) ?? config.reports.find((row) => row.kind === "tourist");
        const reservations = await db.reservation.findMany({
          where: {
            date_entree: { lt: new Date(Date.UTC(year + 1, 0, 1)) },
            date_sortie: { gt: new Date(Date.UTC(year, 0, 1)) },
          },
          select: {
            id: true,
            gite_id: true,
            date_entree: true,
            date_sortie: true,
            nb_adultes: true,
            nb_enfants_2_17: true,
            options: true,
            booking_source: true,
            source_paiement: true,
          },
        });
        const operations = buildNightOperations(
          reservations.map((row) => ({
            ...row,
            hote_nom: "",
            date_entree: new Date(
              Math.max(+row.date_entree, Date.UTC(year, 0, 1)),
            ),
            date_sortie: new Date(
              Math.min(+row.date_sortie, Date.UTC(year + 1, 0, 1)),
            ),
            infants:
              fromJsonString<{ tourist_tax?: { infants?: number } }>(
                row.options,
                {},
              ).tourist_tax?.infants ?? 0,
          })),
        );
        const data: NightSummaryResponse = {
          year,
          report: report
            ? {
                id: report.id,
                name: report.name,
                guestGroups: report.nightGuests ?? ["adults"],
              }
            : null,
          calculatedAt: new Date().toISOString(),
          properties: scope.properties.map((property) => ({
            id: property.id,
            inScope: Boolean(report?.propertyIds.includes(property.id)),
            months: [],
          })),
        };
        const sources = {
          propertyOperators: Object.fromEntries(
            scope.properties.map((property) => [
              property.id,
              property.operatorId,
            ]),
          ),
          propertyManagers: Object.fromEntries(
            scope.properties.map((property) => [
              property.id,
              property.managerId ?? null,
            ]),
          ),
          operationEdits: {},
        };
        const valid =
          report &&
          reportDefinitionSchema.safeParse(report).success &&
          report.propertyIds.every((id) =>
            scope.properties.some((property) => property.id === id),
          ) &&
          (!report.managerId ||
            scope.managers.some((manager) => manager.id === report.managerId));
        for (let month = 1; month <= 12; month++) {
          const period = `${year}-${String(month).padStart(2, "0")}`;
          // A monthly macaron shows its month, even if the report is quarterly/yearly.
          const monthlyOperations = operations.filter((operation) =>
            operation.stayDate.startsWith(period),
          );
          const amounts = new Map<
            string,
            { total: number; included: number; reviewCount: number }
          >();
          for (const operation of monthlyOperations) {
            const amount = amounts.get(operation.propertyId) ?? {
              total: 0,
              included: 0,
              reviewCount: 0,
            };
            amount.total += reportNightValue(operation, report?.nightGuests);
            amounts.set(operation.propertyId, amount);
          }
          const result = report
            ? evaluateReport(
                { ...report, cadence: "monthly" },
                period,
                {},
                monthlyOperations,
                sources,
              )
            : null;
          for (const row of result?.rows ?? []) {
            const amount = amounts.get(row.propertyId)!;
            if (row.status === "included") amount.included += row.value;
            if (row.status === "review") amount.reviewCount++;
          }
          for (const property of data.properties) {
            const amount = amounts.get(property.id) ?? {
              total: 0,
              included: 0,
              reviewCount: 0,
            };
            property.months.push({
              month,
              ...amount,
              reviewCount: amount.reviewCount + (report && !valid ? 1 : 0),
            });
          }
        }
        const revision = await db.financeReportCache.findFirst({
          select: { source_revision: true },
        });
        saved[year] = {
          revision: revision?.source_revision ?? 0,
          version: REPORT_CACHE_VERSION,
          data,
        };
        await db.financeReportCache.upsert({
          where: { organization_id: getOrganizationId() },
          create: {
            organization_id: getOrganizationId(),
            night_summaries_json: JSON.stringify(saved),
          },
          update: { night_summaries_json: JSON.stringify(saved) },
        });
        return data;
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await calculate();
      } catch (error) {
        if (
          attempt >= 2 ||
          !["P2002", "P2034", "P1008", "P2028"].includes(
            (error as { code?: string }).code ?? "",
          )
        )
          throw error;
      }
    }
  };
  const request = run().finally(() => reads.delete(key));
  reads.set(key, request);
  return request;
}

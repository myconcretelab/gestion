import {
  BOOKING_SOURCES,
  createReport,
  type ReportDefinition,
  type ReportState,
  type ReportWorkspaceData,
} from "@contrats/shared";
import type { TenantTransactionClient } from "../../../db/prisma.js";
import {
  getOrganizationId,
  HISTORICAL_ORGANIZATION_ID,
} from "../../organizations/context.js";
import { readDeclarationNightsSettings } from "../../../services/declarationNightsSettings.js";

export type ReportConfiguration = Pick<
  ReportState,
  | "reports"
  | "overrides"
  | "progress"
  | "worklistStartMonth"
  | "nightSettingsVersion"
  | "nightSettingsWarnings"
>;
type Configuration = ReportConfiguration;
function initialConfiguration(
  facts: Pick<ReportWorkspaceData, "properties" | "operators">,
): Configuration {
  const reports: ReportDefinition[] = [];
  for (const operatorId of [
    ...new Set(facts.properties.map((property) => property.operatorId)),
  ]) {
    const operator = facts.operators.find((row) => row.id === operatorId);
    reports.push({
      ...createReport("social", `social-${operatorId ?? "unassigned"}`),
      name: operator ? "Cotisations sociales" : "Recettes sans exploitant",
      recipient: operator?.name ?? "Exploitant à renseigner",
      operatorId,
      propertyIds: facts.properties
        .filter((property) => property.operatorId === operatorId)
        .map((row) => row.id),
    });
  }
  if (facts.properties.length)
    reports.push({
      ...createReport("tourist", "guest-nights"),
      // Preserve the scope of the existing default report; new reports default to Direct.
      bookingSources: undefined,
      nightReference: true,
      recipient: "Gestion interne",
      propertyIds: facts.properties.map((row) => row.id),
    });
  return { reports, overrides: {}, progress: {} };
}
const sourceKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function upgradeNightConfiguration(
  config: ReportConfiguration,
  legacy: string[],
) {
  if (config.nightSettingsVersion) return;
  const warnings = legacy.filter(
    (label) =>
      !BOOKING_SOURCES.some((source) => sourceKey(source) === sourceKey(label)),
  );
  let referenceChosen = false;
  config.reports = config.reports.map((report) => {
    if (report.kind !== "tourist") return report;
    const next = {
      ...report,
      nightGuests: report.nightGuests ?? ["adults" as const],
      nightReference: !referenceChosen,
    };
    referenceChosen = true;
    if (
      report.id === "guest-nights" &&
      report.bookingSources === undefined &&
      legacy.length
    ) {
      next.excludedBookingSources = BOOKING_SOURCES.filter((source) =>
        legacy.some((label) => sourceKey(source) === sourceKey(label)),
      );
    }
    return next;
  });
  config.progress = Object.fromEntries(
    Object.entries(config.progress).map(([key, value]) => [
      key,
      !value.snapshot &&
      config.reports.some(
        (report) =>
          report.kind === "tourist" && key.startsWith(`${report.id}:`),
      )
        ? { ...value, ready: false }
        : value,
    ]),
  );
  config.nightSettingsVersion = 1;
  config.nightSettingsWarnings = warnings;
}
export async function readReportConfiguration(
  db: TenantTransactionClient,
  facts: Pick<ReportWorkspaceData, "properties" | "operators">,
) {
  let store = await db.financeReportStore.findFirst();
  const config: ReportConfiguration = store
    ? JSON.parse(store.data_json)
    : initialConfiguration(facts);
  if (!store && !facts.properties.length) return { store, config };
  if (!config.nightSettingsVersion) {
    const legacy =
      getOrganizationId() === HISTORICAL_ORGANIZATION_ID
        ? readDeclarationNightsSettings().excluded_sources
        : [];
    upgradeNightConfiguration(config, legacy);
    store = store
      ? await db.financeReportStore.update({
          where: { id: store.id },
          data: {
            data_json: JSON.stringify(config),
            revision: { increment: 1 },
          },
        })
      : await db.financeReportStore.create({
          data: {
            organization_id: getOrganizationId(),
            data_json: JSON.stringify(config),
          },
        });
    await db.auditLog.create({
      data: {
        organization_id: getOrganizationId(),
        action: "report.night-settings-upgrade",
        resource_type: "finance_report",
        resource_id: "night-settings",
        metadata_json: JSON.stringify({
          legacyExcludedSources: legacy,
          unresolved: config.nightSettingsWarnings,
        }),
      },
    });
  }
  return { store, config };
}

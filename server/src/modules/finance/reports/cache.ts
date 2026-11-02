import {
  buildReportReminders,
  type ReportRemindersResponse,
  type ReportWorkspaceData,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { getOrganizationId } from "../../organizations/context.js";

// Bump when the calculation rules change, so saved data is rebuilt on the next visit.
export const REPORT_CACHE_VERSION = 3;
const monthFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
});
export const reportCalculationMonth = (now: Date) => monthFormatter.format(now);
type CacheMetadata = {
  source_revision: number;
  calculated_revision: number | null;
  engine_version: number;
  calculated_month: string | null;
  calculated_at: Date | null;
};
export const reportCacheIsCurrent = (cache: CacheMetadata | null, now: Date) =>
  Boolean(
    cache?.calculated_at &&
    cache.engine_version === REPORT_CACHE_VERSION &&
    cache.source_revision === cache.calculated_revision &&
    cache.calculated_month === reportCalculationMonth(now),
  );

export async function storeReportCalculation(
  db: TenantTransactionClient,
  state: ReportWorkspaceData,
  now: Date,
): Promise<ReportWorkspaceData> {
  const organizationId = getOrganizationId();
  const source = await db.financeReportCache.findFirst({
    select: { source_revision: true },
  });
  const currentYear = Number(reportCalculationMonth(now).slice(0, 4));
  const years = [
    currentYear,
    ...state.operations
      .flatMap((row) => [row.stayDate, row.paymentDate])
      .filter((date): date is string => Boolean(date))
      .map((date) => Number(date.slice(0, 4))),
    ...state.legacyDeclarations.map((row) => Number(row.period.slice(0, 4))),
    ...state.reports.flatMap((report) =>
      Object.keys(state.progress)
        .filter((key) => key.startsWith(`${report.id}:`))
        .map((key) =>
          Number(key.slice(report.id.length + 1, report.id.length + 5)),
        ),
    ),
  ].filter(
    (year) => Number.isInteger(year) && year >= 2000 && year <= currentYear,
  );
  const summaries: Record<string, ReturnType<typeof buildReportReminders>> = {};
  const firstYear = years.reduce(
    (first, year) => Math.min(first, year),
    currentYear,
  );
  for (let year = firstYear; year <= currentYear; year++)
    summaries[year] = buildReportReminders(state, year, now);
  const workspace = { ...state, calculatedAt: now.toISOString() };
  const data = {
    calculated_revision: source?.source_revision ?? 0,
    calculated_at: now,
    calculated_month: reportCalculationMonth(now),
    engine_version: REPORT_CACHE_VERSION,
    workspace_json: JSON.stringify(workspace),
    reminders_json: JSON.stringify(summaries),
  };
  await db.financeReportCache.upsert({
    where: { organization_id: organizationId },
    create: { organization_id: organizationId, ...data },
    update: data,
  });
  return workspace;
}

/** Reservations only reads this small projection. Never load facts or run calculations here. */
export async function getStoredReportReminders(
  year: number,
  now = new Date(),
): Promise<ReportRemindersResponse> {
  const cache = await prisma.financeReportCache.findFirst({
    select: {
      source_revision: true,
      calculated_revision: true,
      engine_version: true,
      calculated_at: true,
      calculated_month: true,
      reminders_json: true,
    },
  });
  const stale = !reportCacheIsCurrent(cache, now) || !cache?.reminders_json;
  const summaries = cache?.reminders_json
    ? (JSON.parse(cache.reminders_json) as Record<
        string,
        ReportRemindersResponse["reminders"]
      >)
    : {};
  return {
    reminders: (summaries[year] ?? []).map((reminder) => ({
      ...reminder,
      canCopy: !stale && reminder.canCopy,
    })),
    stale,
    calculatedAt: cache?.calculated_at?.toISOString() ?? null,
  };
}

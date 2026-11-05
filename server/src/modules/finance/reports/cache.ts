import {
  buildReportReminders,
  type ReportRemindersResponse,
  type ReportWorkspaceData,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { getOrganizationId } from "../../organizations/context.js";
import { automaticPlatformReceiptThrough } from "../../reservationPayments/automaticReceipt.js";
import { reportPaymentCheckDay } from "./paymentAlerts.js";

// Bump when the calculation rules change, so saved data is rebuilt on the next visit.
export const REPORT_CACHE_VERSION = 16;
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
    cache.calculated_month === reportCalculationMonth(now) &&
    reportPaymentCheckDay(cache.calculated_at) === reportPaymentCheckDay(now) &&
    automaticPlatformReceiptThrough(cache.calculated_at) ===
      automaticPlatformReceiptThrough(now),
  );

export async function readReportCalculation(
  db: TenantTransactionClient,
  now: Date,
  year: number,
) {
  const [source, annual] = await Promise.all([
    db.financeReportCache.findFirst({ select: { source_revision: true } }),
    db.financeReportYearCache.findFirst({ where: { year } }),
  ]);
  const cache = annual
    ? { ...annual, source_revision: source?.source_revision ?? 0 }
    : null;
  return {
    cache,
    workspace:
      reportCacheIsCurrent(cache, now) && cache?.workspace_json
        ? (JSON.parse(cache.workspace_json) as ReportWorkspaceData)
        : null,
  };
}

export async function storeReportCalculation(
  db: TenantTransactionClient,
  state: ReportWorkspaceData,
  now: Date,
  reuse?: {
    remindersJson: string;
    reportIds: string[];
  },
): Promise<ReportWorkspaceData> {
  const organizationId = getOrganizationId();
  const source = await db.financeReportCache.findFirst({
    select: { source_revision: true },
  });
  const year = state.year!;
  const summaries: Record<string, ReturnType<typeof buildReportReminders>> = {};
  const previous: typeof summaries = reuse
    ? JSON.parse(reuse.remindersJson)
    : {};
  const changedReports = reuse ? new Set(reuse.reportIds) : null;
  const reportOrder = new Map(state.reports.map((report, i) => [report.id, i]));
  // The next year's small reminder projection keeps December / Q4 / annual closings
  // reachable in January, without mixing two years of source operations.
  for (const summaryYear of [year, year + 1]) {
    if (!changedReports || !previous[summaryYear]) {
      summaries[summaryYear] = buildReportReminders(state, summaryYear, now);
      continue;
    }
    summaries[summaryYear] = [
      ...previous[summaryYear].filter(
        (row) => !changedReports.has(row.reportId),
      ),
      ...buildReportReminders(
        {
          ...state,
          reports: state.reports.filter((report) =>
            changedReports.has(report.id),
          ),
        },
        summaryYear,
        now,
      ),
    ].sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.name.localeCompare(b.name, "fr") ||
        a.recipient.localeCompare(b.recipient, "fr") ||
        (reportOrder.get(a.reportId) ?? 0) - (reportOrder.get(b.reportId) ?? 0),
    );
  }
  const workspace = { ...state, calculatedAt: now.toISOString() };
  const data = {
    calculated_revision: source?.source_revision ?? 0,
    calculated_at: now,
    calculated_month: reportCalculationMonth(now),
    engine_version: REPORT_CACHE_VERSION,
    workspace_json: JSON.stringify(workspace),
    reminders_json: JSON.stringify(summaries),
  };
  await db.financeReportYearCache.upsert({
    where: { organization_id_year: { organization_id: organizationId, year } },
    create: { organization_id: organizationId, year, ...data },
    update: data,
  });
  return workspace;
}

/** Reservations only reads this small projection. Never load facts or run calculations here. */
export async function getStoredReportReminders(
  year: number,
  now = new Date(),
): Promise<ReportRemindersResponse> {
  const [source, caches] = await Promise.all([
    prisma.financeReportCache.findFirst({ select: { source_revision: true } }),
    prisma.financeReportYearCache.findMany({
      where: { year: { in: [year - 1, year] } },
      select: {
        year: true,
        calculated_revision: true,
        engine_version: true,
        calculated_at: true,
        calculated_month: true,
        reminders_json: true,
      },
      orderBy: { year: "asc" },
    }),
  ]);
  const isStale = (cache: (typeof caches)[number]) =>
    !reportCacheIsCurrent(
      {
        ...cache,
        source_revision: source?.source_revision ?? 0,
      },
      now,
    );
  const current = caches.find((cache) => cache.year === year);
  const stale = !current || isStale(current);
  return {
    reminders: caches
      .flatMap((cache) => {
        const summaries = JSON.parse(cache.reminders_json) as Record<
          string,
          ReportRemindersResponse["reminders"]
        >;
        return (summaries[year] ?? []).map((reminder) => ({
          ...reminder,
          canCopy: !stale && !isStale(cache) && reminder.canCopy,
          ...(cache.year !== year && isStale(cache) ? { stale: true } : {}),
        }));
      })
      .sort(
        (a, b) =>
          a.month.localeCompare(b.month) ||
          a.name.localeCompare(b.name, "fr") ||
          a.recipient.localeCompare(b.recipient, "fr"),
      ),
    stale,
    calculatedAt: current?.calculated_at.toISOString() ?? null,
  };
}

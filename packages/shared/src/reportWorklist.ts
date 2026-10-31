import type { ReportWorkspaceData } from "./reportApi.js";
import {
  evaluateReport,
  getReportPeriod,
  reportPeriodKey,
  reportStatus,
  snapshotDiffers,
  type ReportDefinition,
} from "./reports.js";

const parisDay = (now: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

export function legacyReportPeriodConfirmed(
  state: ReportWorkspaceData,
  report: ReportDefinition,
  month: string,
) {
  if (
    !report.propertyIds.length ||
    !["social", "tourist"].includes(report.kind)
  )
    return false;
  const period = getReportPeriod(month, report.cadence);
  const cursor = new Date(`${period.start}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) < period.end) {
    const key = cursor.toISOString().slice(0, 7);
    const covered = new Set(
      state.legacyDeclarations
        .filter((row) => row.kind === report.kind && row.period === key)
        .flatMap((row) => row.propertyIds ?? []),
    );
    if (!report.propertyIds.every((id) => covered.has(id))) return false;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return true;
}

export function reportWorkItem(
  state: ReportWorkspaceData,
  report: ReportDefinition,
  month: string,
) {
  const period = getReportPeriod(month, report.cadence);
  const key = reportPeriodKey(report, month);
  const progress = state.progress[key];
  // Filter before evaluation so a history spanning years does not clone every
  // operation for every closed period. Keep all properties for report overrides.
  const operations = state.operations.filter((row) => {
    const date =
      report.dateBasis === "payment"
        ? (state.operationEdits[row.id]?.paymentDate ??
          row.paymentDate ??
          row.stayDate)
        : row.stayDate;
    return date >= period.start && date < period.end;
  });
  const result = evaluateReport(
    report,
    month,
    state.overrides[key],
    operations,
    state,
  );
  const beforeTracking = Boolean(
    state.worklistStartMonth && period.end <= `${state.worklistStartMonth}-01`,
  );
  const historical =
    !progress?.snapshot &&
    (beforeTracking || legacyReportPeriodConfirmed(state, report, month));
  const confirmed =
    historical ||
    Boolean(progress?.snapshot && !snapshotDiffers(progress.snapshot, result));
  const status = historical
    ? beforeTracking
      ? "Déjà traité"
      : "Déjà déclaré"
    : reportStatus(progress, result);
  return {
    key,
    report,
    month: period.start.slice(0, 7),
    period,
    result,
    progress,
    historical,
    confirmed,
    status: status === "Prêt" ? "Prêt à confirmer" : status,
  };
}
export type ReportWorkItem = ReturnType<typeof reportWorkItem>;

function firstReportingDay(state: ReportWorkspaceData, today: string) {
  if (state.worklistStartMonth) return `${state.worklistStartMonth}-01`;
  const dates = [
    ...state.operations.flatMap((row) => [
      row.stayDate,
      state.operationEdits[row.id]?.paymentDate ?? row.paymentDate,
    ]),
    ...state.legacyDeclarations.map((row) => `${row.period}-01`),
    ...state.reports.flatMap((report) =>
      Object.keys(state.progress)
        .filter((key) => key.startsWith(`${report.id}:`))
        .map((key) => key.slice(report.id.length + 1, report.id.length + 11)),
    ),
  ].filter((date): date is string =>
    Boolean(date && /^20\d{2}-\d{2}-\d{2}$/.test(date)),
  );
  return dates.sort()[0] ?? `${today.slice(0, 4)}-01-01`;
}

/** Every configured report for each closed period, including periods with zero activity. */
export function buildReportWorklist(
  state: ReportWorkspaceData,
  now = new Date(),
): ReportWorkItem[] {
  const today = parisDay(now);
  const firstDay = firstReportingDay(state, today);
  const cursor = new Date(`${firstDay.slice(0, 7)}-01T00:00:00Z`);
  const periods = new Map<string, string>();
  while (cursor.toISOString().slice(0, 10) < today) {
    const month = cursor.toISOString().slice(0, 7);
    periods.set(month, month);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const items: ReportWorkItem[] = [];
  for (const report of state.reports) {
    const seen = new Set<string>();
    for (const month of periods.values()) {
      const period = getReportPeriod(month, report.cadence);
      if (period.end > today || seen.has(period.key)) continue;
      seen.add(period.key);
      const item = reportWorkItem(state, report, month);
      if (!item.confirmed) items.push(item);
    }
  }
  return items.sort(
    (a, b) =>
      a.period.end.localeCompare(b.period.end) ||
      a.report.name.localeCompare(b.report.name, "fr") ||
      a.report.recipient.localeCompare(b.report.recipient, "fr") ||
      a.report.id.localeCompare(b.report.id),
  );
}

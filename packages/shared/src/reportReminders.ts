import {
  reportDefinitionSchema,
  type ReportWorkspaceData,
} from "./reportApi.js";
import {
  evaluateReport,
  getReportPeriod,
  reportPeriodKey,
  snapshotDiffers,
} from "./reports.js";
import { legacyReportPeriodConfirmed } from "./reportWorklist.js";

export type ReportReminder = {
  id: string;
  reportId: string;
  name: string;
  recipient: string;
  month: string;
  period: string;
  propertyIds: string[];
  status: "prepare" | "ready" | "review" | "changed";
  reviewCount: number;
  kind: "social" | "tourist";
  total: number;
  canCopy: boolean;
};

/** Closed reporting periods, not legal deadlines: the app does not submit declarations. */
export function buildReportReminders(
  state: ReportWorkspaceData,
  year: number,
  now = new Date(),
): ReportReminder[] {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const currentYear = Number(today.slice(0, 4));
  if (year > currentYear) return [];
  const reminders: ReportReminder[] = [];
  for (const report of state.reports) {
    if (report.kind !== "social" && report.kind !== "tourist") continue;
    const scope = new Set(report.propertyIds);
    const operations = state.operations.filter(
      (row) =>
        scope.has(row.propertyId) &&
        report.categories.includes(row.category) &&
        (!row.basis ||
          row.basis ===
            (report.kind === "tourist" ? "nights" : report.dateBasis)),
    );
    const dates = operations
      .map((row) =>
        report.dateBasis === "payment" ? row.paymentDate : row.stayDate,
      )
      .filter((date): date is string => Boolean(date))
      .sort();
    const history = state.legacyDeclarations.filter(
      (row) => row.kind === report.kind,
    );
    const historyDates = history
      .filter((row) => row.propertyIds?.some((id) => scope.has(id)))
      .map((row) => `${row.period}-01`);
    const confirmationDates = Object.entries(state.progress)
      .filter(
        ([key, value]) => key.startsWith(`${report.id}:`) && value.snapshot,
      )
      .map(([key]) => key.slice(report.id.length + 1, report.id.length + 11));
    // No activity and no declaration history: do not invent a reporting start date.
    const firstDate = [
      ...dates,
      ...historyDates,
      ...confirmationDates,
    ].sort()[0];
    if (!firstDate && !operations.length) continue;
    const periods = new Map<string, string>();
    // Keep December / Q4 / the previous year reachable after the year changes.
    const candidates = [
      ...(year === currentYear ? [`${year - 1}-12`] : []),
      ...Array.from(
        { length: 12 },
        (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
      ),
    ];
    const lastClosedMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    lastClosedMonth.setUTCMonth(lastClosedMonth.getUTCMonth() - 1);
    const startDate = firstDate ?? lastClosedMonth.toISOString().slice(0, 10);
    for (const month of candidates) {
      const period = getReportPeriod(month, report.cadence);
      if (period.end > today || period.end <= startDate) continue;
      periods.set(period.key, period.start.slice(0, 7));
    }
    for (const month of periods.values()) {
      const period = getReportPeriod(month, report.cadence);
      const key = reportPeriodKey(report, month);
      const progress = state.progress[key];
      const result = evaluateReport(
        report,
        month,
        state.overrides[key],
        state.operations,
        state,
      );
      if (
        report.kind === "tourist" &&
        !result.rows.length &&
        !progress?.snapshot
      )
        continue;
      if (progress?.snapshot && !snapshotDiffers(progress.snapshot, result))
        continue;
      // Legacy confirmations stay valid only when every scoped property and month was covered.
      // A confirmation in the new system takes precedence, including subsequent discrepancies.
      if (
        !progress?.snapshot &&
        ((state.worklistStartMonth &&
          period.end <= `${state.worklistStartMonth}-01`) ||
          legacyReportPeriodConfirmed(state, report, month))
      )
        continue;
      const scopeValid = report.propertyIds.every((id) =>
        state.properties.some((property) => property.id === id),
      );
      const operatorValid =
        report.kind !== "social" ||
        (state.operators.some(
          (operator) => operator.id === report.operatorId && !operator.legacy,
        ) &&
          report.propertyIds.every(
            (id) =>
              state.propertyOperators[id] === report.operatorId &&
              !state.operatorIssues?.[id] &&
              !state.socialIssues?.[id],
          ));
      reminders.push({
        id: key,
        reportId: report.id,
        name: report.name,
        recipient: report.recipient,
        month,
        period: period.label,
        propertyIds: [...scope],
        reviewCount: result.reviewCount,
        kind: report.kind,
        total: result.total,
        canCopy:
          !progress?.snapshot &&
          result.reviewCount === 0 &&
          reportDefinitionSchema.safeParse(report).success &&
          scopeValid &&
          operatorValid,
        status: progress?.snapshot
          ? "changed"
          : result.reviewCount
            ? "review"
            : progress?.ready
              ? "ready"
              : "prepare",
      });
    }
  }
  return reminders.sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      a.name.localeCompare(b.name, "fr") ||
      a.recipient.localeCompare(b.recipient, "fr"),
  );
}

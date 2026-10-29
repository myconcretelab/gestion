export {
  REPORT_CATEGORIES,
  REPORT_PAYMENT_METHODS,
  REPORT_TEMPLATES,
  categoryLabel,
  propertyName,
  paymentMethodLabel,
  cadenceLabel,
  createReport,
  evaluateReport,
  getReportPeriod,
  reportPeriodKey,
  accommodationBreakdown,
  formatReportValue,
  snapshotDiffers,
  reportStatus,
  reportCsv,
} from "@contrats/shared";
export type {
  ReportKind,
  ReportCadence,
  ReportDefinition,
  ReportOperation,
  ReportPaymentMethod,
  OperationStatus,
  OperationOverride,
  ReportIssue,
  EvaluatedOperation,
  ReportResult,
} from "@contrats/shared";
import {
  evaluateReport,
  reportPeriodKey,
  type ReportWorkspaceData,
  type ReportDefinition,
} from "@contrats/shared";
export function evaluateWorkspaceReport(
  state: ReportWorkspaceData,
  report: ReportDefinition,
  month: string,
) {
  return evaluateReport(
    report,
    month,
    state.overrides[reportPeriodKey(report, month)],
    state.operations,
    state,
  );
}

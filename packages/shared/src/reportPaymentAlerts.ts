import type { ReportDefinition, ReportResult } from "./reports.js";

export type ReportPaymentAlert = {
  reservationId: string;
  guest: string;
  bookingSource: string;
  stays: Array<{
    propertyId: string;
    propertyLabel: string;
    arrival: string;
    departure: string;
  }>;
  totalCents: number;
  receivedCents: number;
  remainingCents: number;
  reason: "missing" | "partial" | "review";
  sourceRevision: string;
};

export type ReportPaymentReview = {
  signature: string;
  note: string;
  reviewedAt: string;
  reviewedBy?: string | null;
};

/** Stable source signatures let a justified unpaid stay be reviewed without inventing a receipt. */
export const reportPaymentAlertSignature = (
  result: Pick<ReportResult, "paymentAlerts">,
) =>
  JSON.stringify(
    (result.paymentAlerts ?? []).map((row) => [
      row.reservationId,
      row.sourceRevision,
    ]),
  );

export const reportPaymentReviewRequired = (
  result: Pick<ReportResult, "paymentAlerts" | "paymentReview">,
) => Boolean(result.paymentAlerts?.length && !result.paymentReview);

export const reportReviewCount = (result: ReportResult) =>
  result.reviewCount +
  (reportPaymentReviewRequired(result) ? result.paymentAlerts!.length : 0);

export function scopedReportPaymentAlerts(
  report: ReportDefinition,
  period: { start: string; end: string },
  alerts: ReportPaymentAlert[],
  includesSource: (source: string) => boolean,
) {
  if (report.kind !== "social" && report.kind !== "tourist") return [];
  return alerts.filter(
    (alert) =>
      includesSource(alert.bookingSource) &&
      alert.stays.some(
        (stay) =>
          report.propertyIds.includes(stay.propertyId) &&
          stay.arrival < period.end &&
          stay.departure > period.start,
      ),
  );
}

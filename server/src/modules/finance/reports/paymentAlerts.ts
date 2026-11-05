import { createHash } from "node:crypto";
import type {
  ReportPaymentAlert,
  ReservationPaymentTracking,
} from "@contrats/shared";

const parisDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const reportPaymentCheckDay = (now: Date) => parisDay.format(now);

export function endedStayPaymentAlert(
  stay: Pick<
    ReportPaymentAlert,
    "reservationId" | "guest" | "bookingSource" | "stays"
  >,
  tracking: ReservationPaymentTracking,
  testPaymentIds: Set<string>,
  now: Date,
): ReportPaymentAlert | null {
  const today = reportPaymentCheckDay(now);
  // A departure date alone does not attest that today's checkout has already happened.
  if (stay.stays.some((row) => row.departure >= today)) return null;
  const totalCents = Math.round(tracking.total * 100);
  if (totalCents <= 0) return null;
  const active = tracking.entries.filter(
    (entry) =>
      !entry.voided_at && !testPaymentIds.has(entry.id) && entry.amount > 0,
  );
  const received = active.filter(
    (entry) =>
      entry.paid_on &&
      Number.isFinite(Date.parse(entry.paid_on)) &&
      reportPaymentCheckDay(new Date(entry.paid_on)) <= today,
  );
  const receivedCents = received.reduce(
    (total, entry) => total + Math.round(entry.amount * 100),
    0,
  );
  const remainingCents = Math.max(0, totalCents - receivedCents);
  const needsReview =
    tracking.requires_review || received.length !== active.length;
  if (!remainingCents && !needsReview) return null;
  const reason = needsReview
    ? "review"
    : receivedCents > 0
      ? "partial"
      : "missing";
  const sourceRevision = createHash("sha256")
    .update(
      JSON.stringify({
        stay,
        totalCents,
        receivedCents,
        remainingCents,
        reason,
        entries: [...tracking.entries].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
  return {
    ...stay,
    totalCents,
    receivedCents,
    remainingCents,
    reason,
    sourceRevision,
  };
}

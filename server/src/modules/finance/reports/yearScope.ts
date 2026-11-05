import type { TenantTransactionClient } from "../../../db/prisma.js";

/** Include receipts in this year even when the associated stay is in another year. */
export async function loadReportYearReservations(
  db: TenantTransactionClient,
  year: number,
) {
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const end = new Date(`${year + 1}-01-01T00:00:00Z`);
  // Payment days use Europe/Paris. January 1 is always in winter time.
  const paid = {
    gte: new Date(+start - 3_600_000),
    lt: new Date(+end - 3_600_000),
  };
  const [recorded, cards, contracts] = await Promise.all([
    db.reservationRecordedPayment.findMany({
      where: { paid_on: paid, voided_at: null },
      select: { reservation_id: true },
    }),
    db.bookingPayment.findMany({
      where: { paid_at: paid },
      select: {
        reservation_id: true,
        booking_request: {
          select: { approved_reservation_id: true, status: true },
        },
      },
    }),
    db.contrat.findMany({
      where: { date_paiement_arrhes: paid, reservation_id: { not: null } },
      select: { reservation_id: true },
    }),
  ]);
  const receiptIds = [
    ...new Set(
      [
        ...recorded.map((row) => row.reservation_id),
        ...contracts.map((row) => row.reservation_id),
        ...cards.map(
          (row) =>
            row.reservation_id ??
            (row.booking_request?.status === "approved"
              ? row.booking_request.approved_reservation_id
              : null),
        ),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const selected = await db.reservation.findMany({
    where: {
      OR: [
        { date_entree: { lt: end }, date_sortie: { gt: start } },
        { id: { in: receiptIds } },
        // Estimated platform receipts arrive at J+1, including December 31 -> January 1.
        { date_entree: { gte: new Date(+start - 86_400_000), lt: start } },
      ],
    },
  });
  const groups = [
    ...new Set(
      selected.flatMap((row) => (row.stay_group_id ? [row.stay_group_id] : [])),
    ),
  ];
  const siblings = groups.length
    ? await db.reservation.findMany({
        where: { stay_group_id: { in: groups } },
      })
    : [];
  // All segments and their payment history are needed for exact cent allocation.
  // Only operations belonging to the requested year are subsequently exposed.
  return [
    ...new Map([...selected, ...siblings].map((row) => [row.id, row])).values(),
  ].sort((a, b) => +a.date_entree - +b.date_entree || a.id.localeCompare(b.id));
}

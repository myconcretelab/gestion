import { getContractReceiptStatus } from "@contrats/shared";
import { getReservationPaymentTracking, loadReservationPaymentTracking } from "../reservationPayments/ledger.js";
import prisma from "../../db/prisma.js";
import { hydrateBookingRequest } from "../../services/booked.js";
import { cents } from "./money.js";

export const paidBookingForReservation = async (
  reservationId?: string | null,
) => {
  if (!reservationId) return null;
  const request = await prisma.bookingRequest.findFirst({
    where: { approved_reservation_id: reservationId, status: "approved" },
    include: { payment: true },
  });
  return request?.payment?.paid_at
    ? { request, payment: request.payment }
    : null;
};

export const contractStripeTracking = async (
  reservationId: string | null | undefined,
  terms: {
    giteId: string;
    dateDebut: Date;
    dateFin: Date;
    total: number;
    arrhes: number;
  },
) => {
  if (!reservationId) return {};
  const summary = (await reservationPaymentsForIds([reservationId])).get(
    reservationId,
  );
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { payments_managed: true } });
  const managed = reservation?.payments_managed ? await getReservationPaymentTracking(reservationId) : null;
  const managedStatuses = () => {
    if (!managed) return {};
    const status = getContractReceiptStatus(managed, terms.arrhes, terms.total);
    return { ...status, date_paiement_arrhes: status.date_paiement_arrhes ? new Date(status.date_paiement_arrhes) : null };
  };
  if (!summary) return managedStatuses();
  if (summary.status === "requires_review")
    throw Object.assign(
      new Error("Vérifiez le paiement Stripe avant de renseigner le contrat."),
      { statusCode: 409 },
    );
  const original = await paidBookingForReservation(reservationId);
  const direct = original
    ? null
    : await prisma.bookingPayment.findFirst({
        where: { reservation_id: reservationId, paid_at: { not: null } },
        include: { payment_link: true },
        orderBy: { createdAt: "asc" },
      });
  const recorded = original
    ? {
        gite_id: original.request.gite_id,
        start: original.request.date_entree.toISOString(),
        end: original.request.date_sortie.toISOString(),
      }
    : JSON.parse(direct!.payment_link!.terms_json);
  if (
    recorded.gite_id !== terms.giteId ||
    +new Date(recorded.start) !== +terms.dateDebut ||
    +new Date(recorded.end) !== +terms.dateFin ||
    cents(summary.total) !== cents(terms.total)
  ) {
    throw Object.assign(
      new Error(
        "Cette réservation a déjà été payée par Stripe. Les dates et le total du contrat doivent correspondre au séjour payé ; vérifiez le paiement avant de modifier ces éléments.",
      ),
      { statusCode: 409 },
    );
  }
  if (managed) return managedStatuses();
  const amount = cents(summary.total - summary.remaining);
  const arrhesPaid = amount >= cents(terms.arrhes);
  const priorContract =
    summary.offline_received > 0
      ? await prisma.contrat.findFirst({
          where: { reservation_id: reservationId },
          orderBy: { date_creation: "desc" },
        })
      : null;
  return {
    statut_paiement_arrhes: arrhesPaid ? "recu" : "non_recu",
    date_paiement_arrhes: arrhesPaid
      ? priorContract?.date_paiement_arrhes || new Date(summary.paid_at!)
      : null,
    mode_paiement_arrhes: arrhesPaid
      ? priorContract?.mode_paiement_arrhes || "Stripe"
      : null,
    statut_paiement_solde: summary.remaining <= 0 ? "regle" : "non_regle",
  };
};
export const reservationPaymentsForIds = async (reservationIds: string[]) => {
  const receipts = reservationIds.length
    ? await prisma.bookingPayment.findMany({
        where: {
          paid_at: { not: null },
          OR: [
            { reservation_id: { in: reservationIds } },
            {
              booking_request: {
                is: {
                  approved_reservation_id: { in: reservationIds },
                  status: "approved",
                },
              },
            },
          ],
        },
        include: { booking_request: true, payment_link: true },
        orderBy: { paid_at: "asc" },
      })
    : [];
  const grouped = new Map<string, typeof receipts>();
  for (const row of receipts) {
    const id =
      row.reservation_id || row.booking_request?.approved_reservation_id;
    if (id) grouped.set(id, [...(grouped.get(id) || []), row]);
  }
  const result = new Map(
    [...grouped].map(([id, rows]) => {
      const last = rows[rows.length - 1];
      const request = rows.find((row) => row.booking_request)?.booking_request;
      const quote = request
        ? hydrateBookingRequest(request).pricing_snapshot
        : null;
      const amount = rows.reduce(
        (sum, row) => sum + row.paid_amount_cents - row.refunded_amount_cents,
        0,
      );
      const offline = Math.max(
        0,
        ...rows.map((row) => row.payment_link?.offline_received_cents || 0),
      );
      const refund = rows.reduce(
        (sum, row) => sum + row.refunded_amount_cents,
        0,
      );
      const remaining = Math.max(0, last.total_cents - amount - offline);
      return [
        id,
        {
          amount_paid: Math.max(0, amount) / 100,
          offline_received: offline / 100,
          deposit:
            quote?.arrhes_theoriques ??
            (last.payment_link?.deposit_cents || 0) / 100,
          total: last.total_cents / 100,
          remaining: remaining / 100,
          refunded_amount: refund / 100,
          purpose:
            amount >= last.total_cents
              ? "full"
              : rows.every((row) => row.purpose === "deposit")
                ? "deposit"
                : "balance",
          status: rows.some((row) => row.status === "requires_review")
            ? "requires_review"
            : last.status,
          paid_at: last.paid_at,
          request_id: request?.id ?? null,
        },
      ];
    }),
  );
  if (result.size) {
    const managedRows = await prisma.reservation.findMany({ where: { id: { in: [...result.keys()] }, payments_managed: true }, select: { id: true } });
    const tracking = await loadReservationPaymentTracking(managedRows.map((row) => row.id));
    for (const [id, state] of tracking) {
      const summary = result.get(id);
      if (!summary) continue;
      summary.offline_received = state.entries.filter((row) => row.origin !== "stripe" && !row.voided_at).reduce((total, row) => total + cents(row.amount), 0) / 100;
      summary.remaining = state.remaining;
      summary.total = state.total;
      summary.deposit = state.deposit;
    }
  }
  return result;
};
export const reservationPaymentPrefill = async (reservationId: string) =>
  (await reservationPaymentsForIds([reservationId])).get(reservationId) ?? null;

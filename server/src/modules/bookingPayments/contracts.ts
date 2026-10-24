import prisma from "../../db/prisma.js";
import { hydrateBookingRequest } from "../../services/booked.js";
import { cents } from "./service.js";

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
  const paid = await paidBookingForReservation(reservationId);
  if (!paid) return {};
  const { request, payment } = paid;
  if (
    request.gite_id !== terms.giteId ||
    +request.date_entree !== +terms.dateDebut ||
    +request.date_sortie !== +terms.dateFin ||
    payment.total_cents !== cents(terms.total)
  ) {
    throw Object.assign(
      new Error(
        "Cette réservation a déjà été payée par Stripe. Les dates et le total du contrat doivent correspondre au séjour payé ; vérifiez le paiement avant de modifier ces éléments.",
      ),
      { statusCode: 409 },
    );
  }
  const amount = payment.paid_amount_cents - payment.refunded_amount_cents;
  const arrhesPaid = amount >= cents(terms.arrhes);
  return {
    statut_paiement_arrhes: arrhesPaid ? "recu" : "non_recu",
    date_paiement_arrhes: arrhesPaid ? payment.paid_at : null,
    mode_paiement_arrhes: arrhesPaid ? "Stripe" : null,
    statut_paiement_solde:
      amount >= payment.total_cents ? "regle" : "non_regle",
  };
};
export const reservationPaymentPrefill = async (reservationId: string) => {
  const paid = await paidBookingForReservation(reservationId);
  if (!paid) return null;
  const quote = hydrateBookingRequest(paid.request).pricing_snapshot;
  return {
    amount_paid:
      (paid.payment.paid_amount_cents - paid.payment.refunded_amount_cents) /
      100,
    deposit: quote.arrhes_theoriques,
    total: paid.payment.total_cents / 100,
    paid_at: paid.payment.paid_at,
  };
};

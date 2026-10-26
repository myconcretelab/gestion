import { getReservationPaymentTracking } from "../reservationPayments/ledger.js";
import crypto from "node:crypto";
import { bookingStripeConfig } from "./provider.js";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import { computeTouristTax } from "@contrats/shared";
import { fromJsonString } from "../../utils/jsonFields.js";
import { cents } from "./money.js";
import type { OptionsInput } from "../../services/contractCalculator.js";

export const paymentError = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
export const reservationBalance = async (
  id: string,
  db: TenantTransactionClient = prisma,
) => {
  const reservation = await db.reservation.findUnique({
    where: { id },
    include: { gite: true },
  });
  if (!reservation?.gite)
    throw paymentError("La réservation doit être rattachée à un gîte.", 404);
  const [contract, receipts, links] = await Promise.all([
    db.contrat.findFirst({
      where: { reservation_id: id },
      orderBy: [{ date_creation: "desc" }, { id: "desc" }],
    }),
    db.bookingPayment.findMany({
      where: {
        paid_at: { not: null },
        OR: [
          { reservation_id: id },
          { booking_request: { is: { approved_reservation_id: id } } },
        ],
      },
      include: { booking_request: true },
    }),
    db.reservationPaymentLink.findMany({
      where: {
        reservation_id: id,
        payments: { some: { paid_at: { not: null } } },
      },
    }),
  ]);
  const mode = bookingStripeConfig()?.mode;
  if (mode && receipts.some((row) => row.stripe_mode !== mode))
    throw paymentError(
      "Cette réservation contient un règlement d’un autre environnement Stripe. Vérifiez-la avant de demander un paiement.",
    );
  if (
    receipts.some(
      (row) =>
        row.refunded_amount_cents > 0 || row.status === "requires_review",
    )
  )
    throw paymentError(
      "Un paiement ou un remboursement nécessite une vérification avant de créer un nouveau lien.",
    );
  const options = fromJsonString<OptionsInput>(reservation.options, {});
  const accommodation = Math.max(
    0,
    Number(reservation.prix_total) - Number(reservation.remise_montant),
  );
  const tax = options.tourist_tax
    ? computeTouristTax({
        stay: options.tourist_tax,
        nights: reservation.nb_nuits,
        adults: reservation.nb_adultes,
        children: reservation.nb_enfants_2_17,
        accommodation,
        start: reservation.date_entree.toISOString().slice(0, 10),
      })
    : null;
  const rawTotal = cents(
    (tax?.accommodation_amount ?? accommodation) +
      Number(reservation.frais_optionnels_montant) +
      (tax?.host_amount ?? 0),
  );
  if (
    contract &&
    (contract.gite_id !== reservation.gite_id ||
      +contract.date_debut !== +reservation.date_entree ||
      +contract.date_fin !== +reservation.date_sortie)
  )
    throw paymentError(
      "Les dates ou le gîte du contrat diffèrent de la réservation. Vérifiez-les avant de demander un paiement.",
    );
  const oldQuote = fromJsonString<any>(
    receipts.find((row) => row.booking_request)?.booking_request
      ?.pricing_snapshot,
    {},
  );
  const managedTracking = reservation.payments_managed ? await getReservationPaymentTracking(id, db) : null;
  const total = managedTracking ? cents(managedTracking.total) : contract
    ? cents(Number(contract.arrhes_montant) + Number(contract.solde_montant))
    : rawTotal;
  const deposit = contract
    ? cents(Number(contract.arrhes_montant))
    : oldQuote.arrhes_theoriques !== undefined
      ? cents(oldQuote.arrhes_theoriques)
      : cents(accommodation * Number(reservation.gite.arrhes_taux_defaut));
  if (deposit > total || total < 50)
    throw paymentError(
      "Le montant de cette réservation ne permet pas un paiement par carte.",
    );
  const stripePaid = receipts.reduce(
    (sum, row) => sum + row.paid_amount_cents - row.refunded_amount_cents,
    0,
  );
  const offlineDeposit =
    contract?.statut_paiement_arrhes === "recu" &&
    contract.mode_paiement_arrhes !== "Stripe"
      ? deposit
      : 0;
  const stripeForBalance = Math.max(
    0,
    stripePaid - Math.max(0, deposit - offlineDeposit),
  );
  const offlineBalance =
    contract?.statut_paiement_solde === "regle"
      ? Math.max(0, cents(Number(contract.solde_montant)) - stripeForBalance)
      : 0;
  const offline = managedTracking
    ? managedTracking.entries.filter((entry) => entry.origin !== "stripe" && !entry.voided_at).reduce((amount, entry) => amount + cents(entry.amount), 0)
    : Math.max(
    offlineDeposit + offlineBalance,
    0,
    ...links.map((row) => row.offline_received_cents),
  );
  const received = managedTracking ? cents(managedTracking.received) : stripePaid + offline;
  const terms = {
    reservation_id: id,
    gite_id: reservation.gite_id,
    start: reservation.date_entree.toISOString(),
    end: reservation.date_sortie.toISOString(),
    total,
    deposit,
    offline,
    received,
    contract_id: contract?.id ?? null,
    price: Number(reservation.prix_total),
    discount: Number(reservation.remise_montant),
    fees: Number(reservation.frais_optionnels_montant),
    options,
  };
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(terms))
    .digest("hex");
  return {
    reservation,
    contract,
    receipts,
    terms,
    fingerprint,
    total,
    deposit,
    received,
    offline,
    depositDue: Math.max(0, Math.min(total - received, deposit - received)),
    balanceDue: Math.max(0, total - received),
  };
};

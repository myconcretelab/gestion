import { computeTouristTax } from "@contrats/shared";
import type { Reservation } from "./types";

export type PaymentSummaryReservation = Pick<Reservation, "prix_total"> & Partial<Pick<Reservation,
  "linked_contract" | "online_payment" | "remise_montant" | "frais_optionnels_montant" |
  "options" | "nb_nuits" | "nb_adultes" | "nb_enfants_2_17" | "date_entree"
>>;

const money = (value: number | null | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.round(Number(value) * 100) / 100) : 0;

export const getReservationPaymentSummary = (reservation: PaymentSummaryReservation) => {
  const contract = reservation.linked_contract;
  const payment = reservation.online_payment;
  const accommodation = money(reservation.prix_total - money(reservation.remise_montant));
  const tax = reservation.options?.tourist_tax && reservation.date_entree
    ? computeTouristTax({
        stay: reservation.options.tourist_tax,
        nights: reservation.nb_nuits ?? 0,
        adults: reservation.nb_adultes ?? 0,
        children: reservation.nb_enfants_2_17 ?? 0,
        accommodation,
        start: reservation.date_entree.slice(0, 10),
      })
    : null;
  const total = money(contract?.total_montant ?? payment?.total ??
    ((tax?.accommodation_amount ?? accommodation) + money(reservation.frais_optionnels_montant) + (tax?.host_amount ?? 0)));
  const review = Boolean(payment && (payment.status === "requires_review" || payment.refunded_amount > 0));
  const deposit = contract?.statut_paiement_arrhes === "recu"
    ? money(contract.arrhes_montant) : 0;
  // Stripe receipts already include the deposit recorded on the contract.
  const hasOfflineMethod = ["Chèque", "Virement", "Espèces"].includes(contract?.mode_paiement_arrhes ?? "");
  const offlineDeposit = payment && !hasOfflineMethod ? 0 : deposit;
  const offline = Math.max(money(payment?.offline_received), offlineDeposit);
  const recorded = money(money(payment?.amount_paid) + offline);
  const settled = contract?.statut_paiement_solde === "regle" && !review;
  const expectedDeposit = money(contract?.arrhes_montant ?? payment?.deposit);
  // Paying the balance alone does not mark still-unreceived arrhes as paid.
  const received = settled
    ? Math.max(recorded, money(total - Math.max(0, expectedDeposit - recorded)))
    : recorded;
  const known = Boolean(contract || payment);
  const remaining = known ? money(total - received) : null;
  const state = review ? "review" : !known || total <= 0 ? "unknown"
    : remaining === 0 ? "paid" : received > 0 ? "partial" : "unpaid";
  return {
    total, received, remaining, state, review,
    offlineDeposit,
    otherOffline: money(offline - offlineDeposit),
    balanceReceived: settled ? money(received - recorded) : 0,
    progress: total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0,
    label: state === "review" ? "À vérifier" : state === "unknown" ? "Non renseigné"
      : state === "paid" ? "Payé" : state === "unpaid" ? "À régler"
        : received <= money(contract?.arrhes_montant ?? payment?.deposit) ? "Arrhes reçues" : "Paiement partiel",
  };
};

import ReservationPaymentsEditor from "./ReservationPaymentsEditor";
import { isReservationPaymentTracking, type ReservationPaymentTracking } from "@contrats/shared";
import { canCurrentUserAccessPage, canCurrentUserViewAmounts } from "../../utils/auth";
import { formatDate, formatEuro } from "../../utils/format";
import { getReservationPaymentSummary, type PaymentSummaryReservation } from "../../utils/reservationPaymentSummary";
import type { Reservation } from "../../utils/types";
import { isPlatformReservationSource } from "./reservationSources";

type Props = {
  reservation: PaymentSummaryReservation & Pick<Reservation, "source_paiement"> & Partial<Pick<Reservation, "id">>;
  expanded: boolean;
  onToggle: () => void;
  detailsId: string;
  monthlyTotal?: number;
  statusLabel?: string;
};

export const ReservationPaymentTile = ({ reservation, expanded, onToggle, detailsId, statusLabel }: Props) => {
  const summary = getReservationPaymentSummary(reservation);
  const showAmounts = canCurrentUserViewAmounts();
  return (
    <button type="button"
      className={`mobile-reservation-actions__detail reservation-payment-tile reservation-payment-tile--${summary.state}`}
      aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}
      aria-label={`Paiement de la réservation : ${statusLabel ?? summary.label}. ${expanded ? "Masquer" : "Afficher"} le détail`}
    >
      <span className="reservation-payment-tile__heading">
        <span className="mobile-reservation-actions__detail-label">Total</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </span>
      <strong className="mobile-reservation-actions__detail-value">{formatEuro(summary.total, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong>
      <span className="reservation-payment-tile__status">
        {summary.state === "paid" ? <span aria-hidden="true">✓ </span> : null}{statusLabel ?? summary.label}
      </span>
      {showAmounts && summary.state !== "unknown" ? (
        <span className="reservation-payment-tile__track" aria-hidden="true">
          <span style={{ width: `${summary.progress}%` }} />
        </span>
      ) : null}
    </button>
  );
};

export const ReservationPaymentDetails = ({ reservation, detailsId, monthlyTotal, onChangeSource, onUpdated }: Omit<Props, "expanded" | "onToggle"> & {
  onChangeSource: () => void;
  onUpdated?: (tracking: ReservationPaymentTracking, bookingSource?: string) => void;
}) => {
  const summary = getReservationPaymentSummary(reservation);
  if (isReservationPaymentTracking(reservation.payment_tracking) && reservation.id) return <ReservationPaymentsEditor key={reservation.id}
    reservation={{ ...reservation, id: reservation.id }} tracking={reservation.payment_tracking}
    detailsId={detailsId} monthlyTotal={monthlyTotal} onUpdated={onUpdated} />;
  const contract = reservation.linked_contract;
  const payment = reservation.online_payment;
  const source = reservation.source_paiement;
  const method = contract?.mode_paiement_arrhes;
  const row = (label: string, amount: number, detail?: string | null) => (
    <div className="reservation-payment-details__row">
      <span>{label}{detail ? <small>{detail}</small> : null}</span>
      <strong>{formatEuro(amount)}</strong>
    </div>
  );

  return (
    <section id={detailsId} className="reservation-payment-details" aria-label="Détail du règlement">
      {row("Total du séjour", summary.total, "Options et taxe enregistrée comprises")}
      {monthlyTotal !== undefined && Math.abs(monthlyTotal - summary.total) > 0.01
        ? row("Part du mois affiché", monthlyTotal) : null}
      {summary.offlineDeposit > 0 ? row("Arrhes reçues", summary.offlineDeposit,
        [method && method !== "A définir" ? method : "Moyen non renseigné",
          contract?.date_paiement_arrhes ? formatDate(contract.date_paiement_arrhes) : null].filter(Boolean).join(" · ")) : null}
      {payment && payment.amount_paid > 0 ? row(payment.purpose === "deposit" ? "Arrhes reçues" : "Paiement reçu",
        payment.amount_paid, `Carte · Stripe · ${formatDate(payment.paid_at)}`) : null}
      {summary.otherOffline > 0 ? row("Autres règlements reçus", summary.otherOffline, "Moyen non renseigné") : null}
      {summary.balanceReceived > 0 ? row("Solde réglé", summary.balanceReceived, "Moyen non renseigné") : null}
      {payment && payment.refunded_amount > 0 ? row("Remboursement enregistré", payment.refunded_amount,
        "Déjà déduit du paiement reçu") : null}
      {summary.remaining !== null ? (
        <div className="reservation-payment-details__balance">
          <span>{summary.state === "paid" ? "✓ Séjour payé" : summary.review ? "Reste à vérifier" : "Reste à payer"}</span>
          <strong>{formatEuro(summary.remaining)}</strong>
        </div>
      ) : <p>Aucun règlement renseigné. Le moyen prévu ne confirme pas la réception du paiement.</p>}
      {summary.review ? <p role="status">Vérifiez les paiements et remboursements avant de réclamer un solde.</p> : null}
      {source ? <p>{isPlatformReservationSource(source) ? "Plateforme" : "Information historique"} : {source}</p> : null}
      <div className="reservation-payment-details__actions">
        {contract && canCurrentUserViewAmounts() && canCurrentUserAccessPage("contracts") ?
          <a href={`/contrats/${contract.id}`}>Gérer les règlements ↗</a> : null}
        {!isPlatformReservationSource(source) ? <button type="button" onClick={onChangeSource}
          aria-label="Modifier la source ou le moyen de paiement">Modifier l’origine</button> : null}
      </div>
      {payment?.request_id && canCurrentUserAccessPage("booking_requests") ?
        <a href={`/demandes/${payment.request_id}`}>Voir le paiement en ligne ↗</a> : null}
    </section>
  );
};

import { Link } from "react-router-dom";
import { formatDate, formatEuro } from "../../utils/format";
import type { Reservation } from "../../utils/types";

const ReservationOnlinePayment = ({
  payment,
  balancePaid = false,
}: {
  payment: Reservation["online_payment"];
  balancePaid?: boolean;
}) => {
  if (
    !payment ||
    typeof payment.amount_paid !== "number" ||
    typeof payment.remaining !== "number"
  )
    return null;
  const review = payment.status === "requires_review";
  const refunded = payment.refunded_amount > 0;
  return (
    <section
      className="reservations-contact-card"
      aria-label="Paiement en ligne"
    >
      <div className="reservations-contact-card__title">
        {review
          ? "Paiement Stripe — vérification nécessaire"
          : refunded
            ? "Paiement Stripe — remboursement enregistré"
            : payment.purpose === "deposit"
              ? "Arrhes reçues par Stripe"
              : payment.purpose === "balance"
                ? "Règlement reçu par Stripe"
                : "Séjour payé en totalité par Stripe"}
      </div>
      <div className="grid-2">
        <div className="field">
          <span>Montant encaissé{refunded ? " après remboursement" : ""}</span>
          <strong>{formatEuro(payment.amount_paid)}</strong>
        </div>
        <div className="field">
          <span>Solde restant du séjour</span>
          <strong>
            {formatEuro(balancePaid && !refunded ? 0 : payment.remaining)}
          </strong>
        </div>
        <div className="field">
          <span>Date du paiement</span>
          <span>{formatDate(payment.paid_at)}</span>
        </div>
        {refunded ? (
          <div className="field">
            <span>Montant remboursé</span>
            <span>{formatEuro(payment.refunded_amount)}</span>
          </div>
        ) : null}
      </div>
      {refunded || review ? (
        <p className="field-hint">
          Vérifiez le règlement du séjour avant de demander un nouveau paiement.
        </p>
      ) : null}
      {payment.request_id ? (
        <Link className="detail-link" to={`/demandes/${payment.request_id}`}>
          Voir la demande et le paiement
        </Link>
      ) : null}
    </section>
  );
};

export default ReservationOnlinePayment;

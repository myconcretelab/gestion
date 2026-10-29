import { buildPaymentLinkShareHrefs, type PaymentLinkReservation } from "../../utils/reservationPaymentSharing";

export default function ReservationPaymentLinkShareActions({ reservation, link }: {
  reservation: PaymentLinkReservation;
  link: { purpose: "deposit" | "balance"; amount: number; url: string };
}) {
  const hrefs = buildPaymentLinkShareHrefs(reservation, link);
  if (!hrefs.sms && !hrefs.email) return null;
  return (
    <div className="reservation-payment-link__share" role="group" aria-label="Envoyer le lien de paiement">
      {hrefs.sms ? <a href={hrefs.sms} className="reservation-payment-link__share-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /></svg>
        Envoyer par SMS
      </a> : null}
      {hrefs.email ? <a href={hrefs.email} className="reservation-payment-link__share-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></svg>
        Envoyer par e-mail
      </a> : null}
    </div>
  );
}

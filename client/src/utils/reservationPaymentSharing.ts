import { formatDate, formatEuro } from "./format";
import { buildSmsHref } from "./sms";
import type { Reservation } from "./types";

export type PaymentLinkReservation = Pick<Reservation, "id" | "hote_nom" | "date_entree" | "date_sortie" | "telephone" | "email">;

export const buildPaymentLinkShareHrefs = (
  reservation: PaymentLinkReservation,
  link: { purpose: "deposit" | "balance"; amount: number; url: string },
) => {
  const dates = `du ${formatDate(reservation.date_entree)} au ${formatDate(reservation.date_sortie)}`;
  const payment = link.purpose === "deposit" ? "les arrhes de votre séjour" : "le montant restant de votre séjour";
  const body = `Bonjour ${reservation.hote_nom.trim()},\n\nVoici le lien de paiement sécurisé pour régler ${payment} ${dates}, soit ${formatEuro(link.amount)} :\n${link.url}\n\nMerci et à bientôt !`;
  const email = reservation.email?.trim();
  return {
    sms: buildSmsHref(reservation.telephone ?? "", body),
    email: email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Lien de paiement pour votre séjour ${dates}`)}&body=${encodeURIComponent(body)}` : null,
  };
};

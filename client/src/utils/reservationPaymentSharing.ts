import { formatDate, formatEuro } from "./format";
import { buildSmsHref } from "./sms";
import { getReservationOptionBadges } from "./reservationOptionBadges";
import type { Reservation } from "./types";

export type PaymentLinkReservation = Pick<Reservation, "id" | "hote_nom" | "date_entree" | "date_sortie" | "nb_nuits" | "options" | "telephone" | "email">;

export const buildPaymentLinkShareHrefs = (
  reservation: PaymentLinkReservation,
  link: { purpose: "deposit" | "balance"; amount: number; url: string },
) => {
  const dates = `du ${formatDate(reservation.date_entree)} au ${formatDate(reservation.date_sortie)}`;
  const options = reservation.options;
  const optionLabels = getReservationOptionBadges(options).map(({ key, label }) => {
    const quantity = key === "draps" ? options?.draps?.nb_lits
      : key === "linge_toilette" ? options?.linge_toilette?.nb_personnes
      : key === "chiens" ? options?.chiens?.nb : undefined;
    const unit = key === "draps" ? `lit${quantity === 1 ? "" : "s"}` : key === "linge_toilette" ? "pers." : "";
    const detail = quantity && quantity > 0 ? ` (${quantity}${unit ? ` ${unit}` : ""})` : "";
    const billing = key === "menage" && options?.menage?.inclus ? " inclus"
      : options?.[key]?.offert ? (["draps", "chiens"].includes(key) ? " offerts" : key === "linge_toilette" ? " offertes" : " offert") : "";
    return `${label}${detail}${billing}`;
  });
  const payment = link.purpose === "deposit" ? "Arrhes à régler" : "Montant restant à régler";
  const body = [
    `Bonjour ${reservation.hote_nom.trim()},`,
    "",
    `Séjour ${dates} · ${reservation.nb_nuits} nuit${reservation.nb_nuits > 1 ? "s" : ""}.`,
    ...(optionLabels.length ? [`Options : ${optionLabels.join(", ")}.`] : []),
    `${payment} : ${formatEuro(link.amount)}.`,
    `Paiement sécurisé : ${link.url}`,
    "",
    "Merci et à bientôt !",
  ].join("\n");
  const email = reservation.email?.trim();
  return {
    sms: buildSmsHref(reservation.telephone ?? "", body),
    email: email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Lien de paiement pour votre séjour ${dates}`)}&body=${encodeURIComponent(body)}` : null,
  };
};

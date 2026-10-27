import { getBookingSource } from "@contrats/shared";
import { areReservationOptionsAllDeclared, computeReservationOptionsPreview, mergeReservationOptions } from "../../utils/reservationOptions";
import type { ContratOptions, Gite, Reservation } from "../../utils/types";

const money = (value: number) => Math.round(value * 100) / 100;
const ICAL_MARKER = "[ICAL_TO_VERIFY]";
const cleanComment = (value: string) => value.split(/\r?\n/).filter((line) => line.trim() !== ICAL_MARKER).join("\n").trim();

export type ReservationEditDraft = Pick<Reservation,
  "hote_nom" | "date_entree" | "date_sortie" | "nb_adultes" | "nb_enfants_2_17" | "prix_par_nuit" | "prix_total"
> & {
  gite_id: string;
  telephone: string;
  email: string;
  airbnb_url: string;
  booking_source: string;
  commentaire: string;
  options: ContratOptions;
  price_driver: "nightly" | "total";
  additionalFeesAmount: number;
  additionalFeesLabel: string;
  feesChanged: boolean;
};

export const reservationEditNights = (draft: Pick<ReservationEditDraft, "date_entree" | "date_sortie">) => {
  const start = Date.parse(`${draft.date_entree}T00:00:00Z`);
  const end = Date.parse(`${draft.date_sortie}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (new Date(start).toISOString().slice(0, 10) !== draft.date_entree || new Date(end).toISOString().slice(0, 10) !== draft.date_sortie) return 0;
  return Math.round((end - start) / 86_400_000);
};

export const createReservationEditDraft = (reservation: Reservation, gite: Gite | null): ReservationEditDraft => {
  const options = mergeReservationOptions(reservation.options);
  const preview = computeReservationOptionsPreview(options, { nights: reservation.nb_nuits, gite });
  const additionalFeesAmount = money(Math.max(0, (reservation.frais_optionnels_montant ?? 0) - preview.total));
  const originalLabel = reservation.frais_optionnels_libelle ?? "";
  const feeMarker = /(?:Options complémentaires|Frais complémentaires|Frais facture):\s*(.*)$/i.exec(originalLabel);
  return {
    gite_id: reservation.gite_id ?? "",
    hote_nom: reservation.hote_nom,
    telephone: reservation.telephone ?? "",
    email: reservation.email ?? "",
    airbnb_url: reservation.airbnb_url ?? "",
    booking_source: getBookingSource(reservation),
    date_entree: reservation.date_entree.slice(0, 10),
    date_sortie: reservation.date_sortie.slice(0, 10),
    nb_adultes: reservation.nb_adultes,
    nb_enfants_2_17: reservation.nb_enfants_2_17 ?? 0,
    prix_par_nuit: reservation.prix_par_nuit,
    prix_total: reservation.prix_total,
    commentaire: cleanComment(reservation.commentaire ?? ""),
    options,
    price_driver: money(reservation.prix_par_nuit * reservation.nb_nuits) === reservation.prix_total ? "nightly" : "total",
    additionalFeesAmount,
    additionalFeesLabel: feeMarker?.[1] ?? (preview.total === 0 && additionalFeesAmount > 0 ? originalLabel : ""),
    feesChanged: false,
  };
};

export const recalculateReservationEditPrice = (draft: ReservationEditDraft): ReservationEditDraft => {
  const nights = reservationEditNights(draft);
  return draft.price_driver === "nightly"
    ? { ...draft, prix_total: nights > 0 ? money(draft.prix_par_nuit * nights) : 0 }
    : { ...draft, prix_par_nuit: nights > 0 ? money(draft.prix_total / nights) : 0 };
};

export const reservationEditFees = (draft: ReservationEditDraft, original: Reservation, gite: Gite | null) => {
  if (!draft.feesChanged) return {
    amount: original.frais_optionnels_montant ?? 0,
    label: original.frais_optionnels_libelle ?? null,
    declared: original.frais_optionnels_declares,
  };
  const preview = computeReservationOptionsPreview(draft.options, { nights: reservationEditNights(draft), gite });
  return {
    amount: money(preview.total + draft.additionalFeesAmount),
    label: [preview.label, draft.additionalFeesAmount > 0 ? `Options complémentaires: ${draft.additionalFeesLabel.trim() || "Option complémentaire"}` : ""].filter(Boolean).join(" · ") || null,
    declared: draft.additionalFeesAmount === 0 && areReservationOptionsAllDeclared(draft.options),
  };
};

export const buildReservationEditPayload = (draft: ReservationEditDraft, original: Reservation, gite: Gite | null) => {
  if (!draft.hote_nom.trim()) throw new Error("Le nom de l’hôte est requis.");
  const nights = reservationEditNights(draft);
  if (nights <= 0) throw new Error("La date de sortie doit être postérieure à la date d’entrée.");
  for (const value of [draft.prix_par_nuit, draft.prix_total, draft.additionalFeesAmount]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Les montants doivent être positifs ou nuls.");
  }
  for (const value of [draft.nb_adultes, draft.nb_enfants_2_17]) {
    if (!Number.isInteger(value) || value < 0) throw new Error("Le nombre de voyageurs doit être un entier positif ou nul.");
  }
  const fees = reservationEditFees(draft, original, gite);
  const keepMarker = (original.commentaire ?? "").split(/\r?\n/).some((line) => line.trim() === ICAL_MARKER);
  const comment = cleanComment(draft.commentaire);
  return {
    gite_id: draft.gite_id || null,
    placeholder_id: draft.gite_id ? null : original.placeholder_id ?? null,
    hote_nom: draft.hote_nom.trim(),
    telephone: draft.telephone.trim() || null,
    email: draft.email.trim() || null,
    airbnb_url: draft.airbnb_url.trim() || null,
    booking_source: draft.booking_source,
    source_paiement: original.source_paiement,
    date_entree: draft.date_entree,
    date_sortie: draft.date_sortie,
    nb_adultes: draft.nb_adultes,
    nb_enfants_2_17: draft.nb_enfants_2_17,
    prix_par_nuit: draft.prix_par_nuit,
    prix_total: draft.prix_total,
    price_driver: draft.price_driver,
    commentaire: [keepMarker ? ICAL_MARKER : "", comment].filter(Boolean).join("\n") || null,
    frais_optionnels_montant: fees.amount,
    frais_optionnels_libelle: fees.label,
    frais_optionnels_declares: fees.declared,
    options: draft.options,
  };
};

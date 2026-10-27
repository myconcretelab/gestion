import { cleaningBillingSuffix } from "@contrats/shared";
import crypto from "node:crypto";
import type { OptionsInput } from "../../services/contractCalculator.js";
import { fromJsonString, encodeJsonField } from "../../utils/jsonFields.js";
import { buildReservationOriginData } from "../../utils/reservationOrigin.js";
import {
  hydrateBookingRequest,
  type BookingQuote,
} from "../../services/booked.js";
import { round2 } from "../../utils/money.js";
const buildOptionalFeesLabel = (options: OptionsInput) => {
  const labels: string[] = [];
  if (options.draps?.enabled) labels.push("Draps");
  if (options.linge_toilette?.enabled) labels.push("Linge");
  if (options.menage?.enabled) labels.push(`Ménage${cleaningBillingSuffix(options.menage)}`);
  if (options.depart_tardif?.enabled) labels.push("Départ tardif");
  if (options.chiens?.enabled) labels.push("Chiens");
  return labels.join(" · ") || null;
};

const buildReservationComment = (
  internalNote?: string | null,
  clientMessage?: string | null,
) => {
  const trimmedInternalNote = String(internalNote ?? "").trim();
  const trimmedClientMessage = String(clientMessage ?? "").trim();
  const parts = [
    trimmedInternalNote,
    trimmedClientMessage ? `Message du client : ${trimmedClientMessage}` : "",
  ].filter(Boolean);
  return parts.join("\n\n") || null;
};

export const bookingReservationData = (
  bookingRequest: any,
  resolvedInternalNote = bookingRequest.internal_note,
) => {
  const pricingSnapshot = hydrateBookingRequest(bookingRequest)
    .pricing_snapshot as BookingQuote;
  const options = fromJsonString<OptionsInput>(bookingRequest.options, {});
  if (pricingSnapshot.tourist_tax)
    options.tourist_tax = pricingSnapshot.tourist_tax;
  const averageNightly =
    pricingSnapshot.nb_nuits > 0
      ? round2(pricingSnapshot.montant_hebergement / pricingSnapshot.nb_nuits)
      : 0;
  return {
    gite_id: bookingRequest.gite_id,
    stay_group_id: crypto.randomUUID(),
    placeholder_id: null,
    ...buildReservationOriginData({
      originSystem: "booked",
      originReference: bookingRequest.id,
      exportToIcal: true,
    }),
    airbnb_url: null,
    hote_nom: bookingRequest.hote_nom,
    telephone: bookingRequest.telephone ?? null,
    email: bookingRequest.email ?? null,
    date_entree: bookingRequest.date_entree,
    date_sortie: bookingRequest.date_sortie,
    nb_nuits: bookingRequest.nb_nuits,
    nb_adultes: bookingRequest.nb_adultes,
    nb_enfants_2_17: bookingRequest.nb_enfants_2_17,
    prix_par_nuit: averageNightly,
    prix_total: pricingSnapshot.montant_hebergement,
    booking_source: "Direct",
    source_paiement: "Direct",
    commentaire: buildReservationComment(
      resolvedInternalNote,
      bookingRequest.message_client,
    ),
    remise_montant: 0,
    commission_channel_mode: "euro",
    commission_channel_value: 0,
    frais_optionnels_montant: pricingSnapshot.total_options,
    frais_optionnels_libelle: buildOptionalFeesLabel(options),
    frais_optionnels_declares: pricingSnapshot.total_options > 0,
    options: encodeJsonField(options),
  };
};

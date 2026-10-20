import { invoiceReservationServices } from "@contrats/shared";
import type { Gite, Reservation } from "../../utils/types";
import { mergeOptions } from "./rentalForm";

export function invoiceReservationPrefill(
  reservation: Reservation,
  gite?: Gite,
) {
  const pricing = invoiceReservationServices(reservation, gite);
  const options = mergeOptions(reservation.options);
  if (!pricing.useStructuredOptions) {
    // The recorded aggregate is authoritative when current option rates differ.
    for (const key of [
      "draps",
      "linge_toilette",
      "menage",
      "depart_tardif",
      "chiens",
    ] as const) {
      if (!options[key].offert)
        options[key] = { ...options[key], enabled: false };
    }
  }
  return {
    options,
    fees: pricing.extraFee.montant > 0 ? [pricing.extraFee] : [],
  };
}

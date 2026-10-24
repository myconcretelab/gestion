import { buildBookingRequestOptionsTemplateValues } from "@contrats/shared";
import { formatBookedDateInput } from "../../services/booked.js";
import {
  buildBookingEmailMessage,
  type BookingPaymentEmailInfo,
  type BookingRequestEmailPayload,
} from "../../services/bookingRequestEmail.js";
import { resolveEmailPresentation } from "../../services/emailBranding.js";

// Returned only after the payment capability and confirmed status are verified.
export const buildBookingConfirmation = async (
  request: BookingRequestEmailPayload,
  payment: BookingPaymentEmailInfo,
) => {
  const { branding, gite } = await resolveEmailPresentation(request.gite);
  const payload = {
    ...request,
    gite: { ...request.gite, ...gite, nom: gite?.nom || request.gite.nom },
  };
  const message = buildBookingEmailMessage("bookingRequestApproved", payload, {
    branding,
    payment,
  });
  const options = buildBookingRequestOptionsTemplateValues(payload);
  return {
    brand: { name: branding.name, logo_url: branding.logoUrl },
    gite: {
      name: payload.gite.nom,
      address: branding.address,
      photo_url: branding.photoUrl,
      photo_alt: branding.photoAlt,
    },
    stay: {
      arrival: formatBookedDateInput(payload.date_entree),
      departure: formatBookedDateInput(payload.date_sortie),
      nights: payload.pricing_snapshot.nb_nuits,
      adults: payload.nb_adultes,
      children: payload.nb_enfants_2_17,
    },
    options: options.optionsSummary.split("\n").slice(1),
    message: { subject: message.subject, text: message.text },
  };
};

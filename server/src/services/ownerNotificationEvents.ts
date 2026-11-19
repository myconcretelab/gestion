import { buildBookingManagementAction } from "./bookingManagementLinks.js";
import {
  buildBookingRequestApprovedTelegramMessage,
  buildBookingRequestCreatedMessage,
  buildCleaningCompletedMessage,
  buildGiteCheckedMessage,
  type BookingRequestTelegramPayload,
} from "./telegramNotifications.js";
import { escapeNotificationText, notifyOwner } from "./ownerNotifications.js";

export const notifyBookingRequestCreated = (
  payload: BookingRequestTelegramPayload,
) =>
  notifyOwner({
    event: "booking_requested",
    key: payload.id,
    message: buildBookingRequestCreatedMessage(payload),
    url: `/demandes/${encodeURIComponent(payload.id)}`,
    emailManagedByBooking: true,
  });

const bookingPath = (payload: BookingRequestTelegramPayload) => {
  const action = buildBookingManagementAction(
    payload,
    payload.approved_reservation_id,
  );
  if (!action) return undefined;
  const url = new URL(action.url);
  return url.pathname + url.search;
};

export const notifyBookingRequestApproved = (
  payload: BookingRequestTelegramPayload,
) =>
  notifyOwner({
    event: "booking_confirmed",
    key: payload.id,
    message: buildBookingRequestApprovedTelegramMessage(payload),
    url: bookingPath(payload),
    propertyEmail: payload.gite.email,
  });

export const notifyGiteChecked = (
  name: string,
  checkedAt: Date,
  checkedBy: string | null | undefined,
  departureId: string,
  propertyEmail?: string | null,
) =>
  notifyOwner({
    event: "gite_checked",
    key: `${departureId}:${checkedAt.toISOString()}`,
    message: buildGiteCheckedMessage(name, checkedAt, [], checkedBy),
    propertyEmail,
    url: "/taches?view=cleaning",
  });

export const notifyCleaningCompleted = (input: {
  taskId: string;
  propertyId: string;
  propertyEmail?: string | null;
  name: string;
  completedAt: Date;
  completedBy?: string;
  selected: boolean;
}) =>
  notifyOwner({
    event: "cleaning_completed",
    key: `${input.taskId}:${input.completedAt.toISOString()}`,
    message: buildCleaningCompletedMessage(
      input.name,
      input.completedAt,
      input.completedBy,
    ),
    cleaningSelected: input.selected,
    propertyId: input.propertyId,
    propertyEmail: input.propertyEmail,
    url: "/taches?view=cleaning",
  });

export const notifyContractReceived = (contract: {
  id: string;
  numero_contrat: string;
  locataire_nom: string;
  gite: { nom: string; email: string | null } | null;
}) =>
  notifyOwner({
    event: "contract_received",
    key: contract.id,
    message: [
      "<b>Contrat signé reçu</b>",
      `Contrat : ${escapeNotificationText(contract.numero_contrat)}`,
      `Client : ${escapeNotificationText(contract.locataire_nom)}`,
      contract.gite
        ? `Gîte : ${escapeNotificationText(contract.gite.nom)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    url: `/contrats/${encodeURIComponent(contract.id)}`,
    propertyEmail: contract.gite?.email,
  });

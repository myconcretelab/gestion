import { env } from "../config/env.js";
import { sendSmtpMail } from "./mailer.js";
import { formatBookedDateInput, type BookingQuote } from "./booked.js";

type BookingRequestEmailGite = {
  nom: string;
  email?: string | null;
};

type BookingRequestEmailPayload = {
  id: string;
  hote_nom: string;
  telephone?: string | null;
  email?: string | null;
  date_entree: Date | string;
  date_sortie: Date | string;
  nb_adultes: number;
  nb_enfants_2_17: number;
  message_client?: string | null;
  hold_expires_at: Date | string;
  gite: BookingRequestEmailGite;
  pricing_snapshot: BookingQuote;
};

const formatDateTimeFr = (value: Date | string) =>
  new Date(value).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });

const formatPrice = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);

const resolveReplyTo = (giteEmail?: string | null) => giteEmail?.trim() || env.SMTP_REPLY_TO || undefined;

const resolveAdminRecipient = (giteEmail?: string | null) =>
  giteEmail?.trim() || env.SMTP_REPLY_TO.trim() || env.SMTP_FROM.trim() || null;

const buildStaySummary = (payload: BookingRequestEmailPayload) =>
  [
    `Gîte: ${payload.gite.nom}`,
    `Séjour: du ${formatBookedDateInput(payload.date_entree)} au ${formatBookedDateInput(payload.date_sortie)} (${payload.pricing_snapshot.nb_nuits} nuit(s))`,
    `Voyageurs: ${payload.nb_adultes} adulte(s), ${payload.nb_enfants_2_17} enfant(s)`,
    `Total estimatif: ${formatPrice(payload.pricing_snapshot.total_global)}`,
    `Blocage jusqu'au: ${formatDateTimeFr(payload.hold_expires_at)}`,
  ].join("\n");

export const sendBookingRequestCreatedEmails = async (payload: BookingRequestEmailPayload) => {
  const adminRecipient = resolveAdminRecipient(payload.gite.email);
  const replyTo = resolveReplyTo(payload.gite.email);

  if (adminRecipient) {
    await sendSmtpMail({
      to: adminRecipient,
      replyTo,
      subject: `Nouvelle demande de réservation · ${payload.gite.nom}`,
      text: [
        `Une nouvelle demande de réservation a été enregistrée.`,
        "",
        buildStaySummary(payload),
        "",
        `Client: ${payload.hote_nom}`,
        `Téléphone: ${payload.telephone?.trim() || "Non renseigné"}`,
        `Email: ${payload.email?.trim() || "Non renseigné"}`,
        payload.message_client?.trim() ? `Message: ${payload.message_client.trim()}` : "",
        "",
        `Demande #${payload.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  if (payload.email?.trim()) {
    await sendSmtpMail({
      to: payload.email.trim(),
      replyTo,
      subject: `Demande reçue pour ${payload.gite.nom}`,
      text: [
        `Votre demande de réservation a bien été reçue.`,
        "",
        buildStaySummary(payload),
        "",
        `Nous vous répondrons après vérification. Les dates sont bloquées temporairement pendant 24 heures.`,
      ].join("\n"),
    });
  }
};

export const sendBookingRequestApprovedEmail = async (payload: BookingRequestEmailPayload) => {
  if (!payload.email?.trim()) return;
  await sendSmtpMail({
    to: payload.email.trim(),
    replyTo: resolveReplyTo(payload.gite.email),
    subject: `Votre demande est acceptée · ${payload.gite.nom}`,
    text: [
      `Votre demande de réservation a été acceptée.`,
      "",
      buildStaySummary(payload),
      "",
      `Nous vous recontacterons pour la suite du séjour.`,
    ].join("\n"),
  });
};

export const sendBookingRequestRejectedEmail = async (payload: BookingRequestEmailPayload, decisionNote?: string | null) => {
  if (!payload.email?.trim()) return;
  await sendSmtpMail({
    to: payload.email.trim(),
    replyTo: resolveReplyTo(payload.gite.email),
    subject: `Votre demande n'a pas pu être retenue · ${payload.gite.nom}`,
    text: [
      `Votre demande de réservation n'a pas pu être retenue.`,
      "",
      buildStaySummary(payload),
      decisionNote?.trim() ? "" : "",
      decisionNote?.trim() ? `Motif: ${decisionNote.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
};

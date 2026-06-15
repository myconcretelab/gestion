import { env } from "../config/env.js";
import { sendSmtpMail } from "./mailer.js";
import { formatBookedDateInput, type BookingQuote } from "./booked.js";
import { readDocumentEmailTemplateSettings } from "./documentEmailTemplateSettings.js";
import type { OptionsInput } from "./contractCalculator.js";

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
  options?: OptionsInput | null;
};

export type BookingRequestDecisionEmailContent = {
  recipient?: string | null;
  subject?: string | null;
  body?: string | null;
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

const formatStayDuration = (value: number) =>
  `${value} ${value > 1 ? "nuits" : "nuit"}`;

const formatLongDate = (value: Date | string) =>
  new Date(value).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const buildGreeting = (name: string) => {
  const trimmedName = name.trim();
  return trimmedName ? `Bonjour ${trimmedName},` : "Bonjour,";
};

const buildTravellersSummary = (payload: BookingRequestEmailPayload) => {
  const parts = [`${payload.nb_adultes} adulte(s)`];
  if (payload.nb_enfants_2_17 > 0) {
    parts.push(`${payload.nb_enfants_2_17} enfant(s)`);
  }
  return parts.join(", ");
};

const buildBeddingReminder = (options?: OptionsInput | null) => {
  if (options?.draps?.enabled) {
    return "L'option draps est bien notée pour votre séjour.";
  }
  return "Petit rappel : les draps ne sont pas inclus, pensez donc à les prévoir si besoin.";
};

const renderTemplateLine = (line: string, values: Record<string, string>) =>
  line.replace(/{{(\w+)}}/g, (_match, key: string) => values[key] ?? "");

const renderSubjectTemplate = (subject: string, values: Record<string, string>) =>
  renderTemplateLine(subject, values).replace(/\s+/g, " ").trim();

const renderBodyLines = (bodyLines: string[], values: Record<string, string>) => {
  const renderedLines = bodyLines
    .map((line) => renderTemplateLine(line, values))
    .map((line) => line.replace(/\s{2,}/g, " ").trim());
  const compactedLines: string[] = [];

  for (const line of renderedLines) {
    if (line === "" && compactedLines[compactedLines.length - 1] === "") {
      continue;
    }
    compactedLines.push(line);
  }

  while (compactedLines[0] === "") compactedLines.shift();
  while (compactedLines[compactedLines.length - 1] === "") compactedLines.pop();

  return compactedLines.join("\n");
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const linkifyHtml = (value: string) =>
  escapeHtml(value).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>',
  );

const buildHtmlFromText = (text: string) => {
  const paragraphs: string[] = [];
  let currentBlock: string[] = [];

  const flushBlock = () => {
    if (currentBlock.length === 0) return;
    paragraphs.push(
      `<p>${currentBlock.map((line) => linkifyHtml(line)).join("<br />")}</p>`,
    );
    currentBlock = [];
  };

  for (const line of text.split("\n")) {
    if (line === "") {
      flushBlock();
      continue;
    }
    currentBlock.push(line);
  }

  flushBlock();
  return paragraphs.join("");
};

const buildApprovedTemplateValues = (payload: BookingRequestEmailPayload) => {
  const template = readDocumentEmailTemplateSettings().bookingRequestApproved;
  const giteName = String(payload.gite.nom ?? "").trim();
  return {
    template,
    values: {
      greeting: buildGreeting(payload.hote_nom),
      clientName: payload.hote_nom.trim(),
      giteName,
      giteReference: giteName ? `au ${giteName}` : "dans notre gîte",
      stayDuration: formatStayDuration(payload.pricing_snapshot.nb_nuits),
      dateEntree: formatBookedDateInput(payload.date_entree),
      dateSortie: formatBookedDateInput(payload.date_sortie),
      dateEntreeLong: formatLongDate(payload.date_entree),
      dateSortieLong: formatLongDate(payload.date_sortie),
      travellersSummary: buildTravellersSummary(payload),
      nbAdultes: String(payload.nb_adultes),
      nbEnfants: String(payload.nb_enfants_2_17),
      montantHebergement: formatPrice(payload.pricing_snapshot.montant_hebergement),
      totalOptions: formatPrice(payload.pricing_snapshot.total_options),
      taxeSejour: formatPrice(payload.pricing_snapshot.taxe_sejour),
      totalGlobal: formatPrice(payload.pricing_snapshot.total_global),
      beddingReminder: buildBeddingReminder(payload.options),
      activitiesList: (template.activities ?? []).join("\n\n"),
      guideUrl: template.guideUrl ?? "",
      destinationUrl: template.destinationUrl ?? "",
    },
  };
};

const buildBookingRequestApprovedMessage = (
  payload: BookingRequestEmailPayload,
  customMessage?: BookingRequestDecisionEmailContent,
) => {
  const { template, values } = buildApprovedTemplateValues(payload);
  const fallbackSubject = renderSubjectTemplate(template.subject, values);
  const fallbackText = renderBodyLines(template.bodyLines, values);
  const subject = String(customMessage?.subject ?? "").trim() || fallbackSubject;
  const text =
    String(customMessage?.body ?? "")
      .replace(/\r\n/g, "\n")
      .trim() || fallbackText;

  return {
    recipient: String(customMessage?.recipient ?? payload.email ?? "").trim(),
    subject,
    text,
    html: buildHtmlFromText(text),
  };
};

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

export const sendBookingRequestApprovedEmail = async (
  payload: BookingRequestEmailPayload,
  customMessage?: BookingRequestDecisionEmailContent,
) => {
  const message = buildBookingRequestApprovedMessage(payload, customMessage);
  if (!message.recipient) return;
  await sendSmtpMail({
    to: message.recipient,
    replyTo: resolveReplyTo(payload.gite.email),
    subject: message.subject,
    text: message.text,
    html: message.html,
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

import {
  buildBookingRequestOptionsTemplateValues,
  type BookingEmailTemplateKey,
} from "@contrats/shared";
import {
  resolveEmailPresentation,
  organizationEmailVariables,
  type EmailGite,
} from "./emailBranding.js";
import {
  renderEmailPresentation,
  renderEmailTemplateBody,
  renderEmailTemplateLine,
  type EmailBranding,
} from "./emailPresentation.js";
import { env } from "../config/env.js";
import { sendSmtpMail } from "./mailer.js";
import { formatBookedDateInput, type BookingQuote } from "./booked.js";
import { readDocumentEmailTemplateSettings } from "./documentEmailTemplateSettings.js";
import type { OptionsInput } from "./contractCalculator.js";
import { buildGiteNameWithPreposition } from "../utils/giteName.js";

export type BookingPaymentEmailInfo = {
  purpose: string;
  total_cents: number;
  paid_amount_cents: number;
  refunded_amount_cents: number;
  status: string;
  remaining_cents?: number;
};
export type BookingRequestEmailPayload = {
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
  gite: EmailGite & { nom: string };
  pricing_snapshot: Pick<
    BookingQuote,
    | "nb_nuits"
    | "montant_hebergement"
    | "total_options"
    | "total_global"
    | "arrhes_theoriques"
  > &
    Partial<BookingQuote>;
  options?: OptionsInput | null;
};
const paymentSummary = (payment?: BookingPaymentEmailInfo) => {
  if (!payment) return "";
  if (payment.status === "requires_review")
    return "Règlement à vérifier. Aucun nouveau paiement n’est nécessaire.";
  const lines = [
    (payment.purpose === "deposit"
      ? "Arrhes reçues par Stripe : "
      : "Paiement reçu par Stripe : ") +
      formatPrice(payment.paid_amount_cents / 100),
  ];
  if (payment.refunded_amount_cents > 0)
    lines.push(
      "Montant remboursé : " + formatPrice(payment.refunded_amount_cents / 100),
    );
  else {
    const remaining =
      payment.remaining_cents ??
      Math.max(0, payment.total_cents - payment.paid_amount_cents);
    lines.push("Solde à régler sur place : " + formatPrice(remaining / 100));
    if (!remaining) lines.push("Votre séjour est réglé en totalité.");
  }
  return lines.join("\n");
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

const formatGiteAddress = (gite: EmailGite) =>
  [gite.adresse_ligne1, gite.adresse_ligne2]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");

const formatOwnerPhone = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((phone) => String(phone ?? "").trim())
      .filter(Boolean)
      .join(" / ");
  }
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((phone) => String(phone ?? "").trim())
        .filter(Boolean)
        .join(" / ");
    }
  } catch {
    return trimmed;
  }
  return trimmed;
};

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
    return "";
  }
  return "Petit rappel : les draps ne sont pas inclus, pensez donc à les prévoir si besoin.";
};

const renderBodyLines = renderEmailTemplateBody;
const renderSubjectTemplate = (
  subject: string,
  values: Record<string, string>,
) => renderEmailTemplateLine(subject, values).replace(/\s+/g, " ").trim();

const buildApprovedTemplateValues = (
  payload: BookingRequestEmailPayload,
  context?: {
    branding?: EmailBranding;
    payment?: BookingPaymentEmailInfo;
    decisionNote?: string;
  },
) => {
  const template = readDocumentEmailTemplateSettings().bookingRequestApproved;
  const giteName = String(payload.gite.nom ?? "").trim();
  const giteNameWithPreposition = buildGiteNameWithPreposition(payload.gite);
  return {
    template,
    values: {
      ...organizationEmailVariables(
        context?.branding || { name: payload.gite.nom },
      ),
      greeting: buildGreeting(payload.hote_nom),
      clientDetails: [
        "Client : " + payload.hote_nom,
        "Téléphone : " + (payload.telephone || "Non renseigné"),
        "Email : " + (payload.email || "Non renseigné"),
      ].join("\n"),
      clientMessage: payload.message_client?.trim()
        ? "Message : " + payload.message_client.trim()
        : "",
      holdExpiresAt: formatDateTimeFr(payload.hold_expires_at),
      requestReference: "Référence de réservation : " + payload.id,
      decisionNote: context?.decisionNote?.trim() || "",
      paymentSummary: paymentSummary(context?.payment),
      stayPaymentInstruction: !context?.payment
        ? "Ce montant sera à régler sur place."
        : context.payment.status === "requires_review"
          ? "Le règlement nécessite une vérification."
          : context.payment.refunded_amount_cents > 0
            ? "Le règlement fait l’objet d’un suivi après remboursement."
            : (context.payment.remaining_cents ??
                  Math.max(
                    0,
                    context.payment.total_cents -
                      context.payment.paid_amount_cents,
                  )) > 0
              ? "Solde à régler sur place : " +
                formatPrice(
                  (context.payment.remaining_cents ??
                    Math.max(
                      0,
                      context.payment.total_cents -
                        context.payment.paid_amount_cents,
                    )) / 100,
                ) +
                "."
              : "Votre séjour est déjà réglé en totalité.",
      paidAmount: context?.payment
        ? formatPrice(context.payment.paid_amount_cents / 100)
        : "",
      remainingAmount: context?.payment
        ? formatPrice(
            (context.payment.remaining_cents ??
              Math.max(
                0,
                context.payment.total_cents - context.payment.paid_amount_cents,
              )) / 100,
          )
        : "",
      arrhesMontant: formatPrice(payload.pricing_snapshot.arrhes_theoriques),
      arrhesInstruction: paymentSummary(context?.payment),
      clientName: payload.hote_nom.trim(),
      giteName,
      giteNameWithPreposition,
      giteAddress: formatGiteAddress(payload.gite),
      ownerPhone: formatOwnerPhone(payload.gite.telephones),
      giteReference: giteName ? `au ${giteName}` : "dans notre gîte",
      stayDuration: formatStayDuration(payload.pricing_snapshot.nb_nuits),
      dateEntree: formatBookedDateInput(payload.date_entree),
      dateSortie: formatBookedDateInput(payload.date_sortie),
      dateEntreeLong: formatLongDate(payload.date_entree),
      dateSortieLong: formatLongDate(payload.date_sortie),
      travellersSummary: buildTravellersSummary(payload),
      nbAdultes: String(payload.nb_adultes),
      nbEnfants: String(payload.nb_enfants_2_17),
      montantHebergement: formatPrice(
        payload.pricing_snapshot.tourist_tax_result?.accommodation_amount ??
          payload.pricing_snapshot.montant_hebergement,
      ),
      totalOptions: formatPrice(payload.pricing_snapshot.total_options),
      taxeSejour:
        typeof payload.pricing_snapshot.taxe_sejour === "number"
          ? formatPrice(payload.pricing_snapshot.taxe_sejour)
          : "",
      totalGlobal: formatPrice(payload.pricing_snapshot.total_global),
      beddingReminder: buildBeddingReminder(payload.options),
      ...buildBookingRequestOptionsTemplateValues(payload),
      activitiesList: (template.activities ?? []).join("\n\n"),
      guideUrl: template.guideUrl ?? "",
      destinationUrl: template.destinationUrl ?? "",
    },
  };
};

export const buildBookingEmailMessage = (
  type: "bookingRequestApproved" | BookingEmailTemplateKey,
  payload: BookingRequestEmailPayload,
  context?: {
    branding?: EmailBranding;
    payment?: BookingPaymentEmailInfo;
    decisionNote?: string;
    customMessage?: BookingRequestDecisionEmailContent;
  },
) => {
  const { values } = buildApprovedTemplateValues(payload, context);
  const template = readDocumentEmailTemplateSettings()[type];
  const subject =
    context?.customMessage?.subject?.trim() ||
    renderSubjectTemplate(template.subject, values);
  let text =
    context?.customMessage?.body?.replace(/\r\n/g, "\n").trim() ||
    renderBodyLines(template.bodyLines, values);
  // Financial facts remain present when an older customized confirmation omits the new variables.
  if (
    context?.payment &&
    values.paymentSummary &&
    !text.includes(values.paymentSummary)
  ) {
    const closing = text.lastIndexOf("\n\nBien ");
    text =
      closing < 0
        ? text + "\n\n" + values.paymentSummary
        : text.slice(0, closing) +
          "\n\n" +
          values.paymentSummary +
          text.slice(closing);
  }
  const labels: Record<string, string> = {
    bookingRequestReceived: "Demande reçue",
    bookingRequestOwner: "Nouvelle demande",
    bookingRequestApproved: "Réservation confirmée",
    bookingRequestRejected: "Votre demande",
    bookingPaymentReceipt: "Paiement reçu",
    bookingPaymentReview: "Paiement à vérifier",
    bookingPaymentRefunded: "Remboursement",
  };
  const details = buildBookingRequestOptionsTemplateValues(payload);
  const branding = context?.branding || {
    name: payload.gite.nom,
    website: payload.gite.site_web || undefined,
  };
  return {
    recipient:
      context?.customMessage?.recipient?.trim() || payload.email?.trim() || "",
    subject,
    text,
    html: renderEmailPresentation({
      subject,
      text,
      branding,
      label: labels[type],
      facts: [
        { label: "Gîte", value: payload.gite.nom },
        { label: "Arrivée", value: new Date(payload.date_entree).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) },
        { label: "Départ", value: new Date(payload.date_sortie).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) },
      ],
      highlights: [
        {
          text: details.optionsSummary,
          title: "Options choisies",
          lines: details.optionsSummary.split("\n").slice(1),
        },
        {
          text: values.paymentSummary,
          title: "Votre règlement",
          lines: values.paymentSummary.split("\n"),
        },
      ].filter((item) => item.text),
    }),
  };
};
export const buildBookingRequestApprovedMessage = (
  payload: BookingRequestEmailPayload,
  customMessage?: BookingRequestDecisionEmailContent,
) =>
  buildBookingEmailMessage("bookingRequestApproved", payload, {
    customMessage,
  });

const resolveReplyTo = (giteEmail?: string | null) =>
  giteEmail?.trim() || env.SMTP_REPLY_TO || undefined;
const resolveAdminRecipient = (giteEmail?: string | null) =>
  giteEmail?.trim() || env.SMTP_REPLY_TO.trim() || env.SMTP_FROM.trim() || null;

const emailContext = async (payload: BookingRequestEmailPayload) => {
  const presentation = await resolveEmailPresentation(payload.gite);
  return {
    branding: presentation.branding,
    payload: {
      ...payload,
      gite: {
        ...payload.gite,
        ...presentation.gite,
        nom: presentation.gite?.nom || payload.gite.nom,
      },
    },
  };
};
export const sendBookingRequestCreatedEmails = async (
  payload: BookingRequestEmailPayload,
) => {
  const context = await emailContext(payload);
  for (const [type, to] of [
    ["bookingRequestOwner", resolveAdminRecipient(context.payload.gite.email)],
    ["bookingRequestReceived", payload.email?.trim()],
  ] as const) {
    if (!to) continue;
    const message = buildBookingEmailMessage(type, context.payload, context);
    await sendSmtpMail({
      to,
      replyTo: resolveReplyTo(context.payload.gite.email),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
};
export const sendBookingRequestApprovedEmail = async (
  payload: BookingRequestEmailPayload,
  customMessage?: BookingRequestDecisionEmailContent,
) => {
  const context = await emailContext(payload);
  const message = buildBookingEmailMessage(
    "bookingRequestApproved",
    context.payload,
    { ...context, customMessage },
  );
  if (!message.recipient) return false;
  await sendSmtpMail({
    to: message.recipient,
    replyTo: resolveReplyTo(context.payload.gite.email),
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return true;
};
export const sendBookingRequestRejectedEmail = async (
  payload: BookingRequestEmailPayload,
  decisionNote?: string | null,
) => {
  if (!payload.email?.trim()) return;
  const context = await emailContext(payload);
  const message = buildBookingEmailMessage(
    "bookingRequestRejected",
    context.payload,
    { ...context, decisionNote: decisionNote || "" },
  );
  await sendSmtpMail({
    to: message.recipient,
    replyTo: resolveReplyTo(context.payload.gite.email),
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
};
export const sendBookingPaymentEmails = async (
  payload: BookingRequestEmailPayload,
  payment: BookingPaymentEmailInfo,
  existingReservation = false,
) => {
  const context = await emailContext(payload);
  const type =
    payment.status === "requires_review"
      ? "bookingPaymentReview"
      : payment.refunded_amount_cents > 0
        ? "bookingPaymentRefunded"
        : existingReservation
          ? "bookingPaymentReceipt"
          : "bookingRequestApproved";
  const message = buildBookingEmailMessage(type, context.payload, {
    ...context,
    payment,
  });
  for (const to of new Set(
    [payload.email, context.payload.gite.email].filter(Boolean) as string[],
  ))
    await sendSmtpMail({
      to,
      replyTo: resolveReplyTo(context.payload.gite.email),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
};

export const buildBookingRequestApprovedSms = (
  payload: BookingRequestEmailPayload,
) => {
  const { template, values } = buildApprovedTemplateValues(payload);
  return renderBodyLines((template.smsBody ?? "").split("\n"), values);
};

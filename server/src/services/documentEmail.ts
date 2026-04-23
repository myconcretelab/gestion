import fs from "fs/promises";
import { env } from "../config/env.js";
import {
  readDocumentEmailTemplateSettings,
  type DocumentEmailTemplate,
} from "./documentEmailTemplateSettings.js";
import { sendSmtpMail } from "./mailer.js";

type DocumentGite = {
  nom?: string | null;
  email?: string | null;
};

type BaseDocumentEmail = {
  locataire_nom: string;
  locataire_email?: string | null;
  gite?: DocumentGite | null;
};

export type ContractEmailDocument = BaseDocumentEmail & {
  id?: string;
  numero_contrat: string;
  date_debut: string | Date;
  heure_arrivee: string;
  date_fin: string | Date;
  heure_depart: string;
  nb_nuits: number;
  arrhes_montant: number;
  arrhes_date_limite: string | Date;
  statut_paiement_arrhes?: "non_recu" | "recu";
  date_paiement_arrhes?: string | Date | null;
  mode_paiement_arrhes?: string | null;
  solde_montant: number;
};

export type InvoiceEmailDocument = BaseDocumentEmail & {
  id?: string;
  numero_facture: string;
};

export class DocumentEmailError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "DocumentEmailError";
    this.statusCode = statusCode;
  }
}

type BuiltEmailMessage = {
  subject: string;
  text: string;
  html: string;
};

export type DocumentEmailDeliveryMode = "attachment" | "download_link";

type CustomEmailContent = {
  recipient?: string | null;
  subject?: string | null;
  body?: string | null;
};

const isIsoDateOnly = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

const parseDateValue = (value: string | Date) => {
  if (value instanceof Date) return value;
  const trimmedValue = String(value ?? "").trim();
  return new Date(
    isIsoDateOnly(trimmedValue) ? `${trimmedValue}T00:00:00Z` : trimmedValue,
  );
};

const formatLongDate = (value: string | Date) => {
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatTime = (value: string) => {
  const trimmedValue = String(value ?? "").trim();
  const match = trimmedValue.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return trimmedValue || value;

  const hour = String(Number(match[1]));
  const minutes = match[2];
  return minutes === "00" ? `${hour}h` : `${hour}h${minutes}`;
};

const formatEuroText = (value: number | string) => {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return String(value);

  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: Number.isInteger(numericValue) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numericValue);

  return `${formatted}€`;
};

const formatStayDuration = (value: number) =>
  `${value} ${value > 1 ? "nuits" : "nuit"}`;

const formatArrhesPaymentMethod = (value: string) => {
  const trimmedValue = String(value ?? "").trim();
  if (!trimmedValue) return "";
  if (/^par\s+/i.test(trimmedValue)) return trimmedValue;
  if (/^[A-Z0-9\s]+$/.test(trimmedValue)) return `par ${trimmedValue}`;
  return `par ${trimmedValue.charAt(0).toLowerCase()}${trimmedValue.slice(1)}`;
};

const buildArrhesInstruction = (params: {
  arrhesMontant: string;
  arrhesDateLimiteLong: string;
  soldeMontant: string;
  statutPaiementArrhes?: "non_recu" | "recu";
  datePaiementArrhes?: string | Date | null;
  modePaiementArrhes?: string | null;
}) => {
  if (params.statutPaiementArrhes === "recu") {
    const dateText = params.datePaiementArrhes
      ? ` le ${formatLongDate(params.datePaiementArrhes)}`
      : "";
    const paymentMethod = formatArrhesPaymentMethod(
      params.modePaiementArrhes ?? "",
    );
    const modeText = paymentMethod
      ? params.datePaiementArrhes
        ? `, ${paymentMethod}.`
        : ` ${paymentMethod}.`
      : ".";

    return `Les arrhes de ${params.arrhesMontant} ont déjà été reçues${dateText}${modeText} Merci de nous retourner le contrat signé avant le ${params.arrhesDateLimiteLong}. Le solde de la location, soit ${params.soldeMontant}, sera à régler à votre arrivée.`;
  }

  return `Si vous souhaitez confirmer la réservation, merci de nous retourner le contrat signé et accompagné du règlement des arrhes de ${params.arrhesMontant} avant le ${params.arrhesDateLimiteLong}. Il est possible de faire un virement. Le RIB est en bas du contrat. Le solde de la location, soit ${params.soldeMontant}, sera à régler à votre arrivée.`;
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

const buildHtmlFromLines = (lines: string[]) => {
  const paragraphs: string[] = [];
  let currentBlock: string[] = [];

  const flushBlock = () => {
    if (currentBlock.length === 0) return;
    paragraphs.push(
      `<p>${currentBlock.map((line) => linkifyHtml(line)).join("<br />")}</p>`,
    );
    currentBlock = [];
  };

  for (const line of lines) {
    if (line === "") {
      flushBlock();
      continue;
    }
    currentBlock.push(line);
  }

  flushBlock();
  return paragraphs.join("");
};

const renderBodyLines = (
  bodyLines: string[],
  values: Record<string, string>,
) => {
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

const normalizeRecipient = (value: string | null | undefined) =>
  String(value ?? "").trim();

const resolveDeliveryMode = (
  value?: DocumentEmailDeliveryMode | null,
): DocumentEmailDeliveryMode => (value === "download_link" ? "download_link" : "attachment");

const buildDeliveryTemplateValues = (
  documentType: "contrat" | "facture",
  deliveryMode: DocumentEmailDeliveryMode,
  documentUrl: string,
) => {
  if (documentType === "contrat") {
    if (deliveryMode === "download_link") {
      return {
        documentDeliveryIntroContract: "ci-dessous le lien vers",
        documentDeliveryIntroSentence: "",
        documentDeliveryLabel: "Lien de téléchargement du contrat :",
        documentDeliveryValue: documentUrl,
      };
    }

    return {
      documentDeliveryIntroContract: "ci-joint",
      documentDeliveryIntroSentence: "",
      documentDeliveryLabel: "",
      documentDeliveryValue: "",
    };
  }

  if (deliveryMode === "download_link") {
    return {
      documentDeliveryIntroContract: "",
      documentDeliveryIntroSentence:
        "Je vous joins un lien de téléchargement vers votre facture.",
      documentDeliveryLabel: "Lien de téléchargement de la facture :",
      documentDeliveryValue: documentUrl,
    };
  }

  return {
    documentDeliveryIntroContract: "",
    documentDeliveryIntroSentence: "Je vous transmets votre facture.",
    documentDeliveryLabel: "",
    documentDeliveryValue: "",
  };
};

const buildGreeting = (locataireNom: string) => {
  const trimmedName = locataireNom.trim();
  return trimmedName ? `Bonjour ${trimmedName},` : "Bonjour,";
};

const getReplyTo = (giteEmail?: string | null) => {
  const candidates = [env.SMTP_REPLY_TO, giteEmail];
  for (const candidate of candidates) {
    const trimmed = String(candidate ?? "").trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const renderTemplateLine = (line: string, values: Record<string, string>) =>
  line.replace(/{{(\w+)}}/g, (_, key: string) => values[key] ?? "");

const renderSubjectTemplate = (
  template: DocumentEmailTemplate,
  values: Record<string, string>,
) => renderTemplateLine(template.subject, values).replace(/\s+/g, " ").trim();

const normalizeCustomEmailContent = (
  message: CustomEmailContent | undefined,
  fallback: BuiltEmailMessage,
): BuiltEmailMessage => {
  const subject = String(message?.subject ?? "").trim() || fallback.subject;
  const text =
    String(message?.body ?? "")
      .replace(/\r\n/g, "\n")
      .trim() || fallback.text;
  return {
    subject,
    text,
    html: buildHtmlFromLines(text.split("\n")),
  };
};

export const buildContractEmailMessage = (
  contract: ContractEmailDocument,
  options?: {
    documentUrl?: string | null;
    customMessage?: CustomEmailContent;
    deliveryMode?: DocumentEmailDeliveryMode | null;
  },
): BuiltEmailMessage => {
  const template = readDocumentEmailTemplateSettings().contrat;
  const giteName = String(contract.gite?.nom ?? "").trim();
  const deliveryMode = resolveDeliveryMode(options?.deliveryMode ?? "download_link");
  const documentUrl = String(options?.documentUrl ?? "").trim();
  const templateValues: Record<string, string> = {
    greeting: buildGreeting(contract.locataire_nom),
    documentUrl,
    giteName,
    documentNumber: contract.numero_contrat.trim(),
    locataireNom: contract.locataire_nom.trim(),
    giteReference: giteName ? `au ${giteName}` : "dans notre gîte",
    stayDuration: formatStayDuration(contract.nb_nuits),
    dateDebutLong: formatLongDate(contract.date_debut),
    heureArrivee: formatTime(contract.heure_arrivee),
    dateFinLong: formatLongDate(contract.date_fin),
    heureDepart: formatTime(contract.heure_depart),
    arrhesMontant: formatEuroText(contract.arrhes_montant),
    arrhesDateLimiteLong: formatLongDate(contract.arrhes_date_limite),
    soldeMontant: formatEuroText(contract.solde_montant),
    arrhesInstruction: buildArrhesInstruction({
      arrhesMontant: formatEuroText(contract.arrhes_montant),
      arrhesDateLimiteLong: formatLongDate(contract.arrhes_date_limite),
      soldeMontant: formatEuroText(contract.solde_montant),
      statutPaiementArrhes: contract.statut_paiement_arrhes,
      datePaiementArrhes: contract.date_paiement_arrhes,
      modePaiementArrhes: contract.mode_paiement_arrhes,
    }),
    activitiesList: (template.activities ?? []).join("\n\n"),
    guideUrl: template.guideUrl ?? "",
    destinationUrl: template.destinationUrl ?? "",
    ...buildDeliveryTemplateValues("contrat", deliveryMode, documentUrl),
  };
  const subject = renderSubjectTemplate(template, templateValues);

  const fallback = {
    subject,
    text: renderBodyLines(template.bodyLines, templateValues),
    html: "",
  };

  return normalizeCustomEmailContent(options?.customMessage, fallback);
};

export const buildInvoiceEmailMessage = (
  invoice: InvoiceEmailDocument,
  options?: {
    documentUrl?: string | null;
    customMessage?: CustomEmailContent;
    deliveryMode?: DocumentEmailDeliveryMode | null;
  },
): BuiltEmailMessage => {
  const template = readDocumentEmailTemplateSettings().facture;
  const giteName = String(invoice.gite?.nom ?? "").trim();
  const deliveryMode = resolveDeliveryMode(options?.deliveryMode ?? "download_link");
  const documentUrl = String(options?.documentUrl ?? "").trim();
  const templateValues: Record<string, string> = {
    greeting: buildGreeting(invoice.locataire_nom),
    documentUrl,
    giteName,
    documentNumber: invoice.numero_facture.trim(),
    locataireNom: invoice.locataire_nom.trim(),
    giteSentence: giteName ? ` au ${giteName}.` : ".",
    ...buildDeliveryTemplateValues("facture", deliveryMode, documentUrl),
  };
  const subject = renderSubjectTemplate(template, templateValues);

  const fallback = {
    subject,
    text: renderBodyLines(template.bodyLines, templateValues),
    html: "",
  };

  return normalizeCustomEmailContent(options?.customMessage, fallback);
};

const ensureAttachmentReadable = async (attachmentPath: string) => {
  try {
    await fs.access(attachmentPath);
  } catch {
    throw new DocumentEmailError(500, "Le PDF à joindre est introuvable.");
  }
};

export const sendContractEmail = async (
  contract: ContractEmailDocument,
  attachmentPath: string,
  options?: {
    documentUrl?: string | null;
    customMessage?: CustomEmailContent;
    deliveryMode?: DocumentEmailDeliveryMode | null;
  },
) => {
  const recipient = normalizeRecipient(
    options?.customMessage?.recipient ?? contract.locataire_email,
  );
  if (!recipient) {
    throw new DocumentEmailError(
      400,
      "Aucune adresse email n'est renseignée pour ce contrat.",
    );
  }

  const deliveryMode = resolveDeliveryMode(options?.deliveryMode);
  if (deliveryMode === "attachment") {
    await ensureAttachmentReadable(attachmentPath);
  }
  const message = buildContractEmailMessage(contract, {
    ...options,
    deliveryMode,
  });
  return sendSmtpMail({
    to: recipient,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: getReplyTo(contract.gite?.email),
    attachments:
      deliveryMode === "attachment"
        ? [
            {
              filename: `${contract.numero_contrat}.pdf`,
              path: attachmentPath,
              contentType: "application/pdf",
            },
          ]
        : undefined,
  });
};

export const sendInvoiceEmail = async (
  invoice: InvoiceEmailDocument,
  attachmentPath: string,
  options?: {
    documentUrl?: string | null;
    customMessage?: CustomEmailContent;
    deliveryMode?: DocumentEmailDeliveryMode | null;
  },
) => {
  const recipient = normalizeRecipient(
    options?.customMessage?.recipient ?? invoice.locataire_email,
  );
  if (!recipient) {
    throw new DocumentEmailError(
      400,
      "Aucune adresse email n'est renseignée pour cette facture.",
    );
  }

  const deliveryMode = resolveDeliveryMode(options?.deliveryMode);
  if (deliveryMode === "attachment") {
    await ensureAttachmentReadable(attachmentPath);
  }
  const message = buildInvoiceEmailMessage(invoice, {
    ...options,
    deliveryMode,
  });
  return sendSmtpMail({
    to: recipient,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: getReplyTo(invoice.gite?.email),
    attachments:
      deliveryMode === "attachment"
        ? [
            {
              filename: `${invoice.numero_facture}.pdf`,
              path: attachmentPath,
              contentType: "application/pdf",
            },
          ]
        : undefined,
  });
};

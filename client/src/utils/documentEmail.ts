import templates from "../content/documentEmailTemplates.json";

type BuildMailtoHrefParams = {
  recipient?: string | null;
  subject: string;
  body?: string;
};

type BuildDocumentMailtoHrefBaseParams = {
  recipient?: string | null;
  documentNumber: string;
  documentUrl: string;
  locataireNom: string;
  giteNom?: string | null;
};

type BuildContractMailtoHrefParams = BuildDocumentMailtoHrefBaseParams & {
  documentType: "contrat";
  dateDebut: string;
  heureArrivee: string;
  dateFin: string;
  heureDepart: string;
  nbNuits: number;
  arrhesMontant: number;
  arrhesDateLimite: string;
  soldeMontant: number;
};

type BuildInvoiceMailtoHrefParams = BuildDocumentMailtoHrefBaseParams & {
  documentType: "facture";
};

type BuildDocumentMailtoHrefParams =
  | BuildContractMailtoHrefParams
  | BuildInvoiceMailtoHrefParams;

export type BuildDocumentEmailDraftParams = BuildDocumentMailtoHrefParams;

export type DocumentEmailDraft = {
  recipient?: string | null;
  subject: string;
  body: string;
};

export type DocumentEmailTemplate = {
  subject: string;
  bodyLines: string[];
  activities?: string[];
  guideUrl?: string;
  destinationUrl?: string;
};

export type DocumentEmailTemplateSettings = Record<
  BuildDocumentMailtoHrefParams["documentType"],
  DocumentEmailTemplate
>;

export type ContractDocumentEmailTextTemplate = {
  subject: string;
  body: string;
  activitiesList: string;
  guideUrl: string;
  destinationUrl: string;
};

export type InvoiceDocumentEmailTextTemplate = {
  subject: string;
  body: string;
};

export type DocumentEmailTextSettings = {
  contrat: ContractDocumentEmailTextTemplate;
  facture: InvoiceDocumentEmailTextTemplate;
};

const documentTemplates = templates as DocumentEmailTemplateSettings;

const isIsoDateOnly = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

const parseDateValue = (value: string) => {
  const trimmedValue = value.trim();
  return new Date(
    isIsoDateOnly(trimmedValue) ? `${trimmedValue}T00:00:00Z` : trimmedValue,
  );
};

const formatLongDate = (value: string) => {
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;

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

const renderTemplateLine = (line: string, values: Record<string, string>) =>
  line.replace(/{{(\w+)}}/g, (_, key: string) => values[key] ?? "");

const renderSubjectTemplate = (
  template: DocumentEmailTemplate,
  values: Record<string, string>,
) => renderTemplateLine(template.subject, values).replace(/\s+/g, " ").trim();

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

export const renderEmailBodyHtml = (body: string) => {
  const lines = String(body ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
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

export const buildMailtoHref = ({
  recipient,
  subject,
  body,
}: BuildMailtoHrefParams) => {
  const to = String(recipient ?? "").trim();
  if (!to) return null;

  const trimmedSubject = subject.trim();
  const trimmedBody = String(body ?? "").trim();
  const queryParts: string[] = [];

  if (trimmedSubject)
    queryParts.push(`subject=${encodeURIComponent(trimmedSubject)}`);
  if (trimmedBody) queryParts.push(`body=${encodeURIComponent(trimmedBody)}`);

  const query = queryParts.join("&");
  return `mailto:${encodeURIComponent(to)}${query ? `?${query}` : ""}`;
};

export const buildDocumentMailtoHref = (
  params: BuildDocumentMailtoHrefParams,
  templateSettings?: Partial<DocumentEmailTemplateSettings>,
) => {
  const {
    recipient,
    documentType,
    documentNumber,
    documentUrl,
    locataireNom,
    giteNom,
  } = params;
  const template = {
    ...documentTemplates[documentType],
    ...(templateSettings?.[documentType] ?? {}),
  };
  const safeDocumentNumber = documentNumber.trim();
  const safeGiteNom = String(giteNom ?? "").trim();
  const safeLocataireNom = locataireNom.trim();
  const greeting = safeLocataireNom
    ? `Bonjour ${safeLocataireNom},`
    : "Bonjour,";
  const templateValues: Record<string, string> = {
    greeting,
    documentUrl: documentUrl.trim(),
    giteName: safeGiteNom,
    documentNumber: safeDocumentNumber,
    locataireNom: safeLocataireNom,
    giteSentence: safeGiteNom ? ` au ${safeGiteNom}.` : ".",
  };

  if (documentType === "contrat") {
    const activitiesList = (template.activities ?? []).join("\n\n");
    Object.assign(templateValues, {
      stayDuration: formatStayDuration(params.nbNuits),
      giteReference: safeGiteNom ? `au ${safeGiteNom}` : "dans notre gîte",
      dateDebutLong: formatLongDate(params.dateDebut),
      heureArrivee: formatTime(params.heureArrivee),
      dateFinLong: formatLongDate(params.dateFin),
      heureDepart: formatTime(params.heureDepart),
      arrhesMontant: formatEuroText(params.arrhesMontant),
      arrhesDateLimiteLong: formatLongDate(params.arrhesDateLimite),
      soldeMontant: formatEuroText(params.soldeMontant),
      activitiesList,
      guideUrl: template.guideUrl ?? "",
      destinationUrl: template.destinationUrl ?? "",
    });
  }
  const subject = renderSubjectTemplate(template, templateValues);

  const body = template.bodyLines
    .map((line) => renderTemplateLine(line, templateValues))
    .join("\n");

  return buildMailtoHref({ recipient, subject, body });
};

export const buildDocumentEmailDraft = (
  params: BuildDocumentEmailDraftParams,
  templateSettings?: Partial<DocumentEmailTemplateSettings>,
): DocumentEmailDraft => {
  const href = buildDocumentMailtoHref(params, templateSettings);
  const [, rawQuery = ""] = String(href ?? "mailto:").split("?");
  const searchParams = new URLSearchParams(rawQuery);

  return {
    recipient: params.recipient,
    subject: searchParams.get("subject") ?? "",
    body: searchParams.get("body") ?? "",
  };
};

export const buildDocumentEmailTemplateSettings = (
  textSettings: DocumentEmailTextSettings,
): DocumentEmailTemplateSettings => ({
  contrat: {
    ...documentTemplates.contrat,
    subject: textSettings.contrat.subject,
    bodyLines: textSettings.contrat.body.replace(/\r\n/g, "\n").split("\n"),
    activities: textSettings.contrat.activitiesList
      .replace(/\r\n/g, "\n")
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    guideUrl: textSettings.contrat.guideUrl.trim(),
    destinationUrl: textSettings.contrat.destinationUrl.trim(),
  },
  facture: {
    ...documentTemplates.facture,
    subject: textSettings.facture.subject,
    bodyLines: textSettings.facture.body.replace(/\r\n/g, "\n").split("\n"),
  },
});

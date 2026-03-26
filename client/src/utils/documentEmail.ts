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

type BuildDocumentMailtoHrefParams = BuildContractMailtoHrefParams | BuildInvoiceMailtoHrefParams;

type DocumentEmailTemplate = {
  bodyLines: string[];
  activities?: string[];
  guideUrl?: string;
  destinationUrl?: string;
};

const documentTemplates = templates as Record<BuildDocumentMailtoHrefParams["documentType"], DocumentEmailTemplate>;

const isIsoDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

const parseDateValue = (value: string) => {
  const trimmedValue = value.trim();
  return new Date(isIsoDateOnly(trimmedValue) ? `${trimmedValue}T00:00:00Z` : trimmedValue);
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

const formatStayDuration = (value: number) => `${value} ${value > 1 ? "nuits" : "nuit"}`;

const renderTemplateLine = (line: string, values: Record<string, string>) =>
  line.replace(/{{(\w+)}}/g, (_, key: string) => values[key] ?? "");

export const buildMailtoHref = ({ recipient, subject, body }: BuildMailtoHrefParams) => {
  const to = String(recipient ?? "").trim();
  if (!to) return null;

  const trimmedSubject = subject.trim();
  const trimmedBody = String(body ?? "").trim();
  const queryParts: string[] = [];

  if (trimmedSubject) queryParts.push(`subject=${encodeURIComponent(trimmedSubject)}`);
  if (trimmedBody) queryParts.push(`body=${encodeURIComponent(trimmedBody)}`);

  const query = queryParts.join("&");
  return `mailto:${encodeURIComponent(to)}${query ? `?${query}` : ""}`;
};

export const buildDocumentMailtoHref = (params: BuildDocumentMailtoHrefParams) => {
  const { recipient, documentType, documentNumber, documentUrl, locataireNom, giteNom } = params;
  const template = documentTemplates[documentType];
  const safeDocumentNumber = documentNumber.trim();
  const safeGiteNom = String(giteNom ?? "").trim();
  const safeLocataireNom = locataireNom.trim();
  const subjectPrefix = documentType === "contrat" ? "Contrat" : "Facture";
  const subject = [subjectPrefix, safeGiteNom, safeDocumentNumber].filter(Boolean).join(" ");
  const greeting = safeLocataireNom ? `Bonjour ${safeLocataireNom},` : "Bonjour,";
  const templateValues: Record<string, string> = {
    greeting,
    documentUrl: documentUrl.trim(),
    giteSentence: safeGiteNom ? ` au ${safeGiteNom}.` : ".",
  };

  if (documentType === "contrat") {
    const activitiesList = (template.activities ?? []).map((activity) => `- ${activity}`).join("\n");
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

  const body = template.bodyLines.map((line) => renderTemplateLine(line, templateValues)).join("\n");

  return buildMailtoHref({ recipient, subject, body });
};

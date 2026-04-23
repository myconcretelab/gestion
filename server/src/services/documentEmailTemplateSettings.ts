import fs from "node:fs";
import path from "node:path";
import defaults from "../content/documentEmailTemplates.json" with { type: "json" };
import { env } from "../config/env.js";

export type DocumentEmailTemplateType = "contrat" | "facture";

export type DocumentEmailTemplate = {
  subject: string;
  bodyLines: string[];
  activities?: string[];
  guideUrl?: string;
  destinationUrl?: string;
};

export type DocumentEmailTemplateSettings = Record<
  DocumentEmailTemplateType,
  DocumentEmailTemplate
>;

export type DocumentEmailTextTemplate = {
  subject: string;
  body: string;
};

export type ContractDocumentEmailTextTemplate = DocumentEmailTextTemplate & {
  activitiesList: string;
  guideUrl: string;
  destinationUrl: string;
};

export type InvoiceDocumentEmailTextTemplate = DocumentEmailTextTemplate;

export type DocumentEmailTextSettings = {
  contrat: ContractDocumentEmailTextTemplate;
  facture: InvoiceDocumentEmailTextTemplate;
};

const SETTINGS_FILE = path.join(
  env.DATA_DIR,
  "document-email-template-settings.json",
);

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const DEFAULT_TEMPLATES = defaults as DocumentEmailTemplateSettings;
const LEGACY_CONTRACT_ARRHES_LINE =
  "Si vous souhaitez confirmer la réservation, merci de nous retourner le contrat signé et accompagné du règlement des arrhes de {{arrhesMontant}} avant le {{arrhesDateLimiteLong}}. Il est possible de faire un virement. Le RIB est en bas du contrat. Le solde de la location, soit {{soldeMontant}}, sera à régler à votre arrivée.";
const MODERN_CONTRACT_ARRHES_LINE = "{{arrhesInstruction}}";
const LEGACY_CONTRACT_DELIVERY_INTRO_LINE =
  "Suite à votre appel, veuillez trouver ci-dessous le lien vers le contrat de location pour votre séjour de {{stayDuration}} {{giteReference}}, du {{dateDebutLong}}, à partir de {{heureArrivee}} au {{dateFinLong}}, {{heureDepart}}.";
const MODERN_CONTRACT_DELIVERY_INTRO_LINE =
  "Suite à votre appel, veuillez trouver {{documentDeliveryIntroContract}} le contrat de location pour votre séjour de {{stayDuration}} {{giteReference}}, du {{dateDebutLong}}, à partir de {{heureArrivee}} au {{dateFinLong}}, {{heureDepart}}.";
const LEGACY_INVOICE_DELIVERY_INTRO_LINE =
  "Je vous joins un lien de téléchargement vers votre facture.";
const MODERN_INVOICE_DELIVERY_INTRO_LINE =
  "{{documentDeliveryIntroSentence}}";
const LEGACY_CONTRACT_DELIVERY_LABEL_LINE =
  "Lien de téléchargement du contrat :";
const LEGACY_INVOICE_DELIVERY_LABEL_LINE = "Le lien de téléchargement :";
const MODERN_DELIVERY_LABEL_LINE = "{{documentDeliveryLabel}}";
const LEGACY_DELIVERY_VALUE_LINE = "{{documentUrl}}";
const MODERN_DELIVERY_VALUE_LINE = "{{documentDeliveryValue}}";

const normalizeBodyLines = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const lines = value.map((line) => String(line ?? "").replace(/\r\n/g, "\n"));
  return lines.length > 0 ? lines : fallback;
};

const normalizeContractBodyLines = (lines: string[]) =>
  lines.map((line) =>
    line.trim() === LEGACY_CONTRACT_ARRHES_LINE
      ? MODERN_CONTRACT_ARRHES_LINE
      : line.trim() === LEGACY_CONTRACT_DELIVERY_INTRO_LINE
        ? MODERN_CONTRACT_DELIVERY_INTRO_LINE
        : line.trim() === LEGACY_CONTRACT_DELIVERY_LABEL_LINE
          ? MODERN_DELIVERY_LABEL_LINE
          : line.trim() === LEGACY_DELIVERY_VALUE_LINE
            ? MODERN_DELIVERY_VALUE_LINE
            : line
  );

const normalizeInvoiceBodyLines = (lines: string[]) =>
  lines.map((line) =>
    line.trim() === LEGACY_INVOICE_DELIVERY_INTRO_LINE
      ? MODERN_INVOICE_DELIVERY_INTRO_LINE
      : line.trim() === LEGACY_INVOICE_DELIVERY_LABEL_LINE
        ? MODERN_DELIVERY_LABEL_LINE
        : line.trim() === LEGACY_DELIVERY_VALUE_LINE
          ? MODERN_DELIVERY_VALUE_LINE
          : line
  );

const normalizeTemplate = (
  input: Partial<DocumentEmailTemplate> | null | undefined,
  fallback: DocumentEmailTemplate,
): DocumentEmailTemplate => ({
  subject: String(input?.subject ?? "").trim() || fallback.subject,
  bodyLines: normalizeBodyLines(input?.bodyLines, fallback.bodyLines),
  activities: Array.isArray(input?.activities)
    ? input?.activities.map((item) => String(item ?? ""))
    : fallback.activities,
  guideUrl: String(input?.guideUrl ?? "").trim() || fallback.guideUrl,
  destinationUrl:
    String(input?.destinationUrl ?? "").trim() || fallback.destinationUrl,
});

const normalizeSettings = (
  input: Partial<DocumentEmailTemplateSettings> | null | undefined,
): DocumentEmailTemplateSettings => {
  const contrat = normalizeTemplate(input?.contrat, DEFAULT_TEMPLATES.contrat);
  const facture = normalizeTemplate(input?.facture, DEFAULT_TEMPLATES.facture);
  return {
    contrat: {
      ...contrat,
      bodyLines: normalizeContractBodyLines(contrat.bodyLines),
    },
    facture: {
      ...facture,
      bodyLines: normalizeInvoiceBodyLines(facture.bodyLines),
    },
  };
};

export const buildDefaultDocumentEmailTemplateSettings =
  (): DocumentEmailTemplateSettings => normalizeSettings(DEFAULT_TEMPLATES);

export const readDocumentEmailTemplateSettings =
  (): DocumentEmailTemplateSettings => {
    ensureDataDir();

    if (!fs.existsSync(SETTINGS_FILE)) {
      return buildDefaultDocumentEmailTemplateSettings();
    }

    try {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      if (!raw.trim()) return buildDefaultDocumentEmailTemplateSettings();
      return normalizeSettings(
        JSON.parse(raw) as Partial<DocumentEmailTemplateSettings>,
      );
    } catch {
      return buildDefaultDocumentEmailTemplateSettings();
    }
  };

export const writeDocumentEmailTemplateSettings = (
  settings: DocumentEmailTemplateSettings,
) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
};

export const mergeDocumentEmailTemplateSettings = (
  current: DocumentEmailTemplateSettings,
  patch: Partial<DocumentEmailTextSettings>,
): DocumentEmailTemplateSettings =>
  normalizeSettings({
    ...current,
    contrat: patch.contrat
      ? {
          ...current.contrat,
          subject: patch.contrat.subject,
          bodyLines: patch.contrat.body.replace(/\r\n/g, "\n").split("\n"),
          activities: patch.contrat.activitiesList
            .replace(/\r\n/g, "\n")
            .split(/\n\s*\n/)
            .map((item) => item.trim())
            .filter(Boolean),
          guideUrl: patch.contrat.guideUrl.trim(),
          destinationUrl: patch.contrat.destinationUrl.trim(),
        }
      : current.contrat,
    facture: patch.facture
      ? {
          ...current.facture,
          subject: patch.facture.subject,
          bodyLines: patch.facture.body.replace(/\r\n/g, "\n").split("\n"),
        }
      : current.facture,
  });

export const buildDocumentEmailTextSettingsResponse = (
  settings = readDocumentEmailTemplateSettings(),
): DocumentEmailTextSettings => ({
  contrat: {
    subject: settings.contrat.subject,
    body: settings.contrat.bodyLines.join("\n"),
    activitiesList: (settings.contrat.activities ?? []).join("\n\n"),
    guideUrl: settings.contrat.guideUrl ?? "",
    destinationUrl: settings.contrat.destinationUrl ?? "",
  },
  facture: {
    subject: settings.facture.subject,
    body: settings.facture.bodyLines.join("\n"),
  },
});

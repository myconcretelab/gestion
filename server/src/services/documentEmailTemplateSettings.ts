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

const normalizeBodyLines = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const lines = value.map((line) => String(line ?? "").replace(/\r\n/g, "\n"));
  return lines.length > 0 ? lines : fallback;
};

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
): DocumentEmailTemplateSettings => ({
  contrat: normalizeTemplate(input?.contrat, DEFAULT_TEMPLATES.contrat),
  facture: normalizeTemplate(input?.facture, DEFAULT_TEMPLATES.facture),
});

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

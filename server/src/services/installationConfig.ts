import { z } from "zod";
import prisma from "../db/prisma.js";
import { fromJsonString } from "../utils/jsonFields.js";

export const MODULE_KEYS = [
  "reservations",
  "contracts",
  "invoices",
  "finances",
  "personal_expenses",
  "worker_planning",
  "web_publication",
  "ical",
  "pump_airbnb",
  "smart_life",
  "sms",
  "telegram",
  "daily_email",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleSettings = Record<ModuleKey, boolean>;

const optionalText = (max: number) => z.string().trim().max(max).default("");
const urlOrPath = z.string().trim().max(500).refine(
  (value) => !value || value.startsWith("/") || /^https:\/\//i.test(value),
  "Une URL HTTPS ou un chemin local est requis.",
).default("");

export const organizationProfileSchema = z.object({
  tradeName: optionalText(160),
  legalName: optionalText(200),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  postalCode: optionalText(32),
  city: optionalText(120),
  country: z.string().trim().length(2).default("FR"),
  email: z.union([z.literal(""), z.string().trim().email()]).default(""),
  phone: optionalText(60),
  website: z.preprocess((value) => {
    const text = String(value ?? "").trim();
    return text && !/^https?:\/\//i.test(text) ? `https://${text}` : text;
  }, z.union([z.literal(""), z.string().trim().url()])).default(""),
  iban: optionalText(64),
  bic: optionalText(32),
  bankAccountHolder: optionalText(200),
  locale: z.string().trim().min(2).max(20).default("fr-FR"),
  currency: z.string().trim().length(3).default("EUR"),
  timezone: z.string().trim().min(1).max(100).default("Europe/Paris"),
  logoUrl: urlOrPath,
  faviconUrl: urlOrPath,
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#315f4b"),
  emailSignature: optionalText(2000),
  smsSignature: optionalText(320),
  documentFooter: optionalText(1000),
  publicDisplayName: optionalText(160),
  documentLocale: z.string().trim().min(2).max(20).default("fr-FR"),
  documentDateFormat: optionalText(40),
  documentPaymentTerms: optionalText(2000),
});

export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;

export const EMPTY_ORGANIZATION: OrganizationProfile = organizationProfileSchema.parse({});
export const DEFAULT_MODULES: ModuleSettings = Object.fromEntries(MODULE_KEYS.map((key) => [key, false])) as ModuleSettings;

const parseOrganization = (value: unknown) => organizationProfileSchema.parse({
  ...EMPTY_ORGANIZATION,
  ...fromJsonString<Record<string, unknown>>(value, {}),
});

export const normalizeModules = (value: unknown): ModuleSettings => {
  const raw = fromJsonString<Record<string, unknown>>(value, {});
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, raw[key] === true])) as ModuleSettings;
};

export type InstallationConfig = {
  organization: OrganizationProfile;
  modules: ModuleSettings;
  setupComplete: boolean;
};

export const getInstallationConfig = async (): Promise<InstallationConfig> => {
  const row = await prisma.installationConfig.findUnique({ where: { id: "default" } });
  if (!row) return { organization: EMPTY_ORGANIZATION, modules: DEFAULT_MODULES, setupComplete: false };
  return {
    organization: parseOrganization(row.organization_json),
    modules: normalizeModules(row.modules_json),
    setupComplete: row.setup_completed,
  };
};

export const saveOrganizationProfile = async (input: unknown) => {
  const organization = organizationProfileSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    await tx.installationConfig.upsert({
      where: { id: "default" },
      update: { organization_json: JSON.stringify(organization) },
      create: { id: "default", organization_json: JSON.stringify(organization), modules_json: JSON.stringify(DEFAULT_MODULES) },
    });
    await tx.gite.updateMany({ data: {
      proprietaires_noms: organization.legalName,
      proprietaires_adresse: [organization.addressLine1, organization.addressLine2, `${organization.postalCode} ${organization.city}`.trim()].filter(Boolean).join(", "),
      site_web: organization.website || null,
      email: organization.email || null,
      telephones: JSON.stringify(organization.phone ? [organization.phone] : []),
      iban: organization.iban,
      bic: organization.bic || null,
      titulaire: organization.bankAccountHolder || organization.legalName,
    } });
  });
  return organization;
};

export const saveModuleSettings = async (input: unknown) => {
  const raw = z.record(z.string(), z.boolean()).parse(input);
  const modules = Object.fromEntries(MODULE_KEYS.map((key) => [key, raw[key] === true])) as ModuleSettings;
  await prisma.installationConfig.upsert({
    where: { id: "default" },
    update: { modules_json: JSON.stringify(modules) },
    create: { id: "default", organization_json: JSON.stringify(EMPTY_ORGANIZATION), modules_json: JSON.stringify(modules) },
  });
  return modules;
};

export const completeInstallation = async (organization: unknown, modulesInput: unknown) => {
  const parsedOrganization = organizationProfileSchema.parse(organization);
  if (!parsedOrganization.tradeName || !parsedOrganization.legalName) {
    throw Object.assign(new Error("Le nom commercial et la raison sociale sont requis."), { status: 400 });
  }
  const rawModules = z.record(z.string(), z.boolean()).parse(modulesInput);
  const modules = Object.fromEntries(MODULE_KEYS.map((key) => [key, rawModules[key] === true])) as ModuleSettings;
  await prisma.installationConfig.upsert({
    where: { id: "default" },
    update: { organization_json: JSON.stringify(parsedOrganization), modules_json: JSON.stringify(modules), setup_completed: true },
    create: { id: "default", organization_json: JSON.stringify(parsedOrganization), modules_json: JSON.stringify(modules), setup_completed: true },
  });
  return { organization: parsedOrganization, modules, setupComplete: true };
};

export const isModuleEnabled = async (key: ModuleKey) => (await getInstallationConfig()).modules[key];

const ROUTE_MODULES: Array<[RegExp, ModuleKey]> = [
  [/^\/(?:reservations|booking-requests|today)(?:\/|$)/, "reservations"],
  [/^\/contracts(?:\/|$)/, "contracts"],
  [/^\/invoices(?:\/|$)/, "invoices"],
  [/^\/(?:statistics|professional-expenses|guest-night-declarations|urssaf-declarations)(?:\/|$)/, "finances"],
  [/^\/personal-expenses(?:\/|$)/, "personal_expenses"],
  [/^\/(?:planning-relay-periods|intervenants|interventions)(?:\/|$)/, "worker_planning"],
  [/^\/(?:booked|public\/gites)(?:\/|$)/, "web_publication"],
  [/^\/settings\/ical(?:\/|$)|^\/gites\/[^/]+\/calendar\.ics$/, "ical"],
  [/^\/settings\/pump(?:\/|$)|^\/reservations\/integrations\/what-today$/, "pump_airbnb"],
  [/^\/settings\/smartlife(?:\/|$)/, "smart_life"],
  [/^\/settings\/sms-texts(?:\/|$)/, "sms"],
  [/^\/settings\/telegram(?:\/|$)/, "telegram"],
  [/^\/settings\/daily-reservation-email(?:\/|$)/, "daily_email"],
];

export const getModuleForApiPath = (path: string): ModuleKey | null =>
  ROUTE_MODULES.find(([pattern]) => pattern.test(path.toLowerCase()))?.[1] ?? null;

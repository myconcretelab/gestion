export const MODULE_KEYS = [
  "reservations", "contracts", "invoices", "finances", "personal_expenses", "worker_planning",
  "web_publication", "ical", "pump_airbnb", "smart_life", "sms", "telegram", "daily_email",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleSettings = Record<ModuleKey, boolean>;

export type OrganizationProfile = {
  tradeName: string; legalName: string; addressLine1: string; addressLine2: string;
  postalCode: string; city: string; country: string; email: string; phone: string;
  website: string; iban: string; bic: string; bankAccountHolder: string; locale: string;
  currency: string; timezone: string; logoUrl: string; faviconUrl: string; primaryColor: string;
  emailSignature: string; smsSignature: string; documentFooter: string; publicDisplayName: string;
  documentLocale: string; documentDateFormat: string; documentPaymentTerms: string;
};

export type PublicInstallationConfig = {
  setupComplete: boolean;
  organization: Pick<OrganizationProfile, "tradeName" | "publicDisplayName" | "logoUrl" | "faviconUrl" | "primaryColor" | "locale" | "country" | "currency" | "timezone" | "website">;
  modules: ModuleSettings;
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  reservations: "Réservations et demandes", contracts: "Contrats", invoices: "Factures",
  finances: "Finances et statistiques", personal_expenses: "Frais personnels",
  worker_planning: "Planning des intervenants", web_publication: "Publication web / WordPress",
  ical: "iCal", pump_airbnb: "Pump / Airbnb", smart_life: "Smart Life", sms: "SMS",
  telegram: "Telegram", daily_email: "E-mail quotidien",
};

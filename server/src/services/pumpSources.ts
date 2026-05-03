import { env } from "../config/env.js";

export const pumpAutomationSourceTypes = ["airbnb"] as const;

export type PumpAutomationSourceType = (typeof pumpAutomationSourceTypes)[number];

export type PumpAdvancedSelectors = {
  usernameInput: string;
  passwordInput: string;
  submitButton: string;
  emailFirstButton: string;
  continueAfterUsernameButton: string;
  finalSubmitButton: string;
  accountChooserContinueButton: string;
  calendarSourceCard: string;
  calendarSourceEditButton: string;
  calendarSourceRefreshButton: string;
  calendarSourceUrlField: string;
  calendarSourceCloseButton: string;
};

export type PumpAutomationSourceDefinition = {
  type: PumpAutomationSourceType;
  label: string;
  baseUrlDefault: string;
  baseUrlPlaceholder: string;
  usernameLabel: string;
  usernamePlaceholder: string;
  scrollSelectorPlaceholder: string;
  supportsAssistedRenewal: boolean;
  smsCodeLabel: string;
  advancedSelectors: PumpAdvancedSelectors;
};

const AIRBNB_ADVANCED_SELECTORS: PumpAdvancedSelectors = {
  usernameInput: 'input[type="email"], input[type="text"][placeholder*="email"], input[name*="email"]',
  passwordInput: 'input[type="password"]',
  submitButton: 'button[type="submit"], button:has-text("Login"), button:has-text("Sign in")',
  emailFirstButton:
    'button:has-text("Continuer avec un email"), button:has-text("Continuer avec un e-mail"), button:has-text("Continue with email")',
  continueAfterUsernameButton:
    'button:has-text("Continuer"), button:has-text("Continue"), button:has-text("Suivant"), button:has-text("Next"), button[type="submit"]',
  finalSubmitButton:
    'button:has-text("Connexion"), button:has-text("Se connecter"), button:has-text("Continuer"), button:has-text("Continue"), button:has-text("Sign in"), button:has-text("Log in"), button[type="submit"]',
  accountChooserContinueButton:
    'button:has-text("Continuer"), [role="button"]:has-text("Continuer"), button:has-text("Continue"), [role="button"]:has-text("Continue")',
  calendarSourceCard:
    'div:has(button:has-text("Actualiser")), div:has(button:has-text("Refresh")), article:has(button:has-text("Actualiser")), article:has(button:has-text("Refresh"))',
  calendarSourceEditButton:
    'button:has-text("Modifier"), [role="button"]:has-text("Modifier"), button:has-text("Edit"), [role="button"]:has-text("Edit")',
  calendarSourceRefreshButton:
    'button:has-text("Actualiser"), [role="button"]:has-text("Actualiser"), button:has-text("Refresh"), [role="button"]:has-text("Refresh")',
  calendarSourceUrlField:
    'input[type="url"], input[readonly], input[value*="ical"], input[value*="/calendar/"], textarea',
  calendarSourceCloseButton:
    'button:has-text("Fermer"), [role="button"]:has-text("Fermer"), button:has-text("Close"), [role="button"]:has-text("Close"), [aria-label*="Fermer"], [aria-label*="Close"]',
};

const PUMP_SOURCE_DEFINITIONS: Record<PumpAutomationSourceType, PumpAutomationSourceDefinition> = {
  airbnb: {
    type: "airbnb",
    label: "Airbnb",
    baseUrlDefault: env.PUMP_BASE_URL || "https://www.airbnb.fr/hosting/multicalendar",
    baseUrlPlaceholder: "https://www.airbnb.fr/hosting/multicalendar",
    usernameLabel: "Email / identifiant",
    usernamePlaceholder: "compte@exemple.com",
    scrollSelectorPlaceholder: ".v2-multi-calendar__grid",
    supportsAssistedRenewal: true,
    smsCodeLabel: "Code SMS",
    advancedSelectors: AIRBNB_ADVANCED_SELECTORS,
  },
};

export const DEFAULT_PUMP_AUTOMATION_SOURCE_TYPE: PumpAutomationSourceType = "airbnb";

export const resolvePumpAutomationSourceType = (value: unknown): PumpAutomationSourceType => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized && normalized in PUMP_SOURCE_DEFINITIONS) {
    return normalized as PumpAutomationSourceType;
  }

  return DEFAULT_PUMP_AUTOMATION_SOURCE_TYPE;
};

export const getPumpAutomationSourceDefinition = (value?: unknown) =>
  PUMP_SOURCE_DEFINITIONS[resolvePumpAutomationSourceType(value)];

export const listPumpAutomationSourceDefinitions = () =>
  pumpAutomationSourceTypes.map((type) => PUMP_SOURCE_DEFINITIONS[type]);

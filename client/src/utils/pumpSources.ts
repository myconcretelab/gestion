export const PUMP_AUTOMATION_SOURCE_TYPES = ["airbnb"] as const;

export type PumpAutomationSourceType = (typeof PUMP_AUTOMATION_SOURCE_TYPES)[number];

export type PumpAutomationFilterRule = {
  type: string;
  pattern?: string;
  negate?: boolean;
};

export type PumpAutomationAdvancedSelectors = {
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

export type PumpAutomationConfig = {
  sourceType: PumpAutomationSourceType;
  baseUrl: string;
  username: string;
  authMode: "persisted-only" | "legacy-auto-login";
  hasOTP: boolean;
  persistSession: boolean;
  manualScrollMode: boolean;
  manualScrollDuration: number;
  scrollSelector: string;
  scrollCount: number;
  scrollDistance: number;
  scrollDelay: number;
  waitBeforeScroll: number;
  outputFolder: string;
  filterRules: {
    inclusive: PumpAutomationFilterRule[];
    exclusive: PumpAutomationFilterRule[];
  };
  loginStrategy: "simple" | "multi-step";
  advancedSelectors: PumpAutomationAdvancedSelectors;
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
};

const DEFAULT_AIRBNB_ADVANCED_SELECTORS: PumpAutomationAdvancedSelectors = {
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
    baseUrlDefault: "https://www.airbnb.fr/hosting/multicalendar",
    baseUrlPlaceholder: "https://www.airbnb.fr/hosting/multicalendar",
    usernameLabel: "Email / identifiant",
    usernamePlaceholder: "compte@exemple.com",
    scrollSelectorPlaceholder: ".v2-multi-calendar__grid",
    supportsAssistedRenewal: true,
    smsCodeLabel: "Code SMS",
  },
};

export const getPumpAutomationSourceDefinition = (
  sourceType: PumpAutomationSourceType | null | undefined,
) => PUMP_SOURCE_DEFINITIONS[sourceType ?? "airbnb"] ?? PUMP_SOURCE_DEFINITIONS.airbnb;

export const listPumpAutomationSources = () =>
  PUMP_AUTOMATION_SOURCE_TYPES.map((sourceType) =>
    getPumpAutomationSourceDefinition(sourceType),
  );

export const buildDefaultPumpAutomationConfig = (
  sourceType: PumpAutomationSourceType = "airbnb",
): PumpAutomationConfig => {
  const source = getPumpAutomationSourceDefinition(sourceType);

  return {
    sourceType: source.type,
    baseUrl: source.baseUrlDefault,
    username: "",
    authMode: "persisted-only",
    hasOTP: false,
    persistSession: true,
    manualScrollMode: false,
    manualScrollDuration: 20000,
    scrollSelector: "",
    scrollCount: 5,
    scrollDistance: 500,
    scrollDelay: 1000,
    waitBeforeScroll: 2000,
    outputFolder: "",
    filterRules: {
      inclusive: [],
      exclusive: [],
    },
    loginStrategy: "simple",
    advancedSelectors: { ...DEFAULT_AIRBNB_ADVANCED_SELECTORS },
  };
};

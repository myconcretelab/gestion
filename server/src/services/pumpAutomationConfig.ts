import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { resolveDataDir } from "../utils/paths.js";

export type PumpFilterRule = {
  type: string;
  pattern?: string;
  negate?: boolean;
};

export type PumpAutomationConfig = {
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
    inclusive: PumpFilterRule[];
    exclusive: PumpFilterRule[];
  };
  loginStrategy: "simple" | "multi-step";
  advancedSelectors: {
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
};

const sanitizeSegment = (value: string | null | undefined, fallback = "default") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

export const normalizePumpSelectorSyntax = (value: string) => value.replace(/:contains\(/g, ":has-text(");

export const getPumpStorageStateId = (config: Pick<PumpAutomationConfig, "baseUrl" | "username">) => {
  let hostname = "site";
  if (config.baseUrl) {
    try {
      const parsed = new URL(config.baseUrl);
      hostname = parsed.host || parsed.hostname || hostname;
    } catch {
      // Ignore invalid URL here. Validation is handled before execution.
    }
  }

  return `${sanitizeSegment(hostname, "site")}__${sanitizeSegment(config.username, "anonymous")}`;
};

const PUMP_CONFIG_FILE = path.join(resolveDataDir(), "pump-config.json");
const LEGACY_CONFIG_CANDIDATES = [
  path.join(process.cwd(), "..", "pump", "data", "configs", "last.json"),
];

const DEFAULT_ADVANCED_SELECTORS: PumpAutomationConfig["advancedSelectors"] = {
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

const ensureDataDir = () => {
  const dataDir = resolveDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

const toTrimmedString = (value: unknown, fallback = "") => {
  if (typeof value !== "string") return fallback;
  return value.trim();
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const toInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
};

const normalizeFilterRules = (value: unknown) => {
  const source =
    value && typeof value === "object"
      ? (value as {
          inclusive?: unknown;
          exclusive?: unknown;
        })
      : {};

  const normalizeRuleList = (rules: unknown) =>
    Array.isArray(rules)
      ? rules
          .map((rule) => {
            if (!rule || typeof rule !== "object") return null;
            const candidate = rule as Record<string, unknown>;
            const type = toTrimmedString(candidate.type);
            if (!type) return null;
            return {
              type,
              pattern: toTrimmedString(candidate.pattern) || undefined,
              negate: toBoolean(candidate.negate, false),
            } satisfies PumpFilterRule;
          })
          .filter(Boolean) as PumpFilterRule[]
      : [];

  return {
    inclusive: normalizeRuleList(source.inclusive),
    exclusive: normalizeRuleList(source.exclusive),
  };
};

export const buildDefaultPumpAutomationConfig = (): PumpAutomationConfig => ({
  baseUrl: env.PUMP_BASE_URL,
  username: env.PUMP_USERNAME,
  authMode: env.PUMP_AUTH_MODE as PumpAutomationConfig["authMode"],
  hasOTP: env.PUMP_HAS_OTP,
  persistSession: env.PUMP_PERSIST_SESSION,
  manualScrollMode: env.PUMP_MANUAL_SCROLL_MODE,
  manualScrollDuration: env.PUMP_MANUAL_SCROLL_DURATION,
  scrollSelector: env.PUMP_SCROLL_SELECTOR,
  scrollCount: env.PUMP_SCROLL_COUNT,
  scrollDistance: env.PUMP_SCROLL_DISTANCE,
  scrollDelay: env.PUMP_SCROLL_DELAY,
  waitBeforeScroll: env.PUMP_WAIT_BEFORE_SCROLL,
  outputFolder: env.PUMP_OUTPUT_FOLDER,
  filterRules: {
    inclusive: [],
    exclusive: [],
  },
  loginStrategy: env.PUMP_LOGIN_STRATEGY === "multi-step" ? "multi-step" : "simple",
  advancedSelectors: { ...DEFAULT_ADVANCED_SELECTORS },
});

export const normalizePumpAutomationConfig = (
  input: Partial<PumpAutomationConfig> | Record<string, unknown>,
  fallback?: PumpAutomationConfig
): PumpAutomationConfig => {
  const defaults = fallback ?? buildDefaultPumpAutomationConfig();
  const source = input ?? {};

  const advancedSelectors =
    source.advancedSelectors && typeof source.advancedSelectors === "object"
      ? (source.advancedSelectors as Record<string, unknown>)
      : {};

  return {
    baseUrl: toTrimmedString(source.baseUrl, defaults.baseUrl),
    username: toTrimmedString(source.username, defaults.username),
    authMode:
      toTrimmedString(source.authMode, defaults.authMode).toLowerCase() === "legacy-auto-login"
        ? "legacy-auto-login"
        : "persisted-only",
    hasOTP: toBoolean(source.hasOTP, defaults.hasOTP),
    persistSession: toBoolean(source.persistSession, defaults.persistSession),
    manualScrollMode: toBoolean(source.manualScrollMode, defaults.manualScrollMode),
    manualScrollDuration: toInteger(source.manualScrollDuration, defaults.manualScrollDuration, 0, 600_000),
    scrollSelector: toTrimmedString(source.scrollSelector, defaults.scrollSelector),
    scrollCount: toInteger(source.scrollCount, defaults.scrollCount, 1, 500),
    scrollDistance: toInteger(source.scrollDistance, defaults.scrollDistance, 1, 20_000),
    scrollDelay: toInteger(source.scrollDelay, defaults.scrollDelay, 0, 120_000),
    waitBeforeScroll: toInteger(source.waitBeforeScroll, defaults.waitBeforeScroll, 0, 120_000),
    outputFolder: toTrimmedString(source.outputFolder, defaults.outputFolder),
    filterRules: normalizeFilterRules(source.filterRules),
    loginStrategy:
      toTrimmedString(source.loginStrategy, defaults.loginStrategy).toLowerCase() === "multi-step"
        ? "multi-step"
        : "simple",
    advancedSelectors: {
      usernameInput: toTrimmedString(advancedSelectors.usernameInput, defaults.advancedSelectors.usernameInput),
      passwordInput: toTrimmedString(advancedSelectors.passwordInput, defaults.advancedSelectors.passwordInput),
      submitButton: normalizePumpSelectorSyntax(
        toTrimmedString(advancedSelectors.submitButton, defaults.advancedSelectors.submitButton)
      ),
      emailFirstButton: normalizePumpSelectorSyntax(
        toTrimmedString(advancedSelectors.emailFirstButton, defaults.advancedSelectors.emailFirstButton)
      ),
      continueAfterUsernameButton: normalizePumpSelectorSyntax(
        toTrimmedString(
          advancedSelectors.continueAfterUsernameButton,
          defaults.advancedSelectors.continueAfterUsernameButton
        )
      ),
      finalSubmitButton: normalizePumpSelectorSyntax(
        toTrimmedString(advancedSelectors.finalSubmitButton, defaults.advancedSelectors.finalSubmitButton)
      ),
      accountChooserContinueButton: normalizePumpSelectorSyntax(
        toTrimmedString(
          advancedSelectors.accountChooserContinueButton,
          defaults.advancedSelectors.accountChooserContinueButton
        )
      ),
      calendarSourceCard: normalizePumpSelectorSyntax(
        toTrimmedString(advancedSelectors.calendarSourceCard, defaults.advancedSelectors.calendarSourceCard)
      ),
      calendarSourceEditButton: normalizePumpSelectorSyntax(
        toTrimmedString(advancedSelectors.calendarSourceEditButton, defaults.advancedSelectors.calendarSourceEditButton)
      ),
      calendarSourceRefreshButton: normalizePumpSelectorSyntax(
        toTrimmedString(
          advancedSelectors.calendarSourceRefreshButton,
          defaults.advancedSelectors.calendarSourceRefreshButton
        )
      ),
      calendarSourceUrlField: normalizePumpSelectorSyntax(
        toTrimmedString(advancedSelectors.calendarSourceUrlField, defaults.advancedSelectors.calendarSourceUrlField)
      ),
      calendarSourceCloseButton: normalizePumpSelectorSyntax(
        toTrimmedString(advancedSelectors.calendarSourceCloseButton, defaults.advancedSelectors.calendarSourceCloseButton)
      ),
    },
  };
};

export const validatePumpAutomationConfig = (config: PumpAutomationConfig) => {
  const errors: string[] = [];

  if (!config.baseUrl) {
    errors.push("baseUrl est requis.");
  } else {
    try {
      new URL(config.baseUrl);
    } catch {
      errors.push("baseUrl doit être une URL valide.");
    }
  }

  if (!config.scrollSelector) {
    errors.push("scrollSelector est requis.");
  }

  if (!Number.isInteger(config.scrollCount) || config.scrollCount < 1) {
    errors.push("scrollCount doit être un entier positif.");
  }

  if (!Number.isInteger(config.scrollDistance) || config.scrollDistance < 1) {
    errors.push("scrollDistance doit être un entier positif.");
  }

  if (!Number.isInteger(config.scrollDelay) || config.scrollDelay < 0) {
    errors.push("scrollDelay doit être un entier positif ou nul.");
  }

  if (!Number.isInteger(config.waitBeforeScroll) || config.waitBeforeScroll < 0) {
    errors.push("waitBeforeScroll doit être un entier positif ou nul.");
  }

  if (!Number.isInteger(config.manualScrollDuration) || config.manualScrollDuration < 0) {
    errors.push("manualScrollDuration doit être un entier positif ou nul.");
  }

  if (config.loginStrategy !== "simple" && config.loginStrategy !== "multi-step") {
    errors.push("loginStrategy doit valoir simple ou multi-step.");
  }

  if (config.authMode !== "persisted-only" && config.authMode !== "legacy-auto-login") {
    errors.push("authMode doit valoir persisted-only ou legacy-auto-login.");
  }

  return errors;
};

const readConfigFile = (filePath: string, fallback: PumpAutomationConfig) => {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return fallback;
  return normalizePumpAutomationConfig(JSON.parse(raw) as Record<string, unknown>, fallback);
};

const migrateLegacyConfigIfNeeded = (defaults: PumpAutomationConfig) => {
  for (const candidate of LEGACY_CONFIG_CANDIDATES) {
    if (!fs.existsSync(candidate)) continue;

    try {
      const migrated = readConfigFile(candidate, defaults);
      writePumpAutomationConfig(migrated);
      return migrated;
    } catch {
      continue;
    }
  }

  return defaults;
};

export const readPumpAutomationConfig = (fallback?: PumpAutomationConfig): PumpAutomationConfig => {
  const defaults = fallback ?? buildDefaultPumpAutomationConfig();
  ensureDataDir();

  if (fs.existsSync(PUMP_CONFIG_FILE)) {
    try {
      return readConfigFile(PUMP_CONFIG_FILE, defaults);
    } catch {
      return defaults;
    }
  }

  return migrateLegacyConfigIfNeeded(defaults);
};

export const writePumpAutomationConfig = (config: PumpAutomationConfig) => {
  ensureDataDir();
  fs.writeFileSync(PUMP_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
};

export const getPumpAutomationConfigPath = () => PUMP_CONFIG_FILE;

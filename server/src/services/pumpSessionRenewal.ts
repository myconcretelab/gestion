import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { resolveDataDir } from "../utils/paths.js";
import { readPumpAutomationConfig, buildDefaultPumpAutomationConfig, getPumpStorageStateId, validatePumpAutomationConfig } from "./pumpAutomationConfig.js";
import type { PumpAutomationConfig } from "./pumpAutomationConfig.js";
import { PumpPlaywrightSession, checkIfLoginRequired } from "./pumpAutomationCapture.js";
import { syncPumpHealthAlerts } from "./pumpHealth.js";

type RenewalStatus =
  | "idle"
  | "starting"
  | "awaiting_sms_code"
  | "submitting_sms_code"
  | "saving"
  | "saved"
  | "failed"
  | "cancelled"
  | "timed_out";

type RenewalRecord = {
  renewalId: string;
  status: RenewalStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  message: string;
  error: string | null;
  currentUrl: string | null;
  storageStateId: string | null;
  storageStateRelativePath: string | null;
  maskedDestination: string | null;
  diagnosticsRelativePath: string | null;
  cancelRequested: boolean;
  session: PumpPlaywrightSession | null;
  timeoutTimer: NodeJS.Timeout | null;
};

export type PumpSessionRenewalStatus = Omit<
  RenewalRecord,
  "cancelRequested" | "session" | "timeoutTimer"
> & {
  active: boolean;
  available: boolean;
};

const ACTIVE_STATUSES = new Set<RenewalStatus>([
  "starting",
  "awaiting_sms_code",
  "submitting_sms_code",
  "saving",
]);
const storageStatesRoot = path.join(resolveDataDir(), "pump", "storageStates");
const diagnosticsRoot = path.join(resolveDataDir(), "pump", "session-renewal");
const RENEWAL_TIMEOUT_MS = 10 * 60 * 1_000;

let latestRenewal: RenewalRecord | null = null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const canRunSessionRenewal = () => true;

const normalizeAirbnbText = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const isAirbnbAccountRenewalScreenText = (value: string | null | undefined) => {
  const text = normalizeAirbnbText(value);
  return (
    text.includes("ravi de vous revoir") ||
    text.includes("ravis de vous revoir") ||
    text.includes("ce n'est pas vous") ||
    text.includes("nous vous enverrons peut-etre un code de connexion")
  );
};

export const isAirbnbSmsChallengeScreenText = (value: string | null | undefined) => {
  const text = normalizeAirbnbText(value);
  return (
    (text.includes("confirmez qu'il s'agit bien de vous") ||
      text.includes("confirm it's really you") ||
      text.includes("confirm it is really you")) &&
    (text.includes("nous avons envoye un code") ||
      text.includes("we sent a code") ||
      text.includes("envoyer un nouveau code") ||
      text.includes("send a new code"))
  );
};

export const extractAirbnbSmsChallengeDestination = (value: string | null | undefined) => {
  const raw = String(value ?? "").replace(/\u00a0/g, " ");
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const maskedLine = lines.find((line) =>
    /(\+\d[\d\s*.-]{5,}|\b[\w.+-]\*+[\w.+-]*@[\w.-]+\.[a-z]{2,}\b)/i.test(line)
  );
  return maskedLine ?? null;
};

const sanitizeRecord = (renewal: RenewalRecord | null): PumpSessionRenewalStatus => {
  if (!renewal) {
    return {
      renewalId: "",
      status: "idle",
      startedAt: "",
      updatedAt: "",
      completedAt: null,
      message: "Aucun renouvellement assisté en cours.",
      error: null,
      currentUrl: null,
      storageStateId: null,
      storageStateRelativePath: null,
      maskedDestination: null,
      diagnosticsRelativePath: null,
      active: false,
      available: canRunSessionRenewal(),
    };
  }

  return {
    renewalId: renewal.renewalId,
    status: renewal.status,
    startedAt: renewal.startedAt,
    updatedAt: renewal.updatedAt,
    completedAt: renewal.completedAt,
    message: renewal.message,
    error: renewal.error,
    currentUrl: renewal.currentUrl,
    storageStateId: renewal.storageStateId,
    storageStateRelativePath: renewal.storageStateRelativePath,
    maskedDestination: renewal.maskedDestination,
    diagnosticsRelativePath: renewal.diagnosticsRelativePath,
    active: ACTIVE_STATUSES.has(renewal.status),
    available: canRunSessionRenewal(),
  };
};

const updateRenewal = (patch: Partial<RenewalRecord>) => {
  if (!latestRenewal) return null;
  latestRenewal = {
    ...latestRenewal,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return latestRenewal;
};

const clearRenewalTimeout = (renewal: RenewalRecord | null) => {
  if (!renewal?.timeoutTimer) return;
  clearTimeout(renewal.timeoutTimer);
  renewal.timeoutTimer = null;
};

const finalizeRenewal = async (status: RenewalStatus, patch: Partial<RenewalRecord> = {}) => {
  const renewal = updateRenewal({
    ...patch,
    status,
    completedAt: new Date().toISOString(),
  });
  if (!renewal) return null;

  clearRenewalTimeout(renewal);

  try {
    await renewal.session?.close();
  } catch {
    // Ignore close errors during finalization.
  }

  renewal.session = null;
  return renewal;
};

const getDiagnosticsDir = (renewalId: string) => {
  fs.mkdirSync(diagnosticsRoot, { recursive: true });
  return path.join(diagnosticsRoot, renewalId);
};

const writeDiagnostics = async (page: Page | null, renewalId: string, suffix: string) => {
  const diagnosticsDir = getDiagnosticsDir(renewalId);
  fs.mkdirSync(diagnosticsDir, { recursive: true });

  const screenshotPath = path.join(diagnosticsDir, `${suffix}.png`);
  const htmlPath = path.join(diagnosticsDir, `${suffix}.html`);

  if (page && !page.isClosed()) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    const html = await page.content().catch(() => "");
    if (html) {
      fs.writeFileSync(htmlPath, html, "utf-8");
    }
  }

  return path.relative(process.cwd(), diagnosticsDir);
};

const getVisibleLocator = async (locator: Locator) => {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const current = locator.nth(index);
    if (await current.isVisible().catch(() => false)) return current;
  }
  return null;
};

const clickFirstVisible = async (page: Page, selectors: string[], timeout = 5_000) => {
  for (const selector of selectors) {
    const target = await getVisibleLocator(page.locator(selector));
    if (!target) continue;
    await target.click({ timeout });
    return true;
  }
  return false;
};

const fillFirstVisible = async (page: Page, selectors: string[], value: string, timeout = 5_000) => {
  for (const selector of selectors) {
    const target = await getVisibleLocator(page.locator(selector));
    if (!target) continue;
    await target.fill(value, { timeout });
    return true;
  }
  return false;
};

const getRenewalContext = () => {
  const config = readPumpAutomationConfig(buildDefaultPumpAutomationConfig());
  const errors = validatePumpAutomationConfig(config);
  if (errors.length > 0) {
    throw new Error(`Configuration Pump invalide: ${errors.join(" ")}`);
  }
  if (!config.persistSession) {
    throw new Error("Activez d'abord la session persistée pour utiliser le renouvellement assisté.");
  }

  const storageStateId =
    config.baseUrl.trim() && config.username.trim() ? getPumpStorageStateId(config) : null;
  const storageStatePath = storageStateId ? path.join(storageStatesRoot, `${storageStateId}.json`) : null;
  if (!storageStatePath || !fs.existsSync(storageStatePath)) {
    throw new Error("Aucune session persistée Airbnb n'est disponible à renouveler. Importez d'abord une session valide.");
  }

  return {
    config,
    storageStateId,
    storageStatePath,
  };
};

const getBodyText = async (page: Page) => page.locator("body").innerText().catch(() => "");

const maybeHandleAccountChooser = async (page: Page, config: PumpAutomationConfig) => {
  const bodyText = await getBodyText(page);
  if (!isAirbnbAccountRenewalScreenText(bodyText)) return false;

  const button = await getVisibleLocator(page.locator(config.advancedSelectors.accountChooserContinueButton));
  if (!button) {
    throw new Error("Airbnb demande de confirmer le compte mais le bouton Continuer est introuvable.");
  }

  await button.click({ timeout: 5_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await wait(1_000);
  return true;
};

const resolveSmsCodeInput = async (page: Page) => {
  const selectors = [
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[name*="otp" i]',
    'input[name*="code" i]',
    'input[aria-label*="code" i]',
    'input[type="tel"]',
  ];

  for (const selector of selectors) {
    const target = await getVisibleLocator(page.locator(selector));
    if (target) return { mode: "single" as const, target };
  }

  const digitInputs = page.locator(
    'input[maxlength="1"], input[inputmode="numeric"][maxlength], input[type="tel"][maxlength]'
  );
  const count = await digitInputs.count();
  if (count > 1) {
    return { mode: "multi" as const, target: digitInputs };
  }

  return null;
};

const fillSmsCode = async (page: Page, code: string) => {
  const resolved = await resolveSmsCodeInput(page);
  if (!resolved) {
    throw new Error("Le champ de saisie du code SMS est introuvable.");
  }

  if (resolved.mode === "single") {
    await resolved.target.click({ timeout: 5_000 });
    await resolved.target.fill(code, { timeout: 5_000 });
    return;
  }

  const count = await resolved.target.count();
  const digits = code.slice(0, count).split("");
  for (let index = 0; index < digits.length; index += 1) {
    await resolved.target.nth(index).fill(digits[index] ?? "", { timeout: 5_000 });
  }
};

const submitSmsCode = async (page: Page) => {
  const clicked = await clickFirstVisible(page, [
    'button:has-text("Continuer")',
    'button:has-text("Continue")',
    'button:has-text("Valider")',
    'button:has-text("Verify")',
    'button[type="submit"]',
  ]);

  if (!clicked) {
    await page.keyboard.press("Enter").catch(() => undefined);
  }
};

const readOtpError = async (page: Page) => {
  const candidates = [
    '[role="alert"]',
    '[aria-live="assertive"]',
    'div:has-text("incorrect")',
    'div:has-text("invalide")',
    'div:has-text("réessayer")',
    'div:has-text("reessayer")',
  ];
  for (const selector of candidates) {
    const target = await getVisibleLocator(page.locator(selector));
    if (!target) continue;
    const text = (await target.innerText().catch(() => "")).trim();
    if (text) return text;
  }
  return null;
};

const saveAuthenticatedSession = async (renewal: RenewalRecord, session: PumpPlaywrightSession) => {
  session.isAuthenticated = true;
  updateRenewal({
    status: "saving",
    message: "Connexion validée, sauvegarde de la session persistée...",
    currentUrl: session.getPage()?.url() ?? null,
  });
  await session.saveStorageState();
  await syncPumpHealthAlerts("pump-session-renewal-saved").catch(() => undefined);
  await finalizeRenewal("saved", {
    message: "Session persistée renouvelée avec succès.",
    currentUrl: session.getPage()?.url() ?? null,
  });
};

const runRenewalStart = async () => {
  const renewal = latestRenewal;
  if (!renewal) return;

  let page: Page | null = null;

  try {
    const { config, storageStateId, storageStatePath } = getRenewalContext();
    const session = new PumpPlaywrightSession(config, storageStatesRoot);

    updateRenewal({
      session,
      status: "starting",
      message: "Ouverture de la session Airbnb de renouvellement...",
      storageStateId,
      storageStateRelativePath: path.relative(process.cwd(), storageStatePath),
    });

    await session.initialize();
    page = session.getPage();
    if (!page) {
      throw new Error("La page Playwright Airbnb n'a pas pu être initialisée.");
    }

    await session.navigate(config.baseUrl);
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    await wait(1_000);

    updateRenewal({ currentUrl: page.url() });

    const loginRequiredBefore = await checkIfLoginRequired(page, config).catch(() => true);
    if (!loginRequiredBefore) {
      await saveAuthenticatedSession(renewal, session);
      return;
    }

    await maybeHandleAccountChooser(page, config);
    updateRenewal({ currentUrl: page.url() });

    const loginRequiredAfter = await checkIfLoginRequired(page, config).catch(() => true);
    if (!loginRequiredAfter) {
      await saveAuthenticatedSession(renewal, session);
      return;
    }

    const bodyText = await getBodyText(page);
    if (isAirbnbSmsChallengeScreenText(bodyText)) {
      updateRenewal({
        status: "awaiting_sms_code",
        message: "Code SMS requis pour finaliser le renouvellement de la session Airbnb.",
        currentUrl: page.url(),
        maskedDestination: extractAirbnbSmsChallengeDestination(bodyText),
        diagnosticsRelativePath: await writeDiagnostics(page, renewal.renewalId, "awaiting-sms-code"),
      });
      return;
    }

    throw new Error(
      "Le renouvellement assisté V1 n'a pas reconnu l'écran Airbnb courant. Cette version gère uniquement l'écran de compte reconnu puis le code SMS."
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue pendant le renouvellement assisté.";
    const diagnosticsRelativePath = await writeDiagnostics(page, renewal.renewalId, "failed").catch(() => null);
    await finalizeRenewal("failed", {
      error: message,
      message,
      currentUrl: page?.url() ?? null,
      diagnosticsRelativePath,
    });
  }
};

export const getPumpSessionRenewalStatus = () => sanitizeRecord(latestRenewal);

export const startPumpSessionRenewal = () => {
  if (latestRenewal && ACTIVE_STATUSES.has(latestRenewal.status)) {
    return sanitizeRecord(latestRenewal);
  }

  latestRenewal = {
    renewalId: `renewal_${Date.now().toString(36)}`,
    status: "starting",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    message: "Préparation du renouvellement assisté...",
    error: null,
    currentUrl: null,
    storageStateId: null,
    storageStateRelativePath: null,
    maskedDestination: null,
    diagnosticsRelativePath: null,
    cancelRequested: false,
    session: null,
    timeoutTimer: null,
  };

  latestRenewal.timeoutTimer = setTimeout(() => {
    void finalizeRenewal("timed_out", {
      error: "Timeout du renouvellement assisté atteint.",
      message: "Le renouvellement assisté a expiré avant validation du challenge Airbnb.",
    });
  }, RENEWAL_TIMEOUT_MS);
  latestRenewal.timeoutTimer.unref?.();

  void runRenewalStart();
  return sanitizeRecord(latestRenewal);
};

export const cancelPumpSessionRenewal = async () => {
  if (!latestRenewal || !ACTIVE_STATUSES.has(latestRenewal.status)) {
    return sanitizeRecord(latestRenewal);
  }

  latestRenewal.cancelRequested = true;
  await finalizeRenewal("cancelled", {
    message: "Renouvellement assisté annulé.",
  });
  return sanitizeRecord(latestRenewal);
};

export const submitPumpSessionRenewalSmsCode = async (code: string) => {
  const renewal = latestRenewal;
  if (!renewal || !ACTIVE_STATUSES.has(renewal.status)) {
    throw new Error("Aucun renouvellement assisté actif.");
  }
  if (renewal.status !== "awaiting_sms_code") {
    throw new Error("Le renouvellement assisté n'attend pas de code SMS.");
  }

  const page = renewal.session?.getPage();
  if (!page || page.isClosed()) {
    throw new Error("La session de renouvellement Airbnb n'est plus disponible.");
  }

  updateRenewal({
    status: "submitting_sms_code",
    message: "Validation du code SMS Airbnb en cours...",
    error: null,
    currentUrl: page.url(),
  });

  try {
    await fillSmsCode(page, code);
    await submitSmsCode(page);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const bodyText = await getBodyText(page);
      const loginRequired = await checkIfLoginRequired(page, renewal.session!.config).catch(() => true);

      if (!loginRequired && !isAirbnbSmsChallengeScreenText(bodyText)) {
        await saveAuthenticatedSession(renewal, renewal.session!);
        return sanitizeRecord(latestRenewal);
      }

      if (isAirbnbSmsChallengeScreenText(bodyText)) {
        const otpError = await readOtpError(page);
        if (otpError) {
          updateRenewal({
            status: "awaiting_sms_code",
            message: otpError,
            error: otpError,
            currentUrl: page.url(),
            maskedDestination: extractAirbnbSmsChallengeDestination(bodyText),
          });
          return sanitizeRecord(latestRenewal);
        }
      }

      await wait(1_000);
    }

    const bodyText = await getBodyText(page);
    updateRenewal({
      status: "awaiting_sms_code",
      message: "Le code SMS n'a pas permis de finaliser la session. Vérifiez le code et réessayez.",
      error: "Validation du code SMS incomplète.",
      currentUrl: page.url(),
      maskedDestination: extractAirbnbSmsChallengeDestination(bodyText),
      diagnosticsRelativePath: await writeDiagnostics(page, renewal.renewalId, "sms-code-retry"),
    });

    return sanitizeRecord(latestRenewal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de valider le code SMS Airbnb.";
    updateRenewal({
      status: "awaiting_sms_code",
      message,
      error: message,
      currentUrl: page.url(),
      diagnosticsRelativePath: await writeDiagnostics(page, renewal.renewalId, "sms-code-error").catch(() => null),
    });
    return sanitizeRecord(latestRenewal);
  }
};

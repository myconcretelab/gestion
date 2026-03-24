import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Locator, Page } from "playwright";
import { env } from "../config/env.js";
import { resolveDataDir } from "../utils/paths.js";
import { getPumpAutomationConfig } from "./pumpAutomation.js";
import { PumpPlaywrightSession } from "./pumpAutomationCapture.js";
import type { PumpAutomationConfig } from "./pumpAutomationConfig.js";

export type AirbnbCalendarRefreshQueueResult = {
  status: "queued";
  job_id: string;
  message: string;
};

export type AirbnbCalendarRefreshSkippedResult = {
  status: "skipped";
  message: string;
};

export type AirbnbCalendarRefreshCreateResult =
  | AirbnbCalendarRefreshQueueResult
  | AirbnbCalendarRefreshSkippedResult;

export type AirbnbCalendarRefreshJobStatus = "queued" | "running" | "success" | "failed";

export type AirbnbCalendarRefreshJobStatusResponse = {
  job_id: string;
  status: AirbnbCalendarRefreshJobStatus;
  message?: string;
  error_code?: string;
  updated_at: string;
};

export type QueueAirbnbCalendarRefreshParams = {
  giteId: string;
  listingId: string;
};

type StoredAirbnbCalendarRefreshJob = AirbnbCalendarRefreshJobStatusResponse & {
  diagnosticsDir: string;
  cleanupTimer: NodeJS.Timeout | null;
};

type AirbnbCalendarRefreshExecutorParams = QueueAirbnbCalendarRefreshParams & {
  jobId: string;
  diagnosticsDir: string;
};

type AirbnbCalendarRefreshExecutor = (
  params: AirbnbCalendarRefreshExecutorParams
) => Promise<{ message?: string } | void>;

const JOB_RETENTION_MS = 10 * 60 * 1_000;
const diagnosticsRoot = path.join(resolveDataDir(), "airbnb-calendar-refresh");
const storageStatesRoot = path.join(resolveDataDir(), "pump", "storageStates");
const jobs = new Map<string, StoredAirbnbCalendarRefreshJob>();
const PERSONAL_CALENDAR_NAME = "perso";

let executorOverride: AirbnbCalendarRefreshExecutor | null = null;

class AirbnbCalendarRefreshError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AirbnbCalendarRefreshError";
    this.code = code;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isAirbnbAccountChooserScreenText = (value: string | null | undefined) => {
  const text = String(value ?? "").toLowerCase();
  return (
    text.includes("utiliser un autre compte") ||
    text.includes("ce n'est pas vous") ||
    (text.includes("bienvenue") && text.includes("continuer"))
  );
};

export const isAirbnbPersonalCalendarCardText = (value: string | null | undefined) =>
  String(value ?? "").toLowerCase().includes(PERSONAL_CALENDAR_NAME);

const buildJob = (jobId: string): StoredAirbnbCalendarRefreshJob => {
  const diagnosticsDir = path.join(diagnosticsRoot, jobId);
  fs.mkdirSync(diagnosticsDir, { recursive: true });

  return {
    job_id: jobId,
    status: "queued",
    message: "Rafraîchissement Airbnb en attente.",
    updated_at: new Date().toISOString(),
    diagnosticsDir,
    cleanupTimer: null,
  };
};

const scheduleCleanup = (jobId: string) => {
  const current = jobs.get(jobId);
  if (!current) return;

  if (current.cleanupTimer) {
    clearTimeout(current.cleanupTimer);
  }

  current.cleanupTimer = setTimeout(() => {
    jobs.delete(jobId);
  }, JOB_RETENTION_MS);
  current.cleanupTimer.unref?.();
};

const updateJob = (
  jobId: string,
  patch: Partial<Pick<StoredAirbnbCalendarRefreshJob, "status" | "message" | "error_code">>
) => {
  const current = jobs.get(jobId);
  if (!current) return null;

  const next: StoredAirbnbCalendarRefreshJob = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  jobs.set(jobId, next);
  if (next.status === "success" || next.status === "failed") {
    scheduleCleanup(jobId);
  }
  return next;
};

const getVisibleLocator = async (locator: Locator) => {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const current = locator.nth(index);
    if (await current.isVisible().catch(() => false)) return current;
  }
  return null;
};

const clickVisible = async (scope: Locator, selector: string, timeout = 5_000) => {
  const target = await getVisibleLocator(scope.locator(selector));
  if (!target) return false;
  await target.click({ timeout });
  return true;
};

const maybeHandleAccountChooser = async (page: Page, config: PumpAutomationConfig) => {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const currentUrl = page.url().toLowerCase();
  const accountChooserDetected = isAirbnbAccountChooserScreenText(bodyText);
  const button = await getVisibleLocator(page.locator(config.advancedSelectors.accountChooserContinueButton));
  if (!accountChooserDetected && !currentUrl.includes("/login")) {
    return false;
  }

  if (!button && !accountChooserDetected) {
    return false;
  }

  if (!button) {
    throw new AirbnbCalendarRefreshError(
      "account_chooser_unhandled",
      "Airbnb demande de confirmer le compte mais le bouton Continuer est introuvable."
    );
  }

  await button.click({ timeout: 5_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await wait(1_000);
  return true;
};

const locatePersonalCalendarSourceCard = async (page: Page, config: PumpAutomationConfig) => {
  const cards = page.locator(config.advancedSelectors.calendarSourceCard);
  const cardCount = await cards.count();
  if (cardCount === 0) {
    throw new AirbnbCalendarRefreshError(
      "calendar_source_cards_not_found",
      "Aucune carte de source calendrier n'a été trouvée sur la page Airbnb."
    );
  }

  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    const cardText = await card.innerText().catch(() => "");
    if (isAirbnbPersonalCalendarCardText(cardText)) return card;
  }

  throw new AirbnbCalendarRefreshError(
    "personal_calendar_not_found",
    "Aucun calendrier Airbnb nommé Perso n'a été trouvé."
  );
};

const writeDiagnostics = async (page: Page | null, diagnosticsDir: string, error: unknown) => {
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  const serializedError =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          ...(error instanceof AirbnbCalendarRefreshError ? { code: error.code } : {}),
        }
      : { message: String(error) };

  fs.writeFileSync(path.join(diagnosticsDir, "error.json"), JSON.stringify(serializedError, null, 2), "utf-8");

  if (!page) return;

  const currentUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const html = await page.content().catch(() => "");

  fs.writeFileSync(
    path.join(diagnosticsDir, "page.json"),
    JSON.stringify({ url: currentUrl, bodyText }, null, 2),
    "utf-8"
  );
  fs.writeFileSync(path.join(diagnosticsDir, "page.html"), html, "utf-8");
  await page.screenshot({ path: path.join(diagnosticsDir, "page.png"), fullPage: true }).catch(() => undefined);
};

const executeAirbnbCalendarRefresh = async ({
  jobId,
  listingId,
  diagnosticsDir,
}: AirbnbCalendarRefreshExecutorParams) => {
  const config = getPumpAutomationConfig();
  const session = new PumpPlaywrightSession(config, storageStatesRoot);
  const targetUrl = `https://www.airbnb.fr/multicalendar/${encodeURIComponent(listingId)}/availability-settings`;
  let page: Page | null = null;

  try {
    await session.initialize();
    page = session.getPage();
    if (!page) {
      throw new AirbnbCalendarRefreshError("playwright_page_missing", "La page Playwright Airbnb n'a pas pu être initialisée.");
    }

    await session.navigate(targetUrl);
    await wait(1_000);
    await maybeHandleAccountChooser(page, config).catch(async (error) => {
      await writeDiagnostics(page, diagnosticsDir, error);
      throw error;
    });

    await session.performLogin(env.PUMP_SESSION_PASSWORD || "");

    if (!page.url().includes(`/multicalendar/${listingId}/availability-settings`)) {
      await session.navigate(targetUrl);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    await wait(2_000);

    const card = await locatePersonalCalendarSourceCard(page, config);
    const refreshClicked = await clickVisible(card, config.advancedSelectors.calendarSourceRefreshButton, 5_000);
    if (!refreshClicked) {
      throw new AirbnbCalendarRefreshError(
        "refresh_button_not_found",
        "Le bouton Actualiser de la source iCal correspondante est introuvable."
      );
    }

    await wait(1_500);
    return {
      message: "Rafraîchissement Airbnb lancé avec succès.",
    };
  } catch (error) {
    await writeDiagnostics(page, diagnosticsDir, error);
    throw error;
  } finally {
    await session.close();
  }
};

const getExecutor = () => executorOverride ?? executeAirbnbCalendarRefresh;

const runQueuedJob = async (jobId: string, params: QueueAirbnbCalendarRefreshParams) => {
  updateJob(jobId, {
    status: "running",
    message: "Rafraîchissement Airbnb en cours.",
  });

  const current = jobs.get(jobId);
  if (!current) return;

  try {
    const result = await getExecutor()({
      ...params,
      jobId,
      diagnosticsDir: current.diagnosticsDir,
    });
    updateJob(jobId, {
      status: "success",
      message: result?.message ?? "Rafraîchissement Airbnb terminé.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    updateJob(jobId, {
      status: "failed",
      message,
      error_code: error instanceof AirbnbCalendarRefreshError ? error.code : "unknown_error",
    });
  }
};

export const queueAirbnbCalendarRefresh = (
  params: QueueAirbnbCalendarRefreshParams
): AirbnbCalendarRefreshQueueResult => {
  const jobId = randomUUID();
  jobs.set(jobId, buildJob(jobId));

  queueMicrotask(() => {
    void runQueuedJob(jobId, params);
  });

  return {
    status: "queued",
    job_id: jobId,
    message: "Rafraîchissement Airbnb planifié.",
  };
};

export const getAirbnbCalendarRefreshJobStatus = (jobId: string): AirbnbCalendarRefreshJobStatusResponse | null => {
  const current = jobs.get(jobId);
  if (!current) return null;

  const { diagnosticsDir: _diagnosticsDir, cleanupTimer: _cleanupTimer, ...response } = current;
  return response;
};

export const setAirbnbCalendarRefreshExecutorForTests = (executor: AirbnbCalendarRefreshExecutor | null) => {
  executorOverride = executor;
};

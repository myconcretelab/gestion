import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { resolveDataDir } from "../utils/paths.js";
import {
  PumpNetworkCapture,
  PumpPlaywrightSession,
  PumpSessionSaver,
  generatePumpSessionId,
  logError,
  logInfo,
  persistCapturedSession,
} from "./pumpAutomationCapture.js";
import {
  buildDefaultPumpAutomationConfig,
  getPumpStorageStateId,
  normalizePumpAutomationConfig,
  readPumpAutomationConfig,
  validatePumpAutomationConfig,
  writePumpAutomationConfig,
  type PumpAutomationConfig,
} from "./pumpAutomationConfig.js";
import {
  extractPumpReservationsFromSession,
  type PumpLatestExtraction,
  type PumpLatestReservation,
} from "./pumpAutomationExtraction.js";
import { syncPumpHealthAlerts } from "./pumpHealth.js";

export type PumpStatusResponse = {
  sessionId: string | null;
  status: string;
  updatedAt?: string | null;
  reservationCount?: number;
  errors?: Array<{ message?: string | null }>;
  results?: Record<string, unknown> | null;
};

export type PumpLatestResponse = {
  sessionId: string | null;
  status: string;
  updatedAt?: string | null;
  reservationCount: number;
  reservations: PumpLatestReservation[];
  stats?: PumpLatestExtraction["stats"];
};

type StoredSessionRecord = {
  sessionId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  storageDir?: string;
  lastError?: string | null;
};

type ActiveSessionState = {
  sessionId: string;
  playwright: PumpPlaywrightSession;
  networkCapture: PumpNetworkCapture;
  saver: PumpSessionSaver;
  status: string;
  startTime: number;
  errors: Array<{ message: string; timestamp: string }>;
  results: Record<string, unknown> | null;
  cancelRequested: boolean;
  cleanupTimer: NodeJS.Timeout | null;
};

const SESSION_RETENTION_MS = 10 * 60 * 1_000;
const FINISHED_STATUSES = new Set(["completed", "failed", "stopped"]);
const sessionsRoot = path.join(resolveDataDir(), "pump", "sessions");
const storageStatesRoot = path.join(resolveDataDir(), "pump", "storageStates");
const registryPath = path.join(sessionsRoot, "index.json");

let latestRefreshSessionId: string | null = null;
const activeSessions = new Map<string, ActiveSessionState>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeImportedStorageStateId = (value: string) => {
  const basename = path.basename(value, path.extname(value)).trim().toLowerCase();
  const normalized = basename
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
};

export const resolveImportedPumpStorageStateId = (
  config: Pick<PumpAutomationConfig, "baseUrl" | "username">,
  filename?: string | null
) => {
  const configuredStorageStateId =
    config.baseUrl.trim() && config.username.trim() ? getPumpStorageStateId(config) : null;

  if (configuredStorageStateId) {
    return configuredStorageStateId;
  }

  return filename ? sanitizeImportedStorageStateId(filename) : null;
};

const ensurePumpDirectories = () => {
  fs.mkdirSync(sessionsRoot, { recursive: true });
  fs.mkdirSync(storageStatesRoot, { recursive: true });
  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(registryPath, JSON.stringify({ sessions: {} }, null, 2), "utf-8");
  }
};

const readRegistry = (): { sessions: Record<string, StoredSessionRecord> } => {
  ensurePumpDirectories();
  try {
    return JSON.parse(fs.readFileSync(registryPath, "utf-8")) as { sessions: Record<string, StoredSessionRecord> };
  } catch {
    return { sessions: {} };
  }
};

const writeRegistry = (registry: { sessions: Record<string, StoredSessionRecord> }) => {
  ensurePumpDirectories();
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
};

const upsertSession = (sessionId: string, data: Partial<StoredSessionRecord>) => {
  const registry = readRegistry();
  const current = registry.sessions[sessionId] || { sessionId, status: "unknown" };
  registry.sessions[sessionId] = {
    ...current,
    ...data,
    sessionId,
    updatedAt: new Date().toISOString(),
  };
  writeRegistry(registry);
  return registry.sessions[sessionId];
};

const getSession = (sessionId: string) => readRegistry().sessions[sessionId] || null;

const listSessions = (limit = 20) =>
  Object.values(readRegistry().sessions)
    .sort((left, right) => {
      const leftDate = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightDate = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    })
    .slice(0, limit);

const getPumpPassword = () => env.PUMP_SESSION_PASSWORD || "";

const getConfiguredStorageStatePath = (config: Pick<PumpAutomationConfig, "baseUrl" | "username">) =>
  path.join(storageStatesRoot, `${getPumpStorageStateId(config)}.json`);

const sanitizeSessionStatusResponse = (session: ActiveSessionState | null) => {
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    status: session.status,
    duration: Date.now() - session.startTime,
    errors: session.errors,
    results: session.results,
  };
};

const scheduleSessionCleanup = (sessionId: string) => {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
  }

  session.cleanupTimer = setTimeout(() => {
    activeSessions.delete(sessionId);
  }, SESSION_RETENTION_MS);
};

const setSessionStatus = (session: ActiveSessionState, status: string, data: { error?: string | null } = {}) => {
  session.status = status;
  upsertSession(session.sessionId, {
    status,
    storageDir: session.saver.getSessionDir(),
    lastError: data.error ?? null,
  });
};

const getActiveSession = (sessionId: string) => activeSessions.get(sessionId) || null;

const getActiveSessionStatus = (sessionId: string) => sanitizeSessionStatusResponse(getActiveSession(sessionId));

const buildEffectiveConfig = (override?: Partial<PumpAutomationConfig>) => {
  const storedConfig = readPumpAutomationConfig(buildDefaultPumpAutomationConfig());
  const effectiveConfig = {
    ...storedConfig,
    ...(override ?? {}),
    filterRules: {
      ...storedConfig.filterRules,
      ...(override?.filterRules ?? {}),
    },
    advancedSelectors: {
      ...storedConfig.advancedSelectors,
      ...(override?.advancedSelectors ?? {}),
    },
  };

  const errors = validatePumpAutomationConfig(effectiveConfig);
  if (errors.length > 0) {
    throw new Error(`Configuration Pump invalide: ${errors.join(" ")}`);
  }

  return effectiveConfig;
};

const executeSession = async (sessionId: string, password: string) => {
  const sessionData = activeSessions.get(sessionId);
  if (!sessionData) return;

  const startedAt = Date.now();
  const { playwright, networkCapture, saver } = sessionData;

  try {
    logInfo("Local Pump session started.", { sessionId });
    setSessionStatus(sessionData, "running");

    await playwright.initialize();
    networkCapture.page = playwright.getPage();
    await networkCapture.start();

    networkCapture.setContext("before-login");
    await playwright.navigate(playwright.config.baseUrl);

    networkCapture.setContext("login");
    await playwright.performLogin(password);

    networkCapture.setContext("before-scroll");
    await playwright.waitBeforeAction();

    networkCapture.setContext("during-scroll");
    await playwright.performScrollSequence();

    networkCapture.setContext("after-scroll");
    await networkCapture.waitForSettled();

    sessionData.results = persistCapturedSession(saver, networkCapture, [], Date.now() - startedAt);
    setSessionStatus(sessionData, "completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    sessionData.errors.push({
      message,
      timestamp: new Date().toISOString(),
    });
    logError("Local Pump session failed.", { sessionId, error: message });

    await networkCapture.waitForSettled({ idleMs: 250, timeoutMs: 3_000 }).catch(() => false);
    sessionData.results = persistCapturedSession(saver, networkCapture, sessionData.errors, Date.now() - startedAt);
    setSessionStatus(sessionData, sessionData.cancelRequested ? "stopped" : "failed", { error: message });
  } finally {
    await playwright.close();
    networkCapture.stop();
    await syncPumpHealthAlerts(`pump-refresh:${sessionData.status}`).catch((error) => {
      logError("Unable to sync Pump health alerts.", error);
    });
    scheduleSessionCleanup(sessionId);
  }
};

const findLatestFinishedSession = () =>
  listSessions(100).find((session) => FINISHED_STATUSES.has(session.status) && session.storageDir) || null;

const findLatestRefreshSession = () => {
  if (latestRefreshSessionId) {
    const targetedSession = getSession(latestRefreshSessionId);
    if (targetedSession) return targetedSession;
  }
  return listSessions(100)[0] || null;
};

export const getPumpAutomationConfig = () => readPumpAutomationConfig(buildDefaultPumpAutomationConfig());

export const importPumpAutomationConfig = (input: unknown) => {
  const current = getPumpAutomationConfig();
  const source = isRecord(input) && isRecord(input.config) ? input.config : input;
  const config = normalizePumpAutomationConfig((isRecord(source) ? source : {}) as Record<string, unknown>, current);
  const errors = validatePumpAutomationConfig(config);

  if (errors.length > 0) {
    throw new Error(`Configuration Pump invalide: ${errors.join(" ")}`);
  }

  writePumpAutomationConfig(config);
  return config;
};

export const importPersistedPumpSession = (
  input: unknown,
  options: {
    filename?: string | null;
  } = {}
) => {
  ensurePumpDirectories();

  if (!isRecord(input)) {
    throw new Error("Le fichier de session persistée doit être un objet JSON valide.");
  }

  const hasCookies = Array.isArray(input.cookies);
  const hasOrigins = Array.isArray(input.origins);

  if (!hasCookies && !hasOrigins) {
    throw new Error("Le fichier importé ne ressemble pas à un storageState Playwright (cookies/origins manquants).");
  }

  const currentConfig = getPumpAutomationConfig();
  const storageStateId = resolveImportedPumpStorageStateId(currentConfig, options.filename);

  if (!storageStateId) {
    throw new Error("Impossible de déterminer le nom de la session. Importez d'abord la configuration Pump.");
  }

  const targetPath = path.join(storageStatesRoot, `${storageStateId}.json`);
  const normalizedState = {
    ...input,
    cookies: hasCookies ? input.cookies : [],
    origins: hasOrigins ? input.origins : [],
  };

  fs.writeFileSync(targetPath, JSON.stringify(normalizedState, null, 2), "utf-8");

  return {
    storageStateId,
    filename: path.basename(targetPath),
    relativePath: path.relative(process.cwd(), targetPath),
  };
};

export const exportPersistedPumpSession = () => {
  ensurePumpDirectories();
  const currentConfig = getPumpAutomationConfig();

  if (!currentConfig.baseUrl.trim() || !currentConfig.username.trim()) {
    throw new Error("La configuration Pump doit contenir l'URL Airbnb et le compte avant l'export.");
  }

  const storageStateId = getPumpStorageStateId(currentConfig);
  const targetPath = getConfiguredStorageStatePath(currentConfig);
  if (!fs.existsSync(targetPath)) {
    throw new Error("Aucune session persistée Pump n'est disponible pour cet export.");
  }

  const raw = fs.readFileSync(targetPath, "utf-8");
  const storageState = JSON.parse(raw) as unknown;

  return {
    storageStateId,
    filename: path.basename(targetPath),
    relativePath: path.relative(process.cwd(), targetPath),
    storageState,
  };
};

export const updatePumpAutomationConfig = (patch: Partial<PumpAutomationConfig>) => {
  const current = getPumpAutomationConfig();
  const nextConfig = {
    ...current,
    ...patch,
    filterRules: {
      ...current.filterRules,
      ...(patch.filterRules ?? {}),
    },
    advancedSelectors: {
      ...current.advancedSelectors,
      ...(patch.advancedSelectors ?? {}),
    },
  };

  const errors = validatePumpAutomationConfig(nextConfig);
  if (errors.length > 0) {
    throw new Error(`Configuration Pump invalide: ${errors.join(" ")}`);
  }

  writePumpAutomationConfig(nextConfig);
  return nextConfig;
};

export const testPumpAutomationConnection = async (override?: Partial<PumpAutomationConfig>) => {
  ensurePumpDirectories();
  const config = buildEffectiveConfig(override);
  const session = new PumpPlaywrightSession(config, storageStatesRoot);
  return session.testLogin(getPumpPassword());
};

export const testPumpAutomationScrollTarget = async (override?: Partial<PumpAutomationConfig>) => {
  ensurePumpDirectories();
  const config = buildEffectiveConfig(override);
  const session = new PumpPlaywrightSession(config, storageStatesRoot);
  return session.testScrollTarget(getPumpPassword());
};

export const triggerLocalPumpRefresh = async () => {
  ensurePumpDirectories();
  const config = buildEffectiveConfig();
  const password = getPumpPassword();
  const sessionId = generatePumpSessionId();

  const playwright = new PumpPlaywrightSession(config, storageStatesRoot);
  const networkCapture = new PumpNetworkCapture(null, config.filterRules);
  const saver = new PumpSessionSaver(sessionId, config, sessionsRoot);

  activeSessions.set(sessionId, {
    sessionId,
    playwright,
    networkCapture,
    saver,
    status: "starting",
    startTime: Date.now(),
    errors: [],
    results: null,
    cancelRequested: false,
    cleanupTimer: null,
  });

  upsertSession(sessionId, {
    sessionId,
    status: "starting",
    createdAt: new Date().toISOString(),
    storageDir: saver.getSessionDir(),
    lastError: null,
  });

  latestRefreshSessionId = sessionId;
  void executeSession(sessionId, password);

  return {
    success: true,
    sessionId,
    status: "starting",
    message: "Refresh Pump local lancé.",
  };
};

export const getLocalPumpRefreshStatus = async (): Promise<PumpStatusResponse> => {
  ensurePumpDirectories();
  const latestSession = findLatestRefreshSession();
  if (!latestSession) {
    return {
      sessionId: null,
      status: "idle",
      reservationCount: 0,
      results: null,
      errors: [],
    };
  }

  const activeStatus = getActiveSessionStatus(latestSession.sessionId);
  if (activeStatus) {
    return {
      ...activeStatus,
      updatedAt: latestSession.updatedAt || latestSession.createdAt || null,
      reservationCount: 0,
    };
  }

  const extracted =
    latestSession.storageDir && fs.existsSync(latestSession.storageDir)
      ? extractPumpReservationsFromSession(latestSession.storageDir)
      : { reservations: [], stats: { inspectedResponses: 0, matchedResponses: 0 } };

  return {
    sessionId: latestSession.sessionId,
    status: latestSession.status || "unknown",
    updatedAt: latestSession.updatedAt || latestSession.createdAt || null,
    reservationCount: extracted.reservations.length,
    errors: latestSession.lastError ? [{ message: latestSession.lastError }] : [],
    results: null,
  };
};

export const getLocalPumpLatestReservations = async (): Promise<PumpLatestResponse> => {
  ensurePumpDirectories();
  const latestSession = findLatestFinishedSession();
  if (!latestSession?.storageDir || !fs.existsSync(latestSession.storageDir)) {
    throw new Error("Aucune extraction Pump locale terminée n'est disponible.");
  }

  const extracted = extractPumpReservationsFromSession(latestSession.storageDir);
  return {
    sessionId: latestSession.sessionId,
    status: latestSession.status,
    updatedAt: latestSession.updatedAt || latestSession.createdAt || null,
    reservationCount: extracted.reservations.length,
    stats: extracted.stats,
    reservations: extracted.reservations,
  };
};

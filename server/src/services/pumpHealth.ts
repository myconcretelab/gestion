import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import {
  buildDefaultPumpAutomationConfig,
  getPumpStorageStateId,
  readPumpAutomationConfig,
} from "./pumpAutomationConfig.js";
import { buildDefaultPumpCronConfig, readPumpCronConfig } from "./pumpCronSettings.js";
import { resolveDataDir } from "../utils/paths.js";

type StoredSessionRecord = {
  sessionId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  storageDir?: string;
  lastError?: string | null;
};

type AlertState = {
  lastObservedStatus: PumpConnectionHealth["status"] | null;
  lastObservedAt: string | null;
  lastNotifiedStatus: PumpConnectionHealth["status"] | null;
  lastNotifiedAt: string | null;
};

export type PumpConnectionHealth = {
  status: "connected" | "stale" | "auth_required" | "refresh_failed" | "disabled";
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  summary: string;
  recommendedAction: string | null;
  configValid: boolean;
  persistSessionEnabled: boolean;
  sessionFileExists: boolean;
  sessionFileUpdatedAt: string | null;
  storageStateId: string | null;
  storageStateRelativePath: string | null;
  latestSessionId: string | null;
  latestSessionStatus: string | null;
  lastSuccessfulRefreshAt: string | null;
  lastFailedRefreshAt: string | null;
  latestRefreshAt: string | null;
  latestError: string | null;
  cronEnabled: boolean;
  cronScheduler: "internal" | "external";
  staleAfterHours: number;
  checkedAt: string;
};

const pumpRoot = path.join(resolveDataDir(), "pump");
const storageStatesRoot = path.join(pumpRoot, "storageStates");
const sessionsRoot = path.join(pumpRoot, "sessions");
const registryPath = path.join(sessionsRoot, "index.json");
const alertStatePath = path.join(pumpRoot, "health-alert-state.json");
const pumpCronScheduler = env.PUMP_IMPORT_CRON_SCHEDULER as PumpConnectionHealth["cronScheduler"];

const ensurePumpRoot = () => {
  fs.mkdirSync(storageStatesRoot, { recursive: true });
  fs.mkdirSync(sessionsRoot, { recursive: true });
};

const parseDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const readRegistry = (): StoredSessionRecord[] => {
  ensurePumpRoot();
  if (!fs.existsSync(registryPath)) return [];

  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as { sessions?: Record<string, StoredSessionRecord> };
    return Object.values(parsed.sessions ?? {}).sort((left, right) => {
      const leftDate = parseDate(left.updatedAt || left.createdAt)?.getTime() ?? 0;
      const rightDate = parseDate(right.updatedAt || right.createdAt)?.getTime() ?? 0;
      return rightDate - leftDate;
    });
  } catch {
    return [];
  }
};

const getStorageStatePath = () => {
  const config = readPumpAutomationConfig(buildDefaultPumpAutomationConfig());
  if (!config.baseUrl.trim() || !config.username.trim()) {
    return {
      config,
      storageStateId: null,
      absolutePath: null,
      relativePath: null,
    };
  }

  const storageStateId = getPumpStorageStateId(config);
  const absolutePath = path.join(storageStatesRoot, `${storageStateId}.json`);
  return {
    config,
    storageStateId,
    absolutePath,
    relativePath: path.relative(process.cwd(), absolutePath),
  };
};

const hasAuthFailureFingerprint = (value: string | null | undefined) => {
  const message = String(value ?? "").trim().toLowerCase();
  if (!message) return false;
  return [
    "session airbnb expir",
    "session expir",
    "authentification",
    "connexion airbnb",
    "login",
    "mot de passe",
    "persist",
    "storage state",
  ].some((fragment) => message.includes(fragment));
};

const resolveStaleAfterHours = () => {
  const cronConfig = readPumpCronConfig(buildDefaultPumpCronConfig());
  if (!cronConfig.enabled) return env.PUMP_HEALTH_STALE_AFTER_HOURS;
  return Math.max(env.PUMP_HEALTH_STALE_AFTER_HOURS, cronConfig.interval_days * 24 + 24);
};

const readAlertState = (): AlertState => {
  ensurePumpRoot();
  if (!fs.existsSync(alertStatePath)) {
    return {
      lastObservedStatus: null,
      lastObservedAt: null,
      lastNotifiedStatus: null,
      lastNotifiedAt: null,
    };
  }

  try {
    const raw = fs.readFileSync(alertStatePath, "utf-8");
    if (!raw.trim()) {
      return {
        lastObservedStatus: null,
        lastObservedAt: null,
        lastNotifiedStatus: null,
        lastNotifiedAt: null,
      };
    }
    return JSON.parse(raw) as AlertState;
  } catch {
    return {
      lastObservedStatus: null,
      lastObservedAt: null,
      lastNotifiedStatus: null,
      lastNotifiedAt: null,
    };
  }
};

const writeAlertState = (state: AlertState) => {
  ensurePumpRoot();
  fs.writeFileSync(alertStatePath, JSON.stringify(state, null, 2), "utf-8");
};

export const getPumpConnectionHealth = async (): Promise<PumpConnectionHealth> => {
  ensurePumpRoot();

  const { config, storageStateId, absolutePath, relativePath } = getStorageStatePath();
  const cronConfig = readPumpCronConfig(buildDefaultPumpCronConfig());
  const staleAfterHours = resolveStaleAfterHours();
  const staleAfterMs = staleAfterHours * 60 * 60 * 1_000;
  const sessions = readRegistry();
  const latestSession = sessions[0] ?? null;
  const lastSuccessfulSession = sessions.find((session) => session.status === "completed") ?? null;
  const lastFailedSession =
    sessions.find((session) => session.status === "failed" || session.status === "stopped") ?? null;

  const sessionFileExists = Boolean(absolutePath && fs.existsSync(absolutePath));
  const sessionFileStats = sessionFileExists && absolutePath ? fs.statSync(absolutePath) : null;
  const sessionFileUpdatedAt = sessionFileStats?.mtime?.toISOString() ?? null;
  const latestRefreshAt = latestSession?.updatedAt || latestSession?.createdAt || null;
  const lastSuccessfulRefreshAt =
    lastSuccessfulSession?.updatedAt || lastSuccessfulSession?.createdAt || sessionFileUpdatedAt || null;
  const lastFailedRefreshAt = lastFailedSession?.updatedAt || lastFailedSession?.createdAt || null;
  const latestRelevantDate =
    parseDate(lastSuccessfulRefreshAt)?.getTime() ?? parseDate(sessionFileUpdatedAt)?.getTime() ?? null;

  const configValid = Boolean(config.baseUrl.trim() && config.scrollSelector.trim());
  const checkedAt = new Date().toISOString();
  const latestError = latestSession?.lastError?.trim() || null;

  if (!config.persistSession) {
    return {
      status: "disabled",
      tone: "neutral",
      label: "Session persistée désactivée",
      summary: "Le mode session persistée est désactivé, Pump n'est pas fiable en phase 1.",
      recommendedAction: "Activez la session persistée puis importez une session Playwright valide.",
      configValid,
      persistSessionEnabled: false,
      sessionFileExists,
      sessionFileUpdatedAt,
      storageStateId,
      storageStateRelativePath: relativePath,
      latestSessionId: latestSession?.sessionId ?? null,
      latestSessionStatus: latestSession?.status ?? null,
      lastSuccessfulRefreshAt,
      lastFailedRefreshAt,
      latestRefreshAt,
      latestError,
      cronEnabled: cronConfig.enabled,
      cronScheduler: pumpCronScheduler,
      staleAfterHours,
      checkedAt,
    };
  }

  if (!configValid) {
    return {
      status: "disabled",
      tone: "neutral",
      label: "Configuration incomplète",
      summary: "Pump n'est pas encore configuré complètement.",
      recommendedAction: "Renseignez l'URL Airbnb et le sélecteur de scroll dans Paramètres.",
      configValid: false,
      persistSessionEnabled: true,
      sessionFileExists,
      sessionFileUpdatedAt,
      storageStateId,
      storageStateRelativePath: relativePath,
      latestSessionId: latestSession?.sessionId ?? null,
      latestSessionStatus: latestSession?.status ?? null,
      lastSuccessfulRefreshAt,
      lastFailedRefreshAt,
      latestRefreshAt,
      latestError,
      cronEnabled: cronConfig.enabled,
      cronScheduler: pumpCronScheduler,
      staleAfterHours,
      checkedAt,
    };
  }

  if (!sessionFileExists) {
    return {
      status: "auth_required",
      tone: "danger",
      label: "Connexion requise",
      summary: "Aucune session persistée Airbnb n'est disponible sur le serveur.",
      recommendedAction: "Importez une session Playwright valide depuis le local avant le prochain refresh.",
      configValid,
      persistSessionEnabled: true,
      sessionFileExists: false,
      sessionFileUpdatedAt: null,
      storageStateId,
      storageStateRelativePath: relativePath,
      latestSessionId: latestSession?.sessionId ?? null,
      latestSessionStatus: latestSession?.status ?? null,
      lastSuccessfulRefreshAt,
      lastFailedRefreshAt,
      latestRefreshAt,
      latestError,
      cronEnabled: cronConfig.enabled,
      cronScheduler: pumpCronScheduler,
      staleAfterHours,
      checkedAt,
    };
  }

  if (latestSession && (latestSession.status === "failed" || latestSession.status === "stopped")) {
    const authRequired = hasAuthFailureFingerprint(latestSession.lastError);
    return {
      status: authRequired ? "auth_required" : "refresh_failed",
      tone: "danger",
      label: authRequired ? "Session expirée" : "Refresh en échec",
      summary: authRequired
        ? "La session persistée ne suffit plus pour accéder à Airbnb."
        : "Le dernier refresh Pump a échoué alors qu'une session persistée existe encore.",
      recommendedAction: authRequired
        ? "Renouvelez la session Playwright en local puis réimportez-la en production."
        : "Consultez l'erreur du dernier refresh puis relancez un test manuel.",
      configValid,
      persistSessionEnabled: true,
      sessionFileExists,
      sessionFileUpdatedAt,
      storageStateId,
      storageStateRelativePath: relativePath,
      latestSessionId: latestSession.sessionId,
      latestSessionStatus: latestSession.status,
      lastSuccessfulRefreshAt,
      lastFailedRefreshAt,
      latestRefreshAt,
      latestError,
      cronEnabled: cronConfig.enabled,
      cronScheduler: pumpCronScheduler,
      staleAfterHours,
      checkedAt,
    };
  }

  if (!latestRelevantDate || Date.now() - latestRelevantDate > staleAfterMs) {
    return {
      status: "stale",
      tone: "warning",
      label: "Connexion à surveiller",
      summary: "La session persistée existe, mais aucun refresh récent ne confirme encore son état.",
      recommendedAction: "Lancez un refresh manuel ou vérifiez l'exécution du cron Pump.",
      configValid,
      persistSessionEnabled: true,
      sessionFileExists,
      sessionFileUpdatedAt,
      storageStateId,
      storageStateRelativePath: relativePath,
      latestSessionId: latestSession?.sessionId ?? null,
      latestSessionStatus: latestSession?.status ?? null,
      lastSuccessfulRefreshAt,
      lastFailedRefreshAt,
      latestRefreshAt,
      latestError,
      cronEnabled: cronConfig.enabled,
      cronScheduler: pumpCronScheduler,
      staleAfterHours,
      checkedAt,
    };
  }

  return {
    status: "connected",
    tone: "success",
    label: "Connexion active",
    summary: "La session persistée est présente et le dernier refresh connu est récent.",
    recommendedAction: null,
    configValid,
    persistSessionEnabled: true,
    sessionFileExists,
    sessionFileUpdatedAt,
    storageStateId,
    storageStateRelativePath: relativePath,
    latestSessionId: latestSession?.sessionId ?? null,
    latestSessionStatus: latestSession?.status ?? null,
    lastSuccessfulRefreshAt,
    lastFailedRefreshAt,
    latestRefreshAt,
    latestError,
    cronEnabled: cronConfig.enabled,
    cronScheduler: pumpCronScheduler,
    staleAfterHours,
    checkedAt,
  };
};

const canSendPumpAlertEmail = () =>
  env.PUMP_ALERT_EMAIL_ENABLED &&
  Boolean(env.PUMP_ALERT_EMAIL_TO.trim()) &&
  Boolean(env.PUMP_ALERT_EMAIL_FROM.trim()) &&
  Boolean(env.SMTP_HOST.trim());

const sendPumpAlertEmail = async (subject: string, lines: string[]) => {
  if (!canSendPumpAlertEmail()) return false;

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER || env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          }
        : undefined,
  });

  await transporter.sendMail({
    from: env.PUMP_ALERT_EMAIL_FROM,
    to: env.PUMP_ALERT_EMAIL_TO,
    subject,
    text: lines.join("\n"),
  });

  return true;
};

const isProblemStatus = (status: PumpConnectionHealth["status"]) =>
  status === "auth_required" || status === "refresh_failed";

export const syncPumpHealthAlerts = async (reason: string) => {
  const health = await getPumpConnectionHealth();
  const alertState = readAlertState();

  let notifiedStatus = alertState.lastNotifiedStatus;
  let notifiedAt = alertState.lastNotifiedAt;

  if (canSendPumpAlertEmail()) {
    if (isProblemStatus(health.status) && health.status !== alertState.lastNotifiedStatus) {
      await sendPumpAlertEmail(`Pump en erreur: ${health.label}`, [
        `Raison: ${reason}`,
        `Statut: ${health.label}`,
        `Résumé: ${health.summary}`,
        `Dernière erreur: ${health.latestError ?? "Aucune erreur détaillée"}`,
        `Session: ${health.storageStateId ?? "inconnue"}`,
        `Chemin session: ${health.storageStateRelativePath ?? "indisponible"}`,
        `Action recommandée: ${health.recommendedAction ?? "Vérification manuelle"}`,
      ]);
      notifiedStatus = health.status;
      notifiedAt = new Date().toISOString();
    } else if (
      health.status === "connected" &&
      alertState.lastNotifiedStatus &&
      isProblemStatus(alertState.lastNotifiedStatus)
    ) {
      await sendPumpAlertEmail("Pump rétabli", [
        `Raison: ${reason}`,
        `Statut: ${health.label}`,
        `Résumé: ${health.summary}`,
        `Dernier refresh réussi: ${health.lastSuccessfulRefreshAt ?? "inconnu"}`,
        `Session: ${health.storageStateId ?? "inconnue"}`,
      ]);
      notifiedStatus = health.status;
      notifiedAt = new Date().toISOString();
    }
  }

  writeAlertState({
    lastObservedStatus: health.status,
    lastObservedAt: new Date().toISOString(),
    lastNotifiedStatus: notifiedStatus,
    lastNotifiedAt: notifiedAt,
  });

  return health;
};

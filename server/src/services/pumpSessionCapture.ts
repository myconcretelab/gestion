import path from "node:path";
import { env } from "../config/env.js";
import { resolveDataDir } from "../utils/paths.js";
import {
  buildDefaultPumpAutomationConfig,
  getPumpStorageStateId,
  readPumpAutomationConfig,
  validatePumpAutomationConfig,
} from "./pumpAutomationConfig.js";
import { getPumpAutomationSourceDefinition } from "./pumpSources.js";
import { PumpPlaywrightSession, checkIfLoginRequired } from "./pumpAutomationCapture.js";
import { syncPumpHealthAlerts } from "./pumpHealth.js";

type CaptureStatus =
  | "idle"
  | "starting"
  | "waiting_for_login"
  | "saving"
  | "saved"
  | "failed"
  | "cancelled"
  | "timed_out";

type CaptureRecord = {
  captureId: string;
  status: CaptureStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  message: string;
  error: string | null;
  currentUrl: string | null;
  storageStateId: string | null;
  storageStateRelativePath: string | null;
  cancelRequested: boolean;
  session: PumpPlaywrightSession | null;
};

export type PumpSessionCaptureStatus = Omit<CaptureRecord, "cancelRequested" | "session"> & {
  active: boolean;
  available: boolean;
};

const storageStatesRoot = path.join(resolveDataDir(), "pump", "storageStates");
const CAPTURE_TIMEOUT_MS = 10 * 60 * 1_000;
const ACTIVE_STATUSES = new Set<CaptureStatus>(["starting", "waiting_for_login", "saving"]);

let latestCapture: CaptureRecord | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const canRunInteractiveCapture = () => {
  if (env.NODE_ENV === "production") return false;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  return true;
};

const sanitizeRecord = (capture: CaptureRecord | null): PumpSessionCaptureStatus => {
  if (!capture) {
    return {
      captureId: "",
      status: "idle",
      startedAt: "",
      updatedAt: "",
      completedAt: null,
      message: "Aucune capture interactive en cours.",
      error: null,
      currentUrl: null,
      storageStateId: null,
      storageStateRelativePath: null,
      active: false,
      available: canRunInteractiveCapture(),
    };
  }

  return {
    captureId: capture.captureId,
    status: capture.status,
    startedAt: capture.startedAt,
    updatedAt: capture.updatedAt,
    completedAt: capture.completedAt,
    message: capture.message,
    error: capture.error,
    currentUrl: capture.currentUrl,
    storageStateId: capture.storageStateId,
    storageStateRelativePath: capture.storageStateRelativePath,
    active: ACTIVE_STATUSES.has(capture.status),
    available: canRunInteractiveCapture(),
  };
};

const updateCapture = (patch: Partial<CaptureRecord>) => {
  if (!latestCapture) return null;
  latestCapture = {
    ...latestCapture,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return latestCapture;
};

const finalizeCapture = async (status: CaptureStatus, patch: Partial<CaptureRecord> = {}) => {
  const capture = updateCapture({
    ...patch,
    status,
    completedAt: new Date().toISOString(),
  });
  if (!capture) return null;

  try {
    await capture.session?.close();
  } catch {
    // Ignore close errors in capture finalization.
  }

  capture.session = null;
  return capture;
};

const runCapture = async () => {
  const capture = latestCapture;
  if (!capture) return;

  try {
    const config = readPumpAutomationConfig(buildDefaultPumpAutomationConfig());
    const source = getPumpAutomationSourceDefinition(config.sourceType);
    const errors = validatePumpAutomationConfig(config);
    if (errors.length > 0) {
      throw new Error(`Configuration Pump invalide: ${errors.join(" ")}`);
    }
    if (!config.persistSession) {
      throw new Error("Activez d'abord la session persistée pour utiliser la capture interactive.");
    }
    if (!canRunInteractiveCapture()) {
      throw new Error("La capture interactive n'est disponible qu'en local avec un navigateur visible.");
    }

    const session = new PumpPlaywrightSession(config, storageStatesRoot);
    updateCapture({
      session,
      storageStateId: config.baseUrl && config.username ? getPumpStorageStateId(config) : null,
      message: "Ouverture du navigateur visible...",
      status: "starting",
    });

    await session.initialize({ headless: false });
    await session.navigate(config.baseUrl);
    updateCapture({
      status: "waiting_for_login",
      message: `Connectez-vous à ${source.label} dans le navigateur ouvert. La session sera sauvegardée automatiquement.`,
      currentUrl: session.getPage()?.url() ?? null,
    });

    const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!latestCapture || latestCapture.captureId !== capture.captureId) return;
      if (latestCapture.cancelRequested) {
        await finalizeCapture("cancelled", {
          message: "Capture interactive annulée.",
        });
        return;
      }

      const page = session.getPage();
      if (!page) {
        throw new Error("Le navigateur de capture a été fermé avant la sauvegarde.");
      }
      if (page.isClosed()) {
        throw new Error("Le navigateur de capture a été fermé avant la sauvegarde.");
      }

      const currentUrl = page.url();
      updateCapture({ currentUrl });

      const loginRequired = await checkIfLoginRequired(page, config).catch(() => true);
      if (!loginRequired) {
        session.isAuthenticated = true;
        updateCapture({
          status: "saving",
          message: "Connexion détectée, sauvegarde de la session persistée...",
          currentUrl,
          storageStateId: path.basename(session.storageStatePath ?? "", ".json") || null,
          storageStateRelativePath: session.storageStatePath ? path.relative(process.cwd(), session.storageStatePath) : null,
        });
        await session.saveStorageState();
        await finalizeCapture("saved", {
          message: `Session persistée ${source.label} sauvegardée. Vous pouvez maintenant l'exporter pour la production.`,
          currentUrl,
        });
        await syncPumpHealthAlerts("pump-session-capture-saved").catch(() => undefined);
        return;
      }

      await sleep(1_000);
    }

    await finalizeCapture("timed_out", {
      error: "Timeout de capture atteint.",
      message: "La capture interactive a expiré avant qu'une connexion valide soit détectée.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue pendant la capture interactive.";
    await finalizeCapture("failed", {
      error: message,
      message,
    });
  }
};

export const getPumpSessionCaptureStatus = () => sanitizeRecord(latestCapture);

export const startPumpSessionCapture = () => {
  if (!canRunInteractiveCapture()) {
    throw new Error("La capture interactive n'est disponible qu'en local avec un navigateur visible.");
  }

  if (latestCapture && ACTIVE_STATUSES.has(latestCapture.status)) {
    return sanitizeRecord(latestCapture);
  }

  latestCapture = {
    captureId: `capture_${Date.now().toString(36)}`,
    status: "starting",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    message: "Préparation de la capture interactive...",
    error: null,
    currentUrl: null,
    storageStateId: null,
    storageStateRelativePath: null,
    cancelRequested: false,
    session: null,
  };

  void runCapture();
  return sanitizeRecord(latestCapture);
};

export const cancelPumpSessionCapture = async () => {
  if (!latestCapture || !ACTIVE_STATUSES.has(latestCapture.status)) {
    return sanitizeRecord(latestCapture);
  }

  latestCapture.cancelRequested = true;
  updateCapture({
    message: "Annulation de la capture interactive...",
  });

  return sanitizeRecord(latestCapture);
};

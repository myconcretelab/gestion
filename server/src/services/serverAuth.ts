import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { env } from "../config/env.js";

const scryptAsync = promisify(crypto.scrypt);

const SETTINGS_FILE = path.join(env.DATA_DIR, "server-auth-settings.json");
const SESSIONS_FILE = path.join(env.DATA_DIR, "server-auth-sessions.json");
const SESSION_COOKIE_NAME = "contrats_session";
const DEFAULT_SESSION_DURATION_HOURS = 24 * 7;
const MIN_SESSION_DURATION_HOURS = 1;
const MAX_SESSION_DURATION_HOURS = 24 * 90;

type StoredServerAuthSettings = {
  passwordHash: string | null;
  passwordSalt: string | null;
  sessionDurationHours: number;
  passwordUpdatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type StoredServerAuthSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
};

type StoredServerAuthSessions = {
  sessions: Record<string, StoredServerAuthSession>;
};

export type ServerAuthSessionState = {
  required: boolean;
  authenticated: boolean;
  passwordConfigured: boolean;
  sessionDurationHours: number;
  sessionExpiresAt: string | null;
};

export type ServerSecuritySettingsState = {
  enabled: boolean;
  passwordConfigured: boolean;
  sessionDurationHours: number;
  sessionExpiresAt: string | null;
};

export type UpdateServerSecuritySettingsInput = {
  currentPassword?: string;
  newPassword?: string;
  sessionDurationHours: number;
};

const buildDefaultSettings = (): StoredServerAuthSettings => ({
  passwordHash: null,
  passwordSalt: null,
  sessionDurationHours: DEFAULT_SESSION_DURATION_HOURS,
  passwordUpdatedAt: null,
  createdAt: null,
  updatedAt: null,
});

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const normalizeSessionDurationHours = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_DURATION_HOURS;
  const rounded = Math.round(parsed);
  if (rounded < MIN_SESSION_DURATION_HOURS) return MIN_SESSION_DURATION_HOURS;
  if (rounded > MAX_SESSION_DURATION_HOURS) return MAX_SESSION_DURATION_HOURS;
  return rounded;
};

const normalizeSettings = (input: Partial<StoredServerAuthSettings>): StoredServerAuthSettings => {
  const defaults = buildDefaultSettings();
  const passwordHash = typeof input.passwordHash === "string" && input.passwordHash.trim() ? input.passwordHash.trim() : null;
  const passwordSalt = typeof input.passwordSalt === "string" && input.passwordSalt.trim() ? input.passwordSalt.trim() : null;

  return {
    passwordHash,
    passwordSalt,
    sessionDurationHours: normalizeSessionDurationHours(input.sessionDurationHours),
    passwordUpdatedAt: typeof input.passwordUpdatedAt === "string" && input.passwordUpdatedAt.trim() ? input.passwordUpdatedAt : null,
    createdAt: typeof input.createdAt === "string" && input.createdAt.trim() ? input.createdAt : defaults.createdAt,
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt.trim() ? input.updatedAt : defaults.updatedAt,
  };
};

const readSettingsFromDisk = (): StoredServerAuthSettings => {
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) {
    return buildDefaultSettings();
  }

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return buildDefaultSettings();
    return normalizeSettings(JSON.parse(raw) as Partial<StoredServerAuthSettings>);
  } catch {
    return buildDefaultSettings();
  }
};

const writeSettingsToDisk = (settings: StoredServerAuthSettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
};

const normalizeSession = (id: string, input: Partial<StoredServerAuthSession>): StoredServerAuthSession | null => {
  const expiresAt = typeof input.expiresAt === "string" ? input.expiresAt : "";
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : "";
  if (!id || !expiresAt || !createdAt) return null;
  if (Number.isNaN(new Date(expiresAt).getTime()) || Number.isNaN(new Date(createdAt).getTime())) {
    return null;
  }

  return {
    id,
    createdAt,
    expiresAt,
  };
};

const readSessionsFromDisk = (): StoredServerAuthSessions => {
  ensureDataDir();

  if (!fs.existsSync(SESSIONS_FILE)) {
    return { sessions: {} };
  }

  try {
    const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
    if (!raw.trim()) return { sessions: {} };
    const parsed = JSON.parse(raw) as Partial<StoredServerAuthSessions>;
    const input = parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
    const sessions = Object.fromEntries(
      Object.entries(input).flatMap(([id, value]) => {
        const normalized = value && typeof value === "object" ? normalizeSession(id, value as Partial<StoredServerAuthSession>) : null;
        return normalized ? [[id, normalized]] : [];
      })
    );
    return { sessions };
  } catch {
    return { sessions: {} };
  }
};

const writeSessionsToDisk = (data: StoredServerAuthSessions) => {
  ensureDataDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
};

const pruneExpiredSessions = (store: StoredServerAuthSessions) => {
  const now = Date.now();
  let dirty = false;
  const sessions: Record<string, StoredServerAuthSession> = {};

  Object.entries(store.sessions).forEach(([id, session]) => {
    const expiresAt = new Date(session.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      dirty = true;
      return;
    }
    sessions[id] = session;
  });

  return {
    store: { sessions },
    dirty,
  };
};

const readActiveSessions = () => {
  const parsed = readSessionsFromDisk();
  const { store, dirty } = pruneExpiredSessions(parsed);
  if (dirty) writeSessionsToDisk(store);
  return store;
};

const hasConfiguredPassword = (settings: StoredServerAuthSettings) => Boolean(settings.passwordHash && settings.passwordSalt);

const hashPassword = async (password: string, saltHex?: string) => {
  const saltBuffer = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const derived = (await scryptAsync(password, saltBuffer, 64)) as Buffer;
  return {
    passwordHash: derived.toString("hex"),
    passwordSalt: saltBuffer.toString("hex"),
  };
};

const parseCookieHeader = (cookieHeader: string | undefined) => {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .flatMap((chunk) => {
        const separatorIndex = chunk.indexOf("=");
        if (separatorIndex < 0) return [];
        const key = chunk.slice(0, separatorIndex).trim();
        const value = chunk.slice(separatorIndex + 1).trim();
        if (!key) return [];
        return [[key, decodeURIComponent(value)]];
      })
  );
};

const readFirstHeaderValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return typeof value === "string" ? value : "";
};

const requestUsesHttps = (req: Pick<Request, "headers" | "socket"> & { secure?: boolean }) => {
  if (req.secure) {
    return true;
  }

  const forwardedProto = readFirstHeaderValue(req.headers["x-forwarded-proto"])
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") {
    return true;
  }

  const forwardedHeader = readFirstHeaderValue(req.headers.forwarded);
  const forwardedMatch = forwardedHeader.match(/proto=(https)/i);
  if (forwardedMatch) {
    return true;
  }

  const forwardedSsl = readFirstHeaderValue(req.headers["x-forwarded-ssl"]).trim().toLowerCase();
  if (forwardedSsl === "on") {
    return true;
  }

  return Boolean((req.socket as { encrypted?: boolean }).encrypted);
};

const serializeSessionCookie = (value: string, maxAgeMs: number, secure: boolean) => {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
    `Expires=${new Date(Date.now() + Math.max(0, maxAgeMs)).toUTCString()}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
};

const appendSetCookieHeader = (res: Response, cookieValue: string) => {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }

  const next = Array.isArray(current) ? [...current, cookieValue] : [String(current), cookieValue];
  res.setHeader("Set-Cookie", next);
};

let initializationPromise: Promise<void> | null = null;

export const ensureServerAuthInitialized = async () => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const current = readSettingsFromDisk();
      if (hasConfiguredPassword(current)) return;

      const legacyPassword = String(env.BASIC_AUTH_PASSWORD ?? "").trim();
      if (!legacyPassword) return;

      const now = new Date().toISOString();
      const passwordData = await hashPassword(legacyPassword);
      writeSettingsToDisk({
        ...current,
        ...passwordData,
        passwordUpdatedAt: now,
        createdAt: current.createdAt ?? now,
        updatedAt: now,
      });
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
};

export const readServerAuthSettings = async () => {
  await ensureServerAuthInitialized();
  return readSettingsFromDisk();
};

export const verifyServerPassword = async (password: string) => {
  const settings = await readServerAuthSettings();
  if (!hasConfiguredPassword(settings) || !settings.passwordHash || !settings.passwordSalt) {
    return false;
  }

  try {
    const hashed = await hashPassword(password, settings.passwordSalt);
    const expected = Buffer.from(settings.passwordHash, "hex");
    const actual = Buffer.from(hashed.passwordHash, "hex");
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
};

export const getServerAuthSessionIdFromRequest = (req: Pick<Request, "headers">) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
};

export const getServerAuthSessionFromRequest = async (req: Pick<Request, "headers">) => {
  await ensureServerAuthInitialized();
  const sessionId = getServerAuthSessionIdFromRequest(req);
  if (!sessionId) return null;
  const store = readActiveSessions();
  return store.sessions[sessionId] ?? null;
};

export const createServerAuthSession = async (sessionDurationHours?: number) => {
  await ensureServerAuthInitialized();
  const settings = readSettingsFromDisk();
  const durationHours = normalizeSessionDurationHours(sessionDurationHours ?? settings.sessionDurationHours);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  const store = readActiveSessions();
  store.sessions[id] = { id, createdAt, expiresAt };
  writeSessionsToDisk(store);
  return store.sessions[id];
};

export const refreshServerAuthSession = async (sessionId: string, sessionDurationHours?: number) => {
  await ensureServerAuthInitialized();
  const store = readActiveSessions();
  const current = store.sessions[sessionId];
  if (!current) return null;

  const settings = readSettingsFromDisk();
  const durationHours = normalizeSessionDurationHours(sessionDurationHours ?? settings.sessionDurationHours);
  const next = {
    ...current,
    expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
  };
  store.sessions[sessionId] = next;
  writeSessionsToDisk(store);
  return next;
};

export const deleteServerAuthSession = async (sessionId: string | null | undefined) => {
  await ensureServerAuthInitialized();
  if (!sessionId) return;
  const store = readActiveSessions();
  if (!store.sessions[sessionId]) return;
  delete store.sessions[sessionId];
  writeSessionsToDisk(store);
};

export const deleteOtherServerAuthSessions = async (keepSessionId?: string | null) => {
  await ensureServerAuthInitialized();
  const store = readActiveSessions();
  const nextSessions = Object.fromEntries(
    Object.entries(store.sessions).filter(([id]) => keepSessionId && id === keepSessionId)
  );
  writeSessionsToDisk({ sessions: nextSessions });
};

export const clearServerAuthCookie = (req: Pick<Request, "headers" | "socket"> & { secure?: boolean }, res: Response) => {
  appendSetCookieHeader(res, serializeSessionCookie("", 0, requestUsesHttps(req)));
};

export const setServerAuthCookie = (
  req: Pick<Request, "headers" | "socket"> & { secure?: boolean },
  res: Response,
  session: StoredServerAuthSession
) => {
  const maxAgeMs = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
  appendSetCookieHeader(res, serializeSessionCookie(session.id, maxAgeMs, requestUsesHttps(req)));
};

export const buildServerAuthSessionState = async (req: Pick<Request, "headers">): Promise<ServerAuthSessionState> => {
  const settings = await readServerAuthSettings();
  const required = hasConfiguredPassword(settings);
  const session = required ? await getServerAuthSessionFromRequest(req) : null;

  return {
    required,
    authenticated: required ? Boolean(session) : true,
    passwordConfigured: required,
    sessionDurationHours: settings.sessionDurationHours,
    sessionExpiresAt: session?.expiresAt ?? null,
  };
};

export const buildServerSecuritySettingsState = async (
  req: Pick<Request, "headers">
): Promise<ServerSecuritySettingsState> => {
  const sessionState = await buildServerAuthSessionState(req);
  return {
    enabled: sessionState.required,
    passwordConfigured: sessionState.passwordConfigured,
    sessionDurationHours: sessionState.sessionDurationHours,
    sessionExpiresAt: sessionState.sessionExpiresAt,
  };
};

export const updateServerSecuritySettings = async (
  input: UpdateServerSecuritySettingsInput,
  currentSessionId?: string | null
) => {
  const settings = await readServerAuthSettings();
  const now = new Date().toISOString();
  const newPassword = String(input.newPassword ?? "").trim();
  const currentPassword = String(input.currentPassword ?? "");
  const shouldUpdatePassword = newPassword.length > 0;

  if (hasConfiguredPassword(settings) && shouldUpdatePassword) {
    if (!currentPassword) {
      throw new Error("Le mot de passe actuel est requis.");
    }

    const isValid = await verifyServerPassword(currentPassword);
    if (!isValid) {
      throw new Error("Le mot de passe actuel est invalide.");
    }
  }

  let nextSettings: StoredServerAuthSettings = {
    ...settings,
    sessionDurationHours: normalizeSessionDurationHours(input.sessionDurationHours),
    createdAt: settings.createdAt ?? now,
    updatedAt: now,
  };

  if (shouldUpdatePassword) {
    const passwordData = await hashPassword(newPassword);
    nextSettings = {
      ...nextSettings,
      ...passwordData,
      passwordUpdatedAt: now,
    };
  }

  writeSettingsToDisk(nextSettings);

  let session = currentSessionId ? await refreshServerAuthSession(currentSessionId, nextSettings.sessionDurationHours) : null;
  if (shouldUpdatePassword && hasConfiguredPassword(nextSettings)) {
    await deleteOtherServerAuthSessions(session?.id ?? currentSessionId ?? null);
    if (!session) {
      session = await createServerAuthSession(nextSettings.sessionDurationHours);
    }
  }

  return {
    settings: nextSettings,
    session,
  };
};

export const isServerAuthRequired = async () => hasConfiguredPassword(await readServerAuthSettings());

export const buildServerAuthRequiredError = () => ({
  status: 401,
  body: {
    error: "Authentification requise",
    code: "AUTH_REQUIRED",
  },
});

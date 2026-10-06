import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { APP_PAGE_IDS, ensureAppUsersInitialized, findActiveAppUser, type AppUserSummary } from "./appUsers.js";
import { getInstallationConfig } from "./installationConfig.js";

const SETTINGS_FILE = path.join(env.DATA_DIR, "server-auth-settings.json");
const SESSION_COOKIE_NAME = "contrats_session";
const DEFAULT_SESSION_DURATION_HOURS = 24 * 7;
const MIN_SESSION_DURATION_HOURS = 1;
const MAX_SESSION_DURATION_HOURS = 24 * 90;
const PASSWORD_MIN_LENGTH = 12;

type StoredServerAuthSettings = {
  passwordHash: string | null;
  passwordSalt: string | null;
  sessionDurationHours: number;
  passwordUpdatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ServerAuthSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type ServerAuthSessionState = {
  required: boolean;
  authenticated: boolean;
  passwordConfigured: boolean;
  sessionDurationHours: number;
  sessionExpiresAt: string | null;
  user: AppUserSummary | null;
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

const ensureDataDir = () => fs.mkdirSync(env.DATA_DIR, { recursive: true });
const normalizeSessionDurationHours = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_DURATION_HOURS;
  return Math.max(MIN_SESSION_DURATION_HOURS, Math.min(MAX_SESSION_DURATION_HOURS, Math.round(parsed)));
};

const readLegacySettings = (): StoredServerAuthSettings => {
  const defaults: StoredServerAuthSettings = {
    passwordHash: null,
    passwordSalt: null,
    sessionDurationHours: DEFAULT_SESSION_DURATION_HOURS,
    passwordUpdatedAt: null,
    createdAt: null,
    updatedAt: null,
  };
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) return defaults;
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<StoredServerAuthSettings>;
    return {
      ...defaults,
      ...parsed,
      passwordHash: typeof parsed.passwordHash === "string" && parsed.passwordHash ? parsed.passwordHash : null,
      passwordSalt: typeof parsed.passwordSalt === "string" && parsed.passwordSalt ? parsed.passwordSalt : null,
      sessionDurationHours: normalizeSessionDurationHours(parsed.sessionDurationHours),
    };
  } catch {
    return defaults;
  }
};

const writeSettings = (settings: StoredServerAuthSettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
    ...settings,
    passwordHash: null,
    passwordSalt: null,
  }, null, 2), { encoding: "utf8", mode: 0o600 });
};

const hashPassword = async (password: string, saltHex?: string) => {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return { passwordHash: derived.toString("hex"), passwordSalt: salt.toString("hex") };
};

const verifyHash = async (password: string, passwordHash: string, passwordSalt: string) => {
  try {
    const actual = Buffer.from((await hashPassword(password, passwordSalt)).passwordHash, "hex");
    const expected = Buffer.from(passwordHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

const normalizeLoginId = (value: string) => value.trim().toLocaleLowerCase("fr");
const baseLoginId = (value: string) => normalizeLoginId(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9@._+-]+/g, ".")
  .replace(/^\.+|\.+$/g, "") || "utilisateur";

const assignMissingLoginIds = async () => {
  const users = await prisma.appUser.findMany({ orderBy: { createdAt: "asc" } });
  const reserved = new Set(users.map((user) => user.login_id).filter(Boolean).map((value) => normalizeLoginId(String(value))));
  for (const user of users.filter((item) => !item.login_id)) {
    const base = baseLoginId(user.email || user.display_name);
    let candidate = base;
    let suffix = 2;
    while (reserved.has(candidate)) candidate = `${base}.${suffix++}`;
    reserved.add(candidate);
    await prisma.appUser.update({ where: { id: user.id }, data: { login_id: candidate } });
  }
};

const createBootstrapAdminIfNeeded = async () => {
  const loginId = normalizeLoginId(env.BOOTSTRAP_ADMIN_LOGIN);
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!loginId || password.length < PASSWORD_MIN_LENGTH) return;
  const protectedUsers = await prisma.appUser.count({ where: { password_hash: { not: null }, password_salt: { not: null } } });
  if (protectedUsers) return;
  const hash = await hashPassword(password);
  const existingOwner = await prisma.appUser.findFirst({ where: { is_owner: true, is_active: true }, orderBy: { createdAt: "asc" } });
  if (existingOwner) {
    await prisma.appUser.update({ where: { id: existingOwner.id }, data: {
      login_id: loginId,
      password_hash: hash.passwordHash,
      password_salt: hash.passwordSalt,
      password_updated_at: new Date(),
    } });
    return;
  }
  await prisma.appUser.create({
    data: {
      display_name: "Administrateur",
      first_name: "Administrateur",
      last_name: "",
      roles: JSON.stringify(["owner"]),
      status: "owner",
      page_access: JSON.stringify(APP_PAGE_IDS),
      can_write: true,
      can_view_amounts: true,
      is_owner: true,
      is_active: true,
      login_id: loginId,
      password_hash: hash.passwordHash,
      password_salt: hash.passwordSalt,
      password_updated_at: new Date(),
    },
  });
};

let initializationPromise: Promise<void> | null = null;
export const ensureServerAuthInitialized = async () => {
  initializationPromise ??= (async () => {
    await ensureAppUsersInitialized();
    await createBootstrapAdminIfNeeded();
    await assignMissingLoginIds();
    const legacy = readLegacySettings();
    const missing = await prisma.appUser.findMany({
      where: { is_active: true, password_hash: null },
      select: { id: true },
    });
    if (missing.length) {
      let passwordData: { passwordHash: string; passwordSalt: string } | null = null;
      if (legacy.passwordHash && legacy.passwordSalt) {
        passwordData = { passwordHash: legacy.passwordHash, passwordSalt: legacy.passwordSalt };
      } else if (env.BASIC_AUTH_PASSWORD) {
        passwordData = await hashPassword(env.BASIC_AUTH_PASSWORD);
      }
      if (passwordData) {
        await prisma.appUser.updateMany({
          where: { id: { in: missing.map((user) => user.id) } },
          data: {
            password_hash: passwordData.passwordHash,
            password_salt: passwordData.passwordSalt,
            password_updated_at: new Date(),
          },
        });
      }
    }
    writeSettings(legacy);
    await prisma.authSession.deleteMany({ where: { expires_at: { lte: new Date() } } });
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });
  await initializationPromise;
};

export const shouldRefuseProductionStart = (nodeEnv: string, protectedUsers: number) => nodeEnv === "production" && protectedUsers < 1;

export const assertProductionAuthConfigured = async () => {
  await ensureServerAuthInitialized();
  if (env.NODE_ENV !== "production") return;
  const protectedUsers = await prisma.appUser.count({
    where: { is_active: true, password_hash: { not: null }, password_salt: { not: null } },
  });
  if (shouldRefuseProductionStart(env.NODE_ENV, protectedUsers)) {
    const installation = await getInstallationConfig();
    if (!installation.setupComplete && env.SETUP_TOKEN.length >= 24) return;
    throw new Error("Démarrage refusé: aucun compte protégé. Configurez SETUP_TOKEN pour l'assistant initial, ou BOOTSTRAP_ADMIN_LOGIN et BOOTSTRAP_ADMIN_PASSWORD (12 caractères minimum).");
  }
};

export const createFirstAdministrator = async (input: {
  loginId: string;
  password: string;
  displayName: string;
  email?: string;
}) => {
  const existingProtectedUsers = await prisma.appUser.count({
    where: { password_hash: { not: null }, password_salt: { not: null } },
  });
  if (existingProtectedUsers > 0) {
    throw Object.assign(new Error("Le premier administrateur existe déjà."), { status: 409, code: "SETUP_ALREADY_COMPLETED" });
  }
  const loginId = normalizeLoginId(input.loginId);
  if (!loginId || loginId.length > 180) throw Object.assign(new Error("Identifiant invalide."), { status: 400 });
  if (input.password.length < PASSWORD_MIN_LENGTH) throw Object.assign(new Error("Le mot de passe doit contenir au moins 12 caractères."), { status: 400 });
  const displayName = input.displayName.trim();
  if (!displayName) throw Object.assign(new Error("Le nom de l'administrateur est requis."), { status: 400 });
  const hash = await hashPassword(input.password);
  const existingOwner = await prisma.appUser.findFirst({ where: { is_owner: true }, orderBy: { createdAt: "asc" } });
  const data = {
    display_name: displayName,
    first_name: displayName,
    last_name: "",
    email: input.email?.trim() || null,
    roles: JSON.stringify(["owner"]),
    status: "owner",
    page_access: JSON.stringify(APP_PAGE_IDS),
    can_write: true,
    can_view_amounts: true,
    is_owner: true,
    is_active: true,
    login_id: loginId,
    password_hash: hash.passwordHash,
    password_salt: hash.passwordSalt,
    password_updated_at: new Date(),
  };
  try {
    return existingOwner
      ? await prisma.appUser.update({ where: { id: existingOwner.id }, data })
      : await prisma.appUser.create({ data });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw Object.assign(new Error("Cet identifiant est déjà utilisé."), { status: 409 });
    throw error;
  }
};

export const readServerAuthSettings = async () => {
  await ensureServerAuthInitialized();
  return readLegacySettings();
};

export const verifyServerPassword = async (password: string, userId?: string) => {
  await ensureServerAuthInitialized();
  if (!userId) return false;
  const user = await prisma.appUser.findFirst({
    where: { id: userId, is_active: true },
    select: { password_hash: true, password_salt: true },
  });
  return Boolean(user?.password_hash && user.password_salt && await verifyHash(password, user.password_hash, user.password_salt));
};

export const findUserForLogin = async (loginId: string) => {
  await ensureServerAuthInitialized();
  const user = await prisma.appUser.findFirst({ where: { login_id: normalizeLoginId(loginId), is_active: true } });
  return user ? findActiveAppUser(user.id) : null;
};

const parseCookies = (header: string | undefined) => Object.fromEntries(String(header ?? "").split(";").map((part) => part.trim()).filter(Boolean).flatMap((part) => {
  const separator = part.indexOf("=");
  return separator > 0 ? [[part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]] : [];
}));
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const getServerAuthSessionIdFromRequest = (req: Pick<Request, "headers">) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  return typeof token === "string" && token ? token : null;
};

export const getServerAuthSessionFromRequest = async (req: Pick<Request, "headers">): Promise<ServerAuthSession | null> => {
  await ensureServerAuthInitialized();
  const token = getServerAuthSessionIdFromRequest(req);
  if (!token) return null;
  const row = await prisma.authSession.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!row || row.revoked_at || row.expires_at <= new Date() || !row.user.is_active || row.auth_version !== row.user.auth_version) return null;
  await prisma.authSession.update({ where: { id: row.id }, data: { last_seen_at: new Date() } });
  return { id: token, userId: row.user_id, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() };
};

export const createServerAuthSession = async (userId: string, sessionDurationHours?: number): Promise<ServerAuthSession> => {
  await ensureServerAuthInitialized();
  const settings = readLegacySettings();
  const user = await prisma.appUser.findUniqueOrThrow({ where: { id: userId }, select: { auth_version: true } });
  const token = crypto.randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(Date.now() + normalizeSessionDurationHours(sessionDurationHours ?? settings.sessionDurationHours) * 3_600_000);
  await prisma.authSession.create({ data: { id: hashToken(token), user_id: userId, auth_version: user.auth_version, created_at: createdAt, expires_at: expiresAt } });
  return { id: token, userId, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() };
};

export const refreshServerAuthSession = async (token: string, sessionDurationHours?: number) => {
  const id = hashToken(token);
  const row = await prisma.authSession.findUnique({ where: { id } });
  if (!row || row.revoked_at) return null;
  const expiresAt = new Date(Date.now() + normalizeSessionDurationHours(sessionDurationHours ?? readLegacySettings().sessionDurationHours) * 3_600_000);
  await prisma.authSession.update({ where: { id }, data: { expires_at: expiresAt, last_seen_at: new Date() } });
  return { id: token, userId: row.user_id, createdAt: row.created_at.toISOString(), expiresAt: expiresAt.toISOString() };
};

export const deleteServerAuthSession = async (token: string | null | undefined) => {
  if (!token) return;
  await prisma.authSession.updateMany({ where: { id: hashToken(token), revoked_at: null }, data: { revoked_at: new Date() } });
};

export const revokeUserSessions = async (userId: string, keepToken?: string | null) => {
  await prisma.authSession.updateMany({
    where: { user_id: userId, revoked_at: null, ...(keepToken ? { id: { not: hashToken(keepToken) } } : {}) },
    data: { revoked_at: new Date() },
  });
};

export const deleteOtherServerAuthSessions = async (keepToken?: string | null) => {
  if (!keepToken) return;
  const current = await prisma.authSession.findUnique({ where: { id: hashToken(keepToken) } });
  if (current) await revokeUserSessions(current.user_id, keepToken);
};

const requestUsesHttps = (req: Pick<Request, "headers" | "socket"> & { secure?: boolean }) => Boolean(
  req.secure || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() === "https" || (req.socket as { encrypted?: boolean }).encrypted,
);
const appendCookie = (res: Response, value: string) => {
  const current = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", current ? [...(Array.isArray(current) ? current : [String(current)]), value] : value);
};
const serializeCookie = (value: string, maxAgeMs: number, secure: boolean) => [
  `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax",
  `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  `Expires=${new Date(Date.now() + Math.max(0, maxAgeMs)).toUTCString()}`,
  ...(secure ? ["Secure"] : []),
].join("; ");

export const clearServerAuthCookie = (req: Pick<Request, "headers" | "socket"> & { secure?: boolean }, res: Response) => appendCookie(res, serializeCookie("", 0, requestUsesHttps(req)));
export const setServerAuthCookie = (req: Pick<Request, "headers" | "socket"> & { secure?: boolean }, res: Response, session: ServerAuthSession) => appendCookie(res, serializeCookie(session.id, new Date(session.expiresAt).getTime() - Date.now(), requestUsesHttps(req)));

export const isServerAuthRequired = async () => {
  await ensureServerAuthInitialized();
  return (await prisma.appUser.count({ where: { is_active: true, password_hash: { not: null }, password_salt: { not: null } } })) > 0;
};

export const getAuthenticatedAppUser = async (req: Pick<Request, "headers">) => {
  const session = await getServerAuthSessionFromRequest(req);
  return session ? findActiveAppUser(session.userId) : null;
};

export const buildServerAuthSessionState = async (req: Pick<Request, "headers">): Promise<ServerAuthSessionState> => {
  const required = await isServerAuthRequired();
  const session = required ? await getServerAuthSessionFromRequest(req) : null;
  const user = session ? await findActiveAppUser(session.userId) : null;
  return {
    required,
    authenticated: Boolean(session && user),
    passwordConfigured: required,
    sessionDurationHours: readLegacySettings().sessionDurationHours,
    sessionExpiresAt: session?.expiresAt ?? null,
    user,
  };
};

export const buildServerSecuritySettingsState = async (req: Pick<Request, "headers">): Promise<ServerSecuritySettingsState> => {
  const state = await buildServerAuthSessionState(req);
  return { enabled: state.required, passwordConfigured: Boolean(state.user), sessionDurationHours: state.sessionDurationHours, sessionExpiresAt: state.sessionExpiresAt };
};

export const updateServerSecuritySettings = async (input: UpdateServerSecuritySettingsInput, currentToken?: string | null) => {
  const session = currentToken ? await getServerAuthSessionFromRequest({ headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(currentToken)}` } }) : null;
  if (!session) throw Object.assign(new Error("Authentification requise."), { status: 401, code: "AUTH_REQUIRED" });
  const newPassword = String(input.newPassword ?? "");
  if (newPassword) {
    if (newPassword.length < PASSWORD_MIN_LENGTH) throw Object.assign(new Error("Le mot de passe doit contenir au moins 12 caractères."), { status: 400 });
    if (!(await verifyServerPassword(String(input.currentPassword ?? ""), session.userId))) throw Object.assign(new Error("Le mot de passe actuel est invalide."), { status: 400 });
    const hash = await hashPassword(newPassword);
    await prisma.appUser.update({ where: { id: session.userId }, data: {
      password_hash: hash.passwordHash,
      password_salt: hash.passwordSalt,
      password_updated_at: new Date(),
      auth_version: { increment: 1 },
    } });
    await prisma.authSession.update({ where: { id: hashToken(currentToken!) }, data: { auth_version: { increment: 1 } } });
    await revokeUserSessions(session.userId, currentToken);
  }
  const oldSettings = readLegacySettings();
  const settings = { ...oldSettings, sessionDurationHours: normalizeSessionDurationHours(input.sessionDurationHours), updatedAt: new Date().toISOString() };
  writeSettings(settings);
  const refreshed = await refreshServerAuthSession(currentToken!, settings.sessionDurationHours);
  return { settings, session: refreshed };
};

export const buildServerAuthRequiredError = () => ({ status: 401, body: { error: "Authentification requise", code: "AUTH_REQUIRED" } });

export const updateUserCredentials = async (userId: string, input: { loginId: string; password?: string }) => {
  await ensureServerAuthInitialized();
  const loginId = normalizeLoginId(input.loginId);
  if (!loginId || loginId.length > 180) throw Object.assign(new Error("Identifiant de connexion invalide."), { status: 400 });
  const data: Record<string, unknown> = { login_id: loginId };
  if (input.password !== undefined) {
    if (input.password.length < PASSWORD_MIN_LENGTH) throw Object.assign(new Error("Le mot de passe doit contenir au moins 12 caractères."), { status: 400 });
    const hash = await hashPassword(input.password);
    Object.assign(data, {
      password_hash: hash.passwordHash,
      password_salt: hash.passwordSalt,
      password_updated_at: new Date(),
      auth_version: { increment: 1 },
    });
  }
  try {
    await prisma.appUser.update({ where: { id: userId }, data });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw Object.assign(new Error("Cet identifiant de connexion est déjà utilisé."), { status: 409 });
    throw error;
  }
  if (input.password !== undefined) await revokeUserSessions(userId);
  return findActiveAppUser(userId);
};

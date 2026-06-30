import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";

const CLIENT_COOKIE_NAME = "contrats_abuse_client";
const CLIENT_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const SECRET_FILE = path.join(env.DATA_DIR, "request-throttle-secret");

export type RequestThrottleConfig = {
  scope: string;
  threshold: number;
  globalThreshold: number;
  windowMs: number;
  blockMs: number;
};

export const LOGIN_THROTTLE_CONFIG: RequestThrottleConfig = {
  scope: "login",
  threshold: 5,
  globalThreshold: 50,
  windowMs: 15 * 60 * 1000,
  blockMs: 60 * 60 * 1000,
};

export const PLANNING_RELAY_THROTTLE_CONFIG: RequestThrottleConfig = {
  scope: "planning-relay",
  threshold: 10,
  globalThreshold: 100,
  windowMs: 15 * 60 * 1000,
  blockMs: 60 * 60 * 1000,
};

const readOrCreateSecret = () => {
  if (env.SECURITY_THROTTLE_SECRET.trim()) return env.SECURITY_THROTTLE_SECRET.trim();
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    const stored = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (stored) return stored;
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
};

let cachedSecret: string | null = null;
const requestClientIds = new WeakMap<Request, string>();
const getSecret = () => {
  cachedSecret ??= readOrCreateSecret();
  return cachedSecret;
};

const parseCookies = (header: string | undefined) => Object.fromEntries(
  String(header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return [];
      return [[part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]];
    }),
);

const appendCookie = (req: Request, res: Response, clientId: string) => {
  const parts = [
    `${CLIENT_COOKIE_NAME}=${encodeURIComponent(clientId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${CLIENT_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (req.secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const cookies = Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : [];
  res.setHeader("Set-Cookie", [...cookies, parts.join("; ")]);
};

const getClientId = (req: Request, res: Response) => {
  const cached = requestClientIds.get(req);
  if (cached) return cached;
  const stored = parseCookies(req.headers.cookie)[CLIENT_COOKIE_NAME];
  const clientId = typeof stored === "string" && /^[a-f0-9]{32}$/.test(stored)
    ? stored
    : crypto.randomBytes(16).toString("hex");
  requestClientIds.set(req, clientId);
  if (clientId !== stored) appendCookie(req, res, clientId);
  return clientId;
};

const hashKey = (scope: string, type: string, value: string) =>
  crypto.createHmac("sha256", getSecret()).update(`${scope}:${type}:${value}`).digest("hex");

const getThrottleKeys = (req: Request, res: Response, config: RequestThrottleConfig) => ({
  clientKeys: [
    hashKey(config.scope, "ip", req.ip || req.socket.remoteAddress || "unknown"),
    hashKey(config.scope, "client", getClientId(req, res)),
  ],
  globalKey: hashKey(config.scope, "global", "all"),
});

export type ThrottleState = {
  blocked: boolean;
  retryAfterSeconds: number;
};

export const checkRequestThrottle = async (
  req: Request,
  res: Response,
  config: RequestThrottleConfig,
): Promise<ThrottleState> => {
  const { clientKeys, globalKey } = getThrottleKeys(req, res, config);
  const rows = await prisma.securityThrottle.findMany({
    where: { key: { in: [...clientKeys, globalKey] } },
    select: { blocked_until: true },
  });
  const now = Date.now();
  const blockedUntil = Math.max(
    0,
    ...rows.map((row) => row.blocked_until?.getTime() ?? 0).filter((value) => value > now),
  );
  return {
    blocked: blockedUntil > now,
    retryAfterSeconds: blockedUntil > now ? Math.max(1, Math.ceil((blockedUntil - now) / 1000)) : 0,
  };
};

const recordKeyFailure = async (
  key: string,
  config: RequestThrottleConfig,
  threshold: number,
  now: Date,
) => {
  const current = await prisma.securityThrottle.findUnique({ where: { key } });
  const windowExpired = !current || now.getTime() - current.window_started_at.getTime() >= config.windowMs;
  const previousCount = windowExpired ? 0 : current.failure_count;
  const failureCount = previousCount + 1;
  const blockedUntil = failureCount >= threshold ? new Date(now.getTime() + config.blockMs) : null;
  return prisma.securityThrottle.upsert({
    where: { key },
    create: {
      key,
      scope: config.scope,
      failure_count: failureCount,
      window_started_at: now,
      blocked_until: blockedUntil,
    },
    update: {
      scope: config.scope,
      failure_count: failureCount,
      window_started_at: windowExpired ? now : current!.window_started_at,
      blocked_until: blockedUntil,
    },
  });
};

export const recordRequestThrottleFailure = async (
  req: Request,
  res: Response,
  config: RequestThrottleConfig,
): Promise<ThrottleState> => {
  const { clientKeys, globalKey } = getThrottleKeys(req, res, config);
  const now = new Date();
  const rows = [];
  for (const key of clientKeys) rows.push(await recordKeyFailure(key, config, config.threshold, now));
  rows.push(await recordKeyFailure(globalKey, config, config.globalThreshold, now));
  const blockedUntil = Math.max(0, ...rows.map((row) => row.blocked_until?.getTime() ?? 0));
  return {
    blocked: blockedUntil > now.getTime(),
    retryAfterSeconds: blockedUntil > now.getTime()
      ? Math.max(1, Math.ceil((blockedUntil - now.getTime()) / 1000))
      : 0,
  };
};

export const clearRequestThrottleFailures = async (
  req: Request,
  res: Response,
  config: RequestThrottleConfig,
) => {
  const { clientKeys } = getThrottleKeys(req, res, config);
  await prisma.securityThrottle.deleteMany({ where: { key: { in: clientKeys } } });
};

export const sendThrottleResponse = (res: Response, state: ThrottleState) => {
  res.setHeader("Retry-After", String(state.retryAfterSeconds));
  return res.status(429).json({
    error: "Trop de tentatives. Réessayez plus tard.",
    code: "RATE_LIMITED",
    retry_after_seconds: state.retryAfterSeconds,
  });
};

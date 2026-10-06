import crypto from "node:crypto";
import type { Request } from "express";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { parseBearerToken } from "../utils/cronTriggerAuth.js";

export type ApiTokenScope = "reservations:write" | "cron:run";
export const API_TOKEN_SCOPES = ["reservations:write", "cron:run"] as const;
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
let bootstrapPromise: Promise<void> | null = null;

export const ensureLegacyIntegrationTokenMigrated = async () => {
  bootstrapPromise ??= (async () => {
    const token = env.INTEGRATION_API_TOKEN.trim();
    if (!token) return;
    await prisma.apiToken.upsert({
      where: { token_hash: hashToken(token) },
      update: {},
      create: {
        name: "Jeton d'intégration migré",
        token_hash: hashToken(token),
        scopes: JSON.stringify(["reservations:write"] satisfies ApiTokenScope[]),
      },
    });
  })().catch((error) => {
    bootstrapPromise = null;
    throw error;
  });
  await bootstrapPromise;
};

export const verifyScopedApiToken = async (req: Pick<Request, "headers">, requiredScope: ApiTokenScope) => {
  await ensureLegacyIntegrationTokenMigrated();
  const rawToken = parseBearerToken(req.headers.authorization);
  if (!rawToken) return false;
  const now = new Date();
  const token = await prisma.apiToken.findUnique({ where: { token_hash: hashToken(rawToken) } });
  if (!token || token.revoked_at || (token.expires_at && token.expires_at <= now)) return false;
  if (!fromJsonString<string[]>(token.scopes, []).includes(requiredScope)) return false;
  await prisma.apiToken.update({ where: { id: token.id }, data: { last_used_at: now } });
  return true;
};

const serializeApiToken = (token: {
  id: string; name: string; scopes: string; expires_at: Date | null; revoked_at: Date | null;
  last_used_at: Date | null; createdAt: Date;
}) => ({
  id: token.id,
  name: token.name,
  scopes: fromJsonString<ApiTokenScope[]>(token.scopes, []).filter((scope) => API_TOKEN_SCOPES.includes(scope)),
  expiresAt: token.expires_at?.toISOString() ?? null,
  revokedAt: token.revoked_at?.toISOString() ?? null,
  lastUsedAt: token.last_used_at?.toISOString() ?? null,
  createdAt: token.createdAt.toISOString(),
});

export const listApiTokens = async () => {
  await ensureLegacyIntegrationTokenMigrated();
  return (await prisma.apiToken.findMany({ orderBy: { createdAt: "desc" } })).map(serializeApiToken);
};

export const createApiToken = async (input: { name: string; scopes: ApiTokenScope[]; expiresAt?: Date | null }) => {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const token = await prisma.apiToken.create({ data: {
    name: input.name.trim(),
    token_hash: hashToken(rawToken),
    scopes: JSON.stringify([...new Set(input.scopes)]),
    expires_at: input.expiresAt ?? null,
  } });
  return { ...serializeApiToken(token), token: rawToken };
};

export const revokeApiToken = async (id: string) => {
  const result = await prisma.apiToken.updateMany({ where: { id, revoked_at: null }, data: { revoked_at: new Date() } });
  return result.count > 0;
};

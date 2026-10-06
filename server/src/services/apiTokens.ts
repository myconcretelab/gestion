import crypto from "node:crypto";
import type { Request } from "express";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { parseBearerToken } from "../utils/cronTriggerAuth.js";

export type ApiTokenScope = "reservations:write" | "cron:run";
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

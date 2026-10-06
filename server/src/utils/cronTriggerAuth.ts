import type { Request } from "express";
import { env } from "../config/env.js";

export const parseBearerToken = (authorizationHeader: string | undefined) => {
  const [type, token] = String(authorizationHeader ?? "").split(" ");
  if (type !== "Bearer" || !token) return null;
  return token.trim();
};

export const getCronTriggerToken = () => {
  const explicit = String(env.CRON_TRIGGER_TOKEN ?? "").trim();
  if (explicit) return explicit;
  const integration = String(env.INTEGRATION_API_TOKEN ?? "").trim();
  return integration || null;
};

export const hasValidCronTriggerToken = (req: Pick<Request, "headers">) => {
  const expected = getCronTriggerToken();
  if (!expected) return false;

  const bearerToken = parseBearerToken(req.headers.authorization);
  return Boolean(bearerToken && bearerToken === expected);
};

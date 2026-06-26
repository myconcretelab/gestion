import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../utils/paths.js";

type PumpAuthCooldownRecord = {
  reason: "airbnb_rate_limit";
  sourceLabel: string;
  message: string;
  observedAt: string;
  blockedUntil: string;
};

const pumpRoot = path.join(resolveDataDir(), "pump");
const cooldownPath = path.join(pumpRoot, "auth-cooldown.json");
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const RATE_LIMIT_BUFFER_MS = 30 * 60 * 1_000;

const ensurePumpRoot = () => {
  fs.mkdirSync(pumpRoot, { recursive: true });
};

const parseDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseAirbnbRetryDelayMs = (message: string) => {
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .toLowerCase();
  const hourMatch = normalized.match(/(\d+)\s*(?:h|heure|heures|hour|hours)\b/);
  if (hourMatch) return Number(hourMatch[1]) * 60 * 60 * 1_000;

  const minuteMatch = normalized.match(/(\d+)\s*(?:min|minute|minutes)\b/);
  if (minuteMatch) return Number(minuteMatch[1]) * 60 * 1_000;

  return null;
};

export class PumpAuthRateLimitError extends Error {
  readonly sourceLabel: string;
  readonly rateLimitMessage: string;

  constructor(sourceLabel: string, rateLimitMessage: string) {
    super(
      `${sourceLabel} bloque temporairement le renouvellement: ${rateLimitMessage} Toutes les automatisations ${sourceLabel} sont mises en pause pour éviter de prolonger le blocage.`
    );
    this.name = "PumpAuthRateLimitError";
    this.sourceLabel = sourceLabel;
    this.rateLimitMessage = rateLimitMessage;
  }
}

export const readPumpAuthCooldown = (): PumpAuthCooldownRecord | null => {
  ensurePumpRoot();
  if (!fs.existsSync(cooldownPath)) return null;

  try {
    const raw = fs.readFileSync(cooldownPath, "utf-8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as PumpAuthCooldownRecord;
    if (!parsed.blockedUntil || !parsed.message || !parsed.sourceLabel) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const getActivePumpAuthCooldown = (now = new Date()) => {
  const cooldown = readPumpAuthCooldown();
  const blockedUntil = parseDate(cooldown?.blockedUntil);
  if (!cooldown || !blockedUntil) return null;

  if (blockedUntil.getTime() <= now.getTime()) {
    fs.rmSync(cooldownPath, { force: true });
    return null;
  }

  return cooldown;
};

export const assertNoActivePumpAuthCooldown = (sourceLabel: string) => {
  const cooldown = getActivePumpAuthCooldown();
  if (!cooldown) return;

  throw new Error(
    `${sourceLabel} est temporairement en pause jusqu'à ${cooldown.blockedUntil}: ${cooldown.message} Aucune tentative automatique n'est lancée pendant ce délai.`
  );
};

export const registerPumpAuthRateLimit = (sourceLabel: string, rateLimitMessage: string) => {
  ensurePumpRoot();

  const now = new Date();
  const retryDelayMs = parseAirbnbRetryDelayMs(rateLimitMessage);
  const cooldownMs = Math.max(DEFAULT_RATE_LIMIT_COOLDOWN_MS, (retryDelayMs ?? 0) + RATE_LIMIT_BUFFER_MS);
  const proposedBlockedUntil = new Date(now.getTime() + cooldownMs);
  const current = getActivePumpAuthCooldown(now);
  const currentBlockedUntil = parseDate(current?.blockedUntil);
  const blockedUntil =
    currentBlockedUntil && currentBlockedUntil.getTime() > proposedBlockedUntil.getTime()
      ? currentBlockedUntil
      : proposedBlockedUntil;

  const next: PumpAuthCooldownRecord = {
    reason: "airbnb_rate_limit",
    sourceLabel,
    message: rateLimitMessage,
    observedAt: now.toISOString(),
    blockedUntil: blockedUntil.toISOString(),
  };

  fs.writeFileSync(cooldownPath, JSON.stringify(next, null, 2), "utf-8");
  return next;
};

export const clearPumpAuthCooldown = () => {
  fs.rmSync(cooldownPath, { force: true });
};

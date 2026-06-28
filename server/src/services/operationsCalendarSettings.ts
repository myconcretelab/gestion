import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

type OperationsCalendarSettings = {
  token: string;
};

const SETTINGS_FILE = path.join(env.DATA_DIR, "operations-calendar-settings.json");

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const generateToken = () => crypto.randomBytes(32).toString("hex");

const writeSettings = (settings: OperationsCalendarSettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  return settings;
};

export const getOperationsCalendarSettings = (): OperationsCalendarSettings => {
  ensureDataDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<OperationsCalendarSettings>;
    if (typeof parsed.token === "string" && parsed.token.trim().length >= 32) {
      return { token: parsed.token.trim() };
    }
  } catch {
    // The feed is initialized lazily on first use.
  }

  return writeSettings({ token: generateToken() });
};

export const resetOperationsCalendarToken = () => writeSettings({ token: generateToken() });

export const hasValidOperationsCalendarToken = (token: string) => {
  const expected = getOperationsCalendarSettings().token;
  const receivedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
};

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type TodayStatus = {
  done: boolean;
  user: string;
};

export type TodayStatuses = Record<string, TodayStatus>;

const STATUSES_FILE = path.join(env.DATA_DIR, "today-statuses.json");

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const normalizeStatus = (value: unknown): TodayStatus | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const done = typeof (value as TodayStatus).done === "boolean" ? (value as TodayStatus).done : null;
  const rawUser = typeof (value as TodayStatus).user === "string" ? (value as TodayStatus).user : "";
  const user = rawUser.trim().slice(0, 80);

  if (done === null) return null;

  return {
    done,
    user,
  };
};

const normalizeStatuses = (value: unknown): TodayStatuses => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key.trim(), normalizeStatus(item)] as const)
    .filter(([key, item]) => key.length > 0 && item);

  return Object.fromEntries(entries) as TodayStatuses;
};

export const readTodayStatuses = (): TodayStatuses => {
  ensureDataDir();
  if (!fs.existsSync(STATUSES_FILE)) return {};

  try {
    const raw = fs.readFileSync(STATUSES_FILE, "utf-8");
    if (!raw.trim()) return {};
    return normalizeStatuses(JSON.parse(raw));
  } catch {
    return {};
  }
};

export const writeTodayStatuses = (statuses: TodayStatuses) => {
  ensureDataDir();
  fs.writeFileSync(STATUSES_FILE, JSON.stringify(normalizeStatuses(statuses), null, 2), "utf-8");
};

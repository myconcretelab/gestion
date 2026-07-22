import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import {
  normalizePlanningRelayProgrammeTemplates,
  type PlanningRelaySmsProgrammeTemplate,
} from "./planningRelaySms.js";

const SETTINGS_FILE = path.join(env.DATA_DIR, "planning-relay-programme-templates.json");

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) fs.mkdirSync(env.DATA_DIR, { recursive: true });
};

export const readPlanningRelayProgrammeTemplates = (): PlanningRelaySmsProgrammeTemplate[] | null => {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as { programme_templates?: unknown };
    return normalizePlanningRelayProgrammeTemplates(parsed.programme_templates);
  } catch {
    return null;
  }
};

export const writePlanningRelayProgrammeTemplates = (templates: PlanningRelaySmsProgrammeTemplate[]) => {
  ensureDataDir();
  const normalized = normalizePlanningRelayProgrammeTemplates(templates);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ programme_templates: normalized }, null, 2), "utf-8");
  return normalized;
};

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type SmartlifeRegion =
  | "eu"
  | "eu-west"
  | "us"
  | "us-e"
  | "in"
  | "cn";

export type SmartlifeAutomationRuleAction =
  | "device-on"
  | "device-off"
  | "energy-start"
  | "energy-stop";

export type SmartlifeEnergyDeviceRole = "primary" | "informational";

export type SmartlifeAutomationRule = {
  id: string;
  enabled: boolean;
  label: string;
  gite_ids: string[];
  trigger:
    | "before-arrival"
    | "after-arrival"
    | "before-departure"
    | "after-departure";
  offset_minutes: number;
  action: SmartlifeAutomationRuleAction;
  device_id: string;
  device_name: string;
  command_code: string;
  command_label: string | null;
  command_value: boolean;
};

export type SmartlifeEnergyDeviceAssignment = {
  id: string;
  enabled: boolean;
  gite_id: string;
  device_id: string;
  device_name: string;
  role: SmartlifeEnergyDeviceRole;
};

export type SmartlifeAutomationConfig = {
  enabled: boolean;
  region: SmartlifeRegion;
  access_id: string;
  access_secret: string;
  rules: SmartlifeAutomationRule[];
  energy_devices: SmartlifeEnergyDeviceAssignment[];
};

type LegacySmartlifeAutomationRule = Partial<
  SmartlifeAutomationRule & {
    action: SmartlifeAutomationRuleAction | "energy-start" | "energy-stop";
  }
>;

type LegacySmartlifeMeterAssignment = Partial<
  Omit<SmartlifeEnergyDeviceAssignment, "role"> & {
    role?: SmartlifeEnergyDeviceRole;
  }
>;

const SETTINGS_FILE = path.join(
  env.DATA_DIR,
  "smartlife-automation-settings.json",
);

const MAX_OFFSET_MINUTES = 14 * 24 * 60;

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const hasOwn = <T extends object>(value: T, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
};

const normalizeRegion = (
  value: unknown,
  fallback: SmartlifeRegion,
): SmartlifeRegion => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "eu") return "eu";
  if (normalized === "eu-west") return "eu-west";
  if (normalized === "us") return "us";
  if (normalized === "us-e") return "us-e";
  if (normalized === "in") return "in";
  if (normalized === "cn") return "cn";
  return fallback;
};

const normalizeStringList = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const items: string[] = [];
  for (const rawItem of value) {
    const item = normalizeString(rawItem);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
};

const normalizeRuleAction = (
  value: unknown,
  fallback: SmartlifeAutomationRuleAction,
): SmartlifeAutomationRuleAction => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "device-off") return "device-off";
  return normalized === "device-on" ? "device-on" : fallback;
};

const isLegacyEnergyTrackingAction = (value: unknown) => {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === "energy-start" || normalized === "energy-stop";
};

const normalizeEnergyDeviceRole = (
  value: unknown,
  fallback: SmartlifeEnergyDeviceRole,
): SmartlifeEnergyDeviceRole =>
  normalizeString(value).toLowerCase() === "primary"
    ? "primary"
    : fallback;

export const isSmartlifeDeviceCommandAction = (
  action: SmartlifeAutomationRuleAction,
) => action === "device-on" || action === "device-off";

export const getSmartlifeRuleCommandValue = (
  action: SmartlifeAutomationRuleAction,
) => action === "device-on" || action === "energy-start";

const normalizeRule = (
  value: unknown,
  fallback?: SmartlifeAutomationRule,
): SmartlifeAutomationRule | null => {
  if (!value || typeof value !== "object") return fallback ?? null;

  const rule = value as LegacySmartlifeAutomationRule;
  if (isLegacyEnergyTrackingAction(rule.action)) {
    return null;
  }

  const trigger =
    rule.trigger === "after-arrival"
      ? "after-arrival"
      : rule.trigger === "before-departure"
        ? "before-departure"
        : rule.trigger === "after-departure"
          ? "after-departure"
          : "before-arrival";

  const giteIds = normalizeStringList(rule.gite_ids, fallback?.gite_ids ?? []);
  const fallbackAction =
    fallback?.action ??
    (normalizeBoolean(rule.command_value, fallback?.command_value ?? true)
      ? "device-on"
      : "device-off");
  const action = normalizeRuleAction(rule.action, fallbackAction);
  const commandValue = getSmartlifeRuleCommandValue(action);
  const commandCode =
    normalizeString(rule.command_code) || fallback?.command_code || "";
  const commandLabel =
    normalizeNullableString(rule.command_label) ?? fallback?.command_label ?? null;

  return {
    id: normalizeString(rule.id) || fallback?.id || crypto.randomUUID(),
    enabled: normalizeBoolean(rule.enabled, fallback?.enabled ?? true),
    label:
      normalizeString(rule.label) ||
      fallback?.label ||
      "Nouvelle automatisation",
    gite_ids: giteIds,
    trigger,
    offset_minutes: normalizeInteger(
      rule.offset_minutes,
      fallback?.offset_minutes ?? 60,
      0,
      MAX_OFFSET_MINUTES,
    ),
    action,
    device_id: normalizeString(rule.device_id) || fallback?.device_id || "",
    device_name:
      normalizeString(rule.device_name) || fallback?.device_name || "",
    command_code: commandCode,
    command_label: commandLabel,
    command_value: commandValue,
  };
};

const normalizeLegacyMeterAssignment = (
  value: unknown,
  fallback?: LegacySmartlifeMeterAssignment,
): Omit<SmartlifeEnergyDeviceAssignment, "role"> | null => {
  if (!value || typeof value !== "object") return fallback ? {
    id: normalizeString(fallback.id) || crypto.randomUUID(),
    enabled: normalizeBoolean(fallback.enabled, true),
    gite_id: normalizeString(fallback.gite_id),
    device_id: normalizeString(fallback.device_id),
    device_name: normalizeString(fallback.device_name) || normalizeString(fallback.device_id),
  } : null;

  const assignment = value as LegacySmartlifeMeterAssignment;
  const giteId = normalizeString(assignment.gite_id) || normalizeString(fallback?.gite_id);
  const deviceId =
    normalizeString(assignment.device_id) || normalizeString(fallback?.device_id);
  if (!giteId || !deviceId) return null;

  return {
    id: normalizeString(assignment.id) || normalizeString(fallback?.id) || crypto.randomUUID(),
    enabled: normalizeBoolean(assignment.enabled, normalizeBoolean(fallback?.enabled, true)),
    gite_id: giteId,
    device_id: deviceId,
    device_name:
      normalizeString(assignment.device_name) ||
      normalizeString(fallback?.device_name) ||
      deviceId,
  };
};

const normalizeEnergyDeviceAssignment = (
  value: unknown,
  fallback?: SmartlifeEnergyDeviceAssignment,
): SmartlifeEnergyDeviceAssignment | null => {
  const normalized =
    normalizeLegacyMeterAssignment(value, fallback) ?? null;
  if (!normalized) return null;

  const source =
    value && typeof value === "object"
      ? (value as Partial<SmartlifeEnergyDeviceAssignment>)
      : null;

  return {
    ...normalized,
    role: normalizeEnergyDeviceRole(source?.role, fallback?.role ?? "informational"),
  };
};

const normalizeEnergyDevices = (
  assignments: Array<SmartlifeEnergyDeviceAssignment | null | undefined>,
) => {
  const seenKeys = new Set<string>();
  const primaryByGiteId = new Set<string>();

  return assignments
    .filter((assignment): assignment is SmartlifeEnergyDeviceAssignment => assignment != null)
    .map((assignment) => {
      const key = `${assignment.gite_id}:${assignment.device_id}`;
      if (seenKeys.has(key)) return null;
      seenKeys.add(key);

      const wantsPrimary = assignment.role === "primary";
      const role =
        wantsPrimary && !primaryByGiteId.has(assignment.gite_id)
          ? "primary"
          : "informational";
      if (role === "primary") {
        primaryByGiteId.add(assignment.gite_id);
      }

      return {
        ...assignment,
        role,
      } satisfies SmartlifeEnergyDeviceAssignment;
    })
    .filter((assignment): assignment is SmartlifeEnergyDeviceAssignment => assignment != null);
};

const collectLegacyEnergyRuleDeviceIdsByGite = (rules: unknown) => {
  const priorities = new Map<string, string[]>();
  if (!Array.isArray(rules)) return priorities;

  for (const rawRule of rules) {
    if (!rawRule || typeof rawRule !== "object") continue;
    const rule = rawRule as LegacySmartlifeAutomationRule;
    if (!isLegacyEnergyTrackingAction(rule.action)) continue;
    const deviceId = normalizeString(rule.device_id);
    if (!deviceId) continue;
    const giteIds = normalizeStringList(rule.gite_ids, []);
    for (const giteId of giteIds) {
      const existing = priorities.get(giteId) ?? [];
      if (!existing.includes(deviceId)) {
        existing.push(deviceId);
      }
      priorities.set(giteId, existing);
    }
  }

  return priorities;
};

const migrateLegacyEnergyDevices = (
  input: {
    energy_devices?: unknown;
    meter_assignments?: unknown;
    rules?: unknown;
  },
  fallback: SmartlifeEnergyDeviceAssignment[],
) => {
  if (Array.isArray(input.energy_devices)) {
    return normalizeEnergyDevices(
      input.energy_devices
        .map((assignment) => normalizeEnergyDeviceAssignment(assignment))
        .filter((assignment): assignment is SmartlifeEnergyDeviceAssignment => assignment != null),
    );
  }

  if (!Array.isArray(input.meter_assignments)) {
    return fallback;
  }

  const legacyAssignments = input.meter_assignments
    .map((assignment) => normalizeLegacyMeterAssignment(assignment))
    .filter(
      (assignment): assignment is Omit<SmartlifeEnergyDeviceAssignment, "role"> =>
        assignment != null,
    );
  if (legacyAssignments.length === 0) {
    return fallback;
  }

  const energyRulePriorityByGite = collectLegacyEnergyRuleDeviceIdsByGite(
    input.rules,
  );
  const assignmentsByGite = new Map<
    string,
    Array<Omit<SmartlifeEnergyDeviceAssignment, "role">>
  >();
  for (const assignment of legacyAssignments) {
    const bucket = assignmentsByGite.get(assignment.gite_id);
    if (bucket) {
      bucket.push(assignment);
    } else {
      assignmentsByGite.set(assignment.gite_id, [assignment]);
    }
  }

  const migrated: SmartlifeEnergyDeviceAssignment[] = [];
  assignmentsByGite.forEach((assignments, giteId) => {
    const priorityDeviceIds = energyRulePriorityByGite.get(giteId) ?? [];
    const primaryDeviceId =
      priorityDeviceIds.find((deviceId) =>
        assignments.some((assignment) => assignment.device_id === deviceId),
      ) ??
      assignments.find((assignment) => assignment.enabled)?.device_id ??
      assignments[0]?.device_id ??
      "";

    assignments.forEach((assignment) => {
      migrated.push({
        ...assignment,
        role:
          assignment.device_id === primaryDeviceId
            ? "primary"
            : "informational",
      });
    });
  });

  return normalizeEnergyDevices(migrated);
};

export const buildDefaultSmartlifeAutomationConfig =
  (): SmartlifeAutomationConfig => ({
    enabled: false,
    region: "eu",
    access_id: "",
    access_secret: "",
    rules: [],
    energy_devices: [],
  });

export const normalizeSmartlifeAutomationConfig = (
  value: Partial<SmartlifeAutomationConfig> | null | undefined,
  fallback: SmartlifeAutomationConfig,
): SmartlifeAutomationConfig => {
  const input = (value ?? {}) as Partial<SmartlifeAutomationConfig> & {
    meter_assignments?: unknown;
    rules?: unknown;
    energy_devices?: unknown;
  };
  const rules = Array.isArray(input.rules)
    ? input.rules
        .map((rule) => normalizeRule(rule))
        .filter((rule): rule is SmartlifeAutomationRule => rule !== null)
    : fallback.rules;
  const energyDevices = migrateLegacyEnergyDevices(input, fallback.energy_devices);

  return {
    enabled: normalizeBoolean(input.enabled, fallback.enabled),
    region: normalizeRegion(input.region, fallback.region),
    access_id: hasOwn(input, "access_id")
      ? normalizeString(input.access_id)
      : fallback.access_id,
    access_secret: hasOwn(input, "access_secret")
      ? normalizeString(input.access_secret)
      : fallback.access_secret,
    rules,
    energy_devices: energyDevices,
  };
};

export const readSmartlifeAutomationConfig = (
  fallback?: SmartlifeAutomationConfig,
): SmartlifeAutomationConfig => {
  const defaults = fallback ?? buildDefaultSmartlifeAutomationConfig();
  ensureDataDir();

  if (!fs.existsSync(SETTINGS_FILE)) return defaults;

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return defaults;
    return normalizeSmartlifeAutomationConfig(
      JSON.parse(raw) as Partial<SmartlifeAutomationConfig>,
      defaults,
    );
  } catch {
    return defaults;
  }
};

export const writeSmartlifeAutomationConfig = (
  config: SmartlifeAutomationConfig,
) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
};

export const mergeSmartlifeAutomationConfig = (
  current: SmartlifeAutomationConfig,
  patch: Partial<SmartlifeAutomationConfig>,
) => normalizeSmartlifeAutomationConfig(patch, current);

export const hasSmartlifeCredentials = (
  config: SmartlifeAutomationConfig,
) => Boolean(config.access_id.trim() && config.access_secret.trim());

export const getEnabledSmartlifePrimaryEnergyDevices = (
  config: SmartlifeAutomationConfig,
) =>
  config.energy_devices.filter(
    (assignment) => assignment.enabled && assignment.role === "primary",
  );

export const getEnabledSmartlifePrimaryEnergyDeviceForGite = (
  config: SmartlifeAutomationConfig,
  giteId: string | null | undefined,
) => {
  const normalizedGiteId = normalizeString(giteId);
  if (!normalizedGiteId) return null;
  return (
    getEnabledSmartlifePrimaryEnergyDevices(config).find(
      (assignment) => assignment.gite_id === normalizedGiteId,
    ) ?? null
  );
};

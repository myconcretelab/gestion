import type { RequestHandler } from "express";
import type { AppPageId, AppUserSummary } from "./appUsers.js";

export type BusinessPermission =
  | "today:read" | "today:write"
  | "reservations:read" | "reservations:write"
  | "booking_requests:read" | "booking_requests:write"
  | "gites:read" | "gites:write"
  | "rates:read" | "rates:write"
  | "calendar:read" | "calendar:write"
  | "contracts:read" | "contracts:write" | "contracts:share"
  | "invoices:read" | "invoices:write" | "invoices:share"
  | "finances:read" | "finances:write"
  | "declarations:read" | "declarations:write"
  | "planning:read" | "planning:write"
  | "cleaning:execute"
  | "actions:execute"
  | "statistics:read"
  | "users:read" | "users:manage"
  | "settings:read" | "settings:write"
  | "integrations:manage";

const pageForPermission: Partial<Record<BusinessPermission, AppPageId>> = {
  "today:read": "today", "today:write": "today",
  "reservations:read": "reservations", "reservations:write": "reservations",
  "booking_requests:read": "booking_requests", "booking_requests:write": "booking_requests",
  "gites:read": "gites", "gites:write": "gites",
  "rates:read": "rates", "rates:write": "rates",
  "calendar:read": "calendar", "calendar:write": "calendar",
  "contracts:read": "contracts", "contracts:write": "contracts", "contracts:share": "contracts",
  "invoices:read": "invoices", "invoices:write": "invoices", "invoices:share": "invoices",
  "finances:read": "professional_expenses", "finances:write": "professional_expenses",
  "declarations:read": "statistics", "declarations:write": "statistics",
  "planning:read": "planning_relay", "planning:write": "planning_relay",
  "cleaning:execute": "planning_relay",
  "actions:execute": "planning_relay",
  "statistics:read": "statistics",
  "settings:read": "settings", "settings:write": "settings",
};

export const hasBusinessPermission = (user: AppUserSummary, permission: BusinessPermission) => {
  if (user.permissions.isOwner) return true;
  if (permission.startsWith("users:") || permission === "integrations:manage" || permission.endsWith(":share")) return false;
  if (permission === "cleaning:execute") {
    return user.pageAccess.includes("today") || user.pageAccess.includes("planning_relay");
  }
  const page = pageForPermission[permission];
  if (!page || !user.pageAccess.includes(page)) return false;
  if (permission === "actions:execute") return true;
  return !permission.endsWith(":write") || user.permissions.canWrite;
};

const familyPermission = (family: string, method: string): BusinessPermission =>
  `${family}:${isWriteMethod(method) ? "write" : "read"}` as BusinessPermission;

export const getRequiredBusinessPermission = (method: string, requestPath: string): BusinessPermission | null => {
  const path = requestPath.toLowerCase();
  if (path.startsWith("/users/owners")) return familyPermission("gites", method);
  if (path.startsWith("/document-shares")) return "contracts:share";
  if (path.startsWith("/users") || path.startsWith("/managers")) return isWriteMethod(method) ? "users:manage" : "users:read";
  if (path.startsWith("/settings")) {
    if (/^\/settings\/(?:api-tokens|pump|smartlife|telegram|message-channels|ical)/.test(path)) return "integrations:manage";
    return familyPermission("settings", method);
  }
  if (path.startsWith("/gites") && path.includes("season-rates")) return familyPermission("rates", method);
  if (path.startsWith("/gites") && path.includes("calendar.ics")) return "calendar:read";
  if (path.startsWith("/gites")) return familyPermission("gites", method);
  if (path.startsWith("/reservations")) return familyPermission(path.includes("calendar") ? "calendar" : "reservations", method);
  if (path.startsWith("/booking-requests")) return familyPermission("booking_requests", method);
  if (path.startsWith("/contracts")) return familyPermission("contracts", method);
  if (path.startsWith("/invoices")) return familyPermission("invoices", method);
  if (path.startsWith("/statistics")) return isWriteMethod(method) ? "finances:write" : "statistics:read";
  if (/^\/(?:personal-expenses|professional-expenses)/.test(path)) return familyPermission("finances", method);
  if (/^\/(?:guest-night-declarations|urssaf-declarations)/.test(path)) return familyPermission("declarations", method);
  if (path.startsWith("/cleaning-tasks")) return (path.endsWith("/status") || path.endsWith("/note")) && isWriteMethod(method) ? "cleaning:execute" : familyPermission("planning", method);
  if (path.startsWith("/action-tasks")) return (path.endsWith("/status") || path.endsWith("/note")) && isWriteMethod(method) ? "actions:execute" : familyPermission("planning", method);
  if (/^\/(?:planning-relay-periods|intervenants|interventions)/.test(path)) return familyPermission("planning", method);
  if (path.startsWith("/today/cleaning-readiness") && isWriteMethod(method)) return "cleaning:execute";
  if (path.startsWith("/today")) return familyPermission("today", method);
  if (path.startsWith("/school-holidays")) return "calendar:read";
  if (path.startsWith("/booked")) return familyPermission("gites", method);
  return null;
};

export const canActAsRequestedUser = (user: AppUserSummary, requestPath: string, body: unknown) => {
  if (user.permissions.isOwner) return true;
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const requestedUserId = typeof payload.userId === "string" ? payload.userId : typeof payload.user_id === "string" ? payload.user_id : null;
  const workerMatch = requestPath.match(/^\/intervenants\/hours\/([^/]+)/i);
  const requestedWorkerId = workerMatch?.[1] ?? (typeof payload.workerId === "string" ? payload.workerId : null);
  return (!requestedUserId || requestedUserId === user.id) && (!requestedWorkerId || requestedWorkerId === user.intervenantId);
};

const AMOUNT_KEY_PATTERN = /(?:^|_)(?:amount|montant|prix|price|tarif|revenue|revenu|cout|cost|solde|arrhes|caution|commission|taxe_sejour|frais|payable)(?:_|$)/i;
const CAMEL_AMOUNT_KEY_PATTERN = /(?:amount|montant|price|prix|tarif|revenue|revenu|cost|solde|arrhes|caution|commission|taxeSejour|totalGlobal|totalSans|optionsTotal|amountDue)/i;
const AMOUNT_CONTAINER_PATTERN = /^(?:prices|pricing|pricing_snapshot|options_detail|gite_prices|prices_by_gite|totals)$/i;

const isAmountKey = (key: string, parentKey: string) => {
  if (key === "total_count" || key.endsWith("_count") || key === "count") return false;
  if (AMOUNT_KEY_PATTERN.test(key) || CAMEL_AMOUNT_KEY_PATTERN.test(key)) return true;
  if (/^options_(?:draps|linge|menage|depart_tardif|chiens)/i.test(key)) return true;
  return AMOUNT_CONTAINER_PATTERN.test(parentKey);
};

export const containsMonetaryFields = (value: unknown, parentKey = ""): boolean => {
  if (Array.isArray(value)) return value.some((item) => containsMonetaryFields(item, parentKey));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    isAmountKey(key, parentKey) || containsMonetaryFields(child, key),
  );
};

const hiddenValueFor = (value: unknown) => {
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") return {};
  return null;
};

/** Removes monetary values before they cross the API boundary. */
export const redactMonetaryValues = (value: unknown, parentKey = ""): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactMonetaryValues(item, parentKey));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      isAmountKey(key, parentKey)
        ? hiddenValueFor(child)
        : redactMonetaryValues(child, key),
    ]),
  );
};

export const redactMonetaryJson: RequestHandler = (_req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => sendJson(redactMonetaryValues(body))) as typeof res.json;
  next();
};

export const isAmountsOnlyApiPath = (path: string) =>
  [
    "/contracts",
    "/invoices",
    "/statistics",
    "/personal-expenses",
    "/professional-expenses",
    "/urssaf-declarations",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

export const isWriteMethod = (method: string) =>
  !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

const PAGE_API_PREFIXES: Array<[string, AppPageId]> = [
  ["/today", "today"],
  ["/booking-requests", "booking_requests"],
  ["/contracts", "contracts"],
  ["/invoices", "invoices"],
  ["/statistics", "statistics"],
  ["/professional-expenses", "professional_expenses"],
  ["/personal-expenses", "personal_expenses"],
  ["/planning-relay-periods", "planning_relay"],
  ["/cleaning-tasks", "planning_relay"],
  ["/action-tasks", "planning_relay"],
  ["/intervenants", "planning_relay"],
  ["/interventions", "planning_relay"],
  ["/settings", "settings"],
  ["/users/owners", "gites"],
  ["/users", "settings"],
  ["/managers", "settings"],
];

export const getRequiredPageForApiPath = (path: string): AppPageId | null =>
  PAGE_API_PREFIXES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null;

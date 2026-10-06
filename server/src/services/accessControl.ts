import type { RequestHandler } from "express";
import type { AppPageId } from "./appUsers.js";

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
  ["/intervenants", "planning_relay"],
  ["/interventions", "planning_relay"],
  ["/settings", "settings"],
  ["/users/owners", "gites"],
  ["/users", "settings"],
  ["/managers", "settings"],
];

export const getRequiredPageForApiPath = (path: string): AppPageId | null =>
  PAGE_API_PREFIXES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null;

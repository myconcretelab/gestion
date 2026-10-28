import {
  createPrototypeState,
  REPORT_CATEGORIES,
  type PrototypeState,
  type ReportDefinition,
} from "./reportPrototype";

export const PROTOTYPE_STORAGE_KEY = "contrats:reports-prototype:v1";
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
function isReport(value: unknown): value is ReportDefinition {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.recipient === "string" &&
    typeof value.favorite === "boolean" &&
    ["social", "tourist", "owner", "custom"].includes(String(value.kind)) &&
    ["payment", "stay"].includes(String(value.dateBasis)) &&
    ["monthly", "quarterly", "yearly"].includes(String(value.cadence)) &&
    isStringArray(value.propertyIds) &&
    isStringArray(value.categories) &&
    value.categories.every((id) =>
      REPORT_CATEGORIES.some((category) => category.id === id),
    )
  );
}

export function parsePrototypeState(raw: string | null): PrototypeState {
  if (!raw) return createPrototypeState();
  try {
    const data: unknown = JSON.parse(raw);
    if (
      !isObject(data) ||
      data.version !== 1 ||
      !Array.isArray(data.reports) ||
      !data.reports.every(isReport) ||
      !isObject(data.drafts) ||
      !Object.values(data.drafts).every(isReport) ||
      !isObject(data.overrides) ||
      !isObject(data.progress)
    )
      return createPrototypeState();
    for (const overrides of Object.values(data.overrides)) {
      if (
        !isObject(overrides) ||
        !Object.values(overrides).every(
          (entry) =>
            isObject(entry) &&
            ["included", "excluded", "review"].includes(String(entry.status)) &&
            typeof entry.note === "string",
        )
      )
        return createPrototypeState();
    }
    for (const progress of Object.values(data.progress)) {
      if (
        !isObject(progress) ||
        (progress.ready !== undefined && typeof progress.ready !== "boolean")
      )
        return createPrototypeState();
      if (progress.snapshot !== undefined) {
        const snapshot = progress.snapshot;
        if (
          !isObject(snapshot) ||
          typeof snapshot.confirmedAt !== "string" ||
          !Number.isFinite(Date.parse(snapshot.confirmedAt)) ||
          !isReport(snapshot.definition) ||
          !isObject(snapshot.result)
        )
          return createPrototypeState();
        const result = snapshot.result;
        if (
          ![
            result.total,
            result.includedCount,
            result.reviewCount,
            result.excludedCount,
          ].every(
            (value) => typeof value === "number" && Number.isFinite(value),
          ) ||
          !Array.isArray(result.rows)
        )
          return createPrototypeState();
        for (const row of result.rows) {
          if (
            !isObject(row) ||
            ![
              "id",
              "reservation",
              "guest",
              "propertyId",
              "category",
              "stayDate",
              "channel",
              "reason",
            ].every((key) => typeof row[key] === "string") ||
            !REPORT_CATEGORIES.some(
              (category) => category.id === row.category,
            ) ||
            !["included", "review", "excluded"].includes(String(row.status)) ||
            ![row.value, row.amountCents, row.nights].every(
              (value) => typeof value === "number" && Number.isFinite(value),
            ) ||
            !(
              row.effectiveDate === null ||
              typeof row.effectiveDate === "string"
            ) ||
            !(row.paymentDate === null || typeof row.paymentDate === "string")
          )
            return createPrototypeState();
        }
      }
    }
    return data as PrototypeState;
  } catch {
    return createPrototypeState();
  }
}

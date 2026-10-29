import {
  createPrototypeState,
  REPORT_CATEGORIES,
  REPORT_PAYMENT_METHODS,
  REPORT_OPERATORS,
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
      ![1, 2, 3].includes(Number(data.version)) ||
      !Array.isArray(data.reports) ||
      !data.reports.every(isReport) ||
      !isObject(data.drafts) ||
      !Object.values(data.drafts).every(isReport) ||
      !isObject(data.overrides) ||
      !isObject(data.progress)
    )
      return createPrototypeState();
    if (
      data.propertyOperators !== undefined &&
      (!isObject(data.propertyOperators) ||
        !Object.values(data.propertyOperators).every(
          (id) =>
            id === null ||
            REPORT_OPERATORS.some((operator) => operator.id === id),
        ))
    )
      return createPrototypeState();
    if (
      data.operationEdits !== undefined &&
      (!isObject(data.operationEdits) ||
        !Object.values(data.operationEdits).every(
          (edit) =>
            isObject(edit) &&
            (edit.paymentDate === undefined ||
              (typeof edit.paymentDate === "string" &&
                /^\d{4}-\d{2}-\d{2}$/.test(edit.paymentDate) &&
                new Date(`${edit.paymentDate}T12:00:00Z`)
                  .toISOString()
                  .slice(0, 10) === edit.paymentDate)) &&
            (edit.paymentMethod === undefined ||
              REPORT_PAYMENT_METHODS.some(
                (method) => method.id === edit.paymentMethod,
              )),
        ))
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
            !(
              row.paymentDate === null || typeof row.paymentDate === "string"
            ) ||
            (row.paymentMethod !== undefined &&
              !REPORT_PAYMENT_METHODS.some(
                (method) => method.id === row.paymentMethod,
              )) ||
            (row.issues !== undefined &&
              (!Array.isArray(row.issues) ||
                !row.issues.every(
                  (issue) =>
                    isObject(issue) &&
                    ["operator", "payment"].includes(String(issue.kind)) &&
                    typeof issue.message === "string" &&
                    typeof issue.actionLabel === "string",
                )))
          )
            return createPrototypeState();
        }
      }
    }
    const defaults = createPrototypeState();
    const descriptions: Record<string, string> = {
      "Préparer une base de recettes par exploitant.":
        "Recettes de l’exploitant.",
      "Rassembler les nuitées des hébergements concernés.":
        "Nuitées par logement.",
      "Retrouver les recettes des logements d’un propriétaire.":
        "Recettes des logements du propriétaire.",
      "Composer votre propre suivi à partir des recettes.":
        "Recettes des catégories sélectionnées.",
    };
    const normalize = (report: ReportDefinition): ReportDefinition => {
      const { accommodationPaymentMethods: _removed, ...definition } =
        report as ReportDefinition & { accommodationPaymentMethods?: unknown };
      return {
        ...definition,
        description: descriptions[report.description] ?? report.description,
      };
    };
    const restored = data as unknown as PrototypeState;
    return {
      ...restored,
      version: 3,
      propertyOperators: {
        ...defaults.propertyOperators,
        ...restored.propertyOperators,
      },
      operationEdits: restored.operationEdits ?? {},
      reports: restored.reports.map(normalize),
      drafts: Object.fromEntries(
        Object.entries(restored.drafts).map(([key, report]) => [
          key,
          normalize(report),
        ]),
      ),
      progress: Object.fromEntries(
        Object.entries(restored.progress).map(([key, progress]) => [
          key,
          progress.snapshot
            ? {
                ...progress,
                snapshot: {
                  ...progress.snapshot,
                  definition: normalize(progress.snapshot.definition),
                  result: {
                    ...progress.snapshot.result,
                    rows: progress.snapshot.result.rows.map((row) => ({
                      ...row,
                      paymentMethod: row.paymentMethod ?? "unknown",
                      issues: row.issues ?? [],
                    })),
                  },
                },
              }
            : progress,
        ]),
      ),
    };
  } catch {
    return createPrototypeState();
  }
}

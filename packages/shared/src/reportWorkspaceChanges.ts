import type { ReportWorkspaceData } from "./reportApi.js";

export const REPORT_CONFIGURATION_KEYS = [
  "taxRemittances",
  "paymentReviews",
  "reports",
  "overrides",
  "progress",
  "worklistStartMonth",
  "nightSettingsVersion",
  "nightSettingsWarnings",
  "nightRegisterCompletions",
  "nightRegisterCompletionRevisions",
] as const;

export type ReportConfigurationData = Pick<
  ReportWorkspaceData,
  (typeof REPORT_CONFIGURATION_KEYS)[number]
>;

export type ReportWorkspaceChanges = {
  type: "report-workspace-changes";
  organizationId: string;
  year?: number;
  baseRevision: number;
  revision: number;
  factsRevision: string;
  calculatedAt?: string;
  configuration: ReportConfigurationData;
  legacyDeclarations: ReportWorkspaceData["legacyDeclarations"];
};

/** Commands change configuration, while source operations retain their checked revision. */
export function reportWorkspaceChanges(
  state: ReportWorkspaceData,
  baseRevision: number,
): ReportWorkspaceChanges {
  return {
    type: "report-workspace-changes",
    organizationId: state.organizationId,
    year: state.year,
    baseRevision,
    revision: state.revision,
    factsRevision: state.factsRevision,
    calculatedAt: state.calculatedAt,
    configuration: Object.fromEntries(
      REPORT_CONFIGURATION_KEYS.map((key) => [key, state[key]]),
    ) as ReportConfigurationData,
    legacyDeclarations: state.legacyDeclarations,
  };
}

export function applyReportWorkspaceChanges(
  state: ReportWorkspaceData,
  changes: ReportWorkspaceChanges,
): ReportWorkspaceData {
  if (
    state.organizationId !== changes.organizationId ||
    state.year !== changes.year ||
    state.revision !== changes.baseRevision ||
    state.factsRevision !== changes.factsRevision
  )
    throw new Error("Les données ont changé. Actualisez les rapports.");
  return {
    ...state,
    // Replace optional settings too: an omitted key clears its previous value.
    ...Object.fromEntries(
      REPORT_CONFIGURATION_KEYS.map((key) => [key, changes.configuration[key]]),
    ),
    revision: changes.revision,
    calculatedAt: changes.calculatedAt,
    legacyDeclarations: changes.legacyDeclarations,
  };
}

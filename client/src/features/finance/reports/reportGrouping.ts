import type {
  ReportDefinition,
  ReportWorkItem,
  ReportWorkspaceData,
} from "@contrats/shared";
import { reportReviewCount } from "@contrats/shared";

export type ReportManagerGroup = {
  id: string;
  name: string;
  label: string;
};

/** Group by the actual manager identity, never by a recipient's spelling. */
export function reportManagerGroup(
  report: ReportDefinition,
  state: ReportWorkspaceData,
): ReportManagerGroup {
  const propertyManagers = report.propertyIds.map((id) =>
    Object.prototype.hasOwnProperty.call(state.propertyManagers ?? {}, id)
      ? state.propertyManagers?.[id]
      : state.properties.find((property) => property.id === id)?.managerId,
  );
  const managerIds = new Set(propertyManagers.filter(Boolean));
  const managerId =
    report.managerId ??
    (propertyManagers.length &&
    propertyManagers.every(Boolean) &&
    managerIds.size === 1
      ? propertyManagers[0]
      : null);
  if (managerId) {
    return {
      id: `manager:${managerId}`,
      name:
        state.managers?.find((manager) => manager.id === managerId)?.name ??
        "Gestionnaire à vérifier",
      label: "Gestionnaire",
    };
  }
  return managerIds.size > 1
    ? {
        id: "shared",
        name: "Plusieurs gestionnaires",
        label: "Rapports communs",
      }
    : {
        id: "unassigned",
        name: "Gestionnaire non défini",
        label: "Rapports sans gestionnaire unique",
      };
}

/** Quarterly and annual reports belong to the month in which they close. */
export function reportClosingMonth(item: ReportWorkItem) {
  const end = new Date(`${item.period.end}T00:00:00Z`);
  end.setUTCDate(0);
  return end.toISOString().slice(0, 7);
}

const monthFormatter = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export function reportMonthLabel(month: string) {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}

export function groupReportWorkItems(
  items: ReportWorkItem[],
  state: ReportWorkspaceData,
) {
  const months = new Map<
    string,
    {
      month: string;
      count: number;
      attentionCount: number;
      managers: Map<string, ReportManagerGroup & { items: ReportWorkItem[] }>;
    }
  >();
  for (const item of items) {
    const month = reportClosingMonth(item);
    const group = months.get(month) ?? {
      month,
      count: 0,
      attentionCount: 0,
      managers: new Map(),
    };
    const identity = reportManagerGroup(item.report, state);
    const manager = group.managers.get(identity.id) ?? {
      ...identity,
      items: [],
    };
    manager.items.push(item);
    group.managers.set(identity.id, manager);
    group.count++;
    if (reportReviewCount(item.result) || item.status === "Écart à examiner")
      group.attentionCount++;
    months.set(month, group);
  }
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((group) => ({
      ...group,
      managers: [...group.managers.values()]
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id),
        )
        .map((manager) => ({
          ...manager,
          items: manager.items.sort(
            (a, b) =>
              Number(b.report.favorite) - Number(a.report.favorite) ||
              a.report.name.localeCompare(b.report.name, "fr") ||
              a.key.localeCompare(b.key),
          ),
        })),
    }));
}

export type ReportMonthGroup = ReturnType<typeof groupReportWorkItems>[number];

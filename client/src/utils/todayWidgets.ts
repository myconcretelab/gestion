export const TODAY_WIDGET_IDS = ["trash", "occupancy", "hours", "notification_archive", "revenue"] as const;

export type TodayWidgetId = (typeof TODAY_WIDGET_IDS)[number];
export type TodayWidgetWidth = "small" | "medium" | "large" | "full";

export type TodayWidgetPreferences = {
  version: 1;
  order: TodayWidgetId[];
  widgets: Record<TodayWidgetId, {
    enabled: boolean;
    width: TodayWidgetWidth;
  }>;
  options: {
    trash: { showNextPickup: boolean };
    occupancy: { showCount: boolean };
    revenue: { showTrends: boolean };
  };
};

export const TODAY_WIDGET_CATALOG: ReadonlyArray<{
  id: TodayWidgetId;
  label: string;
  description: string;
}> = [
  { id: "trash", label: "Poubelles", description: "Collectes et prochain passage." },
  { id: "occupancy", label: "Remplissage", description: "Occupation des gîtes aujourd’hui." },
  { id: "hours", label: "Heures", description: "Saisie rapide des heures des intervenants." },
  { id: "notification_archive", label: "Archives notifications", description: "Période affichée dans le centre de notifications." },
  { id: "revenue", label: "Revenus nets moyens", description: "Synthèse financière par période." },
];

export const DEFAULT_TODAY_WIDGET_PREFERENCES: TodayWidgetPreferences = {
  version: 1,
  order: [...TODAY_WIDGET_IDS],
  widgets: {
    trash: { enabled: true, width: "small" },
    occupancy: { enabled: true, width: "small" },
    hours: { enabled: true, width: "small" },
    notification_archive: { enabled: true, width: "small" },
    revenue: { enabled: true, width: "full" },
  },
  options: {
    trash: { showNextPickup: true },
    occupancy: { showCount: true },
    revenue: { showTrends: true },
  },
};

const isWidgetId = (value: unknown): value is TodayWidgetId =>
  typeof value === "string" && (TODAY_WIDGET_IDS as readonly string[]).includes(value);

const isWidgetWidth = (value: unknown): value is TodayWidgetWidth =>
  value === "small" || value === "medium" || value === "large" || value === "full";

export const normalizeTodayWidgetPreferences = (value: unknown): TodayWidgetPreferences => {
  const source = value && typeof value === "object" ? value as Partial<TodayWidgetPreferences> : {};
  const sourceWidgets: Partial<TodayWidgetPreferences["widgets"]> =
    source.widgets && typeof source.widgets === "object" ? source.widgets : {};
  const sourceOptions: Partial<TodayWidgetPreferences["options"]> =
    source.options && typeof source.options === "object" ? source.options : {};
  const sourceOrder = Array.isArray(source.order) ? source.order.filter(isWidgetId) : [];
  const order = [...new Set([...sourceOrder, ...TODAY_WIDGET_IDS])];

  return {
    version: 1,
    order,
    widgets: Object.fromEntries(TODAY_WIDGET_IDS.map((id) => {
      const candidate = sourceWidgets[id];
      const defaults = DEFAULT_TODAY_WIDGET_PREFERENCES.widgets[id];
      return [id, {
        enabled: typeof candidate?.enabled === "boolean" ? candidate.enabled : defaults.enabled,
        width: isWidgetWidth(candidate?.width) ? candidate.width : defaults.width,
      }];
    })) as TodayWidgetPreferences["widgets"],
    options: {
      trash: {
        showNextPickup: typeof sourceOptions.trash?.showNextPickup === "boolean"
          ? sourceOptions.trash.showNextPickup
          : DEFAULT_TODAY_WIDGET_PREFERENCES.options.trash.showNextPickup,
      },
      occupancy: {
        showCount: typeof sourceOptions.occupancy?.showCount === "boolean"
          ? sourceOptions.occupancy.showCount
          : DEFAULT_TODAY_WIDGET_PREFERENCES.options.occupancy.showCount,
      },
      revenue: {
        showTrends: typeof sourceOptions.revenue?.showTrends === "boolean"
          ? sourceOptions.revenue.showTrends
          : DEFAULT_TODAY_WIDGET_PREFERENCES.options.revenue.showTrends,
      },
    },
  };
};

export const moveTodayWidget = (
  preferences: TodayWidgetPreferences,
  widgetId: TodayWidgetId,
  direction: -1 | 1,
) => {
  const enabledOrder = preferences.order.filter((id) => preferences.widgets[id].enabled);
  const currentIndex = enabledOrder.indexOf(widgetId);
  const targetId = enabledOrder[currentIndex + direction];
  if (currentIndex < 0 || !targetId) return preferences;

  const order = [...preferences.order];
  const sourceIndex = order.indexOf(widgetId);
  const targetIndex = order.indexOf(targetId);
  [order[sourceIndex], order[targetIndex]] = [order[targetIndex], order[sourceIndex]];
  return { ...preferences, order };
};

export const getTodayWidgetStorageKey = (userId?: string | null) =>
  `contrats:today-widgets:v1:${userId?.trim() || "anonymous"}`;

export const readTodayWidgetPreferences = (userId?: string | null) => {
  if (typeof window === "undefined") return normalizeTodayWidgetPreferences(null);
  try {
    return normalizeTodayWidgetPreferences(JSON.parse(window.localStorage.getItem(getTodayWidgetStorageKey(userId)) ?? "null"));
  } catch {
    return normalizeTodayWidgetPreferences(null);
  }
};

export const writeTodayWidgetPreferences = (userId: string | null | undefined, preferences: TodayWidgetPreferences) => {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(getTodayWidgetStorageKey(userId), JSON.stringify(normalizeTodayWidgetPreferences(preferences)));
    return true;
  } catch {
    return false;
  }
};

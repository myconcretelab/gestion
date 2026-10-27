export const TODAY_WIDGET_IDS = ["trash", "occupancy", "hours", "notification_archive", "revenue"] as const;

export type TodayWidgetId = (typeof TODAY_WIDGET_IDS)[number];
export type TodayReservationClickAction = "drawer" | "reservation";
export type TodayWidgetWidth = "small" | "medium" | "large" | "full";
export type TodayRevenueMetricId = "previous_month" | "current_month" | "next_month" | "last_24_months";

export type TrashCollection = {
  id: string;
  name: string;
  color: string;
  alternateColor: string | null;
  frequencyWeeks: number;
  weekday: number;
  startDate: string;
  switchHour: number;
};

export type TodayWidgetPreferences = {
  version: 1;
  order: TodayWidgetId[];
  widgets: Record<TodayWidgetId, { enabled: boolean; width: TodayWidgetWidth }>;
  options: {
    timeline: { desktopReservationAction: TodayReservationClickAction };
    trash: { showNextPickup: boolean; collections: TrashCollection[] };
    occupancy: { showGauge: boolean; showPercentage: boolean; showCount: boolean };
    hours: { showDatePicker: boolean; showTotals: boolean; quickMinutes: number[] };
    notificationArchive: { dayCount: number; showReservations: boolean; showConflicts: boolean };
    revenue: {
      visibleMetrics: TodayRevenueMetricId[];
      showTrends: boolean;
      highlightCurrentMonth: boolean;
      showGrossRevenue: boolean;
      showExpenses: boolean;
      showExpenseBreakdown: boolean;
      showOccasionalExpenses: boolean;
      roundAmounts: boolean;
    };
  };
};

export const TODAY_WIDGET_CATALOG: ReadonlyArray<{ id: TodayWidgetId; label: string; description: string }> = [
  { id: "trash", label: "Poubelles", description: "Collectes et prochain passage." },
  { id: "occupancy", label: "Remplissage", description: "Occupation des gîtes aujourd’hui." },
  { id: "hours", label: "Heures", description: "Saisie rapide des heures des intervenants." },
  { id: "notification_archive", label: "Archives notifications", description: "Période affichée dans le centre de notifications." },
  { id: "revenue", label: "Revenus nets moyens", description: "Synthèse financière par période." },
];

export const TODAY_REVENUE_METRICS: ReadonlyArray<{ id: TodayRevenueMetricId; label: string; description: string }> = [
  { id: "previous_month", label: "Mois précédent", description: "Le mois civil terminé avant le mois en cours." },
  { id: "current_month", label: "Mois en cours", description: "Les revenus et dépenses du mois actuel." },
  { id: "next_month", label: "Mois suivant", description: "La projection du prochain mois civil." },
  { id: "last_24_months", label: "Deux dernières années", description: "La moyenne mensuelle calculée sur 24 mois." },
];

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Lundi" }, { value: 2, label: "Mardi" }, { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" }, { value: 5, label: "Vendredi" }, { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
] as const;

export const DEFAULT_TODAY_WIDGET_PREFERENCES: TodayWidgetPreferences = {
  version: 1,
  order: [...TODAY_WIDGET_IDS],
  widgets: {
    trash: { enabled: true, width: "small" }, occupancy: { enabled: true, width: "small" },
    hours: { enabled: true, width: "small" }, notification_archive: { enabled: true, width: "small" },
    revenue: { enabled: true, width: "full" },
  },
  options: {
    timeline: { desktopReservationAction: "drawer" },
    trash: {
      showNextPickup: true,
      collections: [
        { id: "mauron", name: "Mauron", color: "#104911", alternateColor: "#FFCB05", frequencyWeeks: 1, weekday: 3, startDate: "2024-01-03", switchHour: 16 },
        { id: "neant", name: "Néant", color: "#FFCB05", alternateColor: "#104911", frequencyWeeks: 1, weekday: 3, startDate: "2024-01-03", switchHour: 16 },
      ],
    },
    occupancy: { showGauge: true, showPercentage: true, showCount: true },
    hours: { showDatePicker: true, showTotals: true, quickMinutes: [30, 60, 120] },
    notificationArchive: { dayCount: 1, showReservations: true, showConflicts: true },
    revenue: {
      visibleMetrics: ["previous_month", "current_month", "next_month", "last_24_months"],
      showTrends: true, highlightCurrentMonth: true, showGrossRevenue: true, showExpenses: true,
      showExpenseBreakdown: true, showOccasionalExpenses: true, roundAmounts: false,
    },
  },
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const isWidgetId = (value: unknown): value is TodayWidgetId => typeof value === "string" && (TODAY_WIDGET_IDS as readonly string[]).includes(value);
const isWidgetWidth = (value: unknown): value is TodayWidgetWidth => value === "small" || value === "medium" || value === "large" || value === "full";
const isRevenueMetricId = (value: unknown): value is TodayRevenueMetricId => typeof value === "string" && TODAY_REVENUE_METRICS.some((metric) => metric.id === value);
const clampInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
};
const normalizeColor = (value: unknown, fallback: string) => typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value.toUpperCase() : fallback;

const normalizeCollection = (value: unknown, index: number, usedIds: Set<string>): TrashCollection => {
  const source = value && typeof value === "object" ? value as Partial<TrashCollection> : {};
  const defaultCollection = DEFAULT_TODAY_WIDGET_PREFERENCES.options.trash.collections[index % 2];
  const rawId = typeof source.id === "string" ? source.id.trim().slice(0, 80) : "";
  let id = rawId || `collection-${index + 1}`;
  if (usedIds.has(id)) id = `${id}-${index + 1}`;
  usedIds.add(id);
  const alternateColor = source.alternateColor === null || source.alternateColor === "" ? null : normalizeColor(source.alternateColor, defaultCollection.alternateColor ?? defaultCollection.color);
  return {
    id,
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 80) : `Collecte ${index + 1}`,
    color: normalizeColor(source.color, defaultCollection.color), alternateColor,
    frequencyWeeks: clampInteger(source.frequencyWeeks, 1, 1, 4), weekday: clampInteger(source.weekday, 3, 0, 6),
    startDate: typeof source.startDate === "string" && ISO_DATE_PATTERN.test(source.startDate) ? source.startDate : defaultCollection.startDate,
    switchHour: clampInteger(source.switchHour, 16, 0, 23),
  };
};

export const normalizeTodayWidgetPreferences = (value: unknown): TodayWidgetPreferences => {
  const source = value && typeof value === "object" ? value as Partial<TodayWidgetPreferences> : {};
  const sourceWidgets: Partial<TodayWidgetPreferences["widgets"]> = source.widgets && typeof source.widgets === "object" ? source.widgets : {};
  const sourceOptions: Partial<TodayWidgetPreferences["options"]> = source.options && typeof source.options === "object" ? source.options : {};
  const sourceOrder = Array.isArray(source.order) ? source.order.filter(isWidgetId) : [];
  const usedCollectionIds = new Set<string>();
  const sourceCollections = Array.isArray(sourceOptions.trash?.collections) ? sourceOptions.trash.collections.slice(0, 12) : DEFAULT_TODAY_WIDGET_PREFERENCES.options.trash.collections;
  const visibleMetrics = Array.isArray(sourceOptions.revenue?.visibleMetrics) ? [...new Set(sourceOptions.revenue.visibleMetrics.filter(isRevenueMetricId))] : DEFAULT_TODAY_WIDGET_PREFERENCES.options.revenue.visibleMetrics;
  const quickMinutes = Array.isArray(sourceOptions.hours?.quickMinutes) ? [...new Set(sourceOptions.hours.quickMinutes.map((minutes) => clampInteger(minutes, 30, 5, 720)))].slice(0, 3) : DEFAULT_TODAY_WIDGET_PREFERENCES.options.hours.quickMinutes;
  return {
    version: 1,
    order: [...new Set([...sourceOrder, ...TODAY_WIDGET_IDS])],
    widgets: Object.fromEntries(TODAY_WIDGET_IDS.map((id) => {
      const candidate = sourceWidgets[id]; const defaults = DEFAULT_TODAY_WIDGET_PREFERENCES.widgets[id];
      return [id, { enabled: typeof candidate?.enabled === "boolean" ? candidate.enabled : defaults.enabled, width: isWidgetWidth(candidate?.width) ? candidate.width : defaults.width }];
    })) as TodayWidgetPreferences["widgets"],
    options: {
      timeline: {
        desktopReservationAction: sourceOptions.timeline?.desktopReservationAction === "reservation" ? "reservation" : "drawer",
      },
      trash: {
        showNextPickup: typeof sourceOptions.trash?.showNextPickup === "boolean" ? sourceOptions.trash.showNextPickup : true,
        collections: sourceCollections.map((collection, index) => normalizeCollection(collection, index, usedCollectionIds)),
      },
      occupancy: {
        showGauge: typeof sourceOptions.occupancy?.showGauge === "boolean" ? sourceOptions.occupancy.showGauge : true,
        showPercentage: typeof sourceOptions.occupancy?.showPercentage === "boolean" ? sourceOptions.occupancy.showPercentage : true,
        showCount: typeof sourceOptions.occupancy?.showCount === "boolean" ? sourceOptions.occupancy.showCount : true,
      },
      hours: {
        showDatePicker: typeof sourceOptions.hours?.showDatePicker === "boolean" ? sourceOptions.hours.showDatePicker : true,
        showTotals: typeof sourceOptions.hours?.showTotals === "boolean" ? sourceOptions.hours.showTotals : true,
        quickMinutes: quickMinutes.length > 0 ? quickMinutes : [...DEFAULT_TODAY_WIDGET_PREFERENCES.options.hours.quickMinutes],
      },
      notificationArchive: {
        dayCount: clampInteger(sourceOptions.notificationArchive?.dayCount, 1, 1, 5),
        showReservations: typeof sourceOptions.notificationArchive?.showReservations === "boolean" ? sourceOptions.notificationArchive.showReservations : true,
        showConflicts: typeof sourceOptions.notificationArchive?.showConflicts === "boolean" ? sourceOptions.notificationArchive.showConflicts : true,
      },
      revenue: {
        visibleMetrics: visibleMetrics.length > 0 ? visibleMetrics : [...DEFAULT_TODAY_WIDGET_PREFERENCES.options.revenue.visibleMetrics],
        showTrends: typeof sourceOptions.revenue?.showTrends === "boolean" ? sourceOptions.revenue.showTrends : true,
        highlightCurrentMonth: typeof sourceOptions.revenue?.highlightCurrentMonth === "boolean" ? sourceOptions.revenue.highlightCurrentMonth : true,
        showGrossRevenue: typeof sourceOptions.revenue?.showGrossRevenue === "boolean" ? sourceOptions.revenue.showGrossRevenue : true,
        showExpenses: typeof sourceOptions.revenue?.showExpenses === "boolean" ? sourceOptions.revenue.showExpenses : true,
        showExpenseBreakdown: typeof sourceOptions.revenue?.showExpenseBreakdown === "boolean" ? sourceOptions.revenue.showExpenseBreakdown : true,
        showOccasionalExpenses: typeof sourceOptions.revenue?.showOccasionalExpenses === "boolean" ? sourceOptions.revenue.showOccasionalExpenses : true,
        roundAmounts: typeof sourceOptions.revenue?.roundAmounts === "boolean" ? sourceOptions.revenue.roundAmounts : false,
      },
    },
  };
};

export const moveTodayWidget = (preferences: TodayWidgetPreferences, widgetId: TodayWidgetId, direction: -1 | 1) => {
  const enabledOrder = preferences.order.filter((id) => preferences.widgets[id].enabled);
  const currentIndex = enabledOrder.indexOf(widgetId); const targetId = enabledOrder[currentIndex + direction];
  if (currentIndex < 0 || !targetId) return preferences;
  const order = [...preferences.order]; const sourceIndex = order.indexOf(widgetId); const targetIndex = order.indexOf(targetId);
  [order[sourceIndex], order[targetIndex]] = [order[targetIndex], order[sourceIndex]];
  return { ...preferences, order };
};

const parseLocalIsoDate = (value: string) => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
const localDateStamp = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
const localWeekStartStamp = (value: Date) => { const weekday = value.getDay() || 7; return localDateStamp(new Date(value.getFullYear(), value.getMonth(), value.getDate() - weekday + 1)); };

export const getNextTrashCollectionOccurrence = (collection: TrashCollection, now: Date) => {
  const normalized = normalizeCollection(collection, 0, new Set()); const anchor = parseLocalIsoDate(normalized.startDate);
  const searchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() < normalized.switchHour ? 0 : 1));
  for (let offset = 0; offset <= normalized.frequencyWeeks * 14; offset += 1) {
    const candidate = new Date(searchStart.getFullYear(), searchStart.getMonth(), searchStart.getDate() + offset);
    if (candidate.getDay() !== normalized.weekday || localDateStamp(candidate) < localDateStamp(anchor)) continue;
    const weekDifference = Math.round((localWeekStartStamp(candidate) - localWeekStartStamp(anchor)) / (7 * DAY_MS));
    if (weekDifference >= 0 && weekDifference % normalized.frequencyWeeks === 0) return candidate;
  }
  return null;
};

export const getTrashCollectionColor = (collection: TrashCollection, occurrence: Date) => {
  if (!collection.alternateColor) return collection.color;
  const anchor = parseLocalIsoDate(collection.startDate);
  const weekDifference = Math.max(0, Math.round((localWeekStartStamp(occurrence) - localWeekStartStamp(anchor)) / (7 * DAY_MS)));
  return Math.floor(weekDifference / Math.max(1, collection.frequencyWeeks)) % 2 === 0 ? collection.color : collection.alternateColor;
};

export const TODAY_WIDGET_PREFERENCES_EVENT = "contrats:today-widget-preferences";
export const getTodayWidgetStorageKey = (userId?: string | null) => `contrats:today-widgets:v1:${userId?.trim() || "anonymous"}`;
export const readTodayWidgetPreferences = (userId?: string | null) => {
  if (typeof window === "undefined") return normalizeTodayWidgetPreferences(null);
  try { return normalizeTodayWidgetPreferences(JSON.parse(window.localStorage.getItem(getTodayWidgetStorageKey(userId)) ?? "null")); }
  catch { return normalizeTodayWidgetPreferences(null); }
};
export const writeTodayWidgetPreferences = (userId: string | null | undefined, preferences: TodayWidgetPreferences) => {
  if (typeof window === "undefined") return false;
  try {
    const normalized = normalizeTodayWidgetPreferences(preferences);
    window.localStorage.setItem(getTodayWidgetStorageKey(userId), JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(TODAY_WIDGET_PREFERENCES_EVENT, { detail: { userId, preferences: normalized } }));
    return true;
  } catch { return false; }
};

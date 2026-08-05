import { getPaymentColor } from "../../utils/paymentColors";

export type StatisticsGite = {
  id: string;
  nom: string;
  ordre: number;
  prefixe_contrat: string;
  proprietaires_noms: string;
  gestionnaire_id?: string | null;
  date_debut_activite?: string | null;
  frais_gestion?: StatisticsExpenseManagement | null;
  gestionnaire?: {
    id: string;
    prenom: string;
    nom: string;
  } | null;
};

export type StatisticsExpenseCategory = {
  id: string;
  name: string;
  color: string;
};

export type StatisticsExpenseLine = {
  id: string;
  label: string;
  category_id: string;
  monthly_amount: number;
  annual_amount: number;
  notes?: string;
};

export type StatisticsExpenseManagement = {
  version?: number;
  categories?: StatisticsExpenseCategory[];
  expenses?: StatisticsExpenseLine[];
};

export type StatisticsDynamicExpenseRule = {
  id: string;
  label: string;
  category_id: string;
  basis: "urssaf_revenue";
  rate: number;
  enabled: boolean;
};

export type StatisticsExpenseSettings = {
  categories: StatisticsExpenseCategory[];
  dynamic_expenses: StatisticsDynamicExpenseRule[];
};

export type StatisticsEntry = {
  reservationId: string;
  giteId: string;
  debut: string;
  fin: string;
  mois: number;
  nuits: number;
  adultes: number;
  prixNuit: number;
  revenus: number;
  fraisOptionnelsTotal: number;
  fraisOptionnelsDeclares: number;
  paiement: string;
  proprietaires: string;
};

export type StatisticsPayload = {
  gites: StatisticsGite[];
  entriesByGite: Record<string, StatisticsEntry[]>;
  availableYears: number[];
  expenseSettings?: StatisticsExpenseSettings;
};

export type UrssafManagerAmount = {
  managerId: string;
  manager: string;
  amount: number;
};

export type GuestNightGiteAmount = {
  giteId: string;
  giteName: string;
  managerName: string | null;
  guestNights: number;
};

export type ParsedStatisticsEntry = StatisticsEntry & {
  debutDate: Date;
};

export type ParsedStatisticsPayload = {
  gites: StatisticsGite[];
  entriesByGite: Record<string, ParsedStatisticsEntry[]>;
  availableYears: number[];
  expenseSettings: StatisticsExpenseSettings;
};

export type ExpenseReportGiteRow = {
  id: string;
  name: string;
  revenue: number;
  fixed: number;
  dynamic: number;
  expenses: number;
  net: number;
  expenseRate: number;
};

export type ExpenseReportCategoryRow = StatisticsExpenseCategory & {
  amount: number;
  lineCount: number;
};

export type ExpenseReport = {
  fixed: number;
  dynamic: number;
  expenses: number;
  revenue: number;
  net: number;
  monthlyAverage: number;
  expenseRate: number;
  monthCount: number;
  rowsByGite: ExpenseReportGiteRow[];
  rowsByCategory: ExpenseReportCategoryRow[];
};

type PeriodYear = number | "all";
type PeriodMonth = number | "";
type ActivityStart = string | Date | null | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

const URSSAF_PAYMENTS = ["Abritel", "Airbnb", "Cheque", "Chèque", "Virement", "Gites de France"];

const DEFAULT_EXPENSE_SETTINGS: StatisticsExpenseSettings = {
  categories: [
    { id: "energie", name: "Énergie", color: "#2D8CFF" },
    { id: "entretien", name: "Entretien", color: "#43B77D" },
    { id: "taxes", name: "Taxes", color: "#F5A623" },
    { id: "assurance", name: "Assurance", color: "#7E5BEF" },
  ],
  dynamic_expenses: [],
};

const normalizeLabel = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const isHomeExchange = (entry: ParsedStatisticsEntry) => normalizeLabel(entry.paiement) === "homeexchange";

export const getEntryUrssafBase = (entry: StatisticsEntry) => {
  if (!URSSAF_PAYMENTS.some((label) => normalizeLabel(entry.paiement).includes(normalizeLabel(label)))) return 0;
  return (Number(entry.revenus) || 0) + (Number(entry.fraisOptionnelsDeclares) || 0);
};

export const getEntryGrossCA = (entry: StatisticsEntry) =>
  (Number(entry.revenus) || 0) + (Number(entry.fraisOptionnelsTotal) || 0);

const entryMatch = (entry: ParsedStatisticsEntry, year: PeriodYear, month: PeriodMonth) => {
  const entryYear = entry.debutDate.getUTCFullYear();
  const entryMonth = entry.debutDate.getUTCMonth() + 1;
  if (month) return (year === "all" || entryYear === year) && entryMonth === Number(month);
  return year === "all" ? true : entryYear === year;
};

const getElapsedEntryFactor = (
  entry: ParsedStatisticsEntry,
  year: PeriodYear,
  month: PeriodMonth,
  now = new Date()
) => {
  if (!entryMatch(entry, year, month)) return 0;

  const currentYear = now.getUTCFullYear();
  const entryYear = entry.debutDate.getUTCFullYear();
  if (entryYear < currentYear) return 1;
  if (entryYear > currentYear) return 0;

  const nights = Math.max(0, Number(entry.nuits) || 0);
  const cutoff = Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate() + 1);
  if (nights === 0) return entry.debutDate.getTime() < cutoff ? 1 : 0;

  const elapsedNights = Math.max(
    0,
    Math.min(nights, Math.round((cutoff - entry.debutDate.getTime()) / DAY_MS))
  );
  return elapsedNights / nights;
};

const scaleEntry = (entry: ParsedStatisticsEntry, factor: number): ParsedStatisticsEntry => {
  if (factor >= 1) return entry;
  return {
    ...entry,
    nuits: Math.round((Number(entry.nuits) || 0) * factor),
    revenus: Math.round((Number(entry.revenus) || 0) * factor * 100) / 100,
    fraisOptionnelsTotal: Math.round((Number(entry.fraisOptionnelsTotal) || 0) * factor * 100) / 100,
    fraisOptionnelsDeclares: Math.round((Number(entry.fraisOptionnelsDeclares) || 0) * factor * 100) / 100,
  };
};

const getEntriesByPeriod = (
  entries: ParsedStatisticsEntry[],
  year: PeriodYear,
  month: PeriodMonth,
  options?: { includeHomeExchange?: boolean; now?: Date }
) =>
  entries.flatMap((entry) => {
    if (!options?.includeHomeExchange && isHomeExchange(entry)) return [];
    const factor = getElapsedEntryFactor(entry, year, month, options?.now);
    return factor > 0 ? [scaleEntry(entry, factor)] : [];
  });

const filterByPeriod = (entries: ParsedStatisticsEntry[], year: PeriodYear, month: PeriodMonth) =>
  getEntriesByPeriod(entries, year, month);

const getActivityStartTime = (activityStart: ActivityStart) => {
  if (!activityStart) return null;
  const time =
    activityStart instanceof Date
      ? Date.UTC(activityStart.getUTCFullYear(), activityStart.getUTCMonth(), activityStart.getUTCDate())
      : new Date(`${activityStart.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

const getPeriodBounds = (year: number, month: PeriodMonth, now = new Date()) => {
  if (month) {
    return {
      start: Date.UTC(year, Number(month) - 1, 1),
      end: Date.UTC(year, Number(month), 1),
    };
  }

  if (year === now.getUTCFullYear()) {
    return {
      start: Date.UTC(year, 0, 1),
      end: Date.UTC(year, now.getUTCMonth(), now.getUTCDate() + 1),
    };
  }

  return {
    start: Date.UTC(year, 0, 1),
    end: Date.UTC(year + 1, 0, 1),
  };
};

const isActivityPeriodAvailable = (
  activityStart: ActivityStart,
  year: number,
  month: PeriodMonth,
  now = new Date()
) => {
  const activityStartTime = getActivityStartTime(activityStart);
  if (activityStartTime === null) return true;
  return activityStartTime < getPeriodBounds(year, month, now).end;
};

const isFullyActivePeriod = (
  activityStart: ActivityStart,
  year: number,
  month: PeriodMonth,
  now = new Date()
) => {
  const activityStartTime = getActivityStartTime(activityStart);
  if (activityStartTime === null) return true;
  return activityStartTime <= getPeriodBounds(year, month, now).start;
};

export const parseStatisticsPayload = (payload: StatisticsPayload): ParsedStatisticsPayload => {
  const entriesByGite: Record<string, ParsedStatisticsEntry[]> = {};
  for (const [giteId, entries] of Object.entries(payload.entriesByGite ?? {})) {
    entriesByGite[giteId] = (entries ?? [])
      .map((entry) => ({
        ...entry,
        fraisOptionnelsTotal: Number(entry.fraisOptionnelsTotal ?? 0),
        fraisOptionnelsDeclares: Number(entry.fraisOptionnelsDeclares ?? 0),
        debutDate: new Date(`${entry.debut}T00:00:00.000Z`),
      }))
      .filter((entry) => !Number.isNaN(entry.debutDate.getTime()));
  }

  return {
    gites: payload.gites ?? [],
    entriesByGite,
    availableYears: payload.availableYears ?? [],
    expenseSettings: payload.expenseSettings ?? DEFAULT_EXPENSE_SETTINGS,
  };
};

const normalizeExpenseAmount = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

const roundExpenseMoney = (value: number) => Math.round(value * 100) / 100;

const getYearPeriodMonthCount = (year: number, month: PeriodMonth, now: Date) => {
  const currentYear = now.getUTCFullYear();
  if (year < currentYear) return month ? 1 : 12;
  if (year > currentYear) return 0;

  if (month) {
    const selectedMonthIndex = Number(month) - 1;
    if (selectedMonthIndex < now.getUTCMonth()) return 1;
    if (selectedMonthIndex > now.getUTCMonth()) return 0;
    const daysInMonth = new Date(Date.UTC(year, selectedMonthIndex + 1, 0)).getUTCDate();
    return Math.min(1, now.getUTCDate() / daysInMonth);
  }

  const yearStart = Date.UTC(year, 0, 1);
  const nextDay = Date.UTC(year, now.getUTCMonth(), now.getUTCDate() + 1);
  const nextYear = Date.UTC(year + 1, 0, 1);
  return ((nextDay - yearStart) / (nextYear - yearStart)) * 12;
};

export const getStatisticsPeriodMonthCount = (
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  availableYears: number[],
  now = new Date()
) => {
  const years = selectedYear === "all"
    ? [...new Set(availableYears.length ? availableYears : [now.getUTCFullYear()])]
    : [selectedYear];
  return years.reduce((sum, year) => sum + getYearPeriodMonthCount(year, selectedMonth, now), 0);
};

const getFixedExpenseAmount = (
  expense: Partial<StatisticsExpenseLine>,
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  availableYears: number[],
  now: Date
) => {
  const monthly = normalizeExpenseAmount(expense.monthly_amount);
  const annual = normalizeExpenseAmount(expense.annual_amount);
  const normalizedMonthly = monthly || annual / 12;
  const normalizedAnnual = annual || normalizedMonthly * 12;
  const years = selectedYear === "all"
    ? [...new Set(availableYears.length ? availableYears : [now.getUTCFullYear()])]
    : [selectedYear];
  return years.reduce((sum, year) => {
    const monthCount = getYearPeriodMonthCount(year, selectedMonth, now);
    return sum + (selectedMonth ? normalizedMonthly * monthCount : normalizedAnnual * (monthCount / 12));
  }, 0);
};

export const computeExpenseReport = (params: {
  entriesByGite: Record<string, ParsedStatisticsEntry[]>;
  gites: StatisticsGite[];
  expenseSettings: StatisticsExpenseSettings;
  selectedYear: PeriodYear;
  selectedMonth: PeriodMonth;
  availableYears: number[];
  now?: Date;
}): ExpenseReport => {
  const { entriesByGite, gites, selectedYear, selectedMonth, availableYears } = params;
  const now = params.now ?? new Date();
  const categories = params.expenseSettings.categories.length
    ? params.expenseSettings.categories
    : DEFAULT_EXPENSE_SETTINGS.categories;
  const dynamicRules = params.expenseSettings.dynamic_expenses.filter((rule) => rule.enabled);
  const fallbackCategoryId = categories[0]?.id ?? "other";
  const categoryTotals = new Map(categories.map((category) => [category.id, { amount: 0, lineCount: 0 }]));

  const rowsByGite = gites.map((gite) => {
    const configuredExpenses = Array.isArray(gite.frais_gestion?.expenses)
      ? gite.frais_gestion.expenses
      : [];
    let fixed = 0;

    for (const expense of configuredExpenses) {
      const amount = getFixedExpenseAmount(expense, selectedYear, selectedMonth, availableYears, now);
      fixed += amount;
      const categoryId = categoryTotals.has(expense.category_id) ? expense.category_id : fallbackCategoryId;
      const category = categoryTotals.get(categoryId) ?? { amount: 0, lineCount: 0 };
      category.amount += amount;
      category.lineCount += 1;
      categoryTotals.set(categoryId, category);
    }

    const periodEntries = getEntriesByPeriod(
      entriesByGite[gite.id] ?? [],
      selectedYear,
      selectedMonth,
      { includeHomeExchange: true, now }
    );
    const urssafBase = periodEntries.reduce((sum, entry) => sum + getEntryUrssafBase(entry), 0);
    let dynamic = 0;
    for (const rule of dynamicRules) {
      const amount = urssafBase * Math.max(0, Number(rule.rate) || 0);
      dynamic += amount;
      const categoryId = categoryTotals.has(rule.category_id) ? rule.category_id : fallbackCategoryId;
      const category = categoryTotals.get(categoryId) ?? { amount: 0, lineCount: 0 };
      category.amount += amount;
      category.lineCount += 1;
      categoryTotals.set(categoryId, category);
    }

    const revenue = computeGiteStats(entriesByGite[gite.id] ?? [], selectedYear, selectedMonth, now).totalCA;
    fixed = roundExpenseMoney(fixed);
    dynamic = roundExpenseMoney(dynamic);
    const expenses = roundExpenseMoney(fixed + dynamic);
    return {
      id: gite.id,
      name: gite.nom,
      revenue,
      fixed,
      dynamic,
      expenses,
      net: roundExpenseMoney(revenue - expenses),
      expenseRate: revenue > 0 ? expenses / revenue : 0,
    };
  });

  const fixed = roundExpenseMoney(rowsByGite.reduce((sum, row) => sum + row.fixed, 0));
  const dynamic = roundExpenseMoney(rowsByGite.reduce((sum, row) => sum + row.dynamic, 0));
  const expenses = roundExpenseMoney(fixed + dynamic);
  const revenue = roundExpenseMoney(rowsByGite.reduce((sum, row) => sum + row.revenue, 0));
  const monthCount = getStatisticsPeriodMonthCount(selectedYear, selectedMonth, availableYears, now);

  return {
    fixed,
    dynamic,
    expenses,
    revenue,
    net: roundExpenseMoney(revenue - expenses),
    monthlyAverage: monthCount > 0 ? roundExpenseMoney(expenses / monthCount) : 0,
    expenseRate: revenue > 0 ? expenses / revenue : 0,
    monthCount,
    rowsByGite: rowsByGite.sort((left, right) => right.expenses - left.expenses || left.name.localeCompare(right.name, "fr")),
    rowsByCategory: categories
      .map((category) => {
        const totals = categoryTotals.get(category.id) ?? { amount: 0, lineCount: 0 };
        return { ...category, ...totals, amount: roundExpenseMoney(totals.amount) };
      })
      .filter((category) => category.amount > 0 || category.lineCount > 0)
      .sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name, "fr")),
  };
};

export const computeGlobalStats = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  year: PeriodYear,
  month: PeriodMonth,
  now = new Date()
) => {
  let totalReservations = 0;
  let totalNights = 0;
  let totalCA = 0;

  for (const entries of Object.values(entriesByGite)) {
    const filtered = getEntriesByPeriod(entries, year, month, { now });
    totalReservations += filtered.length;
    totalNights += filtered.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
    totalCA += filtered.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  }

  return { totalReservations, totalNights, totalCA };
};

export const computeGiteStats = (
  entries: ParsedStatisticsEntry[],
  year: PeriodYear,
  month: PeriodMonth,
  now = new Date()
) => {
  const filtered = getEntriesByPeriod(entries, year, month, { now });
  const reservations = filtered.length;
  const totalNights = filtered.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  const totalCA = filtered.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  const meanStay = reservations ? totalNights / reservations : 0;
  const meanPrice = totalNights ? totalCA / totalNights : 0;
  const payments: Record<string, number> = {};

  for (const entry of filtered) {
    const payment = entry.paiement?.trim() || "Indéfini";
    payments[payment] = (payments[payment] ?? 0) + getEntryGrossCA(entry);
  }

  return {
    reservations,
    totalNights,
    totalCA,
    meanStay,
    meanPrice,
    payments,
  };
};

const computeValue = (entries: ParsedStatisticsEntry[], metric: "CA" | "reservations" | "nights" | "price") => {
  if (metric === "CA") return entries.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  if (metric === "reservations") return entries.length;
  if (metric === "nights") return entries.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  const totalCA = entries.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  const totalNights = entries.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  return totalNights > 0 ? totalCA / totalNights : 0;
};

const computeAverageMetric = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  metric: "CA" | "reservations" | "nights" | "price",
  activityStart?: ActivityStart
) => {
  if (!entries.length) return 0;

  const years = [...new Set(entries.map((entry) => entry.debutDate.getUTCFullYear()))];
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentDay = now.getUTCDate();

  if (selectedYear === "all") {
    const values = years
      .filter((year) => isFullyActivePeriod(activityStart, year, selectedMonth, now))
      .map((year) => {
        const filtered = filterByPeriod(entries, year, selectedMonth);
        return filtered.length > 0 ? computeValue(filtered, metric) : null;
      })
      .filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  const values = years
    .filter(
      (year) =>
        year !== selectedYear &&
        isFullyActivePeriod(activityStart, year, selectedMonth, now)
    )
    .map((year) => {
      let filtered: ParsedStatisticsEntry[];

      if (selectedMonth) {
        filtered = entries.filter(
          (entry) =>
            entry.debutDate.getUTCFullYear() === year &&
            entry.debutDate.getUTCMonth() + 1 === Number(selectedMonth) &&
            !isHomeExchange(entry)
        );
      } else if (selectedYear === currentYear || year === currentYear) {
        const start = Date.UTC(year, 0, 1);
        const end = Date.UTC(year, currentMonth, currentDay + 1);
        filtered = entries.filter((entry) => {
          const time = entry.debutDate.getTime();
          return entry.debutDate.getUTCFullYear() === year && time >= start && time < end && !isHomeExchange(entry);
        });
      } else {
        filtered = entries.filter((entry) => entry.debutDate.getUTCFullYear() === year && !isHomeExchange(entry));
      }

      return filtered.length > 0 ? computeValue(filtered, metric) : null;
    })
    .filter((value): value is number => value !== null);

  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
};

export const computeAverageCA = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "CA", activityStart);

export const computeAverageReservations = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "reservations", activityStart);

export const computeAverageNights = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "nights", activityStart);

export const computeAveragePrice = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "price", activityStart);

const getEntryNightsInPeriod = (entry: ParsedStatisticsEntry, periodStart: number, periodEnd: number) => {
  const entryStart = entry.debutDate.getTime();
  const entryEnd = entryStart + Math.max(0, Number(entry.nuits) || 0) * DAY_MS;
  const overlapStart = Math.max(entryStart, periodStart);
  const overlapEnd = Math.min(entryEnd, periodEnd);
  return overlapEnd > overlapStart ? Math.round((overlapEnd - overlapStart) / DAY_MS) : 0;
};

export const computeOccupation = (
  entries: ParsedStatisticsEntry[],
  year: number,
  month: PeriodMonth,
  activityStart: ActivityStart = null,
  now = new Date()
) => {
  const filtered = filterByPeriod(entries, year, month);
  const bounds = getPeriodBounds(year, month, now);
  const activityStartTime = getActivityStartTime(activityStart);
  const periodStart = activityStartTime === null ? bounds.start : Math.max(bounds.start, activityStartTime);
  const periodEnd = bounds.end;
  if (periodStart >= periodEnd) return 0;

  const totalNights = filtered.reduce(
    (sum, entry) => sum + getEntryNightsInPeriod(entry, periodStart, periodEnd),
    0
  );
  const daysInPeriod = Math.round((periodEnd - periodStart) / DAY_MS);

  return daysInPeriod > 0 ? totalNights / daysInPeriod : 0;
};

export const getOccupationPerYear = (
  entries: ParsedStatisticsEntry[],
  years: number[],
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) =>
  years
    .filter((year) => isActivityPeriodAvailable(activityStart, year, selectedMonth))
    .map((year) => ({
      year,
      occupation: computeOccupation(entries, year, selectedMonth, activityStart),
    }));

export const getMonthlyCAByYear = (entriesByGite: Record<string, ParsedStatisticsEntry[]>) => {
  const result: Record<number, { months: Array<{ month: number; ca: number }>; total: number }> = {};

  for (const entries of Object.values(entriesByGite)) {
    for (const entry of entries) {
      if (isHomeExchange(entry)) continue;
      const year = entry.debutDate.getUTCFullYear();
      const monthIdx = entry.debutDate.getUTCMonth();
      if (!result[year]) result[year] = { months: Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, ca: 0 })), total: 0 };
      const grossCA = getEntryGrossCA(entry);
      result[year].months[monthIdx].ca += grossCA;
      result[year].total += grossCA;
    }
  }

  return result;
};

export const getMonthlyCAByGiteForYear = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  year: number
) => {
  const result: Record<string, { months: Array<{ month: number; ca: number }>; total: number }> = {};

  for (const gite of gites) {
    const months = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, ca: 0 }));
    let total = 0;

    for (const entry of entriesByGite[gite.id] ?? []) {
      if (isHomeExchange(entry)) continue;
      if (entry.debutDate.getUTCFullYear() !== year) continue;
      const monthIdx = entry.debutDate.getUTCMonth();
      const grossCA = getEntryGrossCA(entry);
      months[monthIdx].ca += grossCA;
      total += grossCA;
    }

    result[gite.id] = { months, total };
  }

  return result;
};

export const getMonthlyAverageCA = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  options?: {
    excludeFutureMonthsInCurrentYear?: boolean;
    activityStart?: ActivityStart;
  }
) => {
  const byYear = getMonthlyCAByYear(entriesByGite);
  const years = Object.keys(byYear).map(Number);
  const sums = Array(12).fill(0);
  const counts = Array(12).fill(0);
  const excludeFutureMonthsInCurrentYear = options?.excludeFutureMonthsInCurrentYear ?? true;
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  for (const year of years) {
    byYear[year].months.forEach((monthStat, idx) => {
      if (excludeFutureMonthsInCurrentYear && year === currentYear && idx > currentMonth) return;
      if (!isFullyActivePeriod(options?.activityStart, year, idx + 1, now)) return;
      sums[idx] += monthStat.ca;
      counts[idx] += 1;
    });
  }

  return sums.map((sum, idx) => ({ month: idx + 1, ca: counts[idx] ? sum / counts[idx] : 0 }));
};

export const computeUrssafByManager = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  now = new Date()
) => {
  const byManager: Record<string, UrssafManagerAmount> = {};

  for (const gite of gites) {
    if (!gite.gestionnaire?.id) continue;
    if (!byManager[gite.gestionnaire.id]) {
      byManager[gite.gestionnaire.id] = {
        managerId: gite.gestionnaire.id,
        manager: `${gite.gestionnaire.prenom} ${gite.gestionnaire.nom}`.trim(),
        amount: 0,
      };
    }
  }

  for (const gite of gites) {
    if (!gite.gestionnaire?.id) continue;
    const entries = getEntriesByPeriod(entriesByGite[gite.id] ?? [], selectedYear, selectedMonth, {
      includeHomeExchange: true,
      now,
    });
    for (const entry of entries) {
      byManager[gite.gestionnaire.id].amount += getEntryUrssafBase(entry);
    }
  }

  return Object.values(byManager)
    .sort((left, right) => right.amount - left.amount || left.manager.localeCompare(right.manager, "fr"));
};

export const computeGuestNightsByGite = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  excludedSources: string[],
  now = new Date()
) => {
  const excludedSourceKeys = new Set(excludedSources.map((source) => normalizeLabel(source)).filter(Boolean));
  const byGite: Record<string, GuestNightGiteAmount> = {};

  for (const gite of gites) {
    byGite[gite.id] = {
      giteId: gite.id,
      giteName: gite.nom,
      managerName: gite.gestionnaire ? `${gite.gestionnaire.nom} ${gite.gestionnaire.prenom}`.trim() : null,
      guestNights: 0,
    };
  }

  for (const gite of gites) {
    const entries = getEntriesByPeriod(entriesByGite[gite.id] ?? [], selectedYear, selectedMonth, {
      includeHomeExchange: true,
      now,
    });
    for (const entry of entries) {
      if (excludedSourceKeys.has(normalizeLabel(entry.paiement))) continue;
      byGite[gite.id].guestNights += Math.max(0, Number(entry.nuits || 0)) * Math.max(0, Number(entry.adultes || 0));
    }
  }

  return Object.values(byGite)
    .filter((item) => item.guestNights > 0)
    .sort((left, right) => left.giteName.localeCompare(right.giteName, "fr", { sensitivity: "base" }));
};

export const computeChequeVirementNightsByGite = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  now = new Date()
) => {
  const nights: Record<string, number> = {};

  for (const gite of gites) {
    let sum = 0;
    const entries = getEntriesByPeriod(entriesByGite[gite.id] ?? [], selectedYear, selectedMonth, {
      includeHomeExchange: true,
      now,
    });
    for (const entry of entries) {
      const payment = normalizeLabel(entry.paiement);
      if (payment.includes("virement") || payment.includes("cheque")) {
        sum += (entry.nuits || 0) * (entry.adultes || 0);
      }
    }
    nights[gite.id] = sum;
  }

  return nights;
};

export { getPaymentColor };

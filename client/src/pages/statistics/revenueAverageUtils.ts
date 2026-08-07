import {
  getEntryGrossCA,
  getEntryUrssafBase,
  type ParsedStatisticsPayload,
} from "./statisticsUtils";

type DynamicExpenseRule = {
  enabled: boolean;
  rate: number;
};

const roundMoney = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? Math.round(numericValue * 100) / 100
    : 0;
};

const normalizeRevenueLabel = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

export const getRevenueAveragePeriod = (now = new Date()) => {
  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;
  const currentMonth = now.getMonth() + 1;
  const completedCurrentYearMonths = Math.max(0, currentMonth - 1);

  return {
    previousYear,
    currentYear,
    completedCurrentYearMonths,
    monthCount: 12 + completedCurrentYearMonths,
  };
};

export const getNetAverageMonthlyRevenue = (
  dataset: ParsedStatisticsPayload | null,
  giteId: string | null,
  monthlyExpenses: number,
  dynamicExpenseRules: DynamicExpenseRule[] = [],
  now = new Date()
) => {
  const period = getRevenueAveragePeriod(now);
  if (!dataset || !giteId || period.monthCount <= 0) {
    return {
      ...period,
      grossRevenue: 0,
      expenses: 0,
      netAverage: 0,
    };
  }

  const periodEntries = (dataset.entriesByGite[giteId] ?? []).filter((entry) => {
    const year = entry.debutDate.getUTCFullYear();
    const month = entry.debutDate.getUTCMonth() + 1;
    if (normalizeRevenueLabel(entry.paiement) === "homeexchange") return false;
    return year === period.previousYear
      || (year === period.currentYear && month <= period.completedCurrentYearMonths);
  });
  const grossRevenue = periodEntries.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  const dynamicExpenses = periodEntries.reduce((sum, entry) => {
    const base = getEntryUrssafBase(entry);
    return sum + dynamicExpenseRules
      .filter((rule) => rule.enabled)
      .reduce((ruleSum, rule) => ruleSum + base * rule.rate, 0);
  }, 0);
  const expenses = roundMoney(monthlyExpenses * period.monthCount + dynamicExpenses);

  return {
    ...period,
    grossRevenue,
    expenses,
    netAverage: period.monthCount > 0 ? (grossRevenue - expenses) / period.monthCount : 0,
  };
};

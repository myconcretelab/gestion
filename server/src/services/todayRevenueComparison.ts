const round2 = (value: number) => Math.round(value * 100) / 100;

export type TodayRevenueComparison = {
  reference_label: string;
  reference_net_revenue: number;
  difference: number;
  prorated: boolean;
  elapsed_days: number | null;
  days_in_month: number | null;
};

type TodayRevenueComparisonParams = {
  currentNetRevenue: number;
  referenceMonthNetRevenue: number;
  referenceLabel: string;
  today: Date;
  prorateReference: boolean;
};

export const getUtcDaysInMonth = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

export const buildTodayRevenueComparison = ({
  currentNetRevenue,
  referenceMonthNetRevenue,
  referenceLabel,
  today,
  prorateReference,
}: TodayRevenueComparisonParams): TodayRevenueComparison => {
  const daysInMonth = prorateReference ? getUtcDaysInMonth(today) : null;
  const elapsedDays = prorateReference ? Math.min(today.getUTCDate(), daysInMonth ?? 1) : null;
  const referenceNetRevenue = prorateReference
    ? round2(referenceMonthNetRevenue * ((elapsedDays ?? 0) / (daysInMonth ?? 1)))
    : round2(referenceMonthNetRevenue);

  return {
    reference_label: referenceLabel,
    reference_net_revenue: referenceNetRevenue,
    difference: round2(currentNetRevenue - referenceNetRevenue),
    prorated: prorateReference,
    elapsed_days: elapsedDays,
    days_in_month: daysInMonth,
  };
};

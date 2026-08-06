type GiteFinancialPeriod = {
  revenue: number;
  expenses: number;
  monthCount: number;
};

type PersonalFinancialPeriod = {
  total: number;
  recurring: number;
  paid: number;
  planned: number;
  byMonth: Array<{
    month: number;
    total: number;
    recurring: number;
    paid: number;
    planned: number;
    isFuture: boolean;
  }>;
};

export type ConsolidatedFinancialMonth = {
  month: number;
  revenue: number;
  giteExpenses: number;
  personalExpenses: number;
  personalRecurring: number;
  personalPaid: number;
  personalPlanned: number;
  totalExpenses: number;
  net: number;
  isFuture: boolean;
};

export type ConsolidatedFinancialReport = {
  revenue: number;
  giteExpenses: number;
  personalExpenses: number;
  personalRecurring: number;
  personalPaid: number;
  personalPlanned: number;
  totalExpenses: number;
  net: number;
  expenseRate: number;
  monthCount: number;
  revenueMonthlyAverage: number;
  giteExpensesMonthlyAverage: number;
  personalExpensesMonthlyAverage: number;
  netMonthlyAverage: number;
  months: ConsolidatedFinancialMonth[];
};

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export const computeConsolidatedFinancialReport = (params: {
  gitePeriod: GiteFinancialPeriod;
  giteMonths: GiteFinancialPeriod[];
  personalPeriod: PersonalFinancialPeriod;
}): ConsolidatedFinancialReport => {
  const revenue = round2(params.gitePeriod.revenue);
  const giteExpenses = round2(params.gitePeriod.expenses);
  const personalExpenses = round2(params.personalPeriod.total);
  const personalRecurring = round2(params.personalPeriod.recurring);
  const personalPaid = round2(params.personalPeriod.paid);
  const personalPlanned = round2(params.personalPeriod.planned);
  const totalExpenses = round2(giteExpenses + personalExpenses);
  const monthCount = Math.max(0, Number(params.gitePeriod.monthCount) || 0);

  const months = params.personalPeriod.byMonth.map((personalMonth, index) => {
    const giteMonth = params.giteMonths[index] ?? { revenue: 0, expenses: 0 };
    const monthRevenue = round2(giteMonth.revenue);
    const monthGiteExpenses = round2(giteMonth.expenses);
    const monthPersonalExpenses = round2(personalMonth.total);
    const monthPersonalRecurring = round2(personalMonth.recurring);
    const monthPersonalPaid = round2(personalMonth.paid);
    const monthPersonalPlanned = round2(personalMonth.planned);
    const monthTotalExpenses = round2(monthGiteExpenses + monthPersonalExpenses);
    return {
      month: personalMonth.month,
      revenue: monthRevenue,
      giteExpenses: monthGiteExpenses,
      personalExpenses: monthPersonalExpenses,
      personalRecurring: monthPersonalRecurring,
      personalPaid: monthPersonalPaid,
      personalPlanned: monthPersonalPlanned,
      totalExpenses: monthTotalExpenses,
      net: round2(monthRevenue - monthTotalExpenses),
      isFuture: personalMonth.isFuture,
    };
  });

  return {
    revenue,
    giteExpenses,
    personalExpenses,
    personalRecurring,
    personalPaid,
    personalPlanned,
    totalExpenses,
    net: round2(revenue - totalExpenses),
    expenseRate: revenue > 0 ? totalExpenses / revenue : 0,
    monthCount,
    revenueMonthlyAverage: monthCount > 0 ? round2(revenue / monthCount) : 0,
    giteExpensesMonthlyAverage: monthCount > 0 ? round2(giteExpenses / monthCount) : 0,
    personalExpensesMonthlyAverage: monthCount > 0 ? round2(personalExpenses / monthCount) : 0,
    netMonthlyAverage: monthCount > 0 ? round2((revenue - totalExpenses) / monthCount) : 0,
    months,
  };
};

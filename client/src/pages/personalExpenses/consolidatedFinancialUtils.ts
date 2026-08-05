type GiteFinancialPeriod = {
  revenue: number;
  expenses: number;
};

type PersonalFinancialPeriod = {
  total: number;
  byMonth: Array<{
    month: number;
    total: number;
    isFuture: boolean;
  }>;
};

export type ConsolidatedFinancialMonth = {
  month: number;
  revenue: number;
  giteExpenses: number;
  personalExpenses: number;
  totalExpenses: number;
  net: number;
  isFuture: boolean;
};

export type ConsolidatedFinancialReport = {
  revenue: number;
  giteExpenses: number;
  personalExpenses: number;
  totalExpenses: number;
  net: number;
  expenseRate: number;
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
  const totalExpenses = round2(giteExpenses + personalExpenses);

  const months = params.personalPeriod.byMonth.map((personalMonth, index) => {
    const giteMonth = params.giteMonths[index] ?? { revenue: 0, expenses: 0 };
    const monthRevenue = round2(giteMonth.revenue);
    const monthGiteExpenses = round2(giteMonth.expenses);
    const monthPersonalExpenses = round2(personalMonth.total);
    const monthTotalExpenses = round2(monthGiteExpenses + monthPersonalExpenses);
    return {
      month: personalMonth.month,
      revenue: monthRevenue,
      giteExpenses: monthGiteExpenses,
      personalExpenses: monthPersonalExpenses,
      totalExpenses: monthTotalExpenses,
      net: round2(monthRevenue - monthTotalExpenses),
      isFuture: personalMonth.isFuture,
    };
  });

  return {
    revenue,
    giteExpenses,
    personalExpenses,
    totalExpenses,
    net: round2(revenue - totalExpenses),
    expenseRate: revenue > 0 ? totalExpenses / revenue : 0,
    months,
  };
};

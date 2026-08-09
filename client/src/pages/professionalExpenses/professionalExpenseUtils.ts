export type ProfessionalExpenseCategory = {
  id: string;
  name: string;
  color: string;
};

export type ProfessionalRecurringExpense = {
  id: string;
  label: string;
  category_id: string;
  monthly_amount: number;
  annual_amount: number;
  notes?: string;
};

export type ProfessionalOneOffExpense = {
  id: string;
  label: string;
  scope: "all_gites" | "gite";
  gite_id: string | null;
  gite_nom?: string | null;
  year: number;
  month: number;
  amount: number;
};

export type ProfessionalExpenseMonth = {
  month: number;
  recurring: number;
  oneOff: number;
  total: number;
};

export type ProfessionalExpenseDistribution = {
  id: string;
  name: string;
  color: string;
  recurring: number;
  oneOff: number;
  total: number;
};

export type ProfessionalExpenseScopeReport = {
  id: string;
  name: string;
  recurring: number;
  oneOff: number;
  total: number;
  share: number;
};

export type ProfessionalExpenseOverview = {
  recurringMonthly: number;
  recurringAnnual: number;
  oneOffTotal: number;
  total: number;
  monthlyAverage: number;
  months: ProfessionalExpenseMonth[];
  distribution: ProfessionalExpenseDistribution[];
  scopes: ProfessionalExpenseScopeReport[];
};

const money = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const computeProfessionalExpenseOverview = (params: {
  year: number;
  categories: ProfessionalExpenseCategory[];
  gites: Array<{ id: string; nom: string }>;
  recurringByGite: Record<string, { expenses: ProfessionalRecurringExpense[] } | undefined>;
  oneOffExpenses: ProfessionalOneOffExpense[];
}): ProfessionalExpenseOverview => {
  const { year, categories, gites, recurringByGite } = params;
  const oneOffExpenses = params.oneOffExpenses.filter((expense) => expense.year === year);
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    recurring: 0,
    oneOff: 0,
    total: 0,
  }));
  const categoryRows = new Map(categories.map((category) => [category.id, {
    id: category.id,
    name: category.name,
    color: category.color,
    recurring: 0,
    oneOff: 0,
    total: 0,
  }]));
  const scopeRows = new Map(gites.map((gite) => [gite.id, {
    id: gite.id,
    name: gite.nom,
    recurring: 0,
    oneOff: 0,
    total: 0,
    share: 0,
  }]));

  let recurringAnnual = 0;
  for (const gite of gites) {
    const scope = scopeRows.get(gite.id);
    for (const expense of recurringByGite[gite.id]?.expenses ?? []) {
      const monthly = money(expense.monthly_amount) || money(expense.annual_amount) / 12;
      const annual = money(expense.annual_amount) || monthly * 12;
      recurringAnnual += annual;
      if (scope) scope.recurring += annual;
      let category = categoryRows.get(expense.category_id);
      if (!category) {
        category = {
          id: "uncategorized",
          name: "Autres frais récurrents",
          color: "#94A3B8",
          recurring: 0,
          oneOff: 0,
          total: 0,
        };
        categoryRows.set(category.id, category);
      }
      category.recurring += annual;
      for (const month of months) month.recurring += monthly;
    }
  }

  let oneOffTotal = 0;
  for (const expense of oneOffExpenses) {
    const amount = money(expense.amount);
    oneOffTotal += amount;
    if (expense.month >= 1 && expense.month <= 12) months[expense.month - 1].oneOff += amount;
    if (expense.scope === "gite" && expense.gite_id && scopeRows.has(expense.gite_id)) {
      scopeRows.get(expense.gite_id)!.oneOff += amount;
    } else if (expense.scope === "gite") {
      const id = `deleted:${expense.gite_id ?? "unknown"}`;
      const scope = scopeRows.get(id) ?? {
        id,
        name: expense.gite_nom || "Gîte supprimé",
        recurring: 0,
        oneOff: 0,
        total: 0,
        share: 0,
      };
      scope.oneOff += amount;
      scopeRows.set(id, scope);
    }
  }

  const globalOneOff = oneOffExpenses
    .filter((expense) => expense.scope === "all_gites")
    .reduce((sum, expense) => sum + money(expense.amount), 0);
  if (globalOneOff > 0) {
    scopeRows.set("all_gites", {
      id: "all_gites",
      name: "Frais globaux",
      recurring: 0,
      oneOff: globalOneOff,
      total: 0,
      share: 0,
    });
  }

  if (oneOffTotal > 0) {
    categoryRows.set("one_off", {
      id: "one_off",
      name: "Frais ponctuels",
      color: "#43B77D",
      recurring: 0,
      oneOff: oneOffTotal,
      total: oneOffTotal,
    });
  }

  const total = recurringAnnual + oneOffTotal;
  const normalizedMonths = months.map((month) => ({
    month: month.month,
    recurring: roundMoney(month.recurring),
    oneOff: roundMoney(month.oneOff),
    total: roundMoney(month.recurring + month.oneOff),
  }));
  const distribution = [...categoryRows.values()]
    .map((row) => ({
      ...row,
      recurring: roundMoney(row.recurring),
      oneOff: roundMoney(row.oneOff),
      total: roundMoney(row.recurring + row.oneOff),
    }))
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total);
  const scopes = [...scopeRows.values()]
    .map((row) => {
      const rowTotal = row.recurring + row.oneOff;
      return {
        ...row,
        recurring: roundMoney(row.recurring),
        oneOff: roundMoney(row.oneOff),
        total: roundMoney(rowTotal),
        share: total > 0 ? rowTotal / total : 0,
      };
    })
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total);

  return {
    recurringMonthly: roundMoney(recurringAnnual / 12),
    recurringAnnual: roundMoney(recurringAnnual),
    oneOffTotal: roundMoney(oneOffTotal),
    total: roundMoney(total),
    monthlyAverage: roundMoney(total / 12),
    months: normalizedMonths,
    distribution,
    scopes,
  };
};

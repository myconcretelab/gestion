export type ExpenseManager = { id: string; prenom: string; nom: string };
export type ExpenseCategory = { id: string; name: string; color: string; scope: string; ordre: number };

export type PersonalRecurringExpense = {
  id: string;
  label: string;
  frequency: "monthly" | "annual";
  amount: number;
  start_date: string;
  end_date: string | null;
  notes: string;
  is_active: boolean;
  category_id: string;
  gestionnaire_id: string;
  category: ExpenseCategory;
  gestionnaire: ExpenseManager;
};

export type PersonalExpenseEntry = {
  id: string;
  label: string;
  amount: number;
  expense_date: string;
  status: "planned" | "paid";
  notes: string;
  category_id: string;
  gestionnaire_id: string;
  category: ExpenseCategory;
  gestionnaire: ExpenseManager;
};

export type PersonalExpensePayload = {
  managers: ExpenseManager[];
  categories: ExpenseCategory[];
  recurring: PersonalRecurringExpense[];
  entries: PersonalExpenseEntry[];
};

export type PersonalExpenseReport = {
  recurring: number;
  paid: number;
  planned: number;
  total: number;
  monthlyAverage: number;
  elapsedMonths: number;
  byManager: Array<{ id: string; name: string; recurring: number; occasional: number; total: number }>;
  byCategory: Array<ExpenseCategory & { total: number }>;
  byMonth: Array<{
    month: number;
    recurring: number;
    paid: number;
    planned: number;
    total: number;
    isFuture: boolean;
  }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (value: number) => Math.round(value * 100) / 100;

export const getRecurringExpenseEquivalents = (
  expense: Pick<PersonalRecurringExpense, "amount" | "frequency">
) => {
  const amount = Math.max(0, Number(expense.amount) || 0);
  return expense.frequency === "monthly"
    ? { monthly: round2(amount), annual: round2(amount * 12) }
    : { monthly: round2(amount / 12), annual: round2(amount) };
};

const utcDay = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const getYearPeriod = (year: number, now: Date) => {
  const start = Date.UTC(year, 0, 1);
  const fullEnd = Date.UTC(year + 1, 0, 1);
  if (year < now.getUTCFullYear()) return { start, end: fullEnd };
  if (year > now.getUTCFullYear()) return { start, end: start };
  return { start, end: Math.min(fullEnd, Date.UTC(year, now.getUTCMonth(), now.getUTCDate() + 1)) };
};

const overlapDays = (startA: number, endA: number, startB: number, endB: number) =>
  Math.max(0, Math.round((Math.min(endA, endB) - Math.max(startA, startB)) / DAY_MS));

const getRecurringExpenseRawAmountForMonth = (
  expense: PersonalRecurringExpense,
  year: number,
  month: number,
  now: Date
) => {
  if (!expense.is_active) return 0;
  const yearPeriod = getYearPeriod(year, now);
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 1);
  const periodStart = Math.max(yearPeriod.start, monthStart);
  const periodEnd = Math.min(yearPeriod.end, monthEnd);
  if (periodEnd <= periodStart) return 0;
  const activeStart = utcDay(expense.start_date);
  const activeEnd = expense.end_date ? utcDay(expense.end_date) + DAY_MS : Number.POSITIVE_INFINITY;
  if (activeStart >= periodEnd || activeEnd <= periodStart) return 0;

  const daysInMonth = Math.round((monthEnd - monthStart) / DAY_MS);
  const days = overlapDays(periodStart, periodEnd, activeStart, activeEnd);
  const monthlyAmount = expense.frequency === "annual"
    ? Number(expense.amount) / 12
    : Number(expense.amount);
  return (monthlyAmount * days) / daysInMonth;
};

export const getRecurringExpenseAmountForYear = (
  expense: PersonalRecurringExpense,
  year: number,
  now = new Date()
) => {
  let total = 0;
  for (let month = 1; month <= 12; month += 1) {
    total += getRecurringExpenseRawAmountForMonth(expense, year, month, now);
  }
  return round2(total);
};

export const getRecurringExpenseAmountForFullYear = (
  expense: PersonalRecurringExpense,
  year: number
) => getRecurringExpenseAmountForYear(expense, year, new Date(Date.UTC(year + 1, 0, 1)));

export const computeRecurringMonthlyCategoryTotals = (
  expenses: PersonalRecurringExpense[],
  year: number
) => {
  const totals = new Map<string, {
    id: string;
    name: string;
    color: string;
    monthlyTotal: number;
    expenseCount: number;
  }>();

  for (const expense of expenses) {
    if (!expense.is_active || getRecurringExpenseAmountForFullYear(expense, year) <= 0) continue;
    const current = totals.get(expense.category_id) ?? {
      id: expense.category.id,
      name: expense.category.name,
      color: expense.category.color,
      monthlyTotal: 0,
      expenseCount: 0,
    };
    current.monthlyTotal += getRecurringExpenseEquivalents(expense).monthly;
    current.expenseCount += 1;
    totals.set(expense.category_id, current);
  }

  const byCategory = [...totals.values()]
    .map((category) => ({ ...category, monthlyTotal: round2(category.monthlyTotal) }))
    .sort((left, right) => right.monthlyTotal - left.monthlyTotal || left.name.localeCompare(right.name, "fr"));

  return {
    monthlyTotal: round2(byCategory.reduce((sum, category) => sum + category.monthlyTotal, 0)),
    expenseCount: byCategory.reduce((sum, category) => sum + category.expenseCount, 0),
    byCategory,
  };
};

export const getRecurringExpenseAmountForMonth = (
  expense: PersonalRecurringExpense,
  year: number,
  month: number,
  now = new Date()
) => round2(getRecurringExpenseRawAmountForMonth(expense, year, month, now));

export const computePersonalExpenseReport = (params: {
  payload: PersonalExpensePayload;
  year: number;
  managerId: string | "all";
  now?: Date;
}): PersonalExpenseReport => {
  const { payload, year, managerId } = params;
  const now = params.now ?? new Date();
  const period = getYearPeriod(year, now);
  const elapsedMonths = year < now.getUTCFullYear()
    ? 12
    : year > now.getUTCFullYear()
      ? 0
      : now.getUTCMonth() + (now.getUTCDate() / new Date(Date.UTC(year, now.getUTCMonth() + 1, 0)).getUTCDate());
  const managers = payload.managers.filter((manager) => managerId === "all" || manager.id === managerId);
  const managerTotals = new Map(managers.map((manager) => [manager.id, {
    id: manager.id,
    name: `${manager.prenom} ${manager.nom}`.trim(),
    recurring: 0,
    occasional: 0,
    total: 0,
  }]));
  const categoryTotals = new Map(payload.categories.map((category) => [category.id, 0]));
  const byMonth = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    recurring: 0,
    paid: 0,
    planned: 0,
    total: 0,
    isFuture: year > now.getUTCFullYear() || (year === now.getUTCFullYear() && index > now.getUTCMonth()),
  }));
  let recurring = 0;
  let paid = 0;
  let planned = 0;

  for (const expense of payload.recurring) {
    if (managerId !== "all" && expense.gestionnaire_id !== managerId) continue;
    const monthlyAmounts = byMonth.map((month) =>
      getRecurringExpenseAmountForMonth(expense, year, month.month, now)
    );
    const amount = getRecurringExpenseAmountForYear(expense, year, now);
    const roundedMonthlyTotal = round2(monthlyAmounts.reduce((sum, monthlyAmount) => sum + monthlyAmount, 0));
    const correction = round2(amount - roundedMonthlyTotal);
    if (correction !== 0) {
      let lastActiveMonth = -1;
      for (let index = monthlyAmounts.length - 1; index >= 0; index -= 1) {
        if (monthlyAmounts[index] > 0) {
          lastActiveMonth = index;
          break;
        }
      }
      if (lastActiveMonth >= 0) monthlyAmounts[lastActiveMonth] = round2(monthlyAmounts[lastActiveMonth] + correction);
    }
    monthlyAmounts.forEach((monthlyAmount, index) => {
      byMonth[index].recurring += monthlyAmount;
    });
    recurring += amount;
    const manager = managerTotals.get(expense.gestionnaire_id);
    if (manager) manager.recurring += amount;
    categoryTotals.set(expense.category_id, (categoryTotals.get(expense.category_id) ?? 0) + amount);
  }

  for (const entry of payload.entries) {
    if (managerId !== "all" && entry.gestionnaire_id !== managerId) continue;
    const date = utcDay(entry.expense_date);
    if (date < period.start || date >= period.end) continue;
    const amount = Math.max(0, Number(entry.amount) || 0);
    const monthIndex = new Date(entry.expense_date).getUTCMonth();
    if (entry.status === "paid") {
      paid += amount;
      byMonth[monthIndex].paid += amount;
    } else {
      planned += amount;
      byMonth[monthIndex].planned += amount;
    }
    const manager = managerTotals.get(entry.gestionnaire_id);
    if (manager) manager.occasional += amount;
    categoryTotals.set(entry.category_id, (categoryTotals.get(entry.category_id) ?? 0) + amount);
  }

  const byManager = [...managerTotals.values()].map((row) => ({
    ...row,
    recurring: round2(row.recurring),
    occasional: round2(row.occasional),
    total: round2(row.recurring + row.occasional),
  })).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "fr"));
  const total = round2(recurring + paid + planned);

  return {
    recurring: round2(recurring),
    paid: round2(paid),
    planned: round2(planned),
    total,
    monthlyAverage: elapsedMonths > 0 ? round2(total / elapsedMonths) : 0,
    elapsedMonths,
    byManager,
    byCategory: payload.categories
      .map((category) => ({ ...category, total: round2(categoryTotals.get(category.id) ?? 0) }))
      .filter((category) => category.total > 0)
      .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "fr")),
    byMonth: byMonth.map((month) => ({
      ...month,
      recurring: round2(month.recurring),
      paid: round2(month.paid),
      planned: round2(month.planned),
      total: round2(month.recurring + month.paid + month.planned),
    })),
  };
};

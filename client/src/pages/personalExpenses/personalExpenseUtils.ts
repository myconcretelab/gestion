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
};

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (value: number) => Math.round(value * 100) / 100;
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

export const getRecurringExpenseAmountForYear = (
  expense: PersonalRecurringExpense,
  year: number,
  now = new Date()
) => {
  if (!expense.is_active) return 0;
  const period = getYearPeriod(year, now);
  if (period.end <= period.start) return 0;
  const activeStart = utcDay(expense.start_date);
  const activeEnd = expense.end_date ? utcDay(expense.end_date) + DAY_MS : Number.POSITIVE_INFINITY;
  if (activeStart >= period.end || activeEnd <= period.start) return 0;

  if (expense.frequency === "annual") {
    const daysInYear = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS);
    const days = overlapDays(period.start, period.end, activeStart, activeEnd);
    return round2((Number(expense.amount) * days) / daysInYear);
  }

  let total = 0;
  for (let month = 0; month < 12; month += 1) {
    const monthStart = Date.UTC(year, month, 1);
    const monthEnd = Date.UTC(year, month + 1, 1);
    const daysInMonth = Math.round((monthEnd - monthStart) / DAY_MS);
    const days = overlapDays(monthStart, monthEnd, Math.max(period.start, activeStart), Math.min(period.end, activeEnd));
    total += (Number(expense.amount) * days) / daysInMonth;
  }
  return round2(total);
};

export const computePersonalExpenseReport = (params: {
  payload: PersonalExpensePayload;
  year: number;
  managerId: string | "all";
  now?: Date;
}): PersonalExpenseReport => {
  const { payload, year, managerId } = params;
  const now = params.now ?? new Date();
  const period = getYearPeriod(year, now);
  const elapsedMonths = period.end > period.start
    ? ((period.end - period.start) / (Date.UTC(year + 1, 0, 1) - period.start)) * 12
    : 0;
  const managers = payload.managers.filter((manager) => managerId === "all" || manager.id === managerId);
  const managerTotals = new Map(managers.map((manager) => [manager.id, {
    id: manager.id,
    name: `${manager.prenom} ${manager.nom}`.trim(),
    recurring: 0,
    occasional: 0,
    total: 0,
  }]));
  const categoryTotals = new Map(payload.categories.map((category) => [category.id, 0]));
  let recurring = 0;
  let paid = 0;
  let planned = 0;

  for (const expense of payload.recurring) {
    if (managerId !== "all" && expense.gestionnaire_id !== managerId) continue;
    const amount = getRecurringExpenseAmountForYear(expense, year, now);
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
    if (entry.status === "paid") paid += amount;
    else planned += amount;
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
  };
};

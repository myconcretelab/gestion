import assert from "node:assert/strict";
import test from "node:test";
import {
  computePersonalExpenseReport,
  getRecurringExpenseEquivalents,
  getRecurringExpenseAmountForMonth,
  getRecurringExpenseAmountForFullYear,
  getRecurringExpenseAmountForYear,
  type PersonalExpensePayload,
} from "../src/pages/personalExpenses/personalExpenseUtils.ts";
import { computeConsolidatedFinancialReport } from "../src/pages/personalExpenses/consolidatedFinancialUtils.ts";

const manager = { id: "manager-1", prenom: "Camille", nom: "Martin" };
const category = { id: "category-1", name: "Assurance", color: "#2D8CFF", scope: "personal", ordre: 0 };
const payload: PersonalExpensePayload = {
  managers: [manager],
  categories: [category],
  recurring: [
    {
      id: "monthly",
      label: "Mutuelle",
      frequency: "monthly",
      amount: 100,
      start_date: "2026-01-01T00:00:00.000Z",
      end_date: null,
      notes: "",
      is_active: true,
      category_id: category.id,
      gestionnaire_id: manager.id,
      category,
      gestionnaire: manager,
    },
    {
      id: "annual",
      label: "Assurance annuelle",
      frequency: "annual",
      amount: 1200,
      start_date: "2026-01-01T00:00:00.000Z",
      end_date: null,
      notes: "",
      is_active: true,
      category_id: category.id,
      gestionnaire_id: manager.id,
      category,
      gestionnaire: manager,
    },
  ],
  entries: [
    {
      id: "paid",
      label: "Réparation",
      amount: 50,
      expense_date: "2026-02-10T00:00:00.000Z",
      status: "paid",
      notes: "",
      category_id: category.id,
      gestionnaire_id: manager.id,
      category,
      gestionnaire: manager,
    },
    {
      id: "planned",
      label: "Achat prévu",
      amount: 30,
      expense_date: "2026-03-12T00:00:00.000Z",
      status: "planned",
      notes: "",
      category_id: category.id,
      gestionnaire_id: manager.id,
      category,
      gestionnaire: manager,
    },
    {
      id: "future",
      label: "Dépense future",
      amount: 100,
      expense_date: "2026-04-01T00:00:00.000Z",
      status: "planned",
      notes: "",
      category_id: category.id,
      gestionnaire_id: manager.id,
      category,
      gestionnaire: manager,
    },
  ],
};

test("affiche les équivalents mensuel et annuel des frais récurrents", () => {
  assert.deepEqual(
    getRecurringExpenseEquivalents({ amount: 30.9, frequency: "monthly" }),
    { monthly: 30.9, annual: 370.8 }
  );
  assert.deepEqual(
    getRecurringExpenseEquivalents({ amount: 809.35, frequency: "annual" }),
    { monthly: 67.45, annual: 809.35 }
  );
});

test("mensualise un frais annuel à parts égales sans perdre de centimes", () => {
  const expense = { ...payload.recurring[1], amount: 809.35 };
  const now = new Date("2026-12-31T12:00:00.000Z");
  assert.equal(getRecurringExpenseAmountForMonth(expense, 2026, 1, now), 67.45);
  assert.equal(getRecurringExpenseAmountForMonth(expense, 2026, 2, now), 67.45);
  assert.equal(getRecurringExpenseAmountForYear(expense, 2026, now), 809.35);

  const report = computePersonalExpenseReport({
    payload: { ...payload, recurring: [expense], entries: [] },
    year: 2026,
    managerId: "all",
    now,
  });
  assert.deepEqual(report.byMonth.map((month) => month.recurring), [
    67.45, 67.45, 67.45, 67.45, 67.45, 67.45,
    67.45, 67.45, 67.45, 67.45, 67.45, 67.4,
  ]);
});

test("limite le total annuel d'un frais récurrent à ses dates actives", () => {
  const expense = {
    ...payload.recurring[0],
    amount: 766.67,
    start_date: "2026-08-16T00:00:00.000Z",
    end_date: "2026-10-16T00:00:00.000Z",
  };

  assert.equal(getRecurringExpenseAmountForFullYear(expense, 2026), 1558.07);
  assert.equal(getRecurringExpenseAmountForFullYear(expense, 2025), 0);
  assert.equal(getRecurringExpenseAmountForFullYear(expense, 2027), 0);
});

test("consolide les revenus des gîtes avec les frais gîtes et personnels", () => {
  const report = computeConsolidatedFinancialReport({
    gitePeriod: { revenue: 10_000, expenses: 3_000 },
    giteMonths: [
      { revenue: 4_000, expenses: 1_000 },
      { revenue: 6_000, expenses: 2_000 },
    ],
    personalPeriod: {
      total: 1_200,
      recurring: 900,
      paid: 200,
      planned: 100,
      byMonth: [
        { month: 1, total: 500, recurring: 400, paid: 100, planned: 0, isFuture: false },
        { month: 2, total: 700, recurring: 500, paid: 100, planned: 100, isFuture: false },
      ],
    },
  });

  assert.equal(report.totalExpenses, 4_200);
  assert.equal(report.net, 5_800);
  assert.equal(report.expenseRate, 0.42);
  assert.deepEqual(
    [report.personalRecurring, report.personalPaid, report.personalPlanned],
    [900, 200, 100]
  );
  assert.deepEqual(report.months.map((month) => [month.totalExpenses, month.net]), [
    [1_500, 2_500],
    [2_700, 3_300],
  ]);
});

test("les frais personnels de l'année en cours sont proratisés à la date courante", () => {
  const now = new Date("2026-03-15T12:00:00.000Z");
  assert.equal(getRecurringExpenseAmountForYear(payload.recurring[0], 2026, now), 248.39);
  assert.equal(getRecurringExpenseAmountForYear(payload.recurring[1], 2026, now), 248.39);

  const report = computePersonalExpenseReport({ payload, year: 2026, managerId: "all", now });
  assert.equal(report.recurring, 496.78);
  assert.equal(report.paid, 50);
  assert.equal(report.planned, 30);
  assert.equal(report.total, 576.78);
  assert.equal(report.elapsedMonths, 2 + (15 / 31));
  assert.equal(report.monthlyAverage, 232.21);
  assert.equal(report.byManager[0].total, 576.78);
  assert.equal(report.byCategory[0].total, 576.78);
  assert.deepEqual(
    report.byMonth.slice(0, 4).map((month) => [month.recurring, month.paid, month.planned, month.total]),
    [
      [200, 0, 0, 200],
      [200, 50, 0, 250],
      [96.78, 0, 30, 126.78],
      [0, 0, 0, 0],
    ]
  );
});

test("une année historique utilise les douze mois complets", () => {
  const historicalPayload: PersonalExpensePayload = {
    ...payload,
    recurring: payload.recurring.map((expense) => ({
      ...expense,
      start_date: "2025-01-01T00:00:00.000Z",
    })),
    entries: [],
  };
  const report = computePersonalExpenseReport({
    payload: historicalPayload,
    year: 2025,
    managerId: "all",
    now: new Date("2026-03-15T12:00:00.000Z"),
  });
  assert.equal(report.recurring, 2400);
  assert.equal(report.total, 2400);
  assert.equal(report.monthlyAverage, 200);
});

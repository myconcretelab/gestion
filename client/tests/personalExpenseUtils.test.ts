import assert from "node:assert/strict";
import test from "node:test";
import {
  computePersonalExpenseReport,
  getRecurringExpenseAmountForYear,
  type PersonalExpensePayload,
} from "../src/pages/personalExpenses/personalExpenseUtils.ts";

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

test("les frais personnels de l'année en cours sont proratisés à la date courante", () => {
  const now = new Date("2026-03-15T12:00:00.000Z");
  assert.equal(getRecurringExpenseAmountForYear(payload.recurring[0], 2026, now), 248.39);
  assert.equal(getRecurringExpenseAmountForYear(payload.recurring[1], 2026, now), 243.29);

  const report = computePersonalExpenseReport({ payload, year: 2026, managerId: "all", now });
  assert.equal(report.recurring, 491.68);
  assert.equal(report.paid, 50);
  assert.equal(report.planned, 30);
  assert.equal(report.total, 571.68);
  assert.equal(report.elapsedMonths, (74 / 365) * 12);
  assert.equal(report.monthlyAverage, 234.98);
  assert.equal(report.byManager[0].total, 571.68);
  assert.equal(report.byCategory[0].total, 571.68);
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

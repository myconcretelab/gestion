import assert from "node:assert/strict";
import test from "node:test";
import { computeProfessionalExpenseOverview } from "../src/pages/professionalExpenses/professionalExpenseUtils.ts";

test("consolide les frais professionnels récurrents et ponctuels", () => {
  const report = computeProfessionalExpenseOverview({
    year: 2026,
    categories: [
      { id: "energie", name: "Énergie", color: "#2D8CFF" },
      { id: "assurance", name: "Assurance", color: "#7E5BEF" },
    ],
    gites: [
      { id: "phonsine", nom: "Phonsine" },
      { id: "gree", nom: "La Grée" },
    ],
    recurringByGite: {
      phonsine: { expenses: [{ id: "elec", label: "Électricité", category_id: "energie", monthly_amount: 100, annual_amount: 1200 }] },
      gree: { expenses: [{ id: "assurance", label: "Assurance", category_id: "assurance", monthly_amount: 50, annual_amount: 600 }] },
    },
    oneOffExpenses: [
      { id: "christine", label: "Renfort", scope: "all_gites", gite_id: null, year: 2026, month: 7, amount: 50 },
      { id: "edouard", label: "Matériel", scope: "gite", gite_id: "phonsine", year: 2026, month: 8, amount: 3 },
      { id: "ancien", label: "Ancien", scope: "all_gites", gite_id: null, year: 2025, month: 7, amount: 999 },
    ],
  });

  assert.equal(report.recurringMonthly, 150);
  assert.equal(report.recurringAnnual, 1800);
  assert.equal(report.oneOffTotal, 53);
  assert.equal(report.total, 1853);
  assert.equal(report.monthlyAverage, 154.42);
  assert.deepEqual(report.months[6], { month: 7, recurring: 150, oneOff: 50, total: 200 });
  assert.deepEqual(report.months[7], { month: 8, recurring: 150, oneOff: 3, total: 153 });
  assert.deepEqual(report.scopes.map(({ name, recurring, oneOff, total }) => ({ name, recurring, oneOff, total })), [
    { name: "Phonsine", recurring: 1200, oneOff: 3, total: 1203 },
    { name: "La Grée", recurring: 600, oneOff: 0, total: 600 },
    { name: "Frais globaux", recurring: 0, oneOff: 50, total: 50 },
  ]);
  assert.deepEqual(report.distribution.map(({ name, total }) => ({ name, total })), [
    { name: "Énergie", total: 1200 },
    { name: "Assurance", total: 600 },
    { name: "Frais ponctuels", total: 53 },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createReport,
  reportWorkItem,
  type ReportWorkspaceData,
} from "@contrats/shared";
import {
  groupReportWorkItems,
  reportClosingMonth,
  reportManagerGroup,
} from "../src/features/finance/reports/reportGrouping";

const state: ReportWorkspaceData = {
  version: 3,
  organizationId: "grouping-test",
  revision: 0,
  factsRevision: "v1",
  properties: [
    { id: "a", name: "A", initials: "A", operatorId: null, managerId: "alice" },
    { id: "b", name: "B", initials: "B", operatorId: null, managerId: "bob" },
    { id: "c", name: "C", initials: "C", operatorId: null },
  ],
  managers: [
    { id: "alice", name: "Alice Martin" },
    { id: "bob", name: "Bob Dupont" },
  ],
  operators: [],
  propertyManagers: { a: "alice", b: "bob", c: null },
  propertyOperators: {},
  reports: [],
  operations: [],
  legacyDeclarations: [],
  progress: {},
  drafts: {},
  overrides: {},
  operationEdits: {},
};
const report = {
  ...createReport("custom", "r"),
  name: "Recettes",
  propertyIds: ["a"],
};

test("les noms de destinataires inversés restent sous le même gestionnaire réel", () => {
  const items = ["Alice Martin", "Martin Alice"].map((recipient, i) =>
    reportWorkItem(state, { ...report, id: `r${i}`, recipient }, "2026-09"),
  );
  const [group] = groupReportWorkItems(items, state);
  assert.equal(group.managers.length, 1);
  assert.equal(group.managers[0].name, "Alice Martin");
  assert.equal(group.managers[0].items.length, 2);
  assert.equal(group.count, 2);
});

test("les rapports communs et sans rattachement ne sont pas attribués arbitrairement", () => {
  assert.equal(
    reportManagerGroup({ ...report, propertyIds: ["a", "b"] }, state).id,
    "shared",
  );
  assert.equal(
    reportManagerGroup({ ...report, propertyIds: ["a", "c"] }, state).id,
    "unassigned",
  );
  assert.equal(
    reportManagerGroup({ ...report, propertyIds: [] }, state).id,
    "unassigned",
  );
  assert.equal(
    reportManagerGroup({ ...report, managerId: "bob" }, state).id,
    "manager:bob",
  );
  assert.equal(
    reportManagerGroup({ ...report, managerId: "deleted" }, state).name,
    "Gestionnaire à vérifier",
  );
  assert.equal(
    reportManagerGroup(report, { ...state, propertyManagers: { a: null } }).id,
    "unassigned",
  );
});

test("le mois de clôture classe correctement trimestres, années et années bissextiles", () => {
  for (const [month, cadence, expected] of [
    ["2026-07", "quarterly", "2026-09"],
    ["2026-01", "yearly", "2026-12"],
    ["2024-02", "monthly", "2024-02"],
  ] as const) {
    const item = reportWorkItem(state, { ...report, cadence }, month);
    assert.equal(reportClosingMonth(item), expected);
    assert.equal(item.month, month);
  }
});

test("les mois puis gestionnaires sont ordonnés sans dupliquer les rapports", () => {
  const items = [
    reportWorkItem(
      state,
      { ...report, id: "bob", managerId: "bob" },
      "2026-10",
    ),
    reportWorkItem(state, { ...report, id: "alice" }, "2026-10"),
    reportWorkItem(
      state,
      { ...report, id: "quarter", cadence: "quarterly" },
      "2026-07",
    ),
    reportWorkItem(state, { ...report, id: "sept" }, "2026-09"),
  ];
  const groups = groupReportWorkItems(items, state);
  assert.deepEqual(
    groups.map((group) => group.month),
    ["2026-09", "2026-10"],
  );
  assert.deepEqual(
    groups[1].managers.map((manager) => manager.name),
    ["Alice Martin", "Bob Dupont"],
  );
  assert.equal(groups[0].count, 2);
  assert.equal(
    groups.flatMap((group) =>
      group.managers.flatMap((manager) => manager.items),
    ).length,
    items.length,
  );
});

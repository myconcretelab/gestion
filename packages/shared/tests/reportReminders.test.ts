import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportReminders,
  createReport,
  evaluateReport,
  reportPeriodKey,
  type ReportWorkspaceData,
} from "../src/index.js";

const now = new Date("2026-10-29T09:00:00Z");
function workspace(): ReportWorkspaceData {
  return {
    version: 3,
    organizationId: "org",
    revision: 0,
    factsRevision: "facts",
    properties: [],
    operators: [],
    reports: [
      {
        ...createReport("social", "social"),
        propertyIds: ["g1"],
        operatorId: "e1",
        recipient: "Entreprise",
      },
    ],
    drafts: {},
    overrides: {},
    progress: {},
    propertyOperators: { g1: "e1" },
    operationEdits: {},
    legacyDeclarations: [],
    operations: [
      {
        id: "receipt",
        reservation: "r1",
        guest: "Test",
        propertyId: "g1",
        category: "accommodation",
        amountCents: 10000,
        nights: 0,
        paymentDate: "2026-08-10",
        stayDate: "2026-08-10",
        channel: "direct",
        paymentMethod: "cash",
        basis: "payment",
      },
    ],
  };
}
test("closed periods only, including zero receipts after the first activity", () => {
  const state = workspace();
  assert.deepEqual(
    buildReportReminders(state, 2026, now).map((row) => row.month),
    ["2026-08", "2026-09"],
  );
  assert.deepEqual(buildReportReminders(state, 2027, now), []);
  state.operations = [];
  assert.deepEqual(buildReportReminders(state, 2026, now), []);
});
test("confirmation clears a reminder, a changed source brings it back", () => {
  const state = workspace();
  const definition = state.reports[0];
  state.progress[reportPeriodKey(definition, "2026-08")] = {
    snapshot: {
      confirmedAt: now.toISOString(),
      definition,
      result: evaluateReport(
        definition,
        "2026-08",
        {},
        state.operations,
        state,
      ),
    },
  };
  assert.deepEqual(
    buildReportReminders(state, 2026, now).map((row) => row.month),
    ["2026-09"],
  );
  state.operations[0].amountCents = 20000;
  assert.equal(buildReportReminders(state, 2026, now)[0].status, "changed");
});
test("ready remains actionable until transmission is confirmed; problems link to review", () => {
  const state = workspace();
  state.progress[reportPeriodKey(state.reports[0], "2026-08")] = {
    ready: true,
  };
  assert.equal(buildReportReminders(state, 2026, now)[0].status, "ready");
  state.operations[0].paymentMethod = "unknown";
  assert.equal(buildReportReminders(state, 2026, now)[0].status, "review");
});
test("quarterly/yearly cadence and January rollover use unique completed periods", () => {
  const state = workspace();
  state.reports[0].cadence = "quarterly";
  assert.deepEqual(
    buildReportReminders(state, 2026, now).map((row) => row.month),
    ["2026-07"],
  );
  state.reports[0].cadence = "yearly";
  assert.deepEqual(buildReportReminders(state, 2026, now), []);
  assert.deepEqual(
    buildReportReminders(state, 2027, new Date("2027-01-01T00:00:00Z")).map(
      (row) => row.month,
    ),
    ["2026-01"],
  );
  state.reports[0].cadence = "monthly";
  assert.deepEqual(
    buildReportReminders(state, 2027, new Date("2027-01-01T00:00:00Z")).map(
      (row) => row.month,
    ),
    ["2026-12"],
  );
});
test("Paris month boundary determines when a reminder starts", () => {
  const state = workspace();
  state.operations[0].paymentDate = "2026-10-01";
  assert.equal(
    buildReportReminders(state, 2026, new Date("2026-10-31T22:59:00Z")).length,
    0,
  );
  assert.equal(
    buildReportReminders(state, 2026, new Date("2026-10-31T23:00:00Z")).length,
    1,
  );
});
test("historical confirmations cover exact properties, rather than matching display names", () => {
  const state = workspace();
  state.legacyDeclarations = [
    {
      id: "old",
      kind: "social",
      period: "2026-08",
      subject: "Different name",
      value: 10000,
      confirmedAt: now.toISOString(),
      propertyIds: ["g1"],
    },
  ];
  assert.deepEqual(
    buildReportReminders(state, 2026, now).map((row) => row.month),
    ["2026-09"],
  );
  state.legacyDeclarations[0].propertyIds = ["other"];
  assert.deepEqual(
    buildReportReminders(state, 2026, now).map((row) => row.month),
    ["2026-08", "2026-09"],
  );
});
test("a quarterly legacy confirmation requires coverage of every month and scoped property", () => {
  const state = workspace();
  state.reports[0].cadence = "quarterly";
  state.reports[0].propertyIds = ["g1", "g2"];
  state.legacyDeclarations = ["07", "08", "09"].map((month) => ({
    id: month,
    kind: "social",
    period: `2026-${month}`,
    subject: "Entreprise",
    value: 0,
    confirmedAt: now.toISOString(),
    propertyIds: ["g1", "g2"],
  }));
  assert.equal(buildReportReminders(state, 2026, now).length, 0);
  state.legacyDeclarations[1].propertyIds = ["g1"];
  assert.equal(buildReportReminders(state, 2026, now).length, 1);
});
test("internal reports do not trigger declarations, empty tourist periods do not either", () => {
  const state = workspace();
  state.reports[0].kind = "custom";
  assert.equal(buildReportReminders(state, 2026, now).length, 0);
  state.reports[0] = {
    ...createReport("tourist", "nights"),
    propertyIds: ["g1"],
  };
  state.operations[0].basis = "nights";
  state.operations[0].nights = 5;
  assert.deepEqual(
    buildReportReminders(state, 2026, now).map((row) => row.month),
    ["2026-08"],
  );
});

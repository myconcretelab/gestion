import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportWorklist,
  buildReportReminders,
  createReport,
  evaluateReport,
  legacyReportPeriodConfirmed,
  reportPeriodKey,
  reportWorkItem,
  type ReportWorkspaceData,
} from "../src/index.js";

const now = new Date("2026-10-31T12:00:00Z");
function workspace(): ReportWorkspaceData {
  return {
    version: 3,
    organizationId: "org_test",
    revision: 0,
    factsRevision: "test",
    properties: [
      { id: "g1", name: "Logement", initials: "L", operatorId: "e1" },
    ],
    operators: [{ id: "e1", name: "Entreprise", legacy: false }],
    reports: [
      {
        ...createReport("social", "social-a"),
        propertyIds: ["g1"],
        operatorId: "e1",
      },
      {
        ...createReport("social", "social-b"),
        propertyIds: ["g1"],
        operatorId: "e1",
      },
      { ...createReport("tourist", "nights"), propertyIds: ["g1"] },
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
        reservation: "r",
        guest: "Client",
        propertyId: "g1",
        category: "accommodation",
        amountCents: 10000,
        nights: 0,
        paymentDate: "2026-07-10",
        stayDate: "2026-07-01",
        channel: "Direct",
        paymentMethod: "cash",
        basis: "payment",
      },
    ],
  };
}

test("chaque mois terminé produit les trois rapports, y compris les nuitées ou recettes à zéro", () => {
  const state = workspace();
  const items = buildReportWorklist(state, now);
  assert.equal(items.length, 9);
  for (const month of ["2026-07", "2026-08", "2026-09"]) {
    assert.equal(items.filter((item) => item.month === month).length, 3);
  }
  assert.ok(items.every((item) => item.period.end <= "2026-10-31"));
  assert.equal(
    items.find(
      (item) => item.report.id === "nights" && item.month === "2026-08",
    )!.result.total,
    0,
  );
  state.operations = [];
  assert.equal(buildReportWorklist(state, now).length, 27);
});

test("les fréquences trimestrielles et annuelles ne créent qu’une ligne par période terminée", () => {
  const state = workspace();
  state.reports[1].cadence = "quarterly";
  state.reports[2].cadence = "yearly";
  const items = buildReportWorklist(state, now);
  assert.deepEqual(
    items
      .filter((item) => item.report.id === "social-b")
      .map((item) => item.month),
    ["2026-07"],
  );
  assert.equal(items.filter((item) => item.report.id === "nights").length, 0);
  const january = buildReportWorklist(state, new Date("2026-12-31T23:00:00Z"));
  assert.deepEqual(
    january
      .filter((item) => item.report.id === "nights")
      .map((item) => item.month),
    ["2026-01"],
  );
  assert.equal(
    january.filter((item) => item.report.id === "social-b").length,
    2,
  );
  assert.equal(new Set(january.map((item) => item.key)).size, january.length);
});

test("les mois et années antérieurs restent accessibles et la clôture suit l’heure de Paris", () => {
  const state = workspace();
  state.operations[0].stayDate = "2025-12-01";
  state.operations[0].paymentDate = "2025-12-01";
  assert.equal(buildReportWorklist(state, now).length, 30);
  assert.equal(buildReportWorklist(state, now)[0].month, "2025-12");
  assert.equal(
    buildReportWorklist(state, new Date("2026-10-31T22:59:59Z")).length,
    30,
  );
  assert.equal(
    buildReportWorklist(state, new Date("2026-10-31T23:00:00Z")).length,
    33,
  );
});

test("le suivi commence en septembre après la reprise des périodes déjà traitées, même avec des réservations de 2017", () => {
  const state = workspace();
  state.operations[0].stayDate = "2017-01-06";
  state.operations[0].paymentDate = "2017-01-07";
  state.worklistStartMonth = "2026-09";
  const items = buildReportWorklist(state, now);
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.month === "2026-09"));
  assert.ok(
    buildReportReminders(state, 2026, now).every(
      (item) => item.month === "2026-09",
    ),
  );
  assert.equal(
    reportWorkItem(state, state.reports[0], "2026-08").status,
    "Déjà traité",
  );
  assert.equal(
    buildReportWorklist(state, new Date("2026-10-31T23:00:00Z")).length,
    6,
  );
  state.reports[1].cadence = "quarterly";
  const quarterly = buildReportWorklist(state, now).filter(
    (item) => item.report.id === "social-b",
  );
  assert.equal(quarterly.length, 1);
  assert.equal(quarterly[0].period.start, "2026-07-01");
  assert.equal(quarterly[0].period.end, "2026-10-01");
});

test("prêt reste à traiter, une confirmation retire la ligne, un écart la fait réapparaître", () => {
  const state = workspace();
  const report = state.reports[0];
  const key = reportPeriodKey(report, "2026-07");
  state.progress[key] = { ready: true };
  assert.equal(
    buildReportWorklist(state, now).find((item) => item.key === key)!.status,
    "Prêt à confirmer",
  );
  state.progress[key].snapshot = {
    confirmedAt: now.toISOString(),
    definition: report,
    result: evaluateReport(report, "2026-07", {}, state.operations, state),
  };
  assert.equal(
    buildReportWorklist(state, now).some((item) => item.key === key),
    false,
  );
  state.operations[0].amountCents++;
  assert.equal(
    buildReportWorklist(state, now).find((item) => item.key === key)!.status,
    "Écart à examiner",
  );
});

test("les déclarations historiques retirent uniquement les périodes et logements intégralement couverts", () => {
  const state = workspace();
  const report = state.reports[0];
  report.cadence = "quarterly";
  report.propertyIds = ["g1", "g2"];
  state.legacyDeclarations = ["07", "08", "09"].map((month) => ({
    id: month,
    kind: "social",
    period: `2026-${month}`,
    subject: "Ancien nom",
    value: 0,
    confirmedAt: now.toISOString(),
    propertyIds: ["g1", "g2"],
  }));
  assert.equal(legacyReportPeriodConfirmed(state, report, "2026-07"), true);
  assert.equal(
    buildReportWorklist(state, now).some(
      (item) => item.report.id === report.id,
    ),
    false,
  );
  state.legacyDeclarations[1].propertyIds = ["g1"];
  assert.equal(
    buildReportWorklist(state, now).some(
      (item) => item.report.id === report.id,
    ),
    true,
  );
});

test("les rapports internes sont aussi listés et les dates corrigées utilisent la bonne période", () => {
  const state = workspace();
  state.reports = [
    {
      ...createReport("custom", "custom"),
      propertyIds: ["g1"],
      categories: ["accommodation"],
    },
  ];
  state.operationEdits.receipt = { paymentDate: "2026-08-01" };
  const items = buildReportWorklist(state, now);
  assert.equal(items.length, 3);
  assert.equal(
    reportWorkItem(state, state.reports[0], "2026-07").result.total,
    0,
  );
  assert.equal(
    reportWorkItem(state, state.reports[0], "2026-08").result.total,
    10000,
  );
});

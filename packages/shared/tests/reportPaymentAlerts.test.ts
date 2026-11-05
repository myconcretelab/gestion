import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportReminders,
  createReport,
  evaluateReport,
  reportPaymentAlertSignature,
  reportPaymentReviewRequired,
  reportPeriodKey,
  reportReviewCount,
  snapshotDiffers,
  type ReportPaymentAlert,
  type ReportWorkspaceData,
} from "../src/index.js";

const alert: ReportPaymentAlert = {
  reservationId: "stay",
  guest: "Voyageur",
  bookingSource: "Direct",
  stays: [
    {
      propertyId: "g",
      propertyLabel: "Gîte",
      arrival: "2026-10-30",
      departure: "2026-11-02",
    },
  ],
  totalCents: 10000,
  receivedCents: 0,
  remainingCents: 10000,
  reason: "missing",
  sourceRevision: "a".repeat(64),
};
const report = {
  ...createReport("social", "social"),
  propertyIds: ["g"],
  operatorId: "entity",
};
const sources = {
  propertyOperators: { g: "entity" },
  operationEdits: {},
  stayPaymentAlerts: [alert],
};
test("un séjour sans ligne d’encaissement devient visible sans ajouter de recette", () => {
  const result = evaluateReport(report, "2026-10", {}, [], sources);
  assert.equal(result.total, 0);
  assert.equal(result.rows.length, 0);
  assert.equal(result.paymentAlerts?.length, 1);
  assert.equal(reportReviewCount(result), 1);
  assert.equal(reportPaymentReviewRequired(result), true);
  assert.equal(
    evaluateReport(report, "2026-11", {}, [], sources).paymentAlerts?.length,
    1,
  );
});
test("les alertes respectent gîtes, sources, périodes et rapports de nuitées", () => {
  for (const patch of [
    { propertyIds: ["other"] },
    { bookingSources: ["Airbnb"] },
    { excludedBookingSources: ["Direct"] },
  ])
    assert.equal(
      evaluateReport({ ...report, ...patch }, "2026-10", {}, [], sources)
        .paymentAlerts,
      undefined,
    );
  assert.equal(
    evaluateReport(report, "2026-09", {}, [], sources).paymentAlerts,
    undefined,
  );
  assert.equal(
    evaluateReport(
      { ...createReport("tourist", "n"), propertyIds: ["g"] },
      "2026-10",
      {},
      [],
      sources,
    ).paymentAlerts?.length,
    1,
  );
  assert.equal(
    evaluateReport({ ...report, kind: "custom" }, "2026-10", {}, [], sources)
      .paymentAlerts,
    undefined,
  );
});
test("une justification couvre les sources exactes et devient caduque si le paiement change", () => {
  const pending = evaluateReport(report, "2026-10", {}, [], sources);
  const reviews = {
    [reportPeriodKey(report, "2026-10")]: {
      signature: reportPaymentAlertSignature(pending),
      note: "Solde encore impayé",
      reviewedAt: "2026-11-05T12:00:00Z",
    },
  };
  const checked = evaluateReport(report, "2026-10", {}, [], {
    ...sources,
    paymentReviews: reviews,
  });
  assert.equal(reportReviewCount(checked), 0);
  assert.equal(checked.total, 0);
  assert.equal(snapshotDiffers({ result: checked }, checked), false);
  const changed = evaluateReport(report, "2026-10", {}, [], {
    ...sources,
    paymentReviews: reviews,
    stayPaymentAlerts: [{ ...alert, sourceRevision: "b".repeat(64) }],
  });
  assert.equal(reportPaymentReviewRequired(changed), true);
  assert.equal(snapshotDiffers({ result: checked }, changed), true);
  assert.equal(
    snapshotDiffers(
      { result: evaluateReport(report, "2026-10", {}, [], sources) },
      evaluateReport(report, "2026-10", {}, [], {} as never),
    ),
    true,
  );
});
test("les rappels montrent aussi le rapport sans aucun encaissement et empêchent de copier avant vérification", () => {
  const state = {
    version: 3,
    organizationId: "org_test",
    revision: 0,
    factsRevision: "v1",
    ...sources,
    properties: [
      { id: "g", name: "Gîte", initials: "G", operatorId: "entity" },
    ],
    operators: [{ id: "entity", name: "Exploitant", legacy: false }],
    operations: [],
    reports: [report],
    drafts: {},
    overrides: {},
    progress: {},
    legacyDeclarations: [],
  } as ReportWorkspaceData;
  const reminder = buildReportReminders(
    state,
    2026,
    new Date("2026-11-05T12:00:00Z"),
  ).find((r) => r.month === "2026-10")!;
  assert.equal(reminder.status, "review");
  assert.equal(reminder.canCopy, false);
  assert.equal(reminder.total, 0);
});

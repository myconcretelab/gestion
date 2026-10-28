import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrototypeState,
  createReport,
  DEMO_OPERATIONS,
  evaluateReport,
  getReportPeriod,
  reportCsv,
  reportPeriodKey,
  reportStatus,
  snapshotDiffers,
  type ReportOperation,
} from "../src/features/finance/reports/reportPrototype";
import { parsePrototypeState } from "../src/features/finance/reports/prototypeStorage";

test("la période d’encaissement et la période du séjour donnent des sélections distinctes", () => {
  const report = createReport("social", "r1");
  const paid = evaluateReport(report, "2026-10");
  const stay = evaluateReport({ ...report, dateBasis: "stay" }, "2026-10");
  assert.equal(
    paid.rows.some((row) => row.id === "102-stay"),
    false,
  );
  assert.equal(
    stay.rows.some((row) => row.id === "102-stay"),
    true,
  );
  assert.equal(
    paid.rows.some((row) => row.id === "107-stay"),
    true,
  );
  assert.equal(
    stay.rows.some((row) => row.id === "107-stay"),
    false,
  );
});

test("les données à vérifier restent visibles sans entrer dans le total et les remboursements le diminuent", () => {
  const result = evaluateReport(createReport("social", "r1"), "2026-10");
  assert.equal(result.reviewCount, 2);
  assert.equal(
    result.rows.find((row) => row.id === "103-extra")?.status,
    "review",
  );
  assert.equal(
    result.rows.find((row) => row.id === "105-stay")?.status,
    "review",
  );
  assert.equal(
    result.rows.find((row) => row.id === "104-tax")?.status,
    "excluded",
  );
  assert.equal(result.total, 323500);
  assert.equal(
    result.rows.find((row) => row.id === "106-refund")?.value,
    -3500,
  );
});

test("une correction explique son effet sans affecter un autre rapport ni une autre période", () => {
  const report = createReport("social", "r1");
  const before = evaluateReport(report, "2026-10");
  const after = evaluateReport(report, "2026-10", {
    "103-extra": { status: "included", note: "Date vérifiée dans l’exemple." },
  });
  assert.equal(after.total - before.total, 2500);
  assert.equal(after.reviewCount, 1);
  assert.match(
    after.rows.find((row) => row.id === "103-extra")!.reason,
    /Date vérifiée/,
  );
  assert.equal(
    evaluateReport(createReport("custom", "r2"), "2026-10").rows.find(
      (row) => row.id === "103-extra",
    )?.status,
    "review",
  );
  assert.notEqual(
    reportPeriodKey(report, "2026-10"),
    reportPeriodKey(report, "2026-11"),
  );
});

test("le trimestre et l’année utilisent des périodes cohérentes, y compris la borne de fin", () => {
  assert.equal(getReportPeriod("2026-11", "quarterly").start, "2026-10-01");
  assert.equal(getReportPeriod("2026-11", "quarterly").end, "2027-01-01");
  assert.equal(getReportPeriod("2026-12", "yearly").end, "2027-01-01");
  const report = {
    ...createReport("social", "r1"),
    cadence: "quarterly" as const,
  };
  assert.equal(
    reportPeriodKey(report, "2026-10"),
    reportPeriodKey(report, "2026-12"),
  );
  assert.equal(
    evaluateReport(report, "2026-10").rows.some((row) => row.id === "108-stay"),
    true,
  );
});

test("le suivi des nuitées compte les lignes d’hébergement et ne somme pas leurs montants", () => {
  const report = createReport("tourist", "r1");
  const result = evaluateReport(report, "2026-10");
  assert.equal(result.total, 42);
  assert.equal(
    result.rows.find((row) => row.id === "101-cleaning")?.status,
    "excluded",
  );
  assert.equal(result.rows.find((row) => row.id === "101-cleaning")?.value, 0);
});

test("une copie confirmée conserve ses chiffres même lorsqu’une correction change le calcul courant", () => {
  const report = createReport("custom", "r1");
  const result = evaluateReport(report, "2026-10");
  const snapshot = {
    confirmedAt: "2026-10-28T12:00:00Z",
    definition: structuredClone(report),
    result: structuredClone(result),
  };
  const changed = evaluateReport(report, "2026-10", {
    "101-cleaning": { status: "excluded", note: "Correction de démonstration" },
  });
  assert.equal(snapshotDiffers(snapshot, result), false);
  assert.equal(snapshotDiffers(snapshot, changed), true);
  assert.equal(snapshot.result.total - changed.total, 6500);
  assert.equal(reportStatus({ snapshot }, changed), "Écart à examiner");
  assert.equal(reportStatus({ snapshot }, result), "Transmission confirmée");
});

test("un changement de composition est signalé même quand le total reste identique", () => {
  const report = createReport("social", "r1");
  const rows: ReportOperation[] = DEMO_OPERATIONS.slice(0, 1);
  const result = evaluateReport(report, "2026-10", {}, rows);
  const snapshot = {
    confirmedAt: "2026-10-28T12:00:00Z",
    definition: report,
    result,
  };
  const other = evaluateReport(report, "2026-10", {}, [
    { ...rows[0], id: "other" },
  ]);
  assert.equal(other.total, result.total);
  assert.equal(snapshotDiffers(snapshot, other), true);
});

test("l’export conserve les remboursements numériques et neutralise les formules dans les textes", () => {
  const report = createReport("social", "r1");
  const operation = {
    ...DEMO_OPERATIONS[0],
    guest: '=HYPERLINK("example")',
    amountCents: -3500,
  };
  const csv = reportCsv(
    report,
    evaluateReport(report, "2026-10", {}, [operation]),
  );
  assert.match(csv, /"-35"/);
  assert.equal(csv.includes("'-35"), false);
  assert.equal(csv.includes("'=HYPERLINK"), true);
  assert.equal(csv.includes('""example""'), true);
});

test("les brouillons et copies sont restaurés et un stockage corrompu revient aux exemples initiaux", () => {
  const initial = createPrototypeState();
  const report = initial.reports[0];
  initial.drafts[report.id] = { ...report, name: "Mon brouillon" };
  initial.progress[reportPeriodKey(report, "2026-10")] = {
    snapshot: {
      confirmedAt: "2026-10-28T12:00:00Z",
      definition: report,
      result: evaluateReport(report, "2026-10"),
    },
  };
  assert.deepEqual(parsePrototypeState(JSON.stringify(initial)), initial);
  assert.deepEqual(
    parsePrototypeState('{"version":1,"reports":[{}]}'),
    createPrototypeState(),
  );
  assert.deepEqual(parsePrototypeState("invalid"), createPrototypeState());
  const malformed = structuredClone(initial);
  (
    malformed.progress[reportPeriodKey(report, "2026-10")].snapshot!
      .result as unknown as { rows: unknown }
  ).rows = [null];
  assert.deepEqual(
    parsePrototypeState(JSON.stringify(malformed)),
    createPrototypeState(),
  );
});

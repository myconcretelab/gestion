import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrototypeState,
  applySourceCorrection,
  accommodationBreakdown,
  evaluatePrototypeReport,
  REPORT_PAYMENT_METHODS,
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
  assert.equal(result.reviewCount, 4);
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
  assert.equal(result.total, 311000);
  assert.equal(
    result.rows.find((row) => row.id === "106-refund")?.value,
    -3500,
  );
});

test("une correction explique son effet sans affecter un autre rapport ni une autre période", () => {
  const report = createReport("social", "r1");
  const before = evaluateReport(report, "2026-10");
  const after = evaluateReport(report, "2026-10", {
    "101-cleaning": {
      status: "excluded",
      note: "Correction pour cet exemple.",
    },
  });
  assert.equal(after.total - before.total, -6500);
  assert.equal(after.reviewCount, 4);
  assert.match(
    after.rows.find((row) => row.id === "101-cleaning")!.reason,
    /Correction pour cet exemple/,
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
  assert.equal(result.total, 54);
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

test("une reformulation des explications ne signale pas un écart financier", () => {
  const report = createReport("owner", "r1");
  const result = evaluateReport(report, "2026-10");
  const snapshot = {
    confirmedAt: "2026-10-28T12:00:00Z",
    definition: report,
    result: structuredClone(result),
  };
  const reformulated = {
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      reason: "Nouvelle formulation",
    })),
  };
  assert.equal(snapshotDiffers(snapshot, reformulated), false);
  const changed = {
    ...result,
    rows: result.rows.map((row, index) =>
      index === 0 ? { ...row, paymentMethod: "cash" as const } : row,
    ),
  };
  assert.equal(snapshotDiffers(snapshot, changed), true);
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

test("le rattachement d’un gîte corrige toutes ses recettes sans modifier les copies confirmées", () => {
  const state = createPrototypeState();
  const report = state.reports[0];
  const before = evaluatePrototypeReport(state, report, "2026-10");
  const snapshot = {
    confirmedAt: "2026-10-28T12:00:00Z",
    definition: structuredClone(report),
    result: structuredClone(before),
  };
  state.progress[reportPeriodKey(report, "2026-10")] = { snapshot };
  const next = applySourceCorrection(state, {
    kind: "operator",
    propertyId: "woods",
    operatorId: "operator-a",
  });
  const after = evaluatePrototypeReport(next, report, "2026-10");
  assert.equal(before.reviewCount, 4);
  assert.equal(after.reviewCount, 1);
  assert.equal(after.total - before.total, 96500);
  assert.equal(
    after.rows
      .filter((row) => row.propertyId === "woods")
      .every((row) => row.status === "included"),
    true,
  );
  assert.equal(
    next.progress[reportPeriodKey(report, "2026-10")].snapshot!.result.total,
    before.total,
  );
  assert.equal(state.propertyOperators.woods, null);
});

test("une correction de traitement ne remplace pas une date ou un rattachement manquants", () => {
  const report = createReport("social", "r1");
  const result = evaluateReport(report, "2026-10", {
    "105-stay": { status: "included", note: "Forcer l’inclusion" },
    "103-extra": { status: "included", note: "Forcer l’inclusion" },
  });
  assert.equal(
    result.rows.find((row) => row.id === "105-stay")!.status,
    "review",
  );
  assert.equal(
    result.rows.find((row) => row.id === "103-extra")!.status,
    "review",
  );
  const unknownPayment = {
    ...DEMO_OPERATIONS[0],
    paymentMethod: "unknown" as const,
  };
  const manuallyIncluded = evaluateReport(
    {
      ...createReport("owner", "owner"),
      accommodationPaymentMethods: ["cash"],
    },
    "2026-10",
    { [unknownPayment.id]: { status: "included", note: "Exception" } },
    [unknownPayment],
  );
  assert.equal(manuallyIncluded.rows[0].status, "review");
  assert.equal(manuallyIncluded.rows[0].issues[0].kind, "payment");
});

test("la saisie d’un encaissement déplace l’opération vers sa période de paiement", () => {
  const state = createPrototypeState();
  const report = state.reports[3];
  const next = applySourceCorrection(state, {
    kind: "payment",
    operationId: "103-extra",
    paymentDate: "2026-11-01",
    paymentMethod: "cash",
  });
  assert.equal(
    evaluatePrototypeReport(next, report, "2026-10").rows.some(
      (row) => row.id === "103-extra",
    ),
    false,
  );
  assert.equal(
    evaluatePrototypeReport(next, report, "2026-11").rows.find(
      (row) => row.id === "103-extra",
    )!.status,
    "included",
  );
  assert.equal(
    evaluatePrototypeReport(
      next,
      { ...report, dateBasis: "stay" },
      "2026-10",
    ).rows.find((row) => row.id === "103-extra")!.status,
    "included",
  );
});

test("le filtre de paiement concerne l’hébergement et conserve les autres catégories", () => {
  const report = {
    ...createReport("owner", "r1"),
    accommodationPaymentMethods: ["card" as const],
  };
  const result = evaluateReport(report, "2026-10");
  assert.equal(result.total, 85500);
  assert.equal(
    result.rows.find((row) => row.id === "101-stay")!.status,
    "excluded",
  );
  assert.equal(
    result.rows.find((row) => row.id === "101-cleaning")!.status,
    "included",
  );
  assert.equal(
    result.rows.find((row) => row.id === "104-stay")!.status,
    "included",
  );
  assert.deepEqual(
    accommodationBreakdown(result).map((group) => [group.id, group.total]),
    [["card", 76000]],
  );
  assert.equal(
    evaluateReport({ ...report, accommodationPaymentMethods: [] }, "2026-10")
      .total,
    9500,
  );
});

test("plusieurs paiements d’un même hébergement sont ventilés sans confondre le canal de réservation", () => {
  const report = createReport("owner", "r1");
  const base = DEMO_OPERATIONS[0];
  const operations = [
    {
      ...base,
      id: "split-transfer",
      amountCents: 50000,
      paymentMethod: "transfer" as const,
      channel: "Direct",
    },
    {
      ...base,
      id: "split-cash",
      amountCents: 18000,
      paymentMethod: "cash" as const,
      channel: "Direct",
    },
  ];
  const result = evaluateReport(report, "2026-10", {}, operations);
  assert.equal(result.total, 68000);
  assert.deepEqual(
    accommodationBreakdown(result).map((group) => [group.id, group.total]),
    [
      ["transfer", 50000],
      ["cash", 18000],
    ],
  );
  assert.equal(
    evaluateReport(
      { ...report, accommodationPaymentMethods: ["cash"] },
      "2026-10",
      {},
      operations,
    ).total,
    18000,
  );
});

test("les essais du premier prototype migrent en conservant les brouillons et les montants confirmés", () => {
  const state = createPrototypeState();
  const report = state.reports[2];
  state.progress[reportPeriodKey(report, "2026-10")] = {
    snapshot: {
      confirmedAt: "2026-10-28T12:00:00Z",
      definition: report,
      result: evaluatePrototypeReport(state, report, "2026-10"),
    },
  };
  state.drafts[report.id] = { ...report, name: "Brouillon conservé" };
  const legacy = JSON.parse(JSON.stringify(state));
  legacy.version = 1;
  delete legacy.propertyOperators;
  delete legacy.operationEdits;
  for (const item of [...legacy.reports, ...Object.values(legacy.drafts)])
    delete (item as { accommodationPaymentMethods?: unknown })
      .accommodationPaymentMethods;
  for (const entry of Object.values(legacy.progress) as Array<{
    snapshot: {
      definition: { accommodationPaymentMethods?: unknown };
      result: { rows: Array<{ paymentMethod?: unknown; issues?: unknown }> };
    };
  }>) {
    delete entry.snapshot.definition.accommodationPaymentMethods;
    for (const row of entry.snapshot.result.rows) {
      delete row.paymentMethod;
      delete row.issues;
    }
  }
  const restored = parsePrototypeState(JSON.stringify(legacy));
  assert.equal(restored.version, 2);
  assert.equal(restored.drafts[report.id].name, "Brouillon conservé");
  assert.deepEqual(
    restored.reports[0].accommodationPaymentMethods,
    REPORT_PAYMENT_METHODS.map((method) => method.id),
  );
  assert.equal(
    restored.progress[reportPeriodKey(report, "2026-10")].snapshot!.result
      .total,
    state.progress[reportPeriodKey(report, "2026-10")].snapshot!.result.total,
  );
});

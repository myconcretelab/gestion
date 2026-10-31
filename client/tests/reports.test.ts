import assert from "node:assert/strict";
import test from "node:test";
import {
  createReport,
  evaluateReport,
  getReportPeriod,
  reportPeriodKey,
  snapshotDiffers,
  reportCsv,
  accommodationBreakdown,
  reportDefinitionSchema,
  type ReportOperation,
} from "@contrats/shared";
const report = {
  ...createReport("social", "r"),
  propertyIds: ["g"],
  operatorId: "entity",
};
const sources = { propertyOperators: { g: "entity" }, operationEdits: {} };
const receipt: ReportOperation = {
  id: "payment",
  reservation: "r",
  reservationId: "r",
  guest: "Client",
  propertyId: "g",
  propertyLabel: "Gîte réel",
  category: "accommodation",
  amountCents: 101,
  nights: 0,
  paymentDate: "2026-10-29",
  stayDate: "2026-11-02",
  paymentMethod: "cash",
  channel: "Direct",
  basis: "payment",
};
test("encaissements, montants au séjour et nuitées utilisent des sources distinctes", () => {
  const operations = [
    receipt,
    { ...receipt, id: "stay", basis: "stay" as const },
    { ...receipt, id: "night", basis: "nights" as const, nights: 4 },
  ];
  assert.equal(
    evaluateReport(report, "2026-10", {}, operations, sources).total,
    101,
  );
  assert.equal(
    evaluateReport(
      { ...report, dateBasis: "stay" },
      "2026-10",
      {},
      operations,
      sources,
    ).total,
    0,
  );
  assert.equal(
    evaluateReport(
      { ...createReport("tourist", "n"), propertyIds: ["g"] },
      "2026-11",
      {},
      operations,
      sources,
    ).total,
    4,
  );
});
test("tous les moyens de paiement sont inclus et consultables sans filtre", () => {
  const operations = (
    ["cash", "card", "cheque", "transfer", "platform", "other"] as const
  ).map((paymentMethod, i) => ({ ...receipt, id: String(i), paymentMethod }));
  const result = evaluateReport(report, "2026-10", {}, operations, sources);
  assert.equal(result.total, 606);
  assert.equal(
    accommodationBreakdown(result).reduce((n, group) => n + group.total, 0),
    606,
  );
  assert.equal(
    reportDefinitionSchema.safeParse({
      ...report,
      accommodationPaymentMethods: ["transfer"],
    }).success,
    false,
  );
});
test("une date manquante reste à vérifier dans la période du séjour, sans entrer dans le total", () => {
  for (const month of ["2026-09", "2026-10", "2026-11"]) {
    const result = evaluateReport(
      report,
      month,
      { payment: { status: "included", note: "Test" } },
      [{ ...receipt, paymentDate: null }],
      sources,
    );
    assert.equal(result.total, 0);
    assert.equal(result.reviewCount, month === "2026-11" ? 1 : 0);
  }
});
test("les dates estimées OTA restent incluses, identifiées au CSV et distinguées d’une date confirmée", () => {
  const estimated = {
    ...receipt,
    channel: "Airbnb",
    paymentDateEstimated: true,
  };
  const result = evaluateReport(report, "2026-10", {}, [estimated], sources);
  assert.equal(result.total, 101);
  assert.equal(result.reviewCount, 0);
  assert.match(reportCsv(report, result), /"Date estimée"/);
  assert.match(reportCsv(report, result), /"Oui \(arrivée \+ 1 jour\)"/);
  assert.equal(
    snapshotDiffers(
      {
        confirmedAt: "2026-10-31",
        definition: report,
        result,
      },
      evaluateReport(report, "2026-10", {}, [receipt], sources),
    ),
    true,
  );
});
test("les rapports sociaux demandent un rattachement confirmé à un exploitant", () => {
  assert.equal(
    evaluateReport(report, "2026-10", {}, [receipt], {
      ...sources,
      operatorIssues: { g: "Établissement à rattacher" },
    }).reviewCount,
    1,
  );
  assert.equal(
    evaluateReport(
      { ...report, operatorId: "other" },
      "2026-10",
      {},
      [receipt],
      sources,
    ).reviewCount,
    1,
  );
  assert.equal(
    evaluateReport(
      { ...report, operatorId: null },
      "2026-10",
      {},
      [receipt],
      sources,
    ).reviewCount,
    1,
  );
});
test("une correction interne ne peut exclure un encaissement d’un rapport social", () => {
  assert.equal(
    evaluateReport(
      report,
      "2026-10",
      { payment: { status: "excluded", note: "Test" } },
      [receipt],
      sources,
    ).total,
    101,
  );
  assert.equal(
    evaluateReport(
      { ...report, kind: "custom" },
      "2026-10",
      { payment: { status: "excluded", note: "Erreur de classement" } },
      [receipt],
      sources,
    ).total,
    0,
  );
});
test("la ventilation inconnue des options ne bloque que les sélections partielles", () => {
  const operation = {
    ...receipt,
    category: "extras" as const,
    categoryUncertain: true,
  };
  assert.equal(
    evaluateReport(report, "2026-10", {}, [operation], sources).total,
    101,
  );
  const partial = evaluateReport(
    { ...report, categories: ["cleaning"] },
    "2026-10",
    {},
    [operation],
    sources,
  );
  assert.equal(partial.total, 0);
  assert.equal(partial.reviewCount, 1);
});
test("les bornes trimestrielles et annuelles excluent la borne de fin", () => {
  assert.equal(getReportPeriod("2026-12", "quarterly").end, "2027-01-01");
  assert.equal(getReportPeriod("2026-01", "yearly").end, "2027-01-01");
  assert.equal(
    reportPeriodKey({ ...report, cadence: "quarterly" }, "2026-10"),
    reportPeriodKey({ ...report, cadence: "quarterly" }, "2026-12"),
  );
  assert.equal(
    evaluateReport(
      report,
      "2026-10",
      {},
      [{ ...receipt, paymentDate: "2026-11-01" }],
      sources,
    ).rows.length,
    0,
  );
});
test("le CSV conserve les noms réels et protège les cellules contre les formules", () => {
  const result = evaluateReport(
    report,
    "2026-10",
    {},
    [{ ...receipt, guest: "=IMPORT()" }],
    sources,
  );
  const csv = reportCsv(report, result);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /Gîte réel/);
  assert.match(csv, /'=IMPORT/);
  assert.doesNotMatch(csv, /fictif|exemple/);
});
test("une copie confirmée détecte les changements de montant sans dépendre du texte explicatif", () => {
  const result = evaluateReport(report, "2026-10", {}, [receipt], sources);
  const snapshot = {
    confirmedAt: "2026-10-29",
    definition: report,
    result: structuredClone(result),
  };
  assert.equal(
    snapshotDiffers(snapshot, {
      ...result,
      rows: result.rows.map((row) => ({ ...row, reason: "Libellé reformulé" })),
    }),
    false,
  );
  assert.equal(
    snapshotDiffers(
      snapshot,
      evaluateReport(
        report,
        "2026-10",
        {},
        [{ ...receipt, amountCents: 102 }],
        sources,
      ),
    ),
    true,
  );
});

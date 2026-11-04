import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNightOperations,
  createReport,
  evaluateReport,
  reportDefinitionSchema,
  snapshotDiffers,
} from "../src/index.js";

const stay = {
  id: "stay",
  gite_id: "g",
  hote_nom: "Voyageurs",
  date_entree: "2026-12-30",
  date_sortie: "2027-01-02",
  nb_adultes: 2,
  nb_enfants_2_17: 3,
  infants: 1,
  booking_source: "Direct",
};
const report = {
  ...createReport("tourist", "nights"),
  recipient: "Gestionnaire",
  propertyIds: ["g"],
};

test("le même calcul répartit les nuits aux frontières de mois/année et exclut les mineurs par défaut", () => {
  const operations = buildNightOperations([stay]);
  assert.equal(operations.length, 2);
  assert.deepEqual(
    operations.map((row) => row.nightCounts),
    [
      { adults: 4, children: 6, infants: 2 },
      { adults: 2, children: 3, infants: 1 },
    ],
  );
  assert.equal(evaluateReport(report, "2026-12", {}, operations).total, 4);
  assert.equal(evaluateReport(report, "2027-01", {}, operations).total, 2);
  assert.equal(
    evaluateReport(
      { ...report, nightGuests: ["adults", "children"] },
      "2026-12",
      {},
      operations,
    ).total,
    10,
  );
  assert.equal(
    evaluateReport(
      { ...report, nightGuests: ["infants"] },
      "2026-12",
      {},
      operations,
    ).total,
    2,
  );
  assert.equal(
    evaluateReport(
      { ...report, cadence: "quarterly" },
      "2026-12",
      {},
      operations,
    ).total,
    4,
  );
});

test("les sources sont filtrées indépendamment du règlement et les exclusions historiques acceptent les sources futures", () => {
  const operations = buildNightOperations([
    { ...stay, id: "cash", source_paiement: "Espèces" },
    {
      ...stay,
      id: "airbnb",
      booking_source: "Airbnb",
      source_paiement: "Virement",
    },
    { ...stay, id: "future", booking_source: "Nouvelle plateforme" },
  ]);
  const rules = {
    ...report,
    bookingSources: undefined,
    excludedBookingSources: ["Airbnb"],
  };
  assert.equal(evaluateReport(rules, "2026-12", {}, operations).total, 8);
  assert.equal(
    evaluateReport({ ...rules, cadence: "yearly" }, "2027-01", {}, operations)
      .total,
    4,
  );
});

test("le filtre d’occupants est non vide, sans doublon et réservé aux rapports de nuitées", () => {
  assert.ok(reportDefinitionSchema.safeParse(report).success);
  for (const nightGuests of [[], ["adults", "adults"], ["unknown"]])
    assert.equal(
      reportDefinitionSchema.safeParse({ ...report, nightGuests }).success,
      false,
    );
  assert.equal(
    reportDefinitionSchema.safeParse({ ...report, kind: "custom" }).success,
    false,
  );
});

test("les identifiants repris du gîte changent la déclaration sans changer les nuitées", () => {
  const definition = { ...report, nightDeclaration: true };
  const operations = buildNightOperations([stay]).map((operation) => ({
    ...operation,
    taxableNights: operation.nights,
  }));
  const source = {
    propertyOperators: {},
    operationEdits: {},
    propertyNightDeclarations: {
      g: {
        registration: { number: "NER-A", notApplicable: false },
        receiptReference: "RCP-A",
      },
    },
  };
  const evaluate = (sources = source, rules = definition) =>
    evaluateReport(rules, "2026-12", {}, operations, sources);
  const before = evaluate();
  const after = evaluate({
    ...source,
    propertyNightDeclarations: {
      g: {
        ...source.propertyNightDeclarations.g,
        registration: { number: "NER-B", notApplicable: false },
      },
    },
  });
  assert.equal(after.total, before.total);
  assert.equal(snapshotDiffers({ result: before }, after), true);
  const receiptChange = evaluate({
    ...source,
    propertyNightDeclarations: {
      g: { ...source.propertyNightDeclarations.g, receiptReference: "RCP-B" },
    },
  });
  assert.equal(snapshotDiffers({ result: before }, receiptChange), true);
  const manual = {
    ...definition,
    nightRegistrations: { g: { number: "MANUEL", notApplicable: false } },
  };
  const overriddenBefore = evaluate(source, manual);
  assert.equal(
    snapshotDiffers(
      { result: overriddenBefore },
      evaluate(
        {
          ...source,
          propertyNightDeclarations: {
            g: {
              ...source.propertyNightDeclarations.g,
              registration: { number: "NER-B", notApplicable: false },
            },
          },
        },
        manual,
      ),
    ),
    false,
  );
  const historical = evaluateReport(definition, "2026-12", {}, operations);
  const legacySources = {
    propertyOperators: {},
    operationEdits: {},
    propertyNightDeclarations: { g: { portalReference: "PMM" } },
  };
  assert.equal(
    snapshotDiffers(
      { result: historical },
      evaluateReport(definition, "2026-12", {}, operations, legacySources),
    ),
    false,
  );
});

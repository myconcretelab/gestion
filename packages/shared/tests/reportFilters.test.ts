import assert from "node:assert/strict";
import test from "node:test";
import {
  createReport,
  evaluateReport,
  reportDefinitionSchema,
  reportDraftSchema,
  reportCsv,
  type ReportOperation,
} from "../src/index.js";

const operation: ReportOperation = {
  id: "direct",
  reservation: "reservation",
  guest: "Voyageur",
  propertyId: "g1",
  category: "accommodation",
  amountCents: 10000,
  nights: 6,
  paymentDate: "2026-10-10",
  stayDate: "2026-10-10",
  channel: "Direct",
  paymentMethod: "cash",
};
const sources = {
  propertyOperators: { g1: "entity", g2: "entity" },
  propertyManagers: { g1: "manager-a", g2: "manager-b" },
  operationEdits: {},
};

test("tous les modèles filtrent la source de réservation indépendamment du paiement", () => {
  for (const kind of ["social", "tourist", "owner", "custom"] as const) {
    const report = {
      ...createReport(kind, kind),
      propertyIds: ["g1"],
      categories: ["accommodation" as const],
      operatorId: "entity",
      managerId: "manager-a",
      bookingSources: ["Direct"],
    };
    const operations: ReportOperation[] = [
      operation,
      {
        ...operation,
        id: "direct-platform",
        channel: "Airbnb",
        bookingSource: "Direct",
        paymentMethod: "platform",
      },
      {
        ...operation,
        id: "airbnb-cash",
        channel: "Airbnb",
        bookingSource: "Airbnb",
        paymentMethod: "cash",
        reviewReason: "À contrôler",
      },
      {
        ...operation,
        id: "booking",
        channel: "Booking.com",
        paymentMethod: "card",
      },
      { ...operation, id: "other-manager", propertyId: "g2" },
    ];
    const result = evaluateReport(report, "2026-10", {}, operations, sources);
    assert.equal(result.total, kind === "tourist" ? 12 : 20000);
    assert.equal(result.includedCount, 2);
    assert.equal(result.reviewCount, 0);
    assert.equal(result.excludedCount, 3);
    assert.match(
      result.rows.find((row) => row.id === "airbnb-cash")!.reason,
      /source Airbnb/,
    );
    assert.equal(
      result.rows.find((row) => row.id === "airbnb-cash")!.issues.length,
      0,
    );
    assert.match(reportCsv(report, result), /source Airbnb/);
    const multi = evaluateReport(
      { ...report, bookingSources: ["Direct", "Booking.com"] },
      "2026-10",
      {},
      operations,
      sources,
    );
    assert.equal(multi.includedCount, 3);
  }
});

test("les anciens rapports sans filtre incluent aussi les sources futures et les nouveaux modèles de nuitées proposent Direct", () => {
  assert.deepEqual(createReport("tourist", "new").bookingSources, ["Direct"]);
  const old = {
    ...createReport("tourist", "old"),
    propertyIds: ["g1"],
    bookingSources: undefined,
  };
  const operations = [
    operation,
    { ...operation, id: "new-source", channel: "Nouveau canal" },
  ];
  assert.equal(
    evaluateReport(old, "2026-10", {}, operations, sources).total,
    12,
  );
  assert.equal(
    evaluateReport(
      { ...old, bookingSources: ["Direct"] },
      "2026-10",
      {},
      operations,
      sources,
    ).total,
    6,
  );
});

test("un logement réaffecté au même exploitant mais à un autre gestionnaire demande une vérification", () => {
  const report = {
    ...createReport("tourist", "n"),
    propertyIds: ["g1"],
    managerId: "manager-b",
  };
  const result = evaluateReport(report, "2026-10", {}, [operation], sources);
  assert.equal(result.total, 0);
  assert.equal(result.reviewCount, 1);
  assert.match(result.rows[0].issues[0].message, /gestionnaire/);
});

test("une ancienne correction interne ne réinclut pas une source désormais exclue", () => {
  const report = {
    ...createReport("custom", "custom"),
    propertyIds: ["g1"],
    categories: ["accommodation" as const],
    bookingSources: ["Direct"],
  };
  const result = evaluateReport(
    report,
    "2026-10",
    {
      airbnb: { status: "included", note: "Ancienne correction" },
    },
    [
      {
        ...operation,
        id: "airbnb",
        channel: "Airbnb",
        reviewReason: "Ancien problème",
      },
    ],
    sources,
  );
  assert.equal(result.total, 0);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.rows[0].status, "excluded");
  assert.match(result.rows[0].reason, /source Airbnb/);
});

test("un brouillon peut décocher toutes les sources mais une règle appliquée exige une sélection valide", () => {
  const report = { ...createReport("tourist", "n"), propertyIds: ["g1"] };
  for (const bookingSources of [[], ["Direct", "Direct"], [""], ["   "]]) {
    assert.equal(
      reportDefinitionSchema.safeParse({ ...report, bookingSources }).success,
      false,
    );
  }
  assert.equal(
    reportDraftSchema.safeParse({ ...report, bookingSources: [] }).success,
    true,
  );
  assert.equal(
    reportDefinitionSchema.safeParse({ ...report, bookingSources: undefined })
      .success,
    true,
  );
});

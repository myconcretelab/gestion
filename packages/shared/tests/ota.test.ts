import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAirbnbCsv,
  otaChannelSchema,
  otaRate,
  createReport,
  evaluateReport,
  snapshotDiffers,
  type ReportOperation,
} from "../src/index.js";
import { airbnbFixture } from "./fixtures/airbnb.js";
test("Airbnb conserve brut, frais, net, dates américaines, références et groupes de versement", () => {
  const rows = parseAirbnbCsv("\uFEFF" + airbnbFixture());
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026-10-31");
  assert.equal(rows[0].arrivalBy, "2026-11-05");
  assert.deepEqual(
    [rows[1].grossCents, rows[1].feeCents, rows[1].netCents],
    [10000, 1500, 8500],
  );
  assert.equal(rows[2].type, "resolution");
  assert.equal(rows[2].payoutReference, rows[0].payoutReference);
  assert.equal(rows[1].start, "2026-10-30");
});
test("CSV cité, multi-lignes et décimales mixtes ; aucune ligne inconnue ni incohérente ignorée", () => {
  assert.equal(
    parseAirbnbCsv(airbnbFixture({ Voyageur: 'Client "Test",\nnom' }))[1].guest,
    'Client "Test",\nnom',
  );
  const invalid: Array<Record<string, string>> = [
    { Devise: "USD" },
    { Montant: "84.00" },
    { "Frais de service": "abc" },
    { Date: "02/30/2026" },
    { Type: "Type inconnu" },
    { "Code de confirmation": "" },
  ];
  for (const patch of invalid)
    assert.throws(() => parseAirbnbCsv(airbnbFixture(patch)));
  assert.throws(() =>
    parseAirbnbCsv(airbnbFixture().replace('"100.00"', '"99.00"')),
  );
});
test("commissions datées : limites inclusives, zéro valide, pas de taux rétroactif implicite", () => {
  const channel = otaChannelSchema.parse({
    name: "Airbnb",
    automatic: true,
    rates: [
      { effectiveFrom: "2026-01-01", percent: 15 },
      { effectiveFrom: "2026-10-01", percent: 16 },
      { effectiveFrom: "2027-01-01", percent: 0 },
    ],
  });
  assert.equal(otaRate(channel, "2025-12-31"), undefined);
  assert.equal(otaRate(channel, "2026-09-30")?.percent, 15);
  assert.equal(otaRate(channel, "2026-10-01")?.percent, 16);
  assert.equal(otaRate(channel, "2027-01-01")?.percent, 0);
  assert.equal(
    otaChannelSchema.safeParse({
      ...channel,
      rates: [channel.rates[0], channel.rates[0]],
    }).success,
    false,
  );
});
test("le choix brut/net appartient au rapport, sans modifier le règlement ni une copie confirmée", () => {
  const report = {
    ...createReport("social", "report"),
    propertyIds: ["g"],
    operatorId: "e",
  };
  const operation: ReportOperation = {
    id: "p",
    reservation: "r",
    guest: "Client",
    propertyId: "g",
    category: "accommodation",
    amountCents: 8500,
    nights: 0,
    paymentDate: "2026-10-31",
    stayDate: "2026-09-30",
    channel: "Airbnb",
    paymentMethod: "platform",
    basis: "payment",
    ota: {
      channel: "Airbnb",
      category: "accommodation",
      source: "import",
      grossCents: 10000,
      feeCents: 1500,
      netCents: 8500,
    },
  };
  const sources = { propertyOperators: { g: "e" }, operationEdits: {} };
  const gross = evaluateReport(report, "2026-10", {}, [operation], sources);
  const net = evaluateReport(
    { ...report, otaAmountBasis: "net" },
    "2026-10",
    {},
    [operation],
    sources,
  );
  assert.equal(gross.total, 10000);
  assert.equal(net.total, 8500);
  assert.equal(operation.amountCents, 8500);
  assert.equal(
    snapshotDiffers(
      { confirmedAt: "2026-10-31", definition: report, result: gross },
      net,
    ),
    true,
  );
});

test("arrondis OTA : un seul centime, dans les deux sens, avec une base non ambiguë", async () => {
  const { findOtaRoundingAdjustment: rounding } =
    await import("../src/index.js");
  for (const [recorded, basis, reference] of [
    [8501, "net", 8500],
    [8499, "net", 8500],
    [10001, "gross", 10000],
    [9999, "gross", 10000],
  ] as const) {
    assert.deepEqual(rounding(recorded, 10000, 8500), {
      basis,
      sourceAmountCents: reference,
      recordedAmountCents: recorded,
      adjustmentCents: recorded - reference,
    });
  }
  assert.equal(rounding(8501, 8500, 8500)?.basis, "net");
  for (const recorded of [
    8500,
    10000,
    8502,
    8498,
    10002,
    9998,
    0,
    -1,
    8500.5,
    NaN,
  ])
    assert.equal(rounding(recorded, 10000, 8500), null);
  assert.equal(rounding(8501, 8502, 8500), null); // One cent from both different bases.
  assert.equal(rounding(1, 10000, 0), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getReportPeriod,
  createReport,
  reportDefinitionSchema,
  nightDeclarationCsv,
  summarizeNightRegister,
  type NightRegisterRow,
  type NightRegister,
} from "../src/index.js";

const property = {
  id: "g1",
  name: "Gîte",
  address: "Adresse",
  registrationNumber: "123",
};
const row = (patch: Partial<NightRegisterRow> = {}): NightRegisterRow => ({
  key: "p1",
  reservationId: "r1",
  reference: "Séjour 1",
  propertyId: "g1",
  propertyName: "Gîte",
  address: "Adresse",
  registrationNumber: "123",
  arrival: "2026-10-01",
  departure: "2026-10-04",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-04",
  collectionDate: "2026-10-02",
  collector: "host",
  adults: 2,
  taxableAdults: 1,
  exemptAdults: 1,
  children: 1,
  infants: 1,
  occupants: 4,
  nights: 3,
  personNights: 12,
  classified: true,
  nightlyPriceCents: null,
  collectedTaxCents: 100,
  observedCollectionCents: 100,
  collectedBaseTaxCents: 90,
  calculatedStayTaxCents: 300,
  additionalTaxes: "Taxe départementale : 0,10 €",
  exemptionReason: "Mineurs et saisonnier",
  source: "Direct",
  issues: [],
  ...patch,
});

test("la synthèse décompte les exonérations et compte chaque séjour une seule fois pour plusieurs perceptions", () => {
  const [summary] = summarizeNightRegister({
    properties: [property],
    rows: [
      row(),
      row({ key: "p2", collectedTaxCents: 200, collectedBaseTaxCents: 180 }),
    ],
  });
  assert.equal(summary.stays, 1);
  assert.equal(summary.personNights, 12);
  assert.equal(summary.taxablePersonNights, 3);
  assert.equal(summary.exemptMinorPersonNights, 6);
  assert.equal(summary.exemptAdultPersonNights, 3);
  assert.equal(summary.hostCollectedCents, 300);
  assert.equal(summary.platformCollectedCents, 0);
  assert.equal(summary.baseCollectedCents, 270);
  assert.equal(summary.additionalCollectedCents, 30);
});

test("les perceptions des plateformes sont séparées et les inconnues ne deviennent jamais zéro", () => {
  const [platform] = summarizeNightRegister({
    properties: [property],
    rows: [
      row({
        collector: "platform",
        collectedTaxCents: null,
        collectedBaseTaxCents: null,
      }),
    ],
  });
  assert.equal(platform.hostCollectedCents, 0);
  assert.equal(platform.platformCollectedCents, null);
  assert.equal(platform.baseCollectedCents, null);
  const [unknown] = summarizeNightRegister({
    properties: [property],
    rows: [
      row({
        collector: "unknown",
        taxableAdults: null,
        exemptAdults: null,
        infants: null,
        personNights: null,
        issues: ["Barème à compléter"],
      }),
    ],
  });
  assert.equal(unknown.hostCollectedCents, null);
  assert.equal(unknown.platformCollectedCents, null);
  assert.equal(unknown.taxablePersonNights, null);
  assert.equal(unknown.personNights, null);
  assert.equal(unknown.incompleteStays, 1);
});

test("la non-application reste séparée des exonérations et un gîte vide présente zéro", () => {
  const [summary, empty] = summarizeNightRegister({
    properties: [property, { ...property, id: "empty" }],
    rows: [row({ collector: "not_applicable" })],
  });
  assert.equal(summary.nonApplicablePersonNights, 12);
  assert.equal(summary.taxablePersonNights, 0);
  assert.equal(summary.exemptMinorPersonNights, 0);
  assert.equal(empty.personNights, 0);
  assert.equal(empty.hostCollectedCents, 0);
});

test("le calendrier de Brocéliande couvre l’année sans chevauchement ni trou", () => {
  const expected = [
    ["2026-01-01", "2026-06-01"],
    ["2026-06-01", "2026-10-01"],
    ["2026-10-01", "2027-01-01"],
  ];
  for (let month = 1; month <= 12; month++) {
    const period = getReportPeriod(
      `2026-${String(month).padStart(2, "0")}`,
      "broceliande",
    );
    assert.deepEqual(
      [period.start, period.end],
      expected[month <= 5 ? 0 : month <= 9 ? 1 : 2],
    );
  }
  const definition = {
    ...createReport("tourist", "test"),
    propertyIds: ["g1"],
    nightDeclaration: true,
    cadence: "broceliande",
    nightRegistrations: { g1: { number: "123", notApplicable: false } },
  };
  assert.equal(reportDefinitionSchema.safeParse(definition).success, true);
  assert.equal(
    reportDefinitionSchema.safeParse({ ...definition, kind: "custom" }).success,
    false,
  );
  assert.equal(
    reportDefinitionSchema.safeParse({
      ...definition,
      nightRegistrations: { other: { number: "123", notApplicable: false } },
    }).success,
    false,
  );
});

test("le CSV de synthèse conserve les valeurs inconnues et protège les cellules de texte", () => {
  const summary = summarizeNightRegister({
    properties: [{ ...property, name: "=FORMULE" }],
    rows: [row({ collectedTaxCents: null })],
  });
  const csv = nightDeclarationCsv({
    summary,
    period: { label: "octobre 2026" },
  } as NightRegister);
  assert.match(csv, /Nuitées taxables/);
  assert.match(csv, /"'=FORMULE"/);
  assert.match(csv, /À compléter/);
});

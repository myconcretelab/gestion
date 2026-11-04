import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createReport,
  taxRemittanceAccounts,
  taxRemittanceSources,
  taxRemittanceSourcesChanged,
  taxRemittanceSourcesOverlap,
  taxRemittanceTotals,
  reportCommandSchema,
  type ReportState,
  type NightRegister,
  type TaxRemittance,
} from "../src/index.js";

const account = { id: "soazig", name: "Soazig", propertyIds: ["liberte"] };
const sourceState = (): Pick<ReportState, "progress"> => ({
  progress: {
    "nights:2026-10:monthly": {
      snapshot: {
        confirmedAt: "2026-11-01T12:00:00Z",
        definition: {
          ...createReport("tourist", "nights"),
          nightDeclaration: true,
        },
        result: {
          total: 0,
          rows: [],
          includedCount: 0,
          reviewCount: 0,
          excludedCount: 0,
        },
        nightRegister: {
          reportId: "nights",
          reportName: "Nuitées",
          revision: "a",
          incompleteCount: 0,
          period: {
            label: "Octobre 2026",
            start: "2026-10-01",
            end: "2026-11-01",
          },
          summary: [
            {
              propertyId: "liberte",
              propertyName: "Le Liberté",
              hostCollectedCents: 210,
              platformCollectedCents: 400,
            },
            {
              propertyId: "other",
              propertyName: "Autre propriétaire",
              hostCollectedCents: 900,
              platformCollectedCents: 0,
            },
          ],
        } as NightRegister,
      },
    },
  },
});

test("reversements : les propriétaires et les copies confirmées séparent Le Liberté des autres gîtes", () => {
  const accounts = taxRemittanceAccounts({
    managers: [
      { id: "soazig", name: "Soazig" },
      { id: "seb", name: "Sébastien" },
    ],
    properties: [
      { id: "liberte", managerId: "soazig" },
      { id: "other", managerId: "seb" },
    ],
  });
  assert.deepEqual(accounts[0], account);
  const state = sourceState();
  const sources = taxRemittanceSources(state, account);
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0].properties, [
    { id: "liberte", name: "Le Liberté", hostCents: 210, platformCents: 400 },
  ]);
  state.progress[
    Object.keys(state.progress)[0]
  ].snapshot!.nightRegister!.summary[0].hostCollectedCents = null;
  assert.deepEqual(taxRemittanceSources(state, account), []);
});

test("reversements : soldes exacts, paiements partiels, trop-versé et corrections conservées", () => {
  const state = sourceState();
  const remittance: TaxRemittance = {
    id: "r",
    accountId: "soazig",
    accountName: "Soazig",
    label: "T4",
    declaredAmountCents: 210,
    declarationReference: "",
    note: "",
    sources: taxRemittanceSources(state, account),
    createdAt: "",
    updatedAt: "",
    payments: [],
  };
  assert.equal(taxRemittanceTotals(remittance).status, "À reverser");
  remittance.payments.push({
    id: "p",
    paidOn: "2026-11-01",
    amountCents: 100,
    reference: "",
    note: "",
    recordedAt: "",
    recordedBy: null,
  });
  assert.deepEqual(taxRemittanceTotals(remittance), {
    collectedCents: 210,
    platformCents: 400,
    paidCents: 100,
    balanceCents: 110,
    differenceCents: 0,
    status: "Partiellement réglé",
  });
  remittance.payments[0].amountCents = 210;
  assert.equal(taxRemittanceTotals(remittance).status, "Réglé");
  remittance.payments[0].amountCents = 211;
  assert.equal(taxRemittanceTotals(remittance).status, "Trop versé");
  remittance.payments[0].voidedAt = "2026-11-02";
  assert.equal(taxRemittanceTotals(remittance).status, "À reverser");
  assert.equal(taxRemittanceSourcesChanged(state, remittance), false);
  state.progress[Object.keys(state.progress)[0]].resolutions = [
    {
      resolvedAt: "",
      outcome: "corrected",
      note: "Rectification",
      definition:
        state.progress[Object.keys(state.progress)[0]].snapshot!.definition,
      result: state.progress[Object.keys(state.progress)[0]].snapshot!.result,
      nightRegister: {
        ...state.progress[Object.keys(state.progress)[0]].snapshot!
          .nightRegister!,
        revision: "b",
      },
    },
  ];
  assert.equal(taxRemittanceSourcesChanged(state, remittance), true);
  assert.equal(remittance.sources[0].revision, "a");
  remittance.cancelledAt = "2026-11-02";
  assert.equal(taxRemittanceTotals(remittance).status, "Annulé");
});

test("reversements : les chevauchements portent sur le gîte et les dates, et les saisies invalides sont rejetées", () => {
  const source = taxRemittanceSources(sourceState(), account)[0];
  assert.equal(
    taxRemittanceSourcesOverlap(source, { ...source, key: "another-report" }),
    true,
  );
  assert.equal(
    taxRemittanceSourcesOverlap(source, {
      ...source,
      start: source.end,
      end: "2026-12-01",
    }),
    false,
  );
  assert.equal(
    taxRemittanceSourcesOverlap(source, {
      ...source,
      properties: [
        { id: "other", name: "Autre", hostCents: 1, platformCents: 0 },
      ],
    }),
    false,
  );
  for (const payment of [
    { paidOn: "2026-02-30", amountCents: 210 },
    { paidOn: "2026-11-01", amountCents: -1 },
    { paidOn: "2026-11-01", amountCents: 0 },
    { paidOn: "2026-11-01", amountCents: 1.2 },
  ]) {
    assert.equal(
      reportCommandSchema.safeParse({
        type: "remittance-payment",
        remittanceId: "r",
        payment: { id: "p", reference: "", note: "", ...payment },
      }).success,
      false,
    );
  }
});

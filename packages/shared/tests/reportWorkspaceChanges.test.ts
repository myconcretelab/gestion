import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReportWorkspaceChanges,
  createReport,
  reportWorkspaceChanges,
  type ReportWorkspaceData,
} from "../src/index.js";

const workspace = (): ReportWorkspaceData => ({
  version: 3,
  organizationId: "org_changes",
  revision: 4,
  factsRevision: "checked-sources",
  properties: [],
  operators: [],
  operations: [],
  legacyDeclarations: [],
  propertyOperators: {},
  operationEdits: {},
  reports: [createReport("tourist", "nights")],
  drafts: { local: createReport("custom", "local") },
  overrides: {},
  progress: {},
  worklistStartMonth: "2026-01",
});

test("les changements de statut conservent les sources et brouillons locaux, et remplacent les réglages facultatifs", () => {
  const before = workspace();
  const next = {
    ...before,
    revision: 5,
    progress: { "nights:2026-10:monthly": { ready: true } },
    worklistStartMonth: undefined,
    calculatedAt: "2026-11-05T17:00:00Z",
    legacyDeclarations: [
      {
        id: "legacy",
        kind: "tourist" as const,
        period: "2025-10",
        subject: "Gîte",
        value: 12,
        confirmedAt: "2025-11-01T12:00:00Z",
      },
    ],
  };
  const changes = JSON.parse(
    JSON.stringify(reportWorkspaceChanges(next, before.revision)),
  );
  assert.equal("operations" in changes, false);
  assert.equal("drafts" in changes.configuration, false);
  const merged = applyReportWorkspaceChanges(before, changes);
  assert.equal(merged.operations, before.operations);
  assert.equal(merged.properties, before.properties);
  assert.equal(merged.drafts, before.drafts);
  assert.deepEqual(merged.progress, next.progress);
  assert.deepEqual(merged.legacyDeclarations, next.legacyDeclarations);
  assert.equal(merged.worklistStartMonth, undefined);
  assert.equal(merged.revision, 5);
});

test("une réponse partielle ne peut pas s’appliquer à une autre organisation ou à des données renouvelées", () => {
  const before = workspace();
  const changes = reportWorkspaceChanges({ ...before, revision: 5 }, 4);
  for (const state of [
    { ...before, organizationId: "org_other" },
    { ...before, revision: 6 },
    { ...before, factsRevision: "new-sources" },
  ])
    assert.throws(
      () => applyReportWorkspaceChanges(state, changes),
      /Actualisez/,
    );
  assert.equal(before.revision, 4);
});

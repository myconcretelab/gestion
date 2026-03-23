import assert from "node:assert/strict";
import test from "node:test";
import { buildPumpSessionImportLogEntry } from "../src/services/importLog.ts";

test("buildPumpSessionImportLogEntry convertit une session Pump terminee en entree de traceabilite", () => {
  const entry = buildPumpSessionImportLogEntry(
    {
      sessionId: "session_123",
      status: "completed",
      createdAt: "2026-03-23T20:45:28.911Z",
      updatedAt: "2026-03-23T20:45:50.538Z",
      lastError: null,
    },
    14
  );

  assert.ok(entry);
  assert.equal(entry.source, "pump-refresh");
  assert.equal(entry.status, "success");
  assert.equal(entry.selectionCount, 14);
  assert.equal(entry.errorMessage, null);
});

test("buildPumpSessionImportLogEntry marque les refresh Pump en erreur avec leur message", () => {
  const entry = buildPumpSessionImportLogEntry({
    sessionId: "session_456",
    status: "failed",
    createdAt: "2026-03-23T20:36:06.914Z",
    updatedAt: "2026-03-23T20:36:15.463Z",
    lastError: "Bouton introuvable.",
  });

  assert.ok(entry);
  assert.equal(entry.source, "pump-refresh");
  assert.equal(entry.status, "error");
  assert.equal(entry.errorMessage, "Bouton introuvable.");
  assert.equal(entry.selectionCount, 0);
});

test("buildPumpSessionImportLogEntry ignore les sessions Pump non finalisees", () => {
  const entry = buildPumpSessionImportLogEntry({
    sessionId: "session_789",
    status: "running",
    createdAt: "2026-03-23T20:36:06.914Z",
    updatedAt: "2026-03-23T20:36:15.463Z",
  });

  assert.equal(entry, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  isPumpAutomationSessionInProgress,
  recoverOrphanedPumpSessionRecords,
  runPumpTaskWithTimeout,
} from "../src/services/pumpAutomation.ts";

test("isPumpAutomationSessionInProgress reconnait les statuts non termines", () => {
  assert.equal(isPumpAutomationSessionInProgress("starting"), true);
  assert.equal(isPumpAutomationSessionInProgress("running"), true);
  assert.equal(isPumpAutomationSessionInProgress("completed"), false);
  assert.equal(isPumpAutomationSessionInProgress("failed"), false);
});

test("recoverOrphanedPumpSessionRecords marque uniquement les sessions sans processus actif", () => {
  const recoveredAt = new Date("2026-08-29T10:57:00.000Z");
  const result = recoverOrphanedPumpSessionRecords(
    {
      sessions: {
        orphaned: {
          sessionId: "orphaned",
          status: "running",
          updatedAt: "2026-08-29T08:41:48.099Z",
          lastError: null,
        },
        active: {
          sessionId: "active",
          status: "running",
          updatedAt: "2026-08-29T10:56:59.000Z",
          lastError: null,
        },
        completed: {
          sessionId: "completed",
          status: "completed",
          updatedAt: "2026-08-28T08:02:02.523Z",
          lastError: null,
        },
      },
    },
    new Set(["active"]),
    recoveredAt
  );

  assert.deepEqual(result.recoveredSessionIds, ["orphaned"]);
  assert.equal(result.registry.sessions.orphaned?.status, "failed");
  assert.equal(result.registry.sessions.orphaned?.updatedAt, recoveredAt.toISOString());
  assert.match(result.registry.sessions.orphaned?.lastError ?? "", /redémarrage du serveur/);
  assert.equal(result.registry.sessions.active?.status, "running");
  assert.equal(result.registry.sessions.completed?.status, "completed");
});

test("runPumpTaskWithTimeout interrompt une capture bloquee et appelle son nettoyage", async () => {
  let cleanupCalled = false;

  await assert.rejects(
    runPumpTaskWithTimeout(
      () => new Promise<void>(() => undefined),
      10,
      "capture timeout",
      () => {
        cleanupCalled = true;
      }
    ),
    /capture timeout/
  );

  assert.equal(cleanupCalled, true);
});

test("runPumpTaskWithTimeout laisse une capture rapide se terminer", async () => {
  const result = await runPumpTaskWithTimeout(async () => "ok", 100, "capture timeout");
  assert.equal(result, "ok");
});

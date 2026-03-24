import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAirbnbCalendarRefreshAppNotice,
  getAirbnbCalendarRefreshNotice,
  handleAirbnbCalendarRefreshFailure,
  waitForAirbnbCalendarRefreshJob,
  type AirbnbCalendarRefreshJobStatus,
} from "../src/utils/airbnbCalendarRefresh.ts";

test("waitForAirbnbCalendarRefreshJob s'arrete sur success", async () => {
  const statuses: AirbnbCalendarRefreshJobStatus[] = [
    {
      job_id: "job-1",
      status: "queued",
      updated_at: new Date().toISOString(),
    },
    {
      job_id: "job-1",
      status: "running",
      updated_at: new Date().toISOString(),
    },
    {
      job_id: "job-1",
      status: "success",
      message: "ok",
      updated_at: new Date().toISOString(),
    },
  ];
  let sleepCount = 0;
  const seenStatuses: AirbnbCalendarRefreshJobStatus["status"][] = [];

  const result = await waitForAirbnbCalendarRefreshJob("job-1", {
    fetchStatus: async () => {
      const next = statuses.shift();
      assert.ok(next);
      return next;
    },
    sleep: async () => {
      sleepCount += 1;
    },
    onUpdate: (status) => {
      seenStatuses.push(status.status);
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.message, "ok");
  assert.equal(sleepCount, 2);
  assert.deepEqual(seenStatuses, ["queued", "running", "success"]);
});

test("waitForAirbnbCalendarRefreshJob retourne failed sur timeout", async () => {
  const result = await waitForAirbnbCalendarRefreshJob("job-timeout", {
    maxAttempts: 2,
    fetchStatus: async () => ({
      job_id: "job-timeout",
      status: "running",
      updated_at: new Date().toISOString(),
    }),
    sleep: async () => undefined,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "timeout");
});

test("getAirbnbCalendarRefreshNotice mappe les statuts en ton et message UI", () => {
  assert.deepEqual(
    getAirbnbCalendarRefreshNotice({
      status: "queued",
      job_id: "job-queued",
      updated_at: new Date().toISOString(),
    }),
    {
      tone: "info",
      message: "Rafraîchissement Airbnb planifié.",
    }
  );

  assert.deepEqual(
    getAirbnbCalendarRefreshNotice({
      status: "success",
      job_id: "job-success",
      message: "ok",
      updated_at: new Date().toISOString(),
    }),
    {
      tone: "success",
      message: "ok",
    }
  );

  assert.deepEqual(
    getAirbnbCalendarRefreshNotice({
      status: "skipped",
      message: "Aucun refresh",
    }),
    {
      tone: "info",
      message: "Aucun refresh",
    }
  );
});

test("buildAirbnbCalendarRefreshAppNotice convertit le statut Airbnb en toast global", () => {
  assert.deepEqual(
    buildAirbnbCalendarRefreshAppNotice({
      status: "running",
      job_id: "job-running",
      message: "Rafraîchissement Airbnb en cours.",
      updated_at: new Date().toISOString(),
    }),
    {
      label: "Airbnb",
      message: "Rafraîchissement Airbnb en cours.",
      tone: "neutral",
      timeoutMs: null,
      role: "status",
    }
  );

  assert.deepEqual(
    buildAirbnbCalendarRefreshAppNotice({
      status: "failed",
      job_id: "job-failed",
      message: "Erreur Airbnb",
      updated_at: new Date().toISOString(),
    }),
    {
      label: "Airbnb",
      message: "Erreur Airbnb",
      tone: "error",
      timeoutMs: 5200,
      role: "alert",
    }
  );
});

test("handleAirbnbCalendarRefreshFailure ignore AbortError et remonte les autres erreurs", () => {
  let collected = "";

  handleAirbnbCalendarRefreshFailure(new DOMException("Aborted", "AbortError"), (message) => {
    collected = message;
  });
  assert.equal(collected, "");

  handleAirbnbCalendarRefreshFailure(new Error("boom"), (message) => {
    collected = message;
  });
  assert.equal(collected, "boom");
});

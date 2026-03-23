import assert from "node:assert/strict";
import test from "node:test";
import {
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

  const result = await waitForAirbnbCalendarRefreshJob("job-1", {
    fetchStatus: async () => {
      const next = statuses.shift();
      assert.ok(next);
      return next;
    },
    sleep: async () => {
      sleepCount += 1;
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.message, "ok");
  assert.equal(sleepCount, 2);
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

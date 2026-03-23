import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeIcalUrl,
  getAirbnbCalendarRefreshJobStatus,
  isAirbnbAccountChooserScreenText,
  queueAirbnbCalendarRefresh,
  setAirbnbCalendarRefreshExecutorForTests,
} from "../src/services/airbnbCalendarRefresh.ts";

const waitFor = async (
  predicate: () => boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
) => {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 20;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Condition non satisfaite à temps.");
};

test("canonicalizeIcalUrl trie les query params et nettoie le path", () => {
  const left = canonicalizeIcalUrl("https://example.test/calendar.ics?b=2&a=1");
  const right = canonicalizeIcalUrl("https://example.test/calendar.ics/?a=1&b=2");

  assert.equal(left, "https://example.test/calendar.ics?a=1&b=2");
  assert.equal(left, right);
});

test("isAirbnbAccountChooserScreenText detecte l'ecran de selection de compte", () => {
  assert.equal(isAirbnbAccountChooserScreenText("Bienvenue Sebastien\nContinuer\nUtiliser un autre compte"), true);
  assert.equal(isAirbnbAccountChooserScreenText("Connexion standard Airbnb"), false);
});

test("queueAirbnbCalendarRefresh passe de queued a running puis success", async () => {
  let releaseJob!: () => void;
  const jobReleased = new Promise<void>((resolve) => {
    releaseJob = resolve;
  });

  setAirbnbCalendarRefreshExecutorForTests(async () => {
    await jobReleased;
    return { message: "ok" };
  });

  try {
    const queued = queueAirbnbCalendarRefresh({
      giteId: "gite-1",
      listingId: "48504640",
      icalUrl: "https://example.test/calendar.ics?token=abc",
    });

    assert.equal(queued.status, "queued");
    await waitFor(() => getAirbnbCalendarRefreshJobStatus(queued.job_id)?.status === "running");

    releaseJob();

    await waitFor(() => getAirbnbCalendarRefreshJobStatus(queued.job_id)?.status === "success");
    assert.equal(getAirbnbCalendarRefreshJobStatus(queued.job_id)?.message, "ok");
  } finally {
    setAirbnbCalendarRefreshExecutorForTests(null);
  }
});

test("queueAirbnbCalendarRefresh passe en failed quand l'execution echoue", async () => {
  setAirbnbCalendarRefreshExecutorForTests(async () => {
    throw new Error("boom");
  });

  try {
    const queued = queueAirbnbCalendarRefresh({
      giteId: "gite-1",
      listingId: "48504640",
      icalUrl: "https://example.test/calendar.ics?token=abc",
    });

    await waitFor(() => getAirbnbCalendarRefreshJobStatus(queued.job_id)?.status === "failed");

    const failed = getAirbnbCalendarRefreshJobStatus(queued.job_id);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.message, "boom");
    assert.equal(failed?.error_code, "unknown_error");
  } finally {
    setAirbnbCalendarRefreshExecutorForTests(null);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  getAirbnbCalendarRefreshJobStatus,
  isAirbnbAccountChooserScreenText,
  isAirbnbPersonalCalendarCardText,
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

test("isAirbnbPersonalCalendarCardText detecte la carte Perso", () => {
  assert.equal(isAirbnbPersonalCalendarCardText("Perso\nDerniere mise a jour"), true);
  assert.equal(isAirbnbPersonalCalendarCardText("Calendrier Airbnb"), false);
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

import assert from "node:assert/strict";
import test from "node:test";
import { computeIcalCronNextRunAt, isIcalCronDue, type PersistedIcalCronRunState } from "../src/services/icalCronRunState.ts";
import type { IcalCronConfig } from "../src/services/icalCronSettings.ts";

const config: IcalCronConfig = {
  enabled: true,
  interval_hours: 6,
  run_on_start: false,
};

const baseState: PersistedIcalCronRunState = {
  running: false,
  last_started_at: null,
  last_run_at: null,
  last_success_at: null,
  last_status: "idle",
  last_error: null,
};

test("le cron iCal externe est du immediatement sans execution precedente", () => {
  const now = new Date("2026-03-18T20:00:00.000Z");

  assert.equal(computeIcalCronNextRunAt(config, baseState, now), now.toISOString());
  assert.equal(isIcalCronDue(config, baseState, now), true);
});

test("le cron iCal externe respecte l'intervalle configure", () => {
  const state: PersistedIcalCronRunState = {
    ...baseState,
    last_run_at: "2026-03-18T14:00:00.000Z",
    last_success_at: "2026-03-18T14:00:00.000Z",
    last_status: "success",
  };

  assert.equal(computeIcalCronNextRunAt(config, state, new Date("2026-03-18T18:00:00.000Z")), "2026-03-18T20:00:00.000Z");
  assert.equal(isIcalCronDue(config, state, new Date("2026-03-18T19:59:59.000Z")), false);
  assert.equal(isIcalCronDue(config, state, new Date("2026-03-18T20:00:00.000Z")), true);
});

test("un cron desactive n'est jamais du", () => {
  const disabledConfig: IcalCronConfig = {
    ...config,
    enabled: false,
  };

  assert.equal(computeIcalCronNextRunAt(disabledConfig, baseState, new Date("2026-03-18T20:00:00.000Z")), null);
  assert.equal(isIcalCronDue(disabledConfig, baseState, new Date("2026-03-18T20:00:00.000Z")), false);
});

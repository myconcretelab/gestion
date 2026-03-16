import assert from "node:assert/strict";
import test from "node:test";
import { mergeIcalCronConfig, normalizeIcalCronConfig, type IcalCronConfig } from "../src/services/icalCronSettings.ts";

test("la config iCal legacy heure/minute est migree vers un intervalle de 24h", () => {
  const fallback: IcalCronConfig = {
    enabled: true,
    interval_hours: 6,
    run_on_start: false,
  };

  const config = normalizeIcalCronConfig(
    {
      enabled: false,
      hour: 6,
      minute: 0,
      run_on_start: true,
    },
    fallback
  );

  assert.deepEqual(config, {
    enabled: false,
    interval_hours: 24,
    run_on_start: true,
  });
});

test("mergeIcalCronConfig preserve l'intervalle courant si le patch ne le modifie pas", () => {
  const current: IcalCronConfig = {
    enabled: true,
    interval_hours: 6,
    run_on_start: false,
  };

  const config = mergeIcalCronConfig(current, {
    enabled: false,
    run_on_start: true,
  });

  assert.deepEqual(config, {
    enabled: false,
    interval_hours: 6,
    run_on_start: true,
  });
});

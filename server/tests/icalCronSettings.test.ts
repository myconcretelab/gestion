import assert from "node:assert/strict";
import test from "node:test";
import { mergeIcalCronConfig, normalizeIcalCronConfig, type IcalCronConfig } from "../src/services/icalCronSettings.ts";

test("la config iCal legacy est reduite au simple flag enabled", () => {
  const fallback: IcalCronConfig = {
    enabled: true,
    auto_sync_on_app_load: true,
  };

  const config = normalizeIcalCronConfig(
    {
      enabled: false,
      hour: 6,
      minute: 0,
      run_on_start: true,
      interval_hours: 6,
    },
    fallback
  );

  assert.deepEqual(config, {
    enabled: false,
    auto_sync_on_app_load: true,
  });
});

test("mergeIcalCronConfig conserve l'activation et l'auto-import", () => {
  const current: IcalCronConfig = {
    enabled: true,
    auto_sync_on_app_load: false,
  };

  const config = mergeIcalCronConfig(current, {
    enabled: false,
    auto_sync_on_app_load: true,
  });

  assert.deepEqual(config, {
    enabled: false,
    auto_sync_on_app_load: true,
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultSmartlifeAutomationConfig,
  mergeSmartlifeAutomationConfig,
  normalizeSmartlifeAutomationConfig,
} from "../src/services/smartlifeSettings.ts";

test("normalizeSmartlifeAutomationConfig conserve les anciennes regles on/off", () => {
  const config = normalizeSmartlifeAutomationConfig(
    {
      rules: [
        {
          id: "rule-1",
          label: "Ancienne règle",
          gite_ids: ["gite-1"],
          trigger: "before-arrival",
          offset_minutes: 60,
          device_id: "device-1",
          device_name: "Prise 1",
          command_code: "switch_1",
          command_label: "Interrupteur 1",
          command_value: false,
        },
      ],
    },
    buildDefaultSmartlifeAutomationConfig(),
  );

  assert.equal(config.rules.length, 1);
  assert.equal(config.rules[0]?.action, "device-off");
  assert.equal(config.rules[0]?.command_value, false);
  assert.equal(config.rules[0]?.command_code, "switch_1");
});

test("normalizeSmartlifeAutomationConfig migre les anciens compteurs et ignore les anciennes regles energie", () => {
  const config = normalizeSmartlifeAutomationConfig(
    {
      meter_assignments: [
        {
          id: "meter-assignment-1",
          enabled: true,
          gite_id: "gite-1",
          device_id: "meter-1",
          device_name: "Compteur principal",
        },
        {
          id: "meter-assignment-2",
          enabled: true,
          gite_id: "gite-1",
          device_id: "meter-2",
          device_name: "Sous-compteur",
        },
      ],
      rules: [
        {
          id: "rule-2",
          label: "Compteur séjour",
          gite_ids: ["gite-1"],
          trigger: "after-arrival",
          offset_minutes: 0,
          action: "energy-start",
          device_id: "meter-1",
          device_name: "Compteur 1",
          command_code: "switch_1",
          command_label: "Interrupteur 1",
          command_value: false,
        },
      ],
    },
    buildDefaultSmartlifeAutomationConfig(),
  );

  assert.equal(config.rules.length, 0);
  assert.deepEqual(config.energy_devices, [
    {
      id: "meter-assignment-1",
      enabled: true,
      gite_id: "gite-1",
      device_id: "meter-1",
      device_name: "Compteur principal",
      role: "primary",
    },
    {
      id: "meter-assignment-2",
      enabled: true,
      gite_id: "gite-1",
      device_id: "meter-2",
      device_name: "Sous-compteur",
      role: "informational",
    },
  ]);
});

test("mergeSmartlifeAutomationConfig permet de vider explicitement les identifiants", () => {
  const current = normalizeSmartlifeAutomationConfig(
    {
      enabled: true,
      region: "eu",
      access_id: "access-id",
      access_secret: "access-secret",
    },
    buildDefaultSmartlifeAutomationConfig(),
  );

  const merged = mergeSmartlifeAutomationConfig(current, {
    access_id: "",
    access_secret: "",
  });

  assert.equal(merged.access_id, "");
  assert.equal(merged.access_secret, "");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultSmartlifeAutomationConfig,
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

test("normalizeSmartlifeAutomationConfig nettoie les regles compteur", () => {
  const config = normalizeSmartlifeAutomationConfig(
    {
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

  assert.equal(config.rules.length, 1);
  assert.equal(config.rules[0]?.action, "energy-start");
  assert.equal(config.rules[0]?.command_value, true);
  assert.equal(config.rules[0]?.command_code, "");
  assert.equal(config.rules[0]?.command_label, null);
});

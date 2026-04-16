import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeSmartlifeAutomationRunItems,
  type SmartlifeAutomationRunItem,
} from "../src/services/smartlifeRunState.ts";

const buildRunItem = (
  overrides: Partial<SmartlifeAutomationRunItem>,
): SmartlifeAutomationRunItem => ({
  key: overrides.key ?? "event-1",
  reservation_id: overrides.reservation_id ?? "reservation-1",
  gite_id: overrides.gite_id ?? "gite-1",
  gite_nom: overrides.gite_nom ?? "Gite 1",
  reservation_label: overrides.reservation_label ?? "Client (16/04/2026 -> 17/04/2026)",
  rule_id: overrides.rule_id ?? "rule-1",
  rule_label: overrides.rule_label ?? "Tableau étage",
  device_id: overrides.device_id ?? "device-1",
  device_name: overrides.device_name ?? "Tableau étage",
  action: overrides.action ?? "device-off",
  command_code: overrides.command_code ?? "switch_1",
  command_value: overrides.command_value ?? false,
  trigger: overrides.trigger ?? "before-departure",
  scheduled_at: overrides.scheduled_at ?? "2026-04-16T10:00:00.000Z",
  executed_at: overrides.executed_at ?? null,
  previous_executed_at: overrides.previous_executed_at ?? null,
  status: overrides.status ?? "skipped",
  message: overrides.message ?? null,
});

test("mergeSmartlifeAutomationRunItems conserve une execution face a un doublon skipped", () => {
  const previous = [
    buildRunItem({
      key: "event-1",
      status: "executed",
      executed_at: "2026-04-16T10:00:57.570Z",
      message: "Commande envoyée.",
    }),
  ];

  const current = [
    buildRunItem({
      key: "event-1",
      status: "skipped",
      previous_executed_at: "2026-04-16T10:00:57.570Z",
      message: "Commande déjà exécutée pour ce créneau.",
    }),
  ];

  const merged = mergeSmartlifeAutomationRunItems(previous, current, 10);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.status, "executed");
  assert.equal(merged[0]?.message, "Commande envoyée.");
  assert.equal(merged[0]?.executed_at, "2026-04-16T10:00:57.570Z");
});

test("mergeSmartlifeAutomationRunItems remplace un skipped par une vraie execution", () => {
  const previous = [
    buildRunItem({
      key: "event-1",
      status: "skipped",
      previous_executed_at: "2026-04-16T10:00:57.570Z",
      message: "Commande déjà exécutée pour ce créneau.",
    }),
  ];

  const current = [
    buildRunItem({
      key: "event-1",
      status: "executed",
      executed_at: "2026-04-16T10:05:00.000Z",
      message: "Commande envoyée après relance.",
    }),
  ];

  const merged = mergeSmartlifeAutomationRunItems(previous, current, 10);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.status, "executed");
  assert.equal(merged[0]?.message, "Commande envoyée après relance.");
  assert.equal(merged[0]?.executed_at, "2026-04-16T10:05:00.000Z");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReservationEnergyTracking,
  summarizeReservationEnergyTracking,
} from "../src/services/smartlifeEnergyTracking.ts";

test("parseReservationEnergyTracking ignore les entrees invalides", () => {
  const entries = parseReservationEnergyTracking([
    null,
    { session_id: "", device_id: "dev-1" },
    { session_id: "session-1", device_id: "dev-1", status: "open" },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.session_id, "session-1");
  assert.equal(entries[0]?.device_id, "dev-1");
  assert.equal(entries[0]?.status, "open");
});

test("summarizeReservationEnergyTracking additionne uniquement les sessions cloturees", () => {
  const summary = summarizeReservationEnergyTracking(
    parseReservationEnergyTracking([
      {
        session_id: "open-1",
        device_id: "meter-1",
        device_name: "Meter 1",
        status: "open",
        started_at: "2026-04-05T10:00:00.000Z",
        ended_at: null,
        started_total_kwh: 12.34,
        allocation_ratio: 1,
      },
      {
        session_id: "closed-1",
        device_id: "meter-1",
        device_name: "Meter 1",
        status: "closed",
        started_at: "2026-04-05T10:00:00.000Z",
        ended_at: "2026-04-05T12:00:00.000Z",
        started_total_kwh: 12.34,
        ended_total_kwh: 15.84,
        total_kwh: 3.5,
        total_cost_eur: 0.91,
        stay_total_kwh: 3.5,
        stay_total_cost_eur: 0.91,
        allocation_ratio: 1,
      },
      {
        session_id: "closed-2",
        device_id: "meter-2",
        device_name: "Meter 2",
        status: "closed",
        started_at: "2026-04-06T10:00:00.000Z",
        ended_at: "2026-04-06T11:00:00.000Z",
        started_total_kwh: 4,
        ended_total_kwh: 5.25,
        total_kwh: 1.25,
        total_cost_eur: 0.33,
        stay_total_kwh: 1.25,
        stay_total_cost_eur: 0.33,
        allocation_ratio: 1,
      },
    ]),
  );

  assert.equal(summary.energy_consumption_kwh, 4.75);
  assert.equal(summary.energy_cost_eur, 1.24);
  assert.equal(summary.energy_price_per_kwh, 0.264);
});

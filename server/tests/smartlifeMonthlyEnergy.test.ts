import assert from "node:assert/strict";
import test from "node:test";
import { summarizeGiteMonthlyEnergyRows } from "../src/services/smartlifeMonthlyEnergy.ts";

test("summarizeGiteMonthlyEnergyRows cumule les compteurs complets d'un gite sur un mois", () => {
  const summaries = summarizeGiteMonthlyEnergyRows([
    {
      id: "row-1",
      gite_id: "gite-1",
      year: 2026,
      month: 3,
      device_id: "device-1",
      device_name: "Compteur salon",
      opening_total_kwh: 100,
      opening_recorded_at: new Date("2026-03-01T00:01:00.000Z"),
      closing_total_kwh: 108.25,
      closing_recorded_at: new Date("2026-04-01T00:01:00.000Z"),
      gite: {
        id: "gite-1",
        electricity_price_per_kwh: 0.25,
      },
    },
    {
      id: "row-2",
      gite_id: "gite-1",
      year: 2026,
      month: 3,
      device_id: "device-2",
      device_name: "Compteur spa",
      opening_total_kwh: 50,
      opening_recorded_at: new Date("2026-03-01T00:01:00.000Z"),
      closing_total_kwh: 50.5,
      closing_recorded_at: new Date("2026-04-01T00:01:00.000Z"),
      gite: {
        id: "gite-1",
        electricity_price_per_kwh: 0.25,
      },
    },
  ]);

  assert.deepEqual(summaries, [
    {
      gite_id: "gite-1",
      year: 2026,
      month: 3,
      total_kwh: 8.75,
      total_cost_eur: 2.19,
      device_count: 2,
    },
  ]);
});

test("summarizeGiteMonthlyEnergyRows ignore les mois incomplets ou invalides", () => {
  const summaries = summarizeGiteMonthlyEnergyRows([
    {
      id: "row-1",
      gite_id: "gite-1",
      year: 2026,
      month: 4,
      device_id: "device-1",
      device_name: "Compteur",
      opening_total_kwh: 40,
      opening_recorded_at: new Date("2026-04-01T00:01:00.000Z"),
      closing_total_kwh: null,
      closing_recorded_at: null,
      gite: {
        id: "gite-1",
        electricity_price_per_kwh: 0.24,
      },
    },
    {
      id: "row-2",
      gite_id: "gite-2",
      year: 2026,
      month: 4,
      device_id: "device-1",
      device_name: "Compteur",
      opening_total_kwh: 60,
      opening_recorded_at: new Date("2026-04-01T00:01:00.000Z"),
      closing_total_kwh: 55,
      closing_recorded_at: new Date("2026-05-01T00:01:00.000Z"),
      gite: {
        id: "gite-2",
        electricity_price_per_kwh: 0.24,
      },
    },
  ]);

  assert.deepEqual(summaries, []);
});

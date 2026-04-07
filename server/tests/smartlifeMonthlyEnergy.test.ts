import assert from "node:assert/strict";
import test from "node:test";
import {
  hydrateLiveGiteMonthlyEnergySummaries,
  summarizeGiteMonthlyEnergyRows,
} from "../src/services/smartlifeMonthlyEnergy.ts";

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
      status: "complete",
      total_kwh: 8.75,
      total_cost_eur: 2.19,
      live_total_kwh: null,
      live_total_cost_eur: null,
      live_recorded_at: null,
      live_device_count: 0,
      device_count: 2,
      complete_device_count: 2,
      missing_opening_count: 0,
      missing_closing_count: 0,
      invalid_device_count: 0,
      is_partial_month: false,
    },
  ]);
});

test("summarizeGiteMonthlyEnergyRows expose les mois incomplets ou invalides", () => {
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

  assert.deepEqual(summaries, [
    {
      gite_id: "gite-1",
      year: 2026,
      month: 4,
      status: "incomplete",
      total_kwh: null,
      total_cost_eur: null,
      live_total_kwh: null,
      live_total_cost_eur: null,
      live_recorded_at: null,
      live_device_count: 0,
      device_count: 1,
      complete_device_count: 0,
      missing_opening_count: 0,
      missing_closing_count: 1,
      invalid_device_count: 0,
      is_partial_month: false,
    },
    {
      gite_id: "gite-2",
      year: 2026,
      month: 4,
      status: "incomplete",
      total_kwh: null,
      total_cost_eur: null,
      live_total_kwh: null,
      live_total_cost_eur: null,
      live_recorded_at: null,
      live_device_count: 0,
      device_count: 1,
      complete_device_count: 0,
      missing_opening_count: 0,
      missing_closing_count: 0,
      invalid_device_count: 1,
      is_partial_month: false,
    },
  ]);
});

test("summarizeGiteMonthlyEnergyRows marque un mois partiel quand le relevé de départ est lancé après le 1er", () => {
  const summaries = summarizeGiteMonthlyEnergyRows([
    {
      id: "row-1",
      gite_id: "gite-1",
      year: 2026,
      month: 4,
      device_id: "device-1",
      device_name: "Compteur",
      opening_total_kwh: 140,
      opening_recorded_at: new Date("2026-04-07T10:00:00.000Z"),
      closing_total_kwh: 149.5,
      closing_recorded_at: new Date("2026-05-01T00:01:00.000Z"),
      gite: {
        id: "gite-1",
        electricity_price_per_kwh: 0.24,
      },
    },
  ]);

  assert.deepEqual(summaries, [
    {
      gite_id: "gite-1",
      year: 2026,
      month: 4,
      status: "complete",
      total_kwh: 9.5,
      total_cost_eur: 2.28,
      live_total_kwh: null,
      live_total_cost_eur: null,
      live_recorded_at: null,
      live_device_count: 0,
      device_count: 1,
      complete_device_count: 1,
      missing_opening_count: 0,
      missing_closing_count: 0,
      invalid_device_count: 0,
      is_partial_month: true,
    },
  ]);
});

test("hydrateLiveGiteMonthlyEnergySummaries calcule un montant live pour le mois courant incomplet", async () => {
  const rows = [
    {
      id: "row-1",
      gite_id: "gite-1",
      year: 2026,
      month: 4,
      device_id: "device-1",
      device_name: "Compteur",
      opening_total_kwh: 140,
      opening_recorded_at: new Date("2026-04-07T10:00:00.000Z"),
      closing_total_kwh: null,
      closing_recorded_at: null,
      gite: {
        id: "gite-1",
        electricity_price_per_kwh: 0.24,
      },
    },
  ];
  const summaries = summarizeGiteMonthlyEnergyRows(rows);

  const hydrated = await hydrateLiveGiteMonthlyEnergySummaries({
    summaries,
    rows,
    config: {
      enabled: true,
      region: "eu",
      access_id: "id",
      access_secret: "secret",
      rules: [],
      meter_assignments: [
        {
          id: "assign-1",
          enabled: true,
          gite_id: "gite-1",
          device_id: "device-1",
          device_name: "Compteur",
        },
      ],
    },
    now: new Date("2026-04-20T11:00:00.000Z"),
    loadDeviceTotalKwh: async () => 146.5,
  });

  assert.deepEqual(hydrated, [
    {
      gite_id: "gite-1",
      year: 2026,
      month: 4,
      status: "incomplete",
      total_kwh: null,
      total_cost_eur: null,
      live_total_kwh: 6.5,
      live_total_cost_eur: 1.56,
      live_recorded_at: "2026-04-20T11:00:00.000Z",
      live_device_count: 1,
      device_count: 1,
      complete_device_count: 0,
      missing_opening_count: 0,
      missing_closing_count: 1,
      invalid_device_count: 0,
      is_partial_month: true,
    },
  ]);
});

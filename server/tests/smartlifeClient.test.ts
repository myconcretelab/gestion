import assert from "node:assert/strict";
import test from "node:test";
import { buildEnergyTotalInfo } from "../src/services/smartlifeClient.ts";

test("buildEnergyTotalInfo detecte total_ele en priorite", () => {
  const info = buildEnergyTotalInfo(
    [
      {
        code: "total_ele",
        name: "Total energy",
        desc: "",
        type: "value",
        values: "",
        is_primary_switch: false,
        unit: "kWh",
        scale: 2,
      },
      {
        code: "add_ele",
        name: "Added energy",
        desc: "",
        type: "value",
        values: "",
        is_primary_switch: false,
        unit: "kWh",
        scale: 3,
      },
    ],
    [
      { code: "add_ele", value: 12345 },
      { code: "total_ele", value: 6789 },
    ],
  );

  assert.equal(info.supports_energy_total, true);
  assert.equal(info.energy_total_source_code, "total_ele");
  assert.equal(info.energy_total_scale, 2);
  assert.equal(info.energy_total_kwh, 67.89);
  assert.equal(info.supports_total_ele, true);
  assert.equal(info.total_ele_kwh, 67.89);
});

test("buildEnergyTotalInfo utilise add_ele quand total_ele est absent", () => {
  const info = buildEnergyTotalInfo(
    [
      {
        code: "add_ele",
        name: "Added energy",
        desc: "",
        type: "value",
        values: "",
        is_primary_switch: false,
        unit: "kWh",
        scale: 3,
      },
    ],
    [{ code: "add_ele", value: 12345 }],
  );

  assert.equal(info.supports_energy_total, true);
  assert.equal(info.energy_total_source_code, "add_ele");
  assert.equal(info.energy_total_scale, 3);
  assert.equal(info.energy_total_kwh, 12.345);
  assert.equal(info.total_ele_kwh, 12.345);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultPumpAutomationConfig,
  normalizePumpAutomationConfig,
} from "../src/services/pumpAutomationConfig.ts";

test("buildDefaultPumpAutomationConfig initialise la source Pump par defaut", () => {
  const config = buildDefaultPumpAutomationConfig();

  assert.equal(config.sourceType, "airbnb");
  assert.equal(config.baseUrl.includes("airbnb"), true);
});

test("normalizePumpAutomationConfig migre les anciennes configs sans sourceType", () => {
  const config = normalizePumpAutomationConfig({
    baseUrl: "https://www.airbnb.fr/hosting/multicalendar",
    username: "contact@example.com",
    scrollSelector: ".calendar-grid",
  });

  assert.equal(config.sourceType, "airbnb");
  assert.equal(config.username, "contact@example.com");
  assert.equal(config.scrollSelector, ".calendar-grid");
});

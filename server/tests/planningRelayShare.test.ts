import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlanningRelayShortCode,
  buildPlanningRelayToken,
  hashPlanningRelayShortCode,
  isPlanningRelayShortCode,
  verifyPlanningRelayToken,
} from "../src/services/planningRelayShare.ts";

test("génère un code public déterministe de huit caractères", () => {
  const code = buildPlanningRelayShortCode("nonce-test-1");
  assert.equal(code.length, 8);
  assert.equal(isPlanningRelayShortCode(code), true);
  assert.equal(buildPlanningRelayShortCode("nonce-test-1"), code);
  assert.notEqual(buildPlanningRelayShortCode("nonce-test-2"), code);
  assert.equal(hashPlanningRelayShortCode(code).length, 64);
});

test("conserve la validation des anciens jetons longs", () => {
  const token = buildPlanningRelayToken("period-1", "nonce-test");
  assert.equal(verifyPlanningRelayToken(token, "nonce-test"), true);
  assert.equal(verifyPlanningRelayToken(token, "autre-nonce"), false);
});

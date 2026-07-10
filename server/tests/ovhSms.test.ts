import assert from "node:assert/strict";
import test from "node:test";
import { buildOvhSignature, normalizeSmsRecipient } from "../src/services/ovhSms.ts";

test("normalise les numeros SMS francais pour OVH", () => {
  assert.equal(normalizeSmsRecipient("06 12 34 56 78"), "0033612345678");
  assert.equal(normalizeSmsRecipient("+33 6 12 34 56 78"), "0033612345678");
  assert.equal(normalizeSmsRecipient("33612345678"), "0033612345678");
});

test("signe les requetes OVH avec la chaine attendue", () => {
  const signature = buildOvhSignature({
    appSecret: "secret",
    consumerKey: "consumer",
    method: "POST",
    url: "https://eu.api.ovh.com/1.0/sms/sms-test/jobs",
    body: "{\"message\":\"test\"}",
    timestamp: 1234567890,
  });

  assert.match(signature, /^\$1\$[a-f0-9]{40}$/);
  assert.equal(
    signature,
    buildOvhSignature({
      appSecret: "secret",
      consumerKey: "consumer",
      method: "POST",
      url: "https://eu.api.ovh.com/1.0/sms/sms-test/jobs",
      body: "{\"message\":\"test\"}",
      timestamp: 1234567890,
    }),
  );
});

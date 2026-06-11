import assert from "node:assert/strict";
import test from "node:test";
import { __bookedWordPressWebhookTestUtils } from "../src/services/bookedWordPressWebhook.ts";

const { getUnexpectedWordPressResponseError, isExpectedWordPressPhotoSyncResponse } =
  __bookedWordPressWebhookTestUtils;

test("WordPress photo webhook rejects an HTML success page", () => {
  const html = "<!doctype html><html><body>Accueil WordPress</body></html>";

  assert.equal(isExpectedWordPressPhotoSyncResponse(html), false);
  assert.match(getUnexpectedWordPressResponseError(html), /page HTML/);
});

test("WordPress photo webhook accepts the Booked sync JSON response", () => {
  assert.equal(
    isExpectedWordPressPhotoSyncResponse({
      ok: true,
      queued: false,
      result: {
        created: 1,
        updated: 0,
        replaced: 0,
        orphaned: 0,
        failed: 0,
      },
    }),
    true
  );
});

test("WordPress photo webhook accepts the queued JSON response", () => {
  assert.equal(isExpectedWordPressPhotoSyncResponse({ ok: true, queued: true }), true);
});

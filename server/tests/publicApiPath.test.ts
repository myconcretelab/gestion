import assert from "node:assert/strict";
import test from "node:test";
import { isPublicApiPath } from "../src/utils/publicApiPath.ts";

test("isPublicApiPath n'autorise que les endpoints PDF publics", () => {
  assert.equal(isPublicApiPath("/contracts/abc123/pdf"), true);
  assert.equal(isPublicApiPath("/invoices/xyz789/pdf"), true);
  assert.equal(isPublicApiPath("/contracts/abc123"), false);
  assert.equal(isPublicApiPath("/contracts/abc123/pdf/extra"), false);
  assert.equal(isPublicApiPath("/invoices"), false);
  assert.equal(isPublicApiPath("/settings/security"), false);
});

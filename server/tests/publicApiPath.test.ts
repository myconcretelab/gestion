import assert from "node:assert/strict";
import test from "node:test";
import { isPublicApiPath } from "../src/utils/publicApiPath.ts";

test("isPublicApiPath autorise les endpoints publics attendus", () => {
  assert.equal(isPublicApiPath("/contracts/abc123/pdf"), true);
  assert.equal(isPublicApiPath("/invoices/xyz789/pdf"), true);
  assert.equal(isPublicApiPath("/public/gites"), true);
  assert.equal(isPublicApiPath("/public/gites/gite-le-liberte"), true);
  assert.equal(isPublicApiPath("/contracts/abc123"), false);
  assert.equal(isPublicApiPath("/contracts/abc123/pdf/extra"), false);
  assert.equal(isPublicApiPath("/invoices"), false);
  assert.equal(isPublicApiPath("/settings/security"), false);
});

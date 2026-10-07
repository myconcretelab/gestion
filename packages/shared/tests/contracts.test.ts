import assert from "node:assert/strict";
import test from "node:test";
import {
  apiErrorSchema,
  businessPermissionSchema,
  moduleIdSchema,
  organizationIdSchema,
} from "../src/index.js";

test("shared API contracts reject invalid organization and permission values", () => {
  assert.equal(organizationIdSchema.safeParse("org_example").success, true);
  assert.equal(organizationIdSchema.safeParse("default").success, false);
  assert.equal(moduleIdSchema.safeParse("reservations").success, true);
  assert.equal(
    businessPermissionSchema.safeParse("reservations:write").success,
    true,
  );
  assert.equal(
    apiErrorSchema.safeParse({ error: "Introuvable", code: "NOT_FOUND" })
      .success,
    true,
  );
});

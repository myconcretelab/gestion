import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import { getTenantPrisma, systemPrisma } from "../src/db/prisma.js";
import { enqueueOrganizationJob, listRunnableOrganizationJobs } from "../src/modules/system/jobs.js";

const suffix = crypto.randomBytes(6).toString("hex");
const orgA = `org_test_a_${suffix}`;
const orgB = `org_test_b_${suffix}`;
const userId = `user_test_${suffix}`;
const categoryA = `category_a_${suffix}`;
const categoryB = `category_b_${suffix}`;
const shareA = `share_a_${suffix}`;
const tokenA = `token_a_${suffix}`;

test("tenant data is isolated while a global user can have different membership states", async () => {
  await systemPrisma.organization.createMany({ data: [
    { id: orgA, slug: `test-a-${suffix}`, name: "Organisation similaire" },
    { id: orgB, slug: `test-b-${suffix}`, name: "Organisation similaire" },
  ] });
  await systemPrisma.user.create({ data: { id: userId, login_id: `test-${suffix}@example.invalid` } });
  await systemPrisma.membership.createMany({ data: [
    { id: `membership_a_${suffix}`, user_id: userId, organization_id: orgA, role: "owner", status: "disabled" },
    { id: `membership_b_${suffix}`, user_id: userId, organization_id: orgB, role: "owner", status: "active" },
  ] });
  await systemPrisma.appUser.createMany({ data: [
    { id: `profile_a_${suffix}`, user_id: userId, organization_id: orgA, display_name: "Même personne", first_name: "Même", last_name: "Personne", is_active: false },
    { id: `profile_b_${suffix}`, user_id: userId, organization_id: orgB, display_name: "Même personne", first_name: "Même", last_name: "Personne", is_active: true },
  ] });

  await systemPrisma.expenseCategory.createMany({ data: [
    { id: categoryA, organization_id: orgA, name: "Même catégorie", color: "#000000", scope: "both" },
    { id: categoryB, organization_id: orgB, name: "Même catégorie", color: "#ffffff", scope: "both" },
  ] });
  const tenantA = getTenantPrisma(orgA);
  const tenantB = getTenantPrisma(orgB);

  const visibleA = await tenantA.expenseCategory.findMany({ where: { name: "Même catégorie" } });
  const visibleB = await tenantB.expenseCategory.findMany({ where: { name: "Même catégorie" } });
  assert.deepEqual(visibleA.map((row) => row.id), [categoryA]);
  assert.deepEqual(visibleB.map((row) => row.id), [categoryB]);

  assert.equal(await tenantB.expenseCategory.findUnique({ where: { id: categoryA } }), null);
  await assert.rejects(
    () => tenantB.expenseCategory.update({ where: { id: categoryA }, data: { color: "#123456" } }),
    (error: { code?: string }) => error.code === "P2025",
  );
  await assert.rejects(
    () => tenantB.expenseCategory.delete({ where: { id: categoryA } }),
    (error: { code?: string }) => error.code === "P2025",
  );

  await tenantA.$transaction(async (tx) => {
    await tx.documentShare.create({ data: {
      id: shareA, token_hash: `share_hash_${suffix}`, document_type: "contract", document_id: `document_${suffix}`,
      expires_at: new Date(Date.now() + 60_000),
    } });
    await tx.apiToken.create({ data: { id: tokenA, name: "Test", token_hash: `api_hash_${suffix}` } });
  });
  assert.equal(await tenantB.documentShare.findUnique({ where: { id: shareA } }), null);
  assert.equal(await tenantB.apiToken.findUnique({ where: { id: tokenA } }), null);

  const memberships = await systemPrisma.membership.findMany({ where: { user_id: userId }, orderBy: { organization_id: "asc" } });
  assert.deepEqual(memberships.map((membership) => membership.status), ["disabled", "active"]);

  await enqueueOrganizationJob({ organizationId: orgA, type: "sync", idempotencyKey: "same-key", payload: { tenant: "a" } });
  await enqueueOrganizationJob({ organizationId: orgB, type: "sync", idempotencyKey: "same-key", payload: { tenant: "b" } });
  const jobsA = await listRunnableOrganizationJobs(orgA);
  const jobsB = await listRunnableOrganizationJobs(orgB);
  assert.equal(jobsA.length, 1);
  assert.equal(jobsB.length, 1);
  assert.equal(JSON.parse(jobsA[0].payload_json).tenant, "a");
  assert.equal(JSON.parse(jobsB[0].payload_json).tenant, "b");
});

after(async () => {
  await systemPrisma.documentShare.deleteMany({ where: { id: shareA } });
  await systemPrisma.apiToken.deleteMany({ where: { id: tokenA } });
  await systemPrisma.expenseCategory.deleteMany({ where: { id: { in: [categoryA, categoryB] } } });
  await systemPrisma.appUser.deleteMany({ where: { user_id: userId } });
  await systemPrisma.membership.deleteMany({ where: { user_id: userId } });
  await systemPrisma.user.deleteMany({ where: { id: userId } });
  await systemPrisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

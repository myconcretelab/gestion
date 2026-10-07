import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";
import { getTenantPrisma, systemPrisma } from "../src/db/prisma.js";
import { normalizeModules } from "../src/services/installationConfig.js";
import { HISTORICAL_ORGANIZATION_ID } from "../src/modules/organizations/context.js";
import { computeEffectiveFeature, subscriptionCapabilities } from "../src/modules/billing/policies.js";
import { assertCreationQuota, assertSubscriptionWriteAllowed, consumeMeteredUsage, getSubscriptionSnapshot, processVerifiedBillingEvent, usagePeriodKey } from "../src/modules/billing/service.js";
import { isPlatformAdministrator } from "../src/modules/billing/admin.js";

const suffix = crypto.randomBytes(6).toString("hex");
const orgA = `org_billing_a_${suffix}`;
const orgB = `org_billing_b_${suffix}`;
const planLow = `plan_low_${suffix}`;
const planHigh = `plan_high_${suffix}`;
const userId = `billing_user_${suffix}`;

test("legacy_unlimited préserve exactement les modules historiques", async () => {
  const settings = await systemPrisma.organizationSettings.findUniqueOrThrow({ where: { organization_id: HISTORICAL_ORGANIZATION_ID } });
  const before = normalizeModules(settings.modules_json);
  const snapshot = await getSubscriptionSnapshot(HISTORICAL_ORGANIZATION_ID);
  assert.equal(snapshot.plan?.code, "legacy_unlimited");
  assert.equal(snapshot.subscription?.providerConfigured, false);
  for (const [key, enabled] of Object.entries(before)) assert.equal(snapshot.features[key as keyof typeof snapshot.features].effective, enabled, key);
});

test("les statuts conservent lecture/export et limitent seulement les écritures prévues", () => {
  for (const status of ["trialing", "active", "past_due", "grace_period"] as const) assert.equal(subscriptionCapabilities[status].write, true);
  for (const status of ["suspended", "cancelled"] as const) {
    assert.equal(subscriptionCapabilities[status].read, true);
    assert.equal(subscriptionCapabilities[status].export, true);
    assert.equal(subscriptionCapabilities[status].write, false);
  }
});

test("droits, déclassement, dérogation expirée, isolation et quotas concurrents", async () => {
  await systemPrisma.organization.createMany({ data: [{ id: orgA, slug: `billing-a-${suffix}`, name: "Billing A" }, { id: orgB, slug: `billing-b-${suffix}`, name: "Billing B" }] });
  await systemPrisma.organizationSettings.createMany({ data: [
    { organization_id: orgA, modules_json: JSON.stringify({ reservations: true, contracts: false }) },
    { organization_id: orgB, modules_json: JSON.stringify({ reservations: true, contracts: true }) },
  ] });
  await systemPrisma.plan.createMany({ data: [
    { id: planLow, code: `low_${suffix}`, name: "Low" }, { id: planHigh, code: `high_${suffix}`, name: "High" },
  ] });
  await systemPrisma.planEntitlement.createMany({ data: [
    { plan_id: planLow, feature_key: "module.reservations", value_boolean: false },
    { plan_id: planLow, feature_key: "module.contracts", value_boolean: true },
    { plan_id: planLow, feature_key: "reservations_created", limit_value: 1, limit_type: "hard" },
    { plan_id: planLow, feature_key: "sms_sent", limit_value: 1, limit_type: "hard" },
    { plan_id: planHigh, feature_key: "module.reservations", value_boolean: true },
  ] });
  await systemPrisma.subscription.createMany({ data: [
    { id: `sub_a_${suffix}`, organization_id: orgA, plan_id: planLow, status: "trialing", provider: "fake", provider_subscription_id: `provider_${suffix}` },
    { id: `sub_b_${suffix}`, organization_id: orgB, plan_id: planHigh, status: "active" },
  ] });
  await systemPrisma.expenseCategory.create({ data: { id: `category_${suffix}`, organization_id: orgA, name: "Préservée", color: "#000000", scope: "both" } });

  for (const status of ["trialing", "active", "past_due", "grace_period"] as const) {
    await systemPrisma.subscription.update({ where: { organization_id: orgA }, data: { status } });
    await assertSubscriptionWriteAllowed(orgA);
  }
  for (const status of ["suspended", "cancelled"] as const) {
    await systemPrisma.subscription.update({ where: { organization_id: orgA }, data: { status } });
    await assert.rejects(() => assertSubscriptionWriteAllowed(orgA), (error: { code?: string }) => error.code === "SUBSCRIPTION_READ_ONLY");
  }
  await systemPrisma.subscription.update({ where: { organization_id: orgA }, data: { status: "trialing" } });

  let snapshot = await getSubscriptionSnapshot(orgA);
  assert.equal(snapshot.features.reservations.effective, false, "module local actif mais interdit par le forfait");
  assert.equal(snapshot.features.contracts.effective, false, "module autorisé mais désactivé localement");
  await systemPrisma.organizationEntitlementOverride.create({ data: { organization_id: orgA, feature_key: "module.reservations", value_boolean: true, reason: "Support temporaire", author_user_id: "platform-test", expires_at: new Date(Date.now() + 60_000) } });
  snapshot = await getSubscriptionSnapshot(orgA);
  assert.equal(snapshot.features.reservations.effective, true);
  await systemPrisma.organizationEntitlementOverride.create({ data: { organization_id: orgA, feature_key: "module.reservations", value_boolean: false, reason: "Ancienne dérogation", author_user_id: "platform-test", expires_at: new Date(Date.now() - 60_000) } });
  assert.equal((await getSubscriptionSnapshot(orgA)).features.reservations.effective, true, "la dérogation expirée est ignorée");

  await systemPrisma.subscription.update({ where: { organization_id: orgA }, data: { plan_id: planHigh } });
  await systemPrisma.usageCounter.create({ data: { organization_id: orgA, metric_key: "sms_sent", period_key: usagePeriodKey(), value: 2, source: "metered" } });
  await systemPrisma.subscription.update({ where: { organization_id: orgA }, data: { plan_id: planLow } });
  assert.equal(await systemPrisma.expenseCategory.count({ where: { id: `category_${suffix}` } }), 1, "aucune donnée métier ne varie lors des changements de forfait");
  assert.equal((await getSubscriptionSnapshot(orgA)).limits.find((item) => item.metricKey === "sms_sent")?.exceeded, true);
  await assert.rejects(() => assertCreationQuota(orgA, "sms_sent"), (error: { code?: string }) => error.code === "QUOTA_EXCEEDED");
  await assert.rejects(() => getTenantPrisma(orgA).subscription.update({ where: { id: `sub_b_${suffix}` }, data: { status: "suspended" } }), (error: { code?: string }) => error.code === "P2025");
  assert.equal((await systemPrisma.subscription.findUniqueOrThrow({ where: { organization_id: orgB } })).status, "active");

  await consumeMeteredUsage(orgA, "reservations_created", "test-period", 0, 1);
  const concurrent = await Promise.allSettled([
    consumeMeteredUsage(orgA, "reservations_created", "test-period", 1, 1),
    consumeMeteredUsage(orgA, "reservations_created", "test-period", 1, 1),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
});

test("webhooks idempotents, hors ordre et inconnus", async () => {
  const base = { providerSubscriptionId: `provider_${suffix}`, occurredAt: new Date(), idempotencyKey: `idem_${suffix}`, providerEventId: `event_${suffix}`, type: "subscription.active", version: 2 };
  assert.equal((await processVerifiedBillingEvent("fake", base)).duplicate, false);
  assert.equal((await processVerifiedBillingEvent("fake", base)).duplicate, true);
  const old = await processVerifiedBillingEvent("fake", { ...base, providerEventId: `old_${suffix}`, idempotencyKey: `old_idem_${suffix}`, type: "subscription.suspended", version: 1, occurredAt: new Date(base.occurredAt.getTime() - 1000) });
  assert.equal(old.event.result, "ignored_out_of_order");
  const unknown = await processVerifiedBillingEvent("fake", { ...base, providerEventId: `unknown_${suffix}`, idempotencyKey: `unknown_idem_${suffix}`, type: "something.unknown", version: 3, occurredAt: new Date(base.occurredAt.getTime() + 1000) });
  assert.equal(unknown.event.result, "ignored_unknown");
});

test("un propriétaire d’organisation n’est pas administrateur de plateforme", async () => {
  await systemPrisma.user.create({ data: { id: userId, login_id: `billing-${suffix}@example.invalid` } });
  await systemPrisma.membership.create({ data: { user_id: userId, organization_id: orgA, role: "owner", status: "active" } });
  assert.equal(await isPlatformAdministrator(userId), false);
});

test("la formule de droit applique explicitement les dérogations", () => {
  assert.equal(computeEffectiveFeature({ planAllows: false, organizationEnabled: true, subscriptionAllows: true, override: true }), true);
  assert.equal(computeEffectiveFeature({ planAllows: true, organizationEnabled: true, subscriptionAllows: true, override: false }), false);
});

after(async () => {
  await systemPrisma.billingEvent.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.usageCounter.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.organizationEntitlementOverride.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.expenseCategory.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.membership.deleteMany({ where: { user_id: userId } });
  await systemPrisma.user.deleteMany({ where: { id: userId } });
  await systemPrisma.subscription.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.planEntitlement.deleteMany({ where: { plan_id: { in: [planLow, planHigh] } } });
  await systemPrisma.plan.deleteMany({ where: { id: { in: [planLow, planHigh] } } });
  await systemPrisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

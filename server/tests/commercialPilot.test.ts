import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";
import Stripe from "stripe";
import { systemPrisma } from "../src/db/prisma.js";
import { createOrganizationCheckout, createOrganizationPortal, processVerifiedBillingEvent, recordUsageEvent } from "../src/modules/billing/service.js";
import { StripeBillingProvider } from "../src/modules/billing/stripe.js";
import type { BillingProvider, CreateCheckoutInput, VerifiedBillingEvent } from "../src/modules/billing/provider.js";
import { claimNextOrganizationJob, enqueueOrganizationJob, runOrganizationJobBatch } from "../src/modules/system/jobs.js";
import { runTenantTaskAcrossOrganizations } from "../src/modules/system/tenantTasks.js";
import { assertBillingOwner } from "../src/modules/billing/routes.js";
import { changePlatformAdministrator, isPlatformAdministrator } from "../src/modules/billing/admin.js";
import { StripeCatalogSynchronizer } from "../src/modules/billing/stripeCatalog.js";

const suffix = crypto.randomBytes(6).toString("hex");
const orgA = `org_commercial_a_${suffix}`;
const orgB = `org_commercial_b_${suffix}`;
const planId = `plan_commercial_${suffix}`;
const userA = `user_commercial_a_${suffix}`;
const userB = `user_commercial_b_${suffix}`;
const catalogPlanId = `plan_catalog_${suffix}`;

class FakeStripeCatalog {
  productCreates = 0;
  priceCreates = 0;
  productsStore = new Map<string, Stripe.Product>();
  pricesStore = new Map<string, Stripe.Price>();
  products: Stripe["products"];
  prices: Stripe["prices"];

  constructor() {
    this.products = {
      create: (async (params: Stripe.ProductCreateParams) => {
        this.productCreates += 1;
        const product = { id: `prod_catalog_${this.productCreates}`, object: "product", active: params.active ?? true, livemode: false, name: params.name, description: params.description ?? null, metadata: params.metadata ?? {} } as Stripe.Product;
        this.productsStore.set(product.id, product);
        return product;
      }) as never,
      retrieve: (async (id: string) => {
        const product = this.productsStore.get(id);
        if (!product) throw Object.assign(new Error("missing"), { statusCode: 404 });
        return product;
      }) as never,
      update: (async (id: string, params: Stripe.ProductUpdateParams) => {
        const current = this.productsStore.get(id)!;
        const product = { ...current, ...params, id, livemode: false } as Stripe.Product;
        this.productsStore.set(id, product);
        return product;
      }) as never,
    } as unknown as Stripe["products"];
    this.prices = {
      create: (async (params: Stripe.PriceCreateParams) => {
        this.priceCreates += 1;
        const price = { id: `price_catalog_${this.priceCreates}`, object: "price", active: params.active ?? true, livemode: false, unit_amount: params.unit_amount ?? null, currency: params.currency, tax_behavior: params.tax_behavior ?? "unspecified", recurring: params.recurring ? { interval: params.recurring.interval } : null, product: params.product } as Stripe.Price;
        this.pricesStore.set(price.id, price);
        return price;
      }) as never,
      retrieve: (async (id: string) => {
        const price = this.pricesStore.get(id);
        if (!price) throw Object.assign(new Error("missing"), { statusCode: 404 });
        return price;
      }) as never,
      update: (async (id: string, params: Stripe.PriceUpdateParams) => {
        const current = this.pricesStore.get(id)!;
        const price = { ...current, ...params, id, livemode: false } as Stripe.Price;
        this.pricesStore.set(id, price);
        return price;
      }) as never,
    } as unknown as Stripe["prices"];
  }
}

class FakeProvider implements BillingProvider {
  readonly name = "stripe";
  customers: string[] = [];
  checkouts: CreateCheckoutInput[] = [];
  async createCustomer() { const id = `cus_${this.customers.length + 1}`; this.customers.push(id); return id; }
  async createCheckoutLink(input: CreateCheckoutInput) { this.checkouts.push(input); return `https://checkout.example.invalid/${input.providerCustomerId}`; }
  async createPortalLink(providerCustomerId: string) { return `https://portal.example.invalid/${providerCustomerId}`; }
  async verifyWebhook(): Promise<VerifiedBillingEvent> { throw new Error("not used"); }
  async reconcile(): Promise<VerifiedBillingEvent[]> { return []; }
}

test("prépare deux organisations commerciales isolées", async () => {
  await systemPrisma.organization.createMany({ data: [
    { id: orgA, slug: `commercial-a-${suffix}`, name: "Commercial A" },
    { id: orgB, slug: `commercial-b-${suffix}`, name: "Commercial B" },
  ] });
  await systemPrisma.organizationSettings.createMany({ data: [
    { organization_id: orgA, modules_json: JSON.stringify({ reservations: true, smart_life: true }) },
    { organization_id: orgB, modules_json: JSON.stringify({ reservations: true, smart_life: true }) },
  ] });
  await systemPrisma.plan.create({ data: { id: planId, code: `commercial_${suffix}`, name: "Commercial test" } });
  await systemPrisma.planEntitlement.createMany({ data: [
    { plan_id: planId, feature_key: "module.reservations", value_boolean: true },
    { plan_id: planId, feature_key: "module.smart_life", value_boolean: true },
    { plan_id: planId, feature_key: "sms_sent", limit_value: 1, limit_type: "soft" },
    { plan_id: planId, feature_key: "automations_executed", limit_value: 0, limit_type: "hard" },
  ] });
  await systemPrisma.subscription.createMany({ data: [
    { id: `sub_commercial_a_${suffix}`, organization_id: orgA, plan_id: planId, status: "trialing" },
    { id: `sub_commercial_b_${suffix}`, organization_id: orgB, plan_id: planId, status: "trialing", provider: "stripe", provider_customer_id: `cus_b_${suffix}` },
  ] });
  await systemPrisma.user.createMany({ data: [
    { id: userA, login_id: `commercial-a-${suffix}@example.invalid` },
    { id: userB, login_id: `commercial-b-${suffix}@example.invalid` },
  ] });
  await systemPrisma.membership.createMany({ data: [
    { user_id: userA, organization_id: orgA, role: "owner", status: "active" },
    { user_id: userB, organization_id: orgB, role: "owner", status: "active" },
  ] });
  await systemPrisma.appUser.createMany({ data: [
    { id: `profile_a_${suffix}`, organization_id: orgA, user_id: userA, display_name: "Owner A", is_owner: true, email: `owner-a-${suffix}@example.invalid` },
    { id: `profile_b_${suffix}`, organization_id: orgB, user_id: userB, display_name: "Owner B", is_owner: true, email: `owner-b-${suffix}@example.invalid` },
  ] });
  await systemPrisma.billingPrice.create({ data: { plan_id: planId, provider: "stripe", provider_product_id: `prod_${suffix}`, provider_price_id: `price_${suffix}`, billing_period: "monthly" } });
});

test("la signature Stripe valide est acceptée et une signature invalide est refusée", async () => {
  const stripe = new Stripe("sk_test_unit");
  const secret = "whsec_unit_test";
  const payload = JSON.stringify({ id: `evt_${suffix}`, object: "event", api_version: "2026-09-30.clover", created: 1_800_000_000, data: { object: { id: `sub_${suffix}`, customer: `cus_${suffix}`, status: "active", items: { data: [] } } }, livemode: false, pending_webhooks: 1, request: null, type: "customer.subscription.updated" });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const provider = new StripeBillingProvider(stripe, secret);
  const verified = await provider.verifyWebhook(Buffer.from(payload), signature);
  assert.equal(verified.providerSubscriptionId, `sub_${suffix}`);
  assert.equal(verified.subscriptionStatus, "active");
  await assert.rejects(() => provider.verifyWebhook(Buffer.from(payload), `${signature}invalid`), (error: { code?: string }) => error.code === "INVALID_WEBHOOK_SIGNATURE");
});

test("Checkout et portail restent rattachés à l’organisation serveur", async () => {
  const provider = new FakeProvider();
  const url = await createOrganizationCheckout(provider, orgA, "monthly");
  assert.match(url, /cus_1/);
  assert.equal(provider.checkouts[0].providerPriceId, `price_${suffix}`);
  assert.equal(provider.checkouts[0].organizationReference, orgA);
  assert.equal((await systemPrisma.subscription.findUniqueOrThrow({ where: { organization_id: orgA } })).provider_customer_id, "cus_1");
  assert.match(await createOrganizationPortal(provider, orgB), new RegExp(`cus_b_${suffix}`));
});

test("Checkout et portail exigent explicitement un propriétaire", () => {
  assert.doesNotThrow(() => assertBillingOwner({ permissions: { isOwner: true } }));
  assert.throws(
    () => assertBillingOwner({ permissions: { isOwner: false } }),
    (error: { code?: string }) => error.code === "OWNER_REQUIRED",
  );
  assert.throws(
    () => assertBillingOwner(null),
    (error: { code?: string }) => error.code === "OWNER_REQUIRED",
  );
});

test("le catalogue publie les produits et remplace un prix Stripe modifié sans doublon", async () => {
  await systemPrisma.plan.create({
    data: {
      id: catalogPlanId,
      code: `catalog_${suffix}`,
      name: "Catalogue test",
      description: "Forfait synchronisé",
      status: "active",
      billing_periods: JSON.stringify(["monthly", "annual"]),
      price_definitions: {
        create: [
          { billing_period: "monthly", amount_cents: 2900, currency: "eur", tax_behavior: "inclusive" },
          { billing_period: "annual", amount_cents: 29000, currency: "eur", tax_behavior: "inclusive" },
        ],
      },
    },
  });
  const fake = new FakeStripeCatalog();
  const synchronizer = new StripeCatalogSynchronizer(fake as unknown as Stripe);
  const first = await synchronizer.synchronize(catalogPlanId);
  assert.equal(first.prices.length, 2);
  assert.equal(fake.productCreates, 1);
  assert.equal(fake.priceCreates, 2);

  await synchronizer.synchronize(catalogPlanId);
  assert.equal(fake.productCreates, 1);
  assert.equal(fake.priceCreates, 2);

  await systemPrisma.planPriceDefinition.update({
    where: { plan_id_billing_period: { plan_id: catalogPlanId, billing_period: "monthly" } },
    data: { amount_cents: 3900 },
  });
  const previousMonthly = await systemPrisma.billingPrice.findUniqueOrThrow({
    where: { plan_id_provider_billing_period: { plan_id: catalogPlanId, provider: "stripe", billing_period: "monthly" } },
  });
  await synchronizer.synchronize(catalogPlanId);
  const nextMonthly = await systemPrisma.billingPrice.findUniqueOrThrow({
    where: { plan_id_provider_billing_period: { plan_id: catalogPlanId, provider: "stripe", billing_period: "monthly" } },
  });
  assert.notEqual(nextMonthly.provider_price_id, previousMonthly.provider_price_id);
  assert.equal(fake.pricesStore.get(previousMonthly.provider_price_id)?.active, false);
  assert.equal(fake.priceCreates, 3);
});

test("webhook client Stripe retrouve la bonne organisation sans identifiant navigateur", async () => {
  const event = await processVerifiedBillingEvent("stripe", { providerEventId: `evt_map_${suffix}`, idempotencyKey: `evt_map_${suffix}`, providerCustomerId: `cus_b_${suffix}`, providerSubscriptionId: `sub_provider_b_${suffix}`, type: "customer.subscription.updated", subscriptionStatus: "active", occurredAt: new Date(), version: 10 });
  assert.equal(event.event?.organization_id, orgB);
  assert.equal((await systemPrisma.subscription.findUniqueOrThrow({ where: { organization_id: orgB } })).provider_subscription_id, `sub_provider_b_${suffix}`);
});

test("les transitions de paiement appliquent délai de grâce puis suspension sans supprimer les données", async () => {
  const now = new Date();
  await processVerifiedBillingEvent("stripe", { providerEventId: `evt_due_${suffix}`, idempotencyKey: `evt_due_${suffix}`, providerCustomerId: `cus_b_${suffix}`, type: "invoice.payment_failed", subscriptionStatus: "past_due", occurredAt: now, version: 11 });
  const overdue = await systemPrisma.subscription.findUniqueOrThrow({ where: { organization_id: orgB } });
  assert.equal(overdue.status, "past_due");
  assert.ok(overdue.grace_period_end && overdue.grace_period_end > now);
  await processVerifiedBillingEvent("stripe", { providerEventId: `evt_grace_${suffix}`, idempotencyKey: `evt_grace_${suffix}`, providerCustomerId: `cus_b_${suffix}`, type: "subscription.reconciled", subscriptionStatus: "past_due", occurredAt: new Date(now.getTime() + 1000), version: 12 });
  assert.equal((await systemPrisma.subscription.findUniqueOrThrow({ where: { organization_id: orgB } })).status, "grace_period");
  await processVerifiedBillingEvent("stripe", { providerEventId: `evt_suspend_${suffix}`, idempotencyKey: `evt_suspend_${suffix}`, providerCustomerId: `cus_b_${suffix}`, type: "subscription.reconciled", subscriptionStatus: "past_due", occurredAt: new Date(overdue.grace_period_end!.getTime() + 1000), version: 13 });
  assert.equal((await systemPrisma.subscription.findUniqueOrThrow({ where: { organization_id: orgB } })).status, "suspended");
  assert.equal(await systemPrisma.appUser.count({ where: { organization_id: orgB } }), 1);
});

test("l’administration de plateforme est explicite, auditée et idempotente", async () => {
  const granted = await changePlatformAdministrator({ userId: userA, actorUserId: "test-suite", reason: "Validation du pilote", status: "active" });
  assert.equal(granted.changed, true);
  assert.equal(await isPlatformAdministrator(userA), true);
  const replay = await changePlatformAdministrator({ userId: userA, actorUserId: "test-suite", reason: "Validation du pilote", status: "active" });
  assert.equal(replay.changed, false);
  assert.equal(await systemPrisma.platformAdministratorEvent.count({ where: { user_id: userA, action: "platform_admin.granted" } }), 1);
  const revoked = await changePlatformAdministrator({ userId: userA, actorUserId: "test-suite", reason: "Fin de validation", status: "revoked" });
  assert.equal(revoked.changed, true);
  assert.equal(await isPlatformAdministrator(userA), false);
});

test("l’usage réussi est idempotent et un retry ne double pas le compteur", async () => {
  const first = await recordUsageEvent({ organizationId: orgA, metricKey: "sms_sent", idempotencyKey: `sms:${suffix}`, source: "test" });
  const second = await recordUsageEvent({ organizationId: orgA, metricKey: "sms_sent", idempotencyKey: `sms:${suffix}`, source: "test" });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  const soft = await recordUsageEvent({ organizationId: orgA, metricKey: "sms_sent", idempotencyKey: `sms-soft:${suffix}`, source: "test" });
  assert.equal(soft.exceeded, true);
  const concurrent = await Promise.all([
    recordUsageEvent({ organizationId: orgA, metricKey: "sms_sent", idempotencyKey: `sms-concurrent:${suffix}`, source: "test" }),
    recordUsageEvent({ organizationId: orgA, metricKey: "sms_sent", idempotencyKey: `sms-concurrent:${suffix}`, source: "test" }),
  ]);
  assert.equal(concurrent.filter((item) => item.duplicate).length, 1);
  await assert.rejects(() => recordUsageEvent({ organizationId: orgA, metricKey: "automations_executed", idempotencyKey: `automation-hard:${suffix}`, source: "test" }), (error: { code?: string }) => error.code === "QUOTA_EXCEEDED");
  assert.equal(await systemPrisma.usageEvent.count({ where: { organization_id: orgA, idempotency_key: `sms:${suffix}` } }), 1);
  assert.equal((await systemPrisma.usageCounter.findFirstOrThrow({ where: { organization_id: orgA, metric_key: "sms_sent" } })).value, 3);
});

test("le worker reprend, retente et isole l’échec d’une organisation", async () => {
  const jobA = await enqueueOrganizationJob({ organizationId: orgA, type: "test.isolation", idempotencyKey: `job-a-${suffix}` });
  const jobB = await enqueueOrganizationJob({ organizationId: orgB, type: "test.isolation", idempotencyKey: `job-b-${suffix}` });
  let failA = true;
  const handlers = { "test.isolation": async (job: { organization_id: string }) => {
    if (job.organization_id === orgA && failA) throw new Error("échec A");
    return { ok: true };
  } };
  const first = await runOrganizationJobBatch({ workerId: `worker-${suffix}`, leaseMs: 1000, maxAttempts: 2, handlers, limit: 2 });
  assert.deepEqual(first.map((item) => item.status).sort(), ["retrying", "succeeded"]);
  assert.equal((await systemPrisma.organizationJob.findUniqueOrThrow({ where: { id: jobB.id } })).status, "completed");
  failA = false;
  await systemPrisma.organizationJob.update({ where: { id: jobA.id }, data: { run_at: new Date(0) } });
  const second = await runOrganizationJobBatch({ workerId: `worker-${suffix}`, leaseMs: 1000, maxAttempts: 2, handlers, limit: 1 });
  assert.equal(second[0].status, "succeeded");
  assert.equal(await systemPrisma.organizationJobAttempt.count({ where: { job_id: jobA.id } }), 2);
});

test("le worker reprend un lease expiré et clôt la tentative interrompue", async () => {
  const job = await enqueueOrganizationJob({ organizationId: orgA, type: "test.recovery", idempotencyKey: `job-recovery-${suffix}` });
  const now = new Date();
  await systemPrisma.organizationJob.update({
    where: { id: job.id },
    data: { status: "running", attempts: 1, locked_at: new Date(now.getTime() - 120_000), lock_owner: "worker-interrompu" },
  });
  const attempt = await systemPrisma.organizationJobAttempt.create({
    data: { organization_id: orgA, job_id: job.id, attempt: 1, status: "running", started_at: new Date(now.getTime() - 120_000) },
  });
  const claimed = await claimNextOrganizationJob({ workerId: `worker-reprise-${suffix}`, leaseMs: 60_000, maxAttempts: 3, now, types: ["test.recovery"] });
  assert.equal(claimed?.id, job.id);
  assert.equal(claimed?.attempts, 2);
  const recoveredAttempt = await systemPrisma.organizationJobAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  assert.equal(recoveredAttempt.status, "retrying");
  assert.match(recoveredAttempt.error_message ?? "", /Lease expiré/);
  assert.ok(recoveredAttempt.completed_at);
});

test("les tâches planifiées parcourent deux organisations et isolent leurs erreurs", async () => {
  const visited: string[] = [];
  const outcomes = await runTenantTaskAcrossOrganizations({
    taskKey: `test.tenant-task.${suffix}`,
    moduleKeys: ["smart_life"],
    handler: async (organizationId) => {
      if (![orgA, orgB].includes(organizationId)) return;
      visited.push(organizationId);
      if (organizationId === orgA) throw new Error("organisation A en échec");
    },
  });
  assert.deepEqual(visited.sort(), [orgA, orgB].sort());
  assert.equal(outcomes.find((item) => item.organizationId === orgA)?.status, "failed");
  assert.equal(outcomes.find((item) => item.organizationId === orgB)?.status, "succeeded");
});

after(async () => {
  await systemPrisma.platformAdministratorEvent.deleteMany({ where: { user_id: userA } });
  await systemPrisma.platformAdministrator.deleteMany({ where: { user_id: userA } });
  await systemPrisma.organizationTaskLease.deleteMany({ where: { task_key: { startsWith: "test.tenant-task." } } });
  await systemPrisma.organizationTaskLease.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.organizationJobAttempt.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.organizationJob.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.billingEvent.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.usageEvent.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.usageCounter.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.billingPrice.deleteMany({ where: { plan_id: planId } });
  await systemPrisma.billingPrice.deleteMany({ where: { plan_id: catalogPlanId } });
  await systemPrisma.billingProduct.deleteMany({ where: { plan_id: catalogPlanId } });
  await systemPrisma.planPriceDefinition.deleteMany({ where: { plan_id: catalogPlanId } });
  await systemPrisma.appUser.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.membership.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await systemPrisma.subscription.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await systemPrisma.planEntitlement.deleteMany({ where: { plan_id: planId } });
  await systemPrisma.plan.deleteMany({ where: { id: catalogPlanId } });
  await systemPrisma.plan.deleteMany({ where: { id: planId } });
  await systemPrisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

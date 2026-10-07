import { z } from "zod";
import { getTenantPrisma, systemPrisma } from "../../db/prisma.js";
import {
  MODULE_KEYS,
  normalizeModules,
} from "../../services/installationConfig.js";
import { recordAuditEvent } from "../system/audit.js";
import {
  computeEffectiveFeature,
  isWriteAllowed,
  SUBSCRIPTION_STATUSES,
  subscriptionCapabilities,
  type SubscriptionStatus,
} from "./policies.js";
import type { BillingProvider, VerifiedBillingEvent } from "./provider.js";
import { env } from "../../config/env.js";

export const USAGE_METRICS = [
  "active_properties",
  "manager_members",
  "worker_members",
  "reservations_created",
  "documents_generated",
  "storage_bytes",
  "sms_sent",
  "automations_executed",
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

const statusSchema = z.enum(SUBSCRIPTION_STATUSES);
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const getSubscriptionSnapshot = async (
  organizationId: string,
  now = new Date(),
) => {
  const db = getTenantPrisma(organizationId);
  const [subscription, settings, overrides] = await Promise.all([
    db.subscription.findFirst({
      include: { plan: { include: { entitlements: true } } },
    }),
    db.organizationSettings.findFirst(),
    db.organizationEntitlementOverride.findMany({
      where: { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const localModules = normalizeModules(settings?.modules_json);
  const status = statusSchema
    .catch("active")
    .parse(subscription?.status ?? "active");
  const entitlementByKey = new Map(
    subscription?.plan.entitlements.map((item) => [item.feature_key, item]) ??
      [],
  );
  const overrideByKey = new Map<string, (typeof overrides)[number]>();
  for (const item of overrides)
    if (!overrideByKey.has(item.feature_key))
      overrideByKey.set(item.feature_key, item);
  const features = Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => {
      const key = `module.${moduleKey}`;
      const entitlement = entitlementByKey.get(key);
      const override = overrideByKey.get(key);
      const planAllows = subscription
        ? entitlement?.value_boolean === true
        : true;
      return [
        moduleKey,
        {
          planAllows,
          organizationEnabled: localModules[moduleKey],
          override: override?.value_boolean ?? null,
          effective: computeEffectiveFeature({
            planAllows,
            organizationEnabled: localModules[moduleKey],
            subscriptionAllows: true,
            override: override?.value_boolean,
          }),
        },
      ];
    }),
  );
  const limits = await Promise.all(
    [...entitlementByKey.entries()]
      .filter(([, item]) => item.limit_value !== null)
      .map(async ([key, item]) => {
        const override = overrideByKey.get(key);
        const limit = override?.limit_value ?? item.limit_value;
        const usage = await currentUsage(organizationId, key);
        return {
          metricKey: key,
          limit,
          usage,
          exceeded: limit !== null && usage > limit,
          limitType: item.limit_type,
        };
      }),
  );
  return {
    plan: subscription
      ? {
          code: subscription.plan.code,
          name: subscription.plan.name,
          description: subscription.plan.description,
          metadata: parseJson(subscription.plan.public_metadata, {}),
        }
      : null,
    subscription: subscription
      ? {
          status,
          trialStart: subscription.trial_start,
          trialEnd: subscription.trial_end,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          gracePeriodEnd: subscription.grace_period_end,
          providerConfigured: Boolean(subscription.provider),
        }
      : null,
    capabilities: subscriptionCapabilities[status],
    features,
    limits,
  };
};

export const isFeatureAvailable = async (
  organizationId: string,
  moduleKey: (typeof MODULE_KEYS)[number],
  organizationEnabled: boolean,
) => {
  const db = getTenantPrisma(organizationId);
  const subscription = await db.subscription.findFirst({
    include: {
      plan: {
        include: {
          entitlements: { where: { feature_key: `module.${moduleKey}` } },
        },
      },
    },
  });
  if (!subscription) return organizationEnabled;
  const override = await db.organizationEntitlementOverride.findFirst({
    where: {
      feature_key: `module.${moduleKey}`,
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });
  return computeEffectiveFeature({
    planAllows: subscription.plan.entitlements[0]?.value_boolean === true,
    organizationEnabled,
    subscriptionAllows: true,
    override: override?.value_boolean,
  });
};

export const assertSubscriptionWriteAllowed = async (
  organizationId: string,
) => {
  const subscription = await getTenantPrisma(
    organizationId,
  ).subscription.findFirst({ select: { status: true } });
  if (!subscription) return;
  const status = statusSchema.parse(subscription.status);
  if (!isWriteAllowed(status)) {
    await recordAuditEvent({
      organizationId,
      action: "subscription.write_blocked",
      resourceType: "subscription",
      resourceId: subscription.status,
      metadata: { status },
    });
    throw Object.assign(
      new Error(
        "Abonnement en lecture seule. Les données existantes restent accessibles et exportables.",
      ),
      { status: 403, code: "SUBSCRIPTION_READ_ONLY" },
    );
  }
};

const currentUsage = async (
  organizationId: string,
  metricKey: string,
  now = new Date(),
) => {
  const db = getTenantPrisma(organizationId);
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  if (metricKey === "active_properties") return db.gite.count();
  if (metricKey === "manager_members")
    return db.appUser.count({
      where: { is_active: true, status: { not: "worker" } },
    });
  if (metricKey === "worker_members")
    return db.appUser.count({ where: { is_active: true, status: "worker" } });
  if (metricKey === "reservations_created")
    return db.reservation.count({ where: { createdAt: { gte: monthStart } } });
  if (metricKey === "documents_generated") {
    const [contracts, invoices] = await Promise.all([
      db.contrat.count({ where: { date_creation: { gte: monthStart } } }),
      db.facture.count({ where: { date_creation: { gte: monthStart } } }),
    ]);
    return contracts + invoices;
  }
  if (metricKey === "storage_bytes")
    return Number(
      (
        await db.documentAsset.aggregate({
          _sum: { size_bytes: true },
          where: { status: "active" },
        })
      )._sum.size_bytes ?? 0,
    );
  return (
    (
      await db.usageCounter.findFirst({
        where: { metric_key: metricKey, period_key: usagePeriodKey(now) },
      })
    )?.value ?? 0
  );
};

export const assertCreationQuota = async (
  organizationId: string,
  metricKey: UsageMetric,
) => {
  const db = getTenantPrisma(organizationId);
  const subscription = await db.subscription.findFirst({
    include: {
      plan: {
        include: { entitlements: { where: { feature_key: metricKey } } },
      },
    },
  });
  if (!subscription) return;
  const entitlement = subscription.plan.entitlements[0];
  const override = await db.organizationEntitlementOverride.findFirst({
    where: {
      feature_key: metricKey,
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });
  const limit = override?.limit_value ?? entitlement?.limit_value;
  if (
    limit === null ||
    limit === undefined ||
    entitlement?.limit_type !== "hard"
  )
    return;
  const usage = await currentUsage(organizationId, metricKey);
  if (usage < limit) return;
  await recordAuditEvent({
    organizationId,
    action: "quota.creation_blocked",
    resourceType: "usage_metric",
    resourceId: metricKey,
    metadata: { usage, limit },
  });
  throw Object.assign(
    new Error(
      "Quota atteint. Les données existantes restent disponibles et exportables.",
    ),
    {
      status: 409,
      code: "QUOTA_EXCEEDED",
      details: { metricKey, usage, limit },
    },
  );
};

export const quotaMetricForRequest = (
  method: string,
  path: string,
  body: unknown,
): UsageMetric | null => {
  if (method.toUpperCase() !== "POST") return null;
  if (path === "/gites") return "active_properties";
  if (path === "/reservations") return "reservations_created";
  if (path === "/contracts" || path === "/invoices")
    return "documents_generated";
  if (path === "/users")
    return (body as { status?: unknown } | null)?.status === "worker"
      ? "worker_members"
      : "manager_members";
  return null;
};

export const consumeMeteredUsage = async (
  organizationId: string,
  metricKey: UsageMetric,
  periodKey: string,
  amount: number,
  limit: number | null,
) => {
  const db = getTenantPrisma(organizationId);
  await db.usageCounter.upsert({
    where: {
      organization_id_metric_key_period_key: {
        organization_id: organizationId,
        metric_key: metricKey,
        period_key: periodKey,
      },
    },
    create: {
      organization_id: organizationId,
      metric_key: metricKey,
      period_key: periodKey,
      value: 0,
      source: "metered",
    },
    update: {},
  });
  if (limit === null)
    return db.usageCounter.update({
      where: {
        organization_id_metric_key_period_key: {
          organization_id: organizationId,
          metric_key: metricKey,
          period_key: periodKey,
        },
      },
      data: { value: { increment: amount } },
    });
  const changed = await db.usageCounter.updateMany({
    where: {
      metric_key: metricKey,
      period_key: periodKey,
      value: { lte: limit - amount },
    },
    data: { value: { increment: amount } },
  });
  if (changed.count !== 1) {
    await recordAuditEvent({
      organizationId,
      action: "quota.blocked",
      resourceType: "usage_counter",
      resourceId: metricKey,
      metadata: { periodKey, amount, limit },
    });
    throw Object.assign(
      new Error("Quota atteint. Les données existantes restent disponibles."),
      { status: 409, code: "QUOTA_EXCEEDED", details: { metricKey, limit } },
    );
  }
  return db.usageCounter.findFirstOrThrow({
    where: { metric_key: metricKey, period_key: periodKey },
  });
};

export const usagePeriodKey = (date = new Date()) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

export const recordUsageEvent = async (input: {
  organizationId: string;
  metricKey: UsageMetric;
  idempotencyKey: string;
  source: string;
  amount?: number;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}) => {
  const amount = input.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Le montant d’usage doit être un entier positif.");
  const periodKey = usagePeriodKey(input.occurredAt);
  const db = getTenantPrisma(input.organizationId);
  const existing = await db.usageEvent.findUnique({
    where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
  });
  if (existing) return { duplicate: true, event: existing };
  const subscription = await db.subscription.findFirst({
    include: { plan: { include: { entitlements: { where: { feature_key: input.metricKey } } } } },
  });
  const entitlement = subscription?.plan.entitlements[0];
  const override = await db.organizationEntitlementOverride.findFirst({
    where: { feature_key: input.metricKey, OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
  });
  const limit = override?.limit_value ?? entitlement?.limit_value ?? null;
  const limitType = entitlement?.limit_type ?? "soft";
  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await tx.usageEvent.findUnique({
        where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
      });
      if (duplicate) return { duplicate: true, event: duplicate };
      const counter = await tx.usageCounter.upsert({
        where: { organization_id_metric_key_period_key: { organization_id: input.organizationId, metric_key: input.metricKey, period_key: periodKey } },
        update: {},
        create: { organization_id: input.organizationId, metric_key: input.metricKey, period_key: periodKey, value: 0, source: "metered" },
      });
      let updated;
      if (limitType === "hard" && limit !== null) {
        const remaining = limit - amount;
        const changed = remaining < 0 ? { count: 0 } : await tx.usageCounter.updateMany({
          where: { id: counter.id, value: { lte: remaining } },
          data: { value: { increment: amount } },
        });
        if (changed.count !== 1) {
          throw Object.assign(new Error("Quota atteint. Les données existantes restent disponibles."), { status: 409, code: "QUOTA_EXCEEDED", details: { metricKey: input.metricKey, limit } });
        }
        updated = await tx.usageCounter.findUniqueOrThrow({ where: { id: counter.id } });
      } else {
        updated = await tx.usageCounter.update({ where: { id: counter.id }, data: { value: { increment: amount } } });
      }
      const event = await tx.usageEvent.create({
        data: { organization_id: input.organizationId, metric_key: input.metricKey, period_key: periodKey, amount, idempotency_key: input.idempotencyKey, source: input.source, metadata_json: JSON.stringify(input.metadata ?? {}) },
      });
      return { duplicate: false, event, exceeded: limit !== null && updated.value > limit, limitType };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const duplicate = await db.usageEvent.findUnique({
        where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
      });
      if (duplicate) return { duplicate: true, event: duplicate };
    }
    throw error;
  }
};

const configuredStripePrices = () => [
  { planCode: "pilot_provisional", billingPeriod: "monthly", productId: env.STRIPE_PILOT_PRODUCT_ID, priceId: env.STRIPE_PILOT_MONTHLY_PRICE_ID },
  { planCode: "pilot_provisional", billingPeriod: "annual", productId: env.STRIPE_PILOT_PRODUCT_ID, priceId: env.STRIPE_PILOT_ANNUAL_PRICE_ID },
].filter((item) => item.productId && item.priceId);

export const syncConfiguredStripePrices = async () => {
  for (const configured of configuredStripePrices()) {
    const plan = await systemPrisma.plan.findUnique({ where: { code: configured.planCode } });
    if (!plan) continue;
    await systemPrisma.billingPrice.upsert({
      where: { plan_id_provider_billing_period: { plan_id: plan.id, provider: "stripe", billing_period: configured.billingPeriod } },
      update: { provider_product_id: configured.productId, provider_price_id: configured.priceId, status: "active" },
      create: { plan_id: plan.id, provider: "stripe", provider_product_id: configured.productId, provider_price_id: configured.priceId, billing_period: configured.billingPeriod },
    });
  }
};

export const getBillingActions = async (organizationId: string) => {
  await syncConfiguredStripePrices();
  const subscription = await systemPrisma.subscription.findUnique({ where: { organization_id: organizationId }, include: { plan: true } });
  if (!subscription) return { checkoutAllowed: false, portalAllowed: false, periods: [] as string[] };
  const prices = await systemPrisma.billingPrice.findMany({ where: { plan_id: subscription.plan_id, provider: "stripe", status: "active" }, orderBy: { billing_period: "asc" } });
  return {
    checkoutAllowed: Boolean(env.STRIPE_SECRET_KEY && subscription.plan.code !== "legacy_unlimited" && prices.length),
    portalAllowed: Boolean(env.STRIPE_SECRET_KEY && subscription.provider === "stripe" && subscription.provider_customer_id),
    periods: prices.map((price) => price.billing_period),
  };
};

const billingConfigurationError = () => Object.assign(
  new Error("La facturation Stripe test n’est pas encore configurée pour ce forfait."),
  { status: 409, code: "BILLING_PROVIDER_NOT_CONFIGURED" },
);

export const createOrganizationCheckout = async (
  provider: BillingProvider,
  organizationId: string,
  billingPeriod: "monthly" | "annual",
) => {
  await syncConfiguredStripePrices();
  const subscription = await systemPrisma.subscription.findUnique({
    where: { organization_id: organizationId },
    include: { plan: true },
  });
  if (!subscription || subscription.plan.code === "legacy_unlimited") throw billingConfigurationError();
  const price = await systemPrisma.billingPrice.findUnique({
    where: { plan_id_provider_billing_period: { plan_id: subscription.plan_id, provider: provider.name, billing_period: billingPeriod } },
  });
  if (!price || price.status !== "active") throw billingConfigurationError();
  const organization = await systemPrisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const owner = await systemPrisma.appUser.findFirst({
    where: { organization_id: organizationId, is_owner: true, is_active: true },
    select: { email: true },
  });
  let customerId = subscription.provider_customer_id;
  if (!customerId) {
    customerId = await provider.createCustomer({
      name: organization.name,
      email: owner?.email ?? undefined,
      organizationReference: organization.id,
      idempotencyKey: `customer:${provider.name}:${organization.id}`,
    });
    await systemPrisma.subscription.update({
      where: { id: subscription.id },
      data: { provider: provider.name, provider_customer_id: customerId },
    });
  } else if (subscription.provider && subscription.provider !== provider.name) {
    throw Object.assign(new Error("Cet abonnement est associé à un autre fournisseur."), { status: 409, code: "BILLING_PROVIDER_MISMATCH" });
  }
  const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
  return provider.createCheckoutLink({
    providerCustomerId: customerId,
    providerPriceId: price.provider_price_id,
    successUrl: `${env.APP_PUBLIC_URL.replace(/\/$/, "")}/abonnement?checkout=success`,
    cancelUrl: `${env.APP_PUBLIC_URL.replace(/\/$/, "")}/abonnement?checkout=cancelled`,
    organizationReference: organization.id,
    idempotencyKey: `checkout:${organization.id}:${billingPeriod}:${bucket}`,
  });
};

export const createOrganizationPortal = async (provider: BillingProvider, organizationId: string) => {
  const subscription = await systemPrisma.subscription.findUnique({ where: { organization_id: organizationId } });
  if (!subscription?.provider_customer_id || subscription.provider !== provider.name) throw billingConfigurationError();
  return provider.createPortalLink(subscription.provider_customer_id, `${env.APP_PUBLIC_URL.replace(/\/$/, "")}/abonnement`);
};

const EVENT_STATUS: Record<string, SubscriptionStatus> = {
  "subscription.trialing": "trialing",
  "subscription.active": "active",
  "subscription.past_due": "past_due",
  "subscription.grace_period": "grace_period",
  "subscription.suspended": "suspended",
  "subscription.cancelled": "cancelled",
};

export const processVerifiedBillingEvent = async (
  provider: string,
  event: VerifiedBillingEvent,
) => {
  const subscription = await systemPrisma.subscription.findFirst({
    where: {
      provider,
      OR: [
        ...(event.providerSubscriptionId ? [{ provider_subscription_id: event.providerSubscriptionId }] : []),
        ...(event.providerCustomerId ? [{ provider_customer_id: event.providerCustomerId }] : []),
      ],
    },
  });
  if (!subscription) return { duplicate: false, result: "ignored_unscoped" as const, event: null };
  const existing = await systemPrisma.billingEvent.findFirst({
    where: {
      provider,
      OR: [{ provider_event_id: event.providerEventId }, { idempotency_key: event.idempotencyKey }],
    },
  });
  if (existing) return { duplicate: true, event: existing };
  let nextStatus = event.subscriptionStatus ?? EVENT_STATUS[event.type];
  if (nextStatus === "past_due" && event.type === "subscription.reconciled" && subscription.grace_period_end) {
    nextStatus = event.occurredAt > subscription.grace_period_end ? "suspended" : "grace_period";
  }
  const outOfOrder =
    (event.version !== undefined &&
      event.version < subscription.sync_version) ||
    Boolean(
      subscription.last_synced_at &&
      event.occurredAt < subscription.last_synced_at,
    );
  const billingPrice = event.providerPriceId
    ? await systemPrisma.billingPrice.findUnique({ where: { provider_provider_price_id: { provider, provider_price_id: event.providerPriceId } } })
    : null;
  const created = await systemPrisma.$transaction(async (tx) => {
    const row = await tx.billingEvent.create({
      data: {
        organization_id: subscription.organization_id,
        subscription_id: subscription.id,
        provider,
        provider_event_id: event.providerEventId,
        type: event.type,
        payload_reference: event.reference,
        payload_json: JSON.stringify({
          occurredAt: event.occurredAt.toISOString(),
          version: event.version,
        }),
        idempotency_key: event.idempotencyKey,
        status: "processed",
        result: outOfOrder
          ? "ignored_out_of_order"
          : nextStatus
            ? "applied"
            : event.providerSubscriptionId && !subscription.provider_subscription_id
              ? "associated"
              : "ignored_unknown",
        processed_at: new Date(),
      },
    });
    if (!outOfOrder && nextStatus)
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: nextStatus,
          ...(billingPrice ? { plan_id: billingPrice.plan_id } : {}),
          ...(event.providerCustomerId ? { provider_customer_id: event.providerCustomerId } : {}),
          ...(event.providerSubscriptionId ? { provider_subscription_id: event.providerSubscriptionId } : {}),
          ...(event.trialStart !== undefined ? { trial_start: event.trialStart } : {}),
          ...(event.trialEnd !== undefined ? { trial_end: event.trialEnd } : {}),
          ...(event.currentPeriodStart !== undefined ? { current_period_start: event.currentPeriodStart } : {}),
          ...(event.currentPeriodEnd !== undefined ? { current_period_end: event.currentPeriodEnd } : {}),
          ...(event.cancelAtPeriodEnd !== undefined ? { cancel_at_period_end: event.cancelAtPeriodEnd } : {}),
          ...(nextStatus === "past_due" ? { grace_period_end: new Date(event.occurredAt.getTime() + env.STRIPE_GRACE_PERIOD_DAYS * 86_400_000) } : {}),
          ...(["active", "trialing"].includes(nextStatus) ? { grace_period_end: null } : {}),
          ...(nextStatus === "cancelled" ? { cancelled_at: event.occurredAt } : {}),
          sync_version: event.version ?? subscription.sync_version + 1,
          last_synced_at: event.occurredAt,
        },
      });
    else if (!outOfOrder && event.providerSubscriptionId && !subscription.provider_subscription_id)
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { provider_subscription_id: event.providerSubscriptionId, ...(event.providerCustomerId ? { provider_customer_id: event.providerCustomerId } : {}) },
      });
    return row;
  });
  return { duplicate: false, event: created };
};

export const handleBillingWebhook = async (
  provider: BillingProvider,
  rawBody: Buffer,
  signature: string,
) => {
  const verified = await provider.verifyWebhook(rawBody, signature);
  return processVerifiedBillingEvent(provider.name, verified);
};

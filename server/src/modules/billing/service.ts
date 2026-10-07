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
        where: { metric_key: metricKey },
        orderBy: { updatedAt: "desc" },
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
    where: { provider, provider_subscription_id: event.providerSubscriptionId },
  });
  if (!subscription)
    throw Object.assign(new Error("Abonnement fournisseur inconnu."), {
      status: 404,
      code: "BILLING_SUBSCRIPTION_NOT_FOUND",
    });
  const existing = await systemPrisma.billingEvent.findFirst({
    where: {
      OR: [
        { provider_event_id: event.providerEventId },
        { idempotency_key: event.idempotencyKey },
      ],
    },
  });
  if (existing) return { duplicate: true, event: existing };
  const nextStatus = EVENT_STATUS[event.type];
  const outOfOrder =
    (event.version !== undefined &&
      event.version <= subscription.sync_version) ||
    Boolean(
      subscription.last_synced_at &&
      event.occurredAt <= subscription.last_synced_at,
    );
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
            : "ignored_unknown",
        processed_at: new Date(),
      },
    });
    if (!outOfOrder && nextStatus)
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: nextStatus,
          sync_version: event.version ?? subscription.sync_version + 1,
          last_synced_at: event.occurredAt,
        },
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

import { Router } from "express";
import { z } from "zod";
import { systemPrisma } from "../../db/prisma.js";
import { getServerAuthSessionFromRequest } from "../../services/serverAuth.js";
import { recordAuditEvent } from "../system/audit.js";
import { SUBSCRIPTION_STATUSES } from "./policies.js";
import { getSubscriptionSnapshot } from "./service.js";
import { isPlatformAdministrator } from "./admin.js";
import { enqueueOrganizationJob } from "../system/jobs.js";
import { MODULE_KEYS } from "../../services/installationConfig.js";
import { encodeJsonField, fromJsonString } from "../../utils/jsonFields.js";
import { USAGE_METRICS } from "./service.js";
import { HISTORICAL_ORGANIZATION_ID } from "../organizations/context.js";
import { getStripeTestConfiguration, syncPlanCatalogToStripe } from "./stripeCatalog.js";

const router = Router();

router.use(async (req, res, next) => {
  try {
    const session = await getServerAuthSessionFromRequest(req);
    if (!session || !(await isPlatformAdministrator(session.userId)))
      return res.status(403).json({
        error: "Administration de plateforme requise.",
        code: "PLATFORM_ADMIN_REQUIRED",
      });
    res.locals.platformUserId = session.userId;
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/session", (_req, res) =>
  res.json({ platformAdministrator: true }),
);

const metricLabels: Record<(typeof USAGE_METRICS)[number], string> = {
  active_properties: "Hébergements actifs",
  manager_members: "Membres gestionnaires",
  worker_members: "Intervenants actifs",
  reservations_created: "Réservations créées",
  documents_generated: "Documents générés",
  storage_bytes: "Stockage utilisé",
  sms_sent: "SMS envoyés",
  automations_executed: "Automatisations exécutées",
};

const moduleLabels: Record<(typeof MODULE_KEYS)[number], string> = {
  reservations: "Réservations et demandes",
  contracts: "Contrats",
  invoices: "Factures",
  finances: "Finances et statistiques",
  personal_expenses: "Frais personnels",
  worker_planning: "Planning des intervenants",
  web_publication: "Publication web / WordPress",
  ical: "Calendriers iCal",
  pump_airbnb: "Import Airbnb",
  smart_life: "Automatisations Smart Life",
  sms: "SMS",
  telegram: "Notifications Telegram",
  daily_email: "E-mail quotidien",
};

const planEntitlementSchema = z.object({
  featureKey: z.string().min(1).max(100),
  valueBoolean: z.boolean().nullable().optional(),
  limitValue: z.number().int().nonnegative().nullable().optional(),
  limitType: z.enum(["soft", "hard"]).default("hard"),
}).superRefine((value, context) => {
  const validKeys = new Set<string>([
    ...MODULE_KEYS.map((key) => `module.${key}`),
    ...USAGE_METRICS,
  ]);
  if (!validKeys.has(value.featureKey)) {
    context.addIssue({ code: "custom", message: "Fonctionnalité ou quota inconnu.", path: ["featureKey"] });
  }
});

const planWriteSchema = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[a-z][a-z0-9_]*$/).optional(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).default(""),
  status: z.enum(["draft", "active", "archived"]),
  billingPeriods: z.array(z.enum(["monthly", "annual"])).max(2).default([]),
  priceDefinitions: z.array(z.object({
    billingPeriod: z.enum(["monthly", "annual"]),
    amountCents: z.number().int().nonnegative().nullable(),
    currency: z.literal("eur").default("eur"),
    taxBehavior: z.enum(["inclusive", "exclusive", "unspecified"]).default("unspecified"),
  })).max(2).default([]),
  entitlements: z.array(planEntitlementSchema).max(50),
});

const serializePlan = (plan: {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  billing_periods: unknown;
  price_definitions: Array<{ billing_period: string; amount_cents: number | null; currency: string; tax_behavior: string }>;
  billing_products: Array<{ provider: string; provider_product_id: string; status: string }>;
  entitlements: Array<{ feature_key: string; value_boolean: boolean | null; limit_value: number | null; limit_type: string }>;
  billing_prices: Array<{ id: string; provider: string; provider_product_id: string; provider_price_id: string; billing_period: string; status: string }>;
  _count: { subscriptions: number };
}) => ({
  id: plan.id,
  code: plan.code,
  name: plan.name,
  description: plan.description,
  status: plan.status,
  billingPeriods: fromJsonString<string[]>(plan.billing_periods, []),
  priceDefinitions: plan.price_definitions.map((item) => ({
    billingPeriod: item.billing_period,
    amountCents: item.amount_cents,
    currency: item.currency,
    taxBehavior: item.tax_behavior,
  })),
  products: plan.billing_products.map((product) => ({
    provider: product.provider,
    productId: product.provider_product_id,
    status: product.status,
  })),
  locked: plan.code === "legacy_unlimited",
  subscriptionCount: plan._count.subscriptions,
  entitlements: plan.entitlements.map((item) => ({
    featureKey: item.feature_key,
    valueBoolean: item.value_boolean,
    limitValue: item.limit_value,
    limitType: item.limit_type,
  })),
  prices: plan.billing_prices.map((price) => ({
    id: price.id,
    provider: price.provider,
    productId: price.provider_product_id,
    priceId: price.provider_price_id,
    billingPeriod: price.billing_period,
    status: price.status,
  })),
});

router.get("/dashboard", async (_req, res, next) => {
  try {
    const [
      organizationCount,
      activeOrganizationCount,
      userCount,
      trialCount,
      restrictedCount,
      storage,
      plans,
      auditLogs,
      billingEvents,
    ] = await Promise.all([
      systemPrisma.organization.count(),
      systemPrisma.organization.count({ where: { status: "active" } }),
      systemPrisma.user.count(),
      systemPrisma.subscription.count({ where: { status: "trialing" } }),
      systemPrisma.subscription.count({ where: { status: { in: ["suspended", "cancelled"] } } }),
      systemPrisma.documentAsset.aggregate({ _sum: { size_bytes: true }, where: { status: "active" } }),
      systemPrisma.plan.findMany({
        select: { code: true, name: true, _count: { select: { subscriptions: true } } },
        orderBy: { name: "asc" },
      }),
      systemPrisma.auditLog.findMany({
        include: { organization: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      systemPrisma.billingEvent.findMany({
        include: { organization: { select: { name: true } } },
        orderBy: { received_at: "desc" },
        take: 20,
      }),
    ]);

    const activity = [
      ...auditLogs.map((item) => ({
        id: `audit:${item.id}`,
        type: item.action,
        organization: item.organization.name,
        detail: item.resource_type,
        result: null,
        occurredAt: item.createdAt,
        tone: item.action.includes("failed") || item.action.includes("blocked") ? "danger" : "neutral",
      })),
      ...billingEvents.map((item) => ({
        id: `billing:${item.id}`,
        type: item.type,
        organization: item.organization.name,
        detail: "Facturation",
        result: item.result,
        occurredAt: item.received_at,
        tone: item.error_message ? "danger" : item.result === "applied" ? "success" : "neutral",
      })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 20);

    res.json({
      metrics: {
        users: userCount,
        organizations: organizationCount,
        trials: trialCount,
        activeOrganizations: activeOrganizationCount,
        restrictedOrganizations: restrictedCount,
        storageBytes: Number(storage._sum.size_bytes ?? 0),
      },
      planDistribution: plans.map((plan) => ({ code: plan.code, name: plan.name, organizations: plan._count.subscriptions })),
      activity,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/plans", async (_req, res, next) => {
  try {
    const plans = await systemPrisma.plan.findMany({
      include: {
        entitlements: { orderBy: { feature_key: "asc" } },
        price_definitions: { orderBy: { billing_period: "asc" } },
        billing_products: { orderBy: { provider: "asc" } },
        billing_prices: { orderBy: { billing_period: "asc" } },
        _count: { select: { subscriptions: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    res.json({
      plans: plans.map(serializePlan),
      catalog: {
        modules: MODULE_KEYS.map((key) => ({ key: `module.${key}`, label: moduleLabels[key] })),
        metrics: USAGE_METRICS.map((key) => ({ key, label: metricLabels[key] })),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stripe/configuration", (_req, res) => {
  res.json(getStripeTestConfiguration());
});

router.post("/plans", async (req, res, next) => {
  try {
    const payload = planWriteSchema.extend({ code: planWriteSchema.shape.code.unwrap() }).parse(req.body);
    const existing = await systemPrisma.plan.findUnique({ where: { code: payload.code } });
    if (existing) return res.status(409).json({ error: "Ce code de forfait existe déjà.", code: "PLAN_CODE_EXISTS" });
    const created = await systemPrisma.plan.create({
      data: {
        code: payload.code,
        name: payload.name,
        description: payload.description,
        status: payload.status,
        billing_periods: encodeJsonField(payload.billingPeriods),
        public_metadata: encodeJsonField({ commercial: true }),
        price_definitions: {
          create: payload.priceDefinitions.map((item) => ({
            billing_period: item.billingPeriod,
            amount_cents: item.amountCents,
            currency: item.currency,
            tax_behavior: item.taxBehavior,
          })),
        },
        entitlements: {
          create: payload.entitlements.map((item) => ({
            feature_key: item.featureKey,
            value_boolean: item.valueBoolean ?? null,
            limit_value: item.limitValue ?? null,
            limit_type: item.limitType,
          })),
        },
      },
      include: { entitlements: true, price_definitions: true, billing_products: true, billing_prices: true, _count: { select: { subscriptions: true } } },
    });
    await recordAuditEvent({
      organizationId: HISTORICAL_ORGANIZATION_ID,
      userId: res.locals.platformUserId,
      requestId: String(res.getHeader("X-Request-Id") ?? ""),
      action: "billing.plan.created",
      resourceType: "plan",
      resourceId: created.id,
      metadata: { code: created.code },
    });
    res.status(201).json(serializePlan(created));
  } catch (error) {
    next(error);
  }
});

router.patch("/plans/:planId", async (req, res, next) => {
  try {
    const payload = planWriteSchema.omit({ code: true }).parse(req.body);
    const current = await systemPrisma.plan.findUnique({ where: { id: req.params.planId } });
    if (!current) return res.status(404).json({ error: "Forfait introuvable.", code: "NOT_FOUND" });
    if (current.code === "legacy_unlimited") {
      return res.status(409).json({ error: "Le forfait historique est protégé et ne peut pas être modifié.", code: "LEGACY_PLAN_LOCKED" });
    }
    const updated = await systemPrisma.$transaction(async (tx) => {
      await tx.planEntitlement.deleteMany({ where: { plan_id: current.id } });
      await tx.planPriceDefinition.deleteMany({ where: { plan_id: current.id } });
      return tx.plan.update({
        where: { id: current.id },
        data: {
          name: payload.name,
          description: payload.description,
          status: payload.status,
          billing_periods: encodeJsonField(payload.billingPeriods),
          price_definitions: {
            create: payload.priceDefinitions.map((item) => ({
              billing_period: item.billingPeriod,
              amount_cents: item.amountCents,
              currency: item.currency,
              tax_behavior: item.taxBehavior,
            })),
          },
          entitlements: {
            create: payload.entitlements.map((item) => ({
              feature_key: item.featureKey,
              value_boolean: item.valueBoolean ?? null,
              limit_value: item.limitValue ?? null,
              limit_type: item.limitType,
            })),
          },
        },
        include: { entitlements: true, price_definitions: true, billing_products: true, billing_prices: true, _count: { select: { subscriptions: true } } },
      });
    });
    await recordAuditEvent({
      organizationId: HISTORICAL_ORGANIZATION_ID,
      userId: res.locals.platformUserId,
      requestId: String(res.getHeader("X-Request-Id") ?? ""),
      action: "billing.plan.updated",
      resourceType: "plan",
      resourceId: updated.id,
      metadata: { code: updated.code },
    });
    res.json(serializePlan(updated));
  } catch (error) {
    next(error);
  }
});

router.post("/plans/:planId/sync-stripe", async (req, res, next) => {
  try {
    const result = await syncPlanCatalogToStripe(req.params.planId);
    await recordAuditEvent({
      organizationId: HISTORICAL_ORGANIZATION_ID,
      userId: res.locals.platformUserId,
      requestId: String(res.getHeader("X-Request-Id") ?? ""),
      action: "billing.plan.stripe_synced",
      resourceType: "plan",
      resourceId: req.params.planId,
      metadata: { productId: result.productId, prices: result.prices.map((price) => price.priceId), mode: result.mode },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const query = String(req.query.q ?? "").trim();
    const users = await systemPrisma.user.findMany({
      where: query ? { OR: [{ login_id: { contains: query } }, { email: { contains: query } }] } : undefined,
      include: {
        memberships: { include: { organization: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
        profiles: { select: { display_name: true, organization_id: true, is_active: true, auth_sessions: { select: { last_seen_at: true }, orderBy: { last_seen_at: "desc" }, take: 1 } } },
        platform_administrator: { select: { role: true, status: true } },
      },
      orderBy: { login_id: "asc" },
      take: 100,
    });
    res.json(users.map((user) => ({
      id: user.id,
      loginId: user.login_id,
      email: user.email,
      displayName: user.profiles[0]?.display_name ?? user.login_id,
      active: user.memberships.some((membership) => membership.status === "active") && user.profiles.some((profile) => profile.is_active),
      platformAdministrator: user.platform_administrator?.status === "active",
      lastSeenAt: user.profiles.flatMap((profile) => profile.auth_sessions).sort((a, b) => b.last_seen_at.getTime() - a.last_seen_at.getTime())[0]?.last_seen_at ?? null,
      memberships: user.memberships.map((membership) => ({
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        role: membership.role,
        status: membership.status,
      })),
    })));
  } catch (error) {
    next(error);
  }
});

router.get("/organizations", async (req, res, next) => {
  try {
    const query = String(req.query.q ?? "").trim();
    const [organizations, giteCounts, reservationCounts, storageCounts] = await Promise.all([
      systemPrisma.organization.findMany({
        where: query
          ? { OR: [{ name: { contains: query } }, { slug: { contains: query } }] }
          : undefined,
        include: {
          subscriptions: { include: { plan: true } },
          _count: { select: { memberships: true } },
        },
        orderBy: { name: "asc" },
        take: 100,
      }),
      systemPrisma.gite.groupBy({ by: ["organization_id"], _count: { _all: true } }),
      systemPrisma.reservation.groupBy({ by: ["organization_id"], _count: { _all: true } }),
      systemPrisma.documentAsset.groupBy({ by: ["organization_id"], where: { status: "active" }, _sum: { size_bytes: true } }),
    ]);
    const gitesByOrganization = new Map(giteCounts.map((item) => [item.organization_id, item._count._all]));
    const reservationsByOrganization = new Map(reservationCounts.map((item) => [item.organization_id, item._count._all]));
    const storageByOrganization = new Map(storageCounts.map((item) => [item.organization_id, Number(item._sum.size_bytes ?? 0)]));
    res.json(
      organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        createdAt: organization.createdAt,
        metrics: {
          members: organization._count.memberships,
          properties: gitesByOrganization.get(organization.id) ?? 0,
          reservations: reservationsByOrganization.get(organization.id) ?? 0,
          storageBytes: storageByOrganization.get(organization.id) ?? 0,
        },
        subscription: organization.subscriptions[0]
          ? {
              status: organization.subscriptions[0].status,
              planCode: organization.subscriptions[0].plan.code,
              planName: organization.subscriptions[0].plan.name,
              trialEnd: organization.subscriptions[0].trial_end,
              currentPeriodEnd: organization.subscriptions[0].current_period_end,
              provider: organization.subscriptions[0].provider,
            }
          : null,
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/organizations/:organizationId", async (req, res, next) => {
  try {
    const organization = await systemPrisma.organization.findUnique({
      where: { id: req.params.organizationId },
    });
    if (!organization)
      return res
        .status(404)
        .json({ error: "Organisation introuvable.", code: "NOT_FOUND" });
    const [billing, events, overrides, jobs, plans] = await Promise.all([
      getSubscriptionSnapshot(organization.id),
      systemPrisma.billingEvent.findMany({
        where: { organization_id: organization.id },
        select: {
          id: true,
          type: true,
          status: true,
          result: true,
          error_message: true,
          received_at: true,
          processed_at: true,
        },
        orderBy: { received_at: "desc" },
        take: 50,
      }),
      systemPrisma.organizationEntitlementOverride.findMany({
        where: { organization_id: organization.id },
        select: {
          id: true,
          feature_key: true,
          value_boolean: true,
          limit_value: true,
          reason: true,
          expires_at: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      systemPrisma.organizationJob.findMany({
        where: { organization_id: organization.id, type: "billing.reconcile" },
        include: { attempt_runs: { orderBy: { attempt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      systemPrisma.plan.findMany({ where: { status: { in: ["active", "archived"] } }, select: { code: true, name: true, status: true }, orderBy: { name: "asc" } }),
    ]);
    res.json({ organization, billing, events, overrides, jobs, plans });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/organizations/:organizationId/overrides",
  async (req, res, next) => {
    try {
      const payload = z
        .object({
          featureKey: z.string().min(1).max(100),
          valueBoolean: z.boolean().nullable().optional(),
          limitValue: z.number().int().nonnegative().nullable().optional(),
          reason: z.string().min(3).max(500),
          expiresAt: z.coerce.date().nullable().optional(),
        })
        .parse(req.body);
      const created = await systemPrisma.organizationEntitlementOverride.create(
        {
          data: {
            organization_id: req.params.organizationId,
            feature_key: payload.featureKey,
            value_boolean: payload.valueBoolean,
            limit_value: payload.limitValue,
            reason: payload.reason,
            expires_at: payload.expiresAt,
            author_user_id: res.locals.platformUserId,
          },
        },
      );
      await recordAuditEvent({
        organizationId: req.params.organizationId,
        userId: res.locals.platformUserId,
        requestId: String(res.getHeader("X-Request-Id") ?? ""),
        action: "billing.override.created",
        resourceType: "entitlement_override",
        resourceId: created.id,
        metadata: { featureKey: payload.featureKey, reason: payload.reason },
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/organizations/:organizationId/subscription",
  async (req, res, next) => {
    try {
      const payload = z
        .object({
          status: z.enum(SUBSCRIPTION_STATUSES),
          planCode: z.string().min(1).optional(),
        })
        .parse(req.body);
      const plan = payload.planCode
        ? await systemPrisma.plan.findUnique({
            where: { code: payload.planCode },
          })
        : null;
      if (payload.planCode && !plan)
        return res
          .status(404)
          .json({ error: "Forfait introuvable.", code: "NOT_FOUND" });
      const updated = await systemPrisma.subscription.update({
        where: { organization_id: req.params.organizationId },
        data: { status: payload.status, ...(plan ? { plan_id: plan.id } : {}) },
      });
      await recordAuditEvent({
        organizationId: req.params.organizationId,
        userId: res.locals.platformUserId,
        requestId: String(res.getHeader("X-Request-Id") ?? ""),
        action: "billing.subscription.updated",
        resourceType: "subscription",
        resourceId: updated.id,
        metadata: { status: payload.status, planCode: payload.planCode },
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.post("/organizations/:organizationId/resync", async (req, res, next) => {
  try {
    const subscription = await systemPrisma.subscription.findUnique({
      where: { organization_id: req.params.organizationId },
    });
    if (!subscription?.provider)
      return res.status(409).json({
        error: "Aucun fournisseur n’est configuré.",
        code: "BILLING_PROVIDER_NOT_CONFIGURED",
      });
    const job = await enqueueOrganizationJob({
      organizationId: req.params.organizationId,
      type: "billing.reconcile",
      idempotencyKey: `billing-reconcile:${subscription.id}:${Date.now()}`,
      payload: { subscriptionId: subscription.id },
    });
    await recordAuditEvent({
      organizationId: req.params.organizationId,
      userId: res.locals.platformUserId,
      action: "billing.resync.requested",
      resourceType: "job",
      resourceId: job.id,
    });
    res.status(202).json({ jobId: job.id });
  } catch (error) {
    next(error);
  }
});

export default router;

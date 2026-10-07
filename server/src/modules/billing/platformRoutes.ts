import { Router } from "express";
import { z } from "zod";
import { systemPrisma } from "../../db/prisma.js";
import { getServerAuthSessionFromRequest } from "../../services/serverAuth.js";
import { recordAuditEvent } from "../system/audit.js";
import { SUBSCRIPTION_STATUSES } from "./policies.js";
import { getSubscriptionSnapshot } from "./service.js";
import { isPlatformAdministrator } from "./admin.js";
import { enqueueOrganizationJob } from "../system/jobs.js";

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

router.get("/organizations", async (req, res, next) => {
  try {
    const query = String(req.query.q ?? "").trim();
    const organizations = await systemPrisma.organization.findMany({
      where: query
        ? { OR: [{ name: { contains: query } }, { slug: { contains: query } }] }
        : undefined,
      include: { subscriptions: { include: { plan: true } } },
      orderBy: { name: "asc" },
      take: 50,
    });
    res.json(
      organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        subscription: organization.subscriptions[0]
          ? {
              status: organization.subscriptions[0].status,
              planCode: organization.subscriptions[0].plan.code,
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

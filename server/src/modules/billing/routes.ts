import { Router } from "express";
import { getOrganizationId } from "../organizations/context.js";
import { getTenantPrisma } from "../../db/prisma.js";
import { createOrganizationCheckout, createOrganizationPortal, getBillingActions, getSubscriptionSnapshot } from "./service.js";
import { getAuthenticatedAppUser } from "../../services/serverAuth.js";
import { getStripeBillingProvider } from "./stripe.js";
import { z } from "zod";

const router = Router();

router.get("/subscription", async (_req, res, next) => {
  try {
    const organizationId = getOrganizationId();
    const [snapshot, actions] = await Promise.all([getSubscriptionSnapshot(organizationId), getBillingActions(organizationId)]);
    res.json({ ...snapshot, actions });
  } catch (error) {
    next(error);
  }
});

router.get("/events", async (_req, res, next) => {
  try {
    const events = await getTenantPrisma(
      getOrganizationId(),
    ).billingEvent.findMany({
      select: {
        id: true,
        type: true,
        status: true,
        result: true,
        received_at: true,
        processed_at: true,
      },
      orderBy: { received_at: "desc" },
      take: 50,
    });
    res.json(events);
  } catch (error) {
    next(error);
  }
});

export const assertBillingOwner = (user: { permissions: { isOwner: boolean } } | null | undefined) => {
  if (!user?.permissions.isOwner) throw Object.assign(new Error("Seul un propriétaire peut gérer l’abonnement."), { status: 403, code: "OWNER_REQUIRED" });
};

const requireOwner = async (req: Parameters<typeof getAuthenticatedAppUser>[0]) => {
  assertBillingOwner(await getAuthenticatedAppUser(req));
};

router.post("/checkout", async (req, res, next) => {
  try {
    await requireOwner(req);
    const provider = getStripeBillingProvider();
    if (!provider) throw Object.assign(new Error("Stripe test n’est pas configuré."), { status: 409, code: "BILLING_PROVIDER_NOT_CONFIGURED" });
    const { billingPeriod } = z.object({ billingPeriod: z.enum(["monthly", "annual"]) }).parse(req.body);
    res.json({ url: await createOrganizationCheckout(provider, getOrganizationId(), billingPeriod) });
  } catch (error) { next(error); }
});

router.post("/portal", async (req, res, next) => {
  try {
    await requireOwner(req);
    const provider = getStripeBillingProvider();
    if (!provider) throw Object.assign(new Error("Stripe test n’est pas configuré."), { status: 409, code: "BILLING_PROVIDER_NOT_CONFIGURED" });
    res.json({ url: await createOrganizationPortal(provider, getOrganizationId()) });
  } catch (error) { next(error); }
});

export default router;

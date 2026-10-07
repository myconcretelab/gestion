import { Router } from "express";
import { getOrganizationId } from "../organizations/context.js";
import { getTenantPrisma } from "../../db/prisma.js";
import { getSubscriptionSnapshot } from "./service.js";

const router = Router();

router.get("/subscription", async (_req, res, next) => {
  try {
    res.json(await getSubscriptionSnapshot(getOrganizationId()));
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

router.post("/portal", (_req, res) =>
  res.status(404).json({
    error: "Aucun portail de paiement n’est configuré.",
    code: "BILLING_PROVIDER_NOT_CONFIGURED",
  }),
);

export default router;

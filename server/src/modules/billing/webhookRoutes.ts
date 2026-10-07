import type { NextFunction, Request, Response } from "express";
import { handleBillingWebhook } from "./service.js";
import { getStripeBillingProvider } from "./stripe.js";

export const stripeWebhookHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = getStripeBillingProvider();
    if (!provider) return res.status(503).json({ error: "Stripe test n’est pas configuré.", code: "BILLING_PROVIDER_NOT_CONFIGURED" });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Corps Stripe brut requis.", code: "RAW_BODY_REQUIRED" });
    const signature = String(req.headers["stripe-signature"] ?? "");
    const result = await handleBillingWebhook(provider, req.body, signature);
    res.json({ received: true, duplicate: result.duplicate, result: result.result ?? result.event?.result ?? "ignored" });
  } catch (error) {
    next(error);
  }
};

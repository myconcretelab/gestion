import { syncManagedContractPayments } from "../reservationPayments/ledger.js";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import Stripe from "stripe";
import { z } from "zod";
import prisma from "../../db/prisma.js";
import { runWithOrganization } from "../organizations/context.js";
import { bookingStripeConfig } from "./provider.js";
import {
  applyVerifiedSession,
  deliverPaymentNotification,
  publicPaymentStatus,
} from "./service.js";

export const bookingPaymentRouter = Router();
bookingPaymentRouter.post("/payments/status", async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const input = z
      .object({
        payment_id: z.string().min(1).max(100),
        token: z.string().min(40).max(100),
        cancel: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(
      await publicPaymentStatus(input.payment_id, input.token, input.cancel),
    );
  } catch (error) {
    next(error);
  }
});

export const bookingStripeWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const config = bookingStripeConfig();
  if (!config?.webhookSecret)
    return res.status(503).json({ error: "Paiements non configurés." });
  if (!Buffer.isBuffer(req.body))
    return res.status(400).json({ error: "Corps brut requis." });
  let event: Stripe.Event;
  try {
    event = new Stripe(config.secret).webhooks.constructEvent(
      req.body,
      String(req.headers["stripe-signature"] || ""),
      config.webhookSecret,
    );
  } catch {
    return res.status(400).json({ error: "Signature Stripe invalide." });
  }
  if (event.livemode !== config.livemode)
    return res.status(400).json({ error: "Mode Stripe incorrect." });
  if (event.account && event.account !== config.accountId)
    return res.status(400).json({ error: "Compte Stripe incorrect." });
  try {
    await runWithOrganization(
      { organizationId: config.organizationId, source: "job" },
      async () => {
        if (
          [
            "checkout.session.completed",
            "checkout.session.async_payment_succeeded",
            "checkout.session.expired",
          ].includes(event.type)
        ) {
          const session = event.data.object as Stripe.Checkout.Session;
          await applyVerifiedSession(session);
          const id = session.metadata?.booking_payment_id;
          if (id) {
            try {
              await deliverPaymentNotification(id);
            } catch {
              console.error("[booking-payments] Courriel différé", id);
            }
          }
        }
        if (event.type === "charge.refunded") {
          const charge = event.data.object as Stripe.Charge;
          const intent =
            typeof charge.payment_intent === "string"
              ? charge.payment_intent
              : charge.payment_intent?.id;
          if (intent) {
            // Refund events may arrive out of order: the cumulative refunded total only increases.
            await prisma.bookingPayment.updateMany({
              where: {
                stripe_mode: config.mode,
                OR: [
                  { stripe_payment_intent: intent },
                  ...(charge.metadata?.booking_payment_id
                    ? [
                        {
                          id: charge.metadata.booking_payment_id,
                          stripe_payment_intent: null,
                        },
                      ]
                    : []),
                ],
                refunded_amount_cents: { lt: charge.amount_refunded },
              },
              data: {
                refunded_amount_cents: charge.amount_refunded,
                status: charge.refunded ? "refunded" : "partially_refunded",
                notification_sent_at: null,
              },
            });
            const refundedPayments = await prisma.bookingPayment.findMany({
              where: { stripe_mode: config.mode, stripe_payment_intent: intent }, include: { booking_request: true },
            });
            for (const payment of refundedPayments) {
              const reservationId = payment.reservation_id || payment.booking_request?.approved_reservation_id;
              if (reservationId) await syncManagedContractPayments(reservationId);
            }
          }
        }
      },
    );
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};

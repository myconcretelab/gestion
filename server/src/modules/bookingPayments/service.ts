import { sendBookingPaymentEmails } from "../../services/bookingRequestEmail.js";
import {
  applyReservationLinkSession,
  sendReservationLinkReceipt,
} from "./reservationLinks.js";
import crypto from "node:crypto";
import type Stripe from "stripe";
import prisma from "../../db/prisma.js";
import {
  getOrganizationId,
  runWithOrganization,
} from "../organizations/context.js";
import { bookingStripeConfig, getBookingStripe } from "./provider.js";
import { assertTransactionAvailability, lockBookingGite } from "./locking.js";
import { bookingReservationData } from "./reservation.js";
import {
  BookedValidationError,
  hydrateBookingRequest,
  type BookingQuote,
} from "../../services/booked.js";

export { cents } from "./money.js";
import { cents } from "./money.js";
export const paymentAmounts = (
  quote: BookingQuote,
  purpose: "deposit" | "full",
) => {
  const total = cents(quote.total_global);
  const amount = purpose === "deposit" ? cents(quote.arrhes_theoriques) : total;
  if (amount < 50 || amount > total)
    throw Object.assign(
      new Error(
        "Ce montant ne permet pas un paiement par carte. Choisissez le paiement sur place.",
      ),
      { statusCode: 400, code: "invalid_payment_amount" },
    );
  return { amount, total };
};
const tokenHash = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
export const prepareBookingPayment = (
  quote: BookingQuote,
  purpose: "deposit" | "full",
) => {
  const { amount, total } = paymentAmounts(quote, purpose);
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + 31 * 60;
  return {
    token,
    data: {
      organization_id: getOrganizationId(),
      purpose,
      amount_cents: amount,
      total_cents: total,
      access_token_hash: tokenHash(token),
      expires_at: new Date(expires * 1000),
    },
  };
};
export const createBookingCheckout = async (
  requestId: string,
  token: string,
) => {
  const { stripe, config } = await getBookingStripe();
  const request = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { gite: true, payment: true },
  });
  const payment = request.payment;
  if (!payment || payment.access_token_hash !== tokenHash(token))
    throw new Error("Paiement introuvable.");
  const quote = hydrateBookingRequest(request).pricing_snapshot as BookingQuote;
  const purpose = payment.purpose;
  const amount = payment.amount_cents;
  const expires = Math.floor(payment.expires_at.getTime() / 1000);
  const resultUrl = (result: string) =>
    `${config.returnUrl}#booked_payment=${encodeURIComponent(payment.id)}&token=${token}&result=${result}`;
  // Persist the intent first. A timed-out create call can still have created Checkout;
  // the same idempotency key is then used by reconciliation, never another charge.
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      allowed_payment_method_types: ["card"],
      locale: "fr",
      customer_email: request.email || undefined,
      client_reference_id: payment.id,
      metadata: {
        booking_payment_id: payment.id,
        organization_id: getOrganizationId(),
      },
      payment_intent_data: { metadata: { booking_payment_id: payment.id } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: amount,
            product_data: {
              name: `${purpose === "deposit" ? "Arrhes" : "Séjour complet"} — ${request.gite.nom}`,
              description: `${request.date_entree.toISOString().slice(0, 10)} au ${request.date_sortie.toISOString().slice(0, 10)} · ${quote.nb_nuits} nuits · options incluses dans le total du séjour`,
            },
          },
        },
      ],
      expires_at: expires,
      success_url: resultUrl("success"),
      cancel_url: resultUrl("cancel"),
    },
    { idempotencyKey: `booking-checkout-${payment.id}` },
  );
  await prisma.bookingPayment.update({
    where: { id: payment.id },
    data: { stripe_session_id: session.id },
  });
  if (!session.url || !session.url.startsWith("https://checkout.stripe.com/"))
    throw new Error("URL Stripe invalide.");
  return {
    checkout_url: session.url,
    payment_id: payment.id,
    expires_at: payment.expires_at,
  };
};

export const applyVerifiedSession = async (
  session: Stripe.Checkout.Session,
) => {
  // Called only with an SDK-verified webhook or an authenticated Stripe API response.
  if (session.livemode || session.mode !== "payment") return "ignored";
  const paymentId = session.metadata?.booking_payment_id;
  if (!paymentId || session.metadata?.organization_id !== getOrganizationId())
    return "ignored";
  const payment = await prisma.bookingPayment.findUnique({
    where: { id: paymentId },
    include: { booking_request: true },
  });
  if (
    !payment ||
    (payment.stripe_session_id && payment.stripe_session_id !== session.id) ||
    session.client_reference_id !== payment.id
  )
    return "ignored";
  if (payment.reservation_id)
    return applyReservationLinkSession(session, payment.id);
  if (!payment.booking_request) return "ignored";
  if (session.payment_status !== "paid") {
    if (session.status === "expired") {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.bookingPayment.updateMany({
          where: { id: payment.id, status: "pending" },
          data: { status: "expired", stripe_session_id: session.id },
        });
        if (changed.count)
          await tx.bookingRequest.updateMany({
            where: { id: payment.booking_request_id!, status: "pending" },
            data: { status: "expired", decided_at: new Date() },
          });
      });
    }
    return "unpaid";
  }
  const intent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!intent) return "ignored";
  return prisma.$transaction(async (tx) => {
    await lockBookingGite(tx, payment.booking_request!.gite_id);
    const current = await tx.bookingPayment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { booking_request: true },
    });
    if (current.paid_at) return "duplicate";
    const request = current.booking_request;
    if (!request) return "ignored";
    let review =
      session.currency !== current.currency ||
      session.amount_total !== current.amount_cents
        ? `Montant ou devise Stripe différent du devis : ${session.amount_total} centimes ${session.currency || "inconnue"}.`
        : null;
    if (
      !["pending", "expired"].includes(request.status) ||
      request.approved_reservation_id
    )
      review = "La demande a déjà été traitée.";
    if (current.refunded_amount_cents > 0)
      review =
        "Ce paiement a déjà fait l’objet d’un remboursement ; ne pas confirmer automatiquement.";
    if (!review) {
      try {
        await assertTransactionAvailability(tx, request);
      } catch (error) {
        if (!(error instanceof BookedValidationError)) throw error;
        review =
          "Paiement reçu après réattribution des dates : vérification et remboursement éventuel nécessaires.";
      }
    }
    await tx.bookingPayment.update({
      where: { id: current.id },
      data: {
        stripe_session_id: session.id,
        stripe_payment_intent: intent,
        paid_amount_cents: session.amount_total || 0,
        paid_at: new Date(),
        status: review ? "requires_review" : "paid",
        review_reason: review,
      },
    });
    if (review) return "requires_review";
    const reservation = await tx.reservation.create({
      data: bookingReservationData(request),
    });
    await tx.bookingRequest.update({
      where: { id: request.id },
      data: {
        status: "approved",
        approved_reservation_id: reservation.id,
        decided_at: new Date(),
        decision_note: `Confirmation automatique après paiement Stripe (${current.purpose === "deposit" ? "arrhes" : "totalité"}).`,
      },
    });
    return "confirmed";
  });
};

export const deliverPaymentNotification = async (id: string) => {
  const lease = await prisma.bookingPayment.updateMany({
    where: {
      id,
      status: {
        in: ["paid", "requires_review", "refunded", "partially_refunded"],
      },
      notification_sent_at: null,
      OR: [
        { notification_lease_at: null },
        { notification_lease_at: { lt: new Date(Date.now() - 5 * 60_000) } },
      ],
    },
    data: { notification_lease_at: new Date() },
  });
  if (!lease.count) return;
  try {
    const payment = await prisma.bookingPayment.findUniqueOrThrow({
      where: { id },
      include: {
        booking_request: { include: { gite: true } },
        reservation: { include: { gite: true } },
        payment_link: true,
      },
    });
    if (payment.reservation_id && payment.reservation) {
      await sendReservationLinkReceipt(payment);
      await prisma.bookingPayment.update({
        where: { id },
        data: { notification_sent_at: new Date(), notification_lease_at: null },
      });
      return;
    }
    if (!payment.booking_request)
      throw new Error("Demande de paiement introuvable.");
    const request = hydrateBookingRequest(payment.booking_request);
    await sendBookingPaymentEmails(request, payment);
    await prisma.bookingPayment.update({
      where: { id },
      data: { notification_sent_at: new Date(), notification_lease_at: null },
    });
  } catch (error) {
    await prisma.bookingPayment.updateMany({
      where: { id },
      data: { notification_lease_at: null },
    });
    throw error;
  }
};

export const refreshPayment = async (id: string) => {
  let payment = await prisma.bookingPayment.findUniqueOrThrow({
    where: { id },
  });
  if (
    ["pending", "creating"].includes(payment.status) &&
    !payment.stripe_session_id
  ) {
    const { stripe } = await getBookingStripe();
    let found = false;
    for await (const session of stripe.checkout.sessions.list({
      created: { gte: Math.floor(payment.createdAt.getTime() / 1000) - 5 },
      limit: 100,
    })) {
      if (
        session.client_reference_id === payment.id &&
        session.metadata?.booking_payment_id === payment.id
      ) {
        await prisma.bookingPayment.updateMany({
          where: {
            id,
            paid_at: null,
            status: { in: ["pending", "creating"] },
            stripe_session_id: null,
          },
          data: {
            stripe_session_id: session.id,
            ...(payment.status === "creating" ? { status: "pending" } : {}),
          },
        });
        await applyVerifiedSession(session);
        found = true;
        break;
      }
    }
    if (!found && payment.expires_at.getTime() + 180_000 < Date.now()) {
      await prisma.$transaction(async (tx) => {
        await tx.bookingPayment.updateMany({
          where: {
            id,
            status: { in: ["pending", "creating"] },
            stripe_session_id: null,
          },
          data: { status: "expired" },
        });
        if (payment.booking_request_id)
          await tx.bookingRequest.updateMany({
            where: { id: payment.booking_request_id!, status: "pending" },
            data: { status: "expired" },
          });
      });
    }
    payment = await prisma.bookingPayment.findUniqueOrThrow({ where: { id } });
  }
  if (payment.status === "pending" && payment.stripe_session_id) {
    const { stripe } = await getBookingStripe();
    await applyVerifiedSession(
      await stripe.checkout.sessions.retrieve(payment.stripe_session_id),
    );
    await prisma.bookingPayment.updateMany({
      where: { id, status: "pending" },
      data: { updatedAt: new Date() },
    });
  }
  // Notification failures never turn a received payment into a failed checkout.
  try {
    await deliverPaymentNotification(id);
  } catch {
    console.error(
      "[booking-payments] Courriel en attente de nouvelle tentative",
      id,
    );
  }
};
export const publicPaymentStatus = async (
  id: string,
  token: string,
  cancel = false,
) => {
  const payment = await prisma.bookingPayment.findUnique({
    where: { id, access_token_hash: tokenHash(token) },
  });
  if (!payment)
    throw Object.assign(new Error("Paiement introuvable."), {
      statusCode: 404,
    });
  if (cancel && payment.status === "pending" && payment.stripe_session_id) {
    const { stripe } = await getBookingStripe();
    // Expire Stripe first. Returning via cancel_url alone never releases a payable session.
    try {
      await applyVerifiedSession(
        await stripe.checkout.sessions.expire(payment.stripe_session_id),
      );
    } catch {
      await refreshPayment(id);
    }
  } else await refreshPayment(id);
  const updated = await prisma.bookingPayment.findUniqueOrThrow({
    where: { id },
    include: { booking_request: true },
  });
  return {
    status: updated.status,
    confirmed:
      updated.booking_request?.status === "approved" &&
      updated.status === "paid",
    purpose: updated.purpose,
    amount_paid: updated.paid_amount_cents / 100,
    total: updated.total_cents / 100,
    remaining:
      Math.max(0, updated.total_cents - updated.paid_amount_cents) / 100,
    reference: updated.booking_request_id,
  };
};

export const reconcileBookingPayments = async () => {
  const config = bookingStripeConfig();
  if (!config) return;
  await runWithOrganization(
    { organizationId: config.organizationId, source: "job" },
    async () => {
      const rows = await prisma.bookingPayment.findMany({
        where: {
          OR: [
            { status: { in: ["pending", "creating"] } },
            {
              status: {
                in: [
                  "paid",
                  "requires_review",
                  "refunded",
                  "partially_refunded",
                ],
              },
              notification_sent_at: null,
            },
          ],
        },
        orderBy: { updatedAt: "asc" },
        take: 25,
      });
      for (const row of rows) {
        try {
          await refreshPayment(row.id);
        } catch {
          console.error("[booking-payments] Rapprochement à réessayer", row.id);
        }
      }
    },
  );
};
let timer: NodeJS.Timeout | undefined;
export const startBookingPaymentsWorker = () => {
  if (timer || !bookingStripeConfig()) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileBookingPayments();
    } finally {
      running = false;
    }
  };
  void tick().catch(() =>
    console.error("[booking-payments] Rapprochement indisponible"),
  );
  timer = setInterval(
    () =>
      void tick().catch(() =>
        console.error("[booking-payments] Rapprochement indisponible"),
      ),
    60_000,
  );
  timer.unref();
};

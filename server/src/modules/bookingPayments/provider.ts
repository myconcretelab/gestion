import Stripe from "stripe";
import { getOrganizationId } from "../organizations/context.js";

// Guest receipts use their own merchant account; never reuse SaaS subscription keys.
export const bookingStripeConfig = () => {
  const secret = process.env.BOOKING_STRIPE_SECRET_KEY || "";
  const organizationId = process.env.BOOKING_STRIPE_ORGANIZATION_ID || "";
  const accountId = process.env.BOOKING_STRIPE_ACCOUNT_ID || "";
  const returnUrl = process.env.BOOKING_STRIPE_RETURN_URL || "";
  const webhookSecret = process.env.BOOKING_STRIPE_WEBHOOK_SECRET || "";
  if (
    !secret.startsWith("sk_test_") ||
    !organizationId ||
    !accountId ||
    !returnUrl
  )
    return null;
  if (
    process.env.NODE_ENV === "production" &&
    !webhookSecret.startsWith("whsec_")
  )
    return null;
  try {
    const url = new URL(returnUrl);
    if (url.username || url.password || url.hash || url.search) return null;
    if (
      url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        (url.hostname.endsWith(".local") ||
          ["localhost", "127.0.0.1"].includes(url.hostname))
      )
    )
      return null;
  } catch {
    return null;
  }
  return { secret, organizationId, accountId, returnUrl, webhookSecret };
};
export const bookingPaymentsEnabled = () =>
  bookingStripeConfig()?.organizationId === getOrganizationId();
let cached: { secret: string; stripe: Stripe; accountId: string } | undefined;
export const getBookingStripe = async () => {
  const config = bookingStripeConfig();
  if (!config || config.organizationId !== getOrganizationId()) {
    throw Object.assign(
      new Error(
        "Le paiement en ligne n’est pas disponible actuellement. Choisissez le paiement sur place.",
      ),
      { statusCode: 503, code: "booking_payments_disabled" },
    );
  }
  if (
    !cached ||
    cached.secret !== config.secret ||
    cached.accountId !== config.accountId
  ) {
    const stripe = new Stripe(config.secret, {
      maxNetworkRetries: 2,
      timeout: 15_000,
    });
    const account = await stripe.accounts.retrieve(null);
    if (account.id !== config.accountId)
      throw new Error("Compte Stripe des réservations incorrect.");
    cached = { secret: config.secret, stripe, accountId: config.accountId };
  }
  return { stripe: cached.stripe, config };
};

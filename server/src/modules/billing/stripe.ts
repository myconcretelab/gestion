import Stripe from "stripe";
import { env } from "../../config/env.js";
import type { BillingProvider, CreateCheckoutInput, VerifiedBillingEvent } from "./provider.js";

type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};
const idOf = (value: unknown) => typeof value === "string" ? value : typeof asRecord(value).id === "string" ? String(asRecord(value).id) : undefined;
const dateOf = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
const first = (value: unknown) => Array.isArray(value) ? value[0] : undefined;

const stripeStatus = (value: unknown): VerifiedBillingEvent["subscriptionStatus"] => {
  if (value === "trialing") return "trialing";
  if (value === "active") return "active";
  if (value === "past_due" || value === "incomplete") return "past_due";
  if (value === "unpaid" || value === "paused") return "suspended";
  if (value === "canceled" || value === "incomplete_expired") return "cancelled";
  return undefined;
};

const subscriptionDetails = (object: UnknownRecord) => {
  const items = asRecord(object.items);
  const item = asRecord(first(items.data));
  const price = asRecord(item.price);
  return {
    providerSubscriptionId: idOf(object.id),
    providerCustomerId: idOf(object.customer),
    providerPriceId: idOf(price),
    providerProductId: idOf(price.product),
    subscriptionStatus: stripeStatus(object.status),
    trialStart: dateOf(object.trial_start),
    trialEnd: dateOf(object.trial_end),
    currentPeriodStart: dateOf(object.current_period_start ?? item.current_period_start),
    currentPeriodEnd: dateOf(object.current_period_end ?? item.current_period_end),
    cancelAtPeriodEnd: object.cancel_at_period_end === true,
  };
};

const invoiceSubscriptionId = (object: UnknownRecord) => {
  const direct = idOf(object.subscription);
  if (direct) return direct;
  const parent = asRecord(object.parent);
  return idOf(asRecord(parent.subscription_details).subscription);
};

export class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe";

  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  async createCustomer(input: { name: string; email?: string; organizationReference: string; idempotencyKey: string }) {
    const customer = await this.stripe.customers.create({
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      metadata: { application: "gestion-app", organization_reference: input.organizationReference },
    }, { idempotencyKey: input.idempotencyKey });
    return customer.id;
  }

  async createCheckoutLink(input: CreateCheckoutInput) {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.providerCustomerId,
      line_items: [{ price: input.providerPriceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.organizationReference,
      subscription_data: { metadata: { application: "gestion-app" } },
      allow_promotion_codes: true,
    }, { idempotencyKey: input.idempotencyKey });
    if (!session.url) throw new Error("Stripe n’a pas retourné d’URL de Checkout.");
    return session.url;
  }

  async createPortalLink(providerCustomerId: string, returnUrl: string) {
    const session = await this.stripe.billingPortal.sessions.create({ customer: providerCustomerId, return_url: returnUrl });
    return session.url;
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<VerifiedBillingEvent> {
    if (!this.webhookSecret) throw Object.assign(new Error("Secret de webhook Stripe non configuré."), { status: 503, code: "BILLING_PROVIDER_NOT_CONFIGURED" });
    let event: Stripe.Event;
    try {
      event = await this.stripe.webhooks.constructEventAsync(rawBody, signature, this.webhookSecret);
    } catch {
      throw Object.assign(new Error("Signature Stripe invalide."), { status: 400, code: "INVALID_WEBHOOK_SIGNATURE" });
    }
    const object = asRecord(event.data.object);
    let details: Partial<VerifiedBillingEvent> = {};
    if (event.type.startsWith("customer.subscription.")) details = subscriptionDetails(object);
    else if (event.type.startsWith("invoice.")) details = {
      providerSubscriptionId: invoiceSubscriptionId(object),
      providerCustomerId: idOf(object.customer),
      subscriptionStatus: event.type === "invoice.payment_failed" ? "past_due" : event.type === "invoice.paid" || event.type === "invoice.payment_succeeded" ? "active" : undefined,
    };
    else if (event.type === "checkout.session.completed") details = {
      providerSubscriptionId: idOf(object.subscription),
      providerCustomerId: idOf(object.customer),
    };
    return {
      providerEventId: event.id,
      idempotencyKey: event.id,
      type: event.type,
      occurredAt: new Date(event.created * 1000),
      version: event.created,
      reference: idOf(object.id),
      ...details,
    };
  }

  async reconcile(providerSubscriptionId: string): Promise<VerifiedBillingEvent[]> {
    const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId, { expand: ["items.data.price.product"] });
    const details = subscriptionDetails(asRecord(subscription));
    const reconciledAt = new Date();
    const hourBucket = Math.floor(reconciledAt.getTime() / 3_600_000);
    const marker = `${subscription.status}:${details.currentPeriodEnd?.getTime() ?? "none"}:${details.providerPriceId ?? "none"}:${hourBucket}`;
    return [{
      providerEventId: `reconcile:${subscription.id}:${marker}`,
      idempotencyKey: `reconcile:${subscription.id}:${marker}`,
      type: "subscription.reconciled",
      occurredAt: reconciledAt,
      reference: subscription.id,
      ...details,
    }];
  }
}

let provider: StripeBillingProvider | null | undefined;
export const getStripeBillingProvider = () => {
  if (provider !== undefined) return provider;
  provider = env.STRIPE_SECRET_KEY
    ? new StripeBillingProvider(new Stripe(env.STRIPE_SECRET_KEY), env.STRIPE_WEBHOOK_SECRET)
    : null;
  return provider;
};

export const resetStripeBillingProviderForTests = () => { provider = undefined; };

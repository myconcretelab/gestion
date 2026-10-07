export type VerifiedBillingEvent = {
  providerEventId: string;
  idempotencyKey: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  providerPriceId?: string;
  providerProductId?: string;
  type: string;
  occurredAt: Date;
  version?: number;
  reference?: string;
  subscriptionStatus?: "trialing" | "active" | "past_due" | "grace_period" | "suspended" | "cancelled";
  trialStart?: Date | null;
  trialEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
};

export type CreateCheckoutInput = {
  providerCustomerId: string;
  providerPriceId: string;
  successUrl: string;
  cancelUrl: string;
  organizationReference: string;
  idempotencyKey: string;
};

export interface BillingProvider {
  readonly name: string;
  createCustomer(input: { name: string; email?: string; organizationReference: string; idempotencyKey: string }): Promise<string>;
  createCheckoutLink(input: CreateCheckoutInput): Promise<string>;
  verifyWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<VerifiedBillingEvent>;
  createPortalLink(
    providerCustomerId: string,
    returnUrl: string,
  ): Promise<string>;
  reconcile(providerSubscriptionId: string): Promise<VerifiedBillingEvent[]>;
}

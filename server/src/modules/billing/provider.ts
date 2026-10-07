export type VerifiedBillingEvent = {
  providerEventId: string;
  idempotencyKey: string;
  providerSubscriptionId: string;
  type: string;
  occurredAt: Date;
  version?: number;
  reference?: string;
};

export interface BillingProvider {
  readonly name: string;
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

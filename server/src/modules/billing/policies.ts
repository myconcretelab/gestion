export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "suspended",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptionCapabilities: Record<
  SubscriptionStatus,
  { read: boolean; export: boolean; write: boolean; warning: boolean }
> = {
  trialing: { read: true, export: true, write: true, warning: false },
  active: { read: true, export: true, write: true, warning: false },
  past_due: { read: true, export: true, write: true, warning: true },
  grace_period: { read: true, export: true, write: true, warning: true },
  suspended: { read: true, export: true, write: false, warning: true },
  cancelled: { read: true, export: true, write: false, warning: true },
};

export const isWriteAllowed = (status: SubscriptionStatus) =>
  subscriptionCapabilities[status].write;

export const computeEffectiveFeature = (input: {
  planAllows: boolean;
  organizationEnabled: boolean;
  subscriptionAllows: boolean;
  override?: boolean | null;
}) =>
  (input.override ?? input.planAllows) &&
  input.organizationEnabled &&
  input.subscriptionAllows;

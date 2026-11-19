import { z } from "zod";

export const ownerNotificationEvents = [
  "booking_requested",
  "booking_confirmed",
  "payment_received",
  "payment_review",
  "payment_refunded",
  "task_completed",
  "cleaning_completed",
  "gite_checked",
  "cleaning_check_reminder",
  "contract_received",
  "contract_overdue",
  "invoice_overdue",
] as const;

export const ownerNotificationEventSchema = z.enum(ownerNotificationEvents);
export type OwnerNotificationEvent = z.infer<
  typeof ownerNotificationEventSchema
>;

export const telegramDeliverySchema = z.enum(["off", "fallback", "always"]);
export const ownerNotificationRuleSchema = z.object({
  push: z.boolean(),
  telegram: telegramDeliverySchema,
  email: z.boolean(),
});
export type OwnerNotificationRule = z.infer<typeof ownerNotificationRuleSchema>;

export const ownerNotificationSettingsSchema = z.object({
  rules: z
    .partialRecord(
      ownerNotificationEventSchema,
      ownerNotificationRuleSchema.partial(),
    )
    .default({}),
  taskOverrides: z
    .record(z.string().min(1).max(160), ownerNotificationRuleSchema)
    .default({}),
  cleaningGiteIds: z.array(z.string().min(1).max(160)).optional(),
  cleaningScope: z.enum(["selected", "all"]).default("selected"),
});
export type OwnerNotificationSettings = z.infer<
  typeof ownerNotificationSettingsSchema
>;

export const ownerNotificationEmailsSchema = z
  .array(z.email().max(254))
  .max(20);

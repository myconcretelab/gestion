import { z } from "zod";

export const organizationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^org_[a-z0-9_-]+$/i);
export type OrganizationId = z.infer<typeof organizationIdSchema>;

export const membershipStatusSchema = z.enum(["invited", "active", "disabled"]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const moduleIds = [
  "reservations",
  "contracts",
  "invoices",
  "finances",
  "personal_expenses",
  "worker_planning",
  "web_publication",
  "ical",
  "pump_airbnb",
  "smart_life",
  "sms",
  "telegram",
  "daily_email",
] as const;
export const moduleIdSchema = z.enum(moduleIds);
export type ModuleId = z.infer<typeof moduleIdSchema>;

export const businessPermissions = [
  "today:read",
  "today:write",
  "reservations:read",
  "reservations:write",
  "booking_requests:read",
  "booking_requests:write",
  "gites:read",
  "gites:write",
  "rates:read",
  "rates:write",
  "calendar:read",
  "calendar:write",
  "contracts:read",
  "contracts:write",
  "contracts:share",
  "invoices:read",
  "invoices:write",
  "invoices:share",
  "finances:read",
  "finances:write",
  "declarations:read",
  "declarations:write",
  "planning:read",
  "planning:write",
  "statistics:read",
  "users:read",
  "users:manage",
  "settings:read",
  "settings:write",
  "integrations:manage",
] as const;
export const businessPermissionSchema = z.enum(businessPermissions);
export type BusinessPermission = z.infer<typeof businessPermissionSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const organizationSummarySchema = z.object({
  id: organizationIdSchema,
  slug: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  status: z.string(),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

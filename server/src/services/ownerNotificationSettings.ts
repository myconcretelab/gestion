import {
  ownerNotificationEmailsSchema,
  ownerNotificationEvents,
  ownerNotificationSettingsSchema,
  type OwnerNotificationEvent,
  type OwnerNotificationRule,
  type OwnerNotificationSettings,
} from "@contrats/shared";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";
import { getOrganizationId } from "./organizationContext.js";
import {
  readTelegramNotificationConfig,
  type TelegramNotificationConfig,
} from "./telegramNotifications.js";
import { normalizeAppUserRoles } from "./appUsers.js";

const RULES_KEY = "owner-notifications.rules";
const EMAILS_KEY = "owner-notifications.emails";

const settingWhere = (key: string) => ({
  organization_id_key: { organization_id: getOrganizationId(), key },
});

const readSetting = async (key: string) => {
  const row = await prisma.organizationRuntimeSetting.findUnique({
    where: settingWhere(key),
  });
  return fromJsonString<unknown>(row?.value_json, undefined);
};

const saveSetting = async (key: string, value: unknown) => {
  const value_json = encodeJsonField(value);
  await prisma.organizationRuntimeSetting.upsert({
    where: settingWhere(key),
    create: { ...settingWhere(key).organization_id_key, value_json },
    update: { value_json },
  });
};

export const readOwnerNotificationSettings = async () =>
  ownerNotificationSettingsSchema.parse((await readSetting(RULES_KEY)) ?? {});

export const saveOwnerNotificationSettings = (
  settings: OwnerNotificationSettings,
) => saveSetting(RULES_KEY, settings);

export const readOwnerNotificationEmails = async () =>
  ownerNotificationEmailsSchema.parse((await readSetting(EMAILS_KEY)) ?? []);

export const uniqueNotificationEmails = (emails: string[]) => [
  ...new Map(emails.map((email) => [email.toLowerCase(), email])).values(),
];

export const saveOwnerNotificationEmails = (emails: string[]) =>
  saveSetting(EMAILS_KEY, uniqueNotificationEmails(emails));

export type OwnerNotificationContext = {
  taskTemplateId?: string | null;
  cleaningSelected?: boolean;
  propertyId?: string;
  automaticConfirmation?: boolean;
};

const scheduledEvents = new Set<OwnerNotificationEvent>([
  "contract_overdue",
  "invoice_overdue",
  "cleaning_check_reminder",
]);

export const resolveOwnerNotificationRule = (
  event: OwnerNotificationEvent,
  settings: OwnerNotificationSettings,
  telegram: TelegramNotificationConfig,
  context: OwnerNotificationContext = {},
): OwnerNotificationRule => {
  const legacyEvents: Partial<Record<OwnerNotificationEvent, boolean>> = {
    booking_requested: telegram.notify_booking_request_created,
    booking_confirmed: telegram.notify_booking_request_approved,
    payment_received: telegram.notify_booking_request_approved,
    payment_review: telegram.notify_booking_request_approved,
    payment_refunded: telegram.notify_booking_request_approved,
    cleaning_completed: true,
    gite_checked: telegram.notify_gite_checked,
    cleaning_check_reminder: telegram.notify_cleaning_check_reminder,
    contract_overdue: telegram.notify_contract_return_overdue,
    invoice_overdue: telegram.notify_invoice_payment_overdue,
  };
  const legacy = Boolean(
    telegram.enabled &&
    legacyEvents[event] &&
    (env.MULTITENANT_AUTOMATION_ENABLED || !scheduledEvents.has(event)),
  );
  const email =
    event === "booking_requested" ||
    (event === "booking_confirmed" && Boolean(context.automaticConfirmation)) ||
    event === "payment_received" ||
    event === "payment_review" ||
    event === "payment_refunded";
  const rule: OwnerNotificationRule = {
    push: legacy,
    telegram: legacy ? "fallback" : "off",
    email,
    ...settings.rules[event],
  };
  const cleaningSelected =
    settings.cleaningGiteIds && context.propertyId
      ? settings.cleaningGiteIds.includes(context.propertyId)
      : context.cleaningSelected;
  if (
    event === "cleaning_completed" &&
    settings.cleaningScope === "selected" &&
    cleaningSelected === false
  ) {
    return { push: false, telegram: "off", email: false };
  }
  if (event === "task_completed" && context.taskTemplateId) {
    return { ...rule, ...settings.taskOverrides[context.taskTemplateId] };
  }
  return rule;
};

export const ownerNotificationDefaults = (
  telegram: TelegramNotificationConfig,
) =>
  Object.fromEntries(
    ownerNotificationEvents.map((event) => [
      event,
      resolveOwnerNotificationRule(
        event,
        ownerNotificationSettingsSchema.parse({}),
        telegram,
      ),
    ]),
  ) as Record<OwnerNotificationEvent, OwnerNotificationRule>;

export const preserveOwnerNotificationRules = async (
  telegram: TelegramNotificationConfig,
) => {
  const settings = await readOwnerNotificationSettings();
  const defaults = ownerNotificationDefaults(telegram);
  for (const event of ownerNotificationEvents) {
    settings.rules[event] = {
      push: defaults[event].push,
      telegram: defaults[event].telegram,
      ...settings.rules[event],
    };
  }
  await saveOwnerNotificationSettings(settings);
};

export const bookingPaymentOwnerEvent = (
  payment: { status: string; refunded_amount_cents: number },
  existingReservation: boolean,
): OwnerNotificationEvent => {
  if (payment.status === "requires_review") return "payment_review";
  if (payment.refunded_amount_cents > 0) return "payment_refunded";
  return existingReservation ? "payment_received" : "booking_confirmed";
};

export const resolveOwnerNotificationEmails = async (
  propertyEmail?: string | null,
) => {
  const configured = await readOwnerNotificationEmails();
  if (configured.length) return configured;
  if (propertyEmail?.trim()) return [propertyEmail.trim()];
  const users = await prisma.appUser.findMany({
    where: { is_active: true, email: { not: null } },
    select: { email: true, roles: true, is_owner: true, status: true },
  });
  return uniqueNotificationEmails(
    users.flatMap((user) =>
      user.email?.trim() &&
      normalizeAppUserRoles(user.roles, {
        isOwner: user.is_owner,
        status: user.status,
      }).includes("owner")
        ? [user.email.trim()]
        : [],
    ),
  );
};

export const legacyBookingRequestEmail = (propertyEmail?: string | null) =>
  propertyEmail?.trim() || env.SMTP_REPLY_TO.trim() || env.SMTP_FROM.trim();

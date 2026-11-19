import crypto from "node:crypto";
import { z } from "zod";
import prisma from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { hydrateBookingRequest } from "../../services/booked.js";
import {
  buildBookingPaymentTelegramMessage,
  readTelegramNotificationConfig,
  resolveTelegramNotificationRecipients,
  sendTelegramMessage,
} from "../../services/telegramNotifications.js";
import {
  bookingPaymentOwnerEvent,
  readOwnerNotificationSettings,
} from "../../services/ownerNotificationSettings.js";
import {
  enqueueOwnerNotification,
  paymentNotificationState,
} from "../../services/ownerNotifications.js";
import { getOrganizationId } from "../organizations/context.js";
import {
  enqueueOrganizationJob,
  runOrganizationJobBatch,
  type OrganizationJobHandler,
} from "../system/jobs.js";
import { bookingStripeConfig } from "./provider.js";
import { buildReservationLinkReceipt } from "./reservationLinks.js";

const JOB_TYPE = "booking.telegram.payment";
const jobPayload = z.object({
  paymentId: z.string().min(1),
  chatId: z.string().min(1),
  state: z.string().min(1),
});
type PaymentEvent = {
  id: string;
  reservation_id?: string | null;
  status: string;
  paid_amount_cents: number;
  refunded_amount_cents: number;
};
// Each recipient has an independent retry record. An unavailable bot does not
// resend successful emails or notifications to other recipients.
export const queueBookingPaymentTelegram = async (payment: PaymentEvent) => {
  if (
    !["paid", "requires_review", "refunded", "partially_refunded"].includes(
      payment.status,
    )
  )
    return;
  const settings = await readOwnerNotificationSettings();
  const event = bookingPaymentOwnerEvent(
    payment,
    Boolean(payment.reservation_id),
  );
  const override = settings.rules[event];
  if (override?.push !== undefined || override?.telegram !== undefined) {
    const row = await loadPayment(payment.id);
    const content = row && (await getPaymentContent(row));
    if (!content || !row) return;
    const state = paymentNotificationState(payment);
    await enqueueOwnerNotification({
      event,
      key: `payment:${payment.id}:${state}`,
      message: buildBookingPaymentTelegramMessage(
        content.payload,
        content.paymentInfo,
        Boolean(row.reservation_id),
      ),
      emailManagedByBooking: true,
      payment: { id: payment.id, state },
    });
    return;
  }
  const config = readTelegramNotificationConfig();
  if (
    !config.enabled ||
    !config.notify_booking_request_approved ||
    !config.bot_token
  )
    return;
  for (const chatId of await resolveTelegramNotificationRecipients(config)) {
    const recipientKey = crypto
      .createHash("sha256")
      .update(chatId)
      .digest("hex");
    await enqueueOrganizationJob({
      organizationId: getOrganizationId(),
      type: JOB_TYPE,
      payload: {
        paymentId: payment.id,
        chatId,
        state: paymentNotificationState(payment),
      },
      idempotencyKey: `${JOB_TYPE}:${payment.id}:${paymentNotificationState(payment)}:${recipientKey}`,
    });
  }
};

const loadPayment = (id: string) =>
  prisma.bookingPayment.findUnique({
    where: { id },
    include: {
      booking_request: { include: { gite: true } },
      reservation: { include: { gite: true } },
      payment_link: true,
    },
  });

const getPaymentContent = async (
  payment: NonNullable<Awaited<ReturnType<typeof loadPayment>>>,
) => {
  if (payment.reservation_id) return buildReservationLinkReceipt(payment);
  if (
    !payment.booking_request ||
    (payment.status === "paid" && payment.booking_request.status !== "approved")
  ) {
    return null;
  }
  return {
    payload: hydrateBookingRequest(payment.booking_request),
    paymentInfo: payment,
  };
};

const deliver: OrganizationJobHandler = async (job) => {
  const input = jobPayload.parse(
    typeof job.payload_json === "string"
      ? JSON.parse(job.payload_json)
      : job.payload_json,
  );
  const config = readTelegramNotificationConfig();
  if (
    !config.enabled ||
    !config.notify_booking_request_approved ||
    !config.bot_token
  )
    return { skipped: "disabled" };
  if (
    !(await resolveTelegramNotificationRecipients(config)).includes(
      input.chatId,
    )
  )
    return { skipped: "recipient_removed" };
  const payment = await loadPayment(input.paymentId);
  if (
    !payment ||
    payment.stripe_mode !== bookingStripeConfig()?.mode ||
    paymentNotificationState(payment) !== input.state
  )
    return { skipped: "superseded" };
  const existing = Boolean(payment.reservation_id);
  const content = await getPaymentContent(payment);
  if (!content) return { skipped: "not_confirmed" };
  const message = buildBookingPaymentTelegramMessage(
    content.payload,
    content.paymentInfo,
    existing,
  );
  const result = await sendTelegramMessage(
    message,
    config,
    [input.chatId],
    `payment:${input.paymentId}:${input.state}`,
  );
  if (!result.sent_count && result.skipped_reason !== "test_environment")
    throw new Error("Notification Telegram non remise.");
  return result;
};

export const bookingTelegramJobHandlers = { [JOB_TYPE]: deliver };
export const runBookingTelegramJobBatch = () =>
  runOrganizationJobBatch({
    workerId: `booking-telegram-${process.pid}-${crypto.randomUUID()}`,
    leaseMs: env.ORGANIZATION_JOB_LEASE_MS,
    maxAttempts: env.ORGANIZATION_JOB_MAX_ATTEMPTS,
    handlers: bookingTelegramJobHandlers,
  });

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
import { getOrganizationId } from "../organizations/context.js";
import {
  enqueueOrganizationJob,
  runOrganizationJobBatch,
  type OrganizationJobHandler,
} from "../system/jobs.js";
import { buildReservationLinkReceipt } from "./reservationLinks.js";

const JOB_TYPE = "booking.telegram.payment";
const jobPayload = z.object({
  paymentId: z.string().min(1),
  chatId: z.string().min(1),
  state: z.string().min(1),
});
type PaymentEvent = {
  id: string;
  status: string;
  paid_amount_cents: number;
  refunded_amount_cents: number;
};
const eventState = (payment: PaymentEvent) =>
  `${payment.status}:${payment.paid_amount_cents}:${payment.refunded_amount_cents}`;

// Each recipient has an independent retry record. An unavailable bot does not
// resend successful emails or notifications to other recipients.
export const queueBookingPaymentTelegram = async (payment: PaymentEvent) => {
  const config = readTelegramNotificationConfig();
  if (
    !config.enabled ||
    !config.notify_booking_request_approved ||
    !config.bot_token
  )
    return;
  if (
    !["paid", "requires_review", "refunded", "partially_refunded"].includes(
      payment.status,
    )
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
      payload: { paymentId: payment.id, chatId, state: eventState(payment) },
      idempotencyKey: `${JOB_TYPE}:${payment.id}:${eventState(payment)}:${recipientKey}`,
    });
  }
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
  const payment = await prisma.bookingPayment.findUnique({
    where: { id: input.paymentId },
    include: {
      booking_request: { include: { gite: true } },
      reservation: { include: { gite: true } },
      payment_link: true,
    },
  });
  if (!payment || eventState(payment) !== input.state)
    return { skipped: "superseded" };
  const existing = Boolean(payment.reservation_id);
  if (
    !existing &&
    (!payment.booking_request ||
      (payment.status === "paid" &&
        payment.booking_request.status !== "approved"))
  )
    return { skipped: "not_confirmed" };
  const content = existing
    ? await buildReservationLinkReceipt(payment)
    : {
        payload: hydrateBookingRequest(payment.booking_request!),
        paymentInfo: payment,
      };
  const message = buildBookingPaymentTelegramMessage(
    content.payload,
    content.paymentInfo,
    existing,
  );
  const result = await sendTelegramMessage(message, config, [input.chatId]);
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

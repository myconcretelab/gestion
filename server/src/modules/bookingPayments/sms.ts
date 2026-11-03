import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import prisma from "../../db/prisma.js";
import { hydrateBookingRequest } from "../../services/booked.js";
import { buildBookingRequestApprovedSms } from "../../services/bookingRequestEmail.js";
import { sendMessage } from "../../services/messageChannels/index.js";
import { getOrganizationId } from "../organizations/context.js";
import {
  enqueueOrganizationJob,
  runOrganizationJobBatch,
  type OrganizationJobHandler,
} from "../system/jobs.js";
import { bookingStripeConfig } from "./provider.js";

const JOB_TYPE = "booking.sms.confirmation";
const jobPayload = z.object({ paymentId: z.string().min(1) });
type PaymentForSms = {
  id: string;
  stripe_mode: string;
  status: string;
  refunded_amount_cents: number;
  reservation_id: string | null;
  booking_request: {
    status: string;
    approved_reservation_id: string | null;
    telephone: string | null;
  } | null;
};

const canSendConfirmation = (payment: PaymentForSms) => {
  const config = bookingStripeConfig();
  return (
    config?.organizationId === getOrganizationId() &&
    payment.stripe_mode === config.mode &&
    payment.status === "paid" &&
    payment.refunded_amount_cents === 0 &&
    !payment.reservation_id &&
    payment.booking_request?.status === "approved" &&
    Boolean(payment.booking_request.approved_reservation_id) &&
    Boolean(payment.booking_request.telephone?.trim())
  );
};

// One persistent job per payment keeps SMS retries independent of sent emails.
export const queueBookingPaymentSms = async (payment: PaymentForSms) => {
  if (!canSendConfirmation(payment)) return;
  await enqueueOrganizationJob({
    organizationId: getOrganizationId(),
    type: JOB_TYPE,
    payload: { paymentId: payment.id },
    idempotencyKey: `${JOB_TYPE}:${payment.id}`,
  });
};

const deliver: OrganizationJobHandler = async (job) => {
  const input = jobPayload.parse(
    typeof job.payload_json === "string"
      ? JSON.parse(job.payload_json)
      : job.payload_json,
  );
  const payment = await prisma.bookingPayment.findUnique({
    where: { id: input.paymentId },
    include: { booking_request: { include: { gite: true } } },
  });
  if (!payment || !canSendConfirmation(payment) || !payment.booking_request)
    return { skipped: "not_confirmed" };

  const result = await sendMessage("sms", {
    recipients: [payment.booking_request.telephone!.trim()],
    message: buildBookingRequestApprovedSms(
      hydrateBookingRequest(payment.booking_request),
    ),
  });
  if (!result.sent_count) throw new Error("SMS de confirmation non remis.");
  return result;
};

export const bookingSmsJobHandlers = { [JOB_TYPE]: deliver };
export const runBookingSmsJobBatch = () =>
  runOrganizationJobBatch({
    workerId: `booking-sms-${process.pid}-${crypto.randomUUID()}`,
    leaseMs: env.ORGANIZATION_JOB_LEASE_MS,
    maxAttempts: env.ORGANIZATION_JOB_MAX_ATTEMPTS,
    handlers: bookingSmsJobHandlers,
  });

import { z } from "zod";
import type { ReservationPaymentTracking } from "./reservationPayments.js";

export const paymentTouristTaxInputSchema = z
  .object({
    amount_cents: z.number().int().positive().max(1_000_000_000),
    source_revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PaymentTouristTaxInput = z.infer<
  typeof paymentTouristTaxInputSchema
>;
export const recordedPaymentTouristTaxSchema = z
  .object({
    version: z.literal(1),
    amountCents: z.number().int().positive().max(1_000_000_000),
    sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RecordedPaymentTouristTax = z.infer<
  typeof recordedPaymentTouristTaxSchema
>;
export type PaymentTouristTaxContext = {
  available: boolean;
  reason: string | null;
  expectedCents: number;
  allocatedCents: number;
  remainingCents: number;
  sourceRevision: string;
  needsReview: boolean;
  hasUnassignedPayments: boolean;
};

/** A proposal is not collection evidence until the operator confirms it with the payment. */
export function suggestPaymentTouristTax(
  tracking: ReservationPaymentTracking,
  amount: number,
  purpose: string,
) {
  const context = tracking.tourist_tax;
  const amountCents = Math.round(amount * 100);
  if (
    !context?.available ||
    tracking.requires_review ||
    context.needsReview ||
    amountCents <= 0 ||
    context.remainingCents <= 0
  )
    return null;
  return {
    amountCents: Math.min(amountCents, context.remainingCents),
    checked:
      purpose !== "deposit" &&
      !context.hasUnassignedPayments &&
      amountCents >= Math.round(tracking.remaining * 100),
    sourceRevision: context.sourceRevision,
  };
}

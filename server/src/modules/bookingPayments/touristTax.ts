import type Stripe from "stripe";
import type {
  RecordedPaymentTouristTax,
  ReservationPaymentTracking,
} from "@contrats/shared";

export function checkoutStayLines(
  amount: number,
  tax: number,
  name: string,
  description: string,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const lines = [];
  if (amount > tax)
    lines.push({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: amount - tax,
        product_data: { name, description },
      },
    });
  if (tax > 0)
    lines.push({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: tax,
        product_data: { name: "Taxe de séjour" },
      },
    });
  return lines;
}

export function confirmedStripeTax(
  tracking: ReservationPaymentTracking,
  amountCents: number,
  sourceRevision?: string,
): RecordedPaymentTouristTax | null {
  const quote = tracking.tourist_tax;
  if (
    amountCents <= 0 ||
    tracking.requires_review ||
    !quote?.available ||
    quote.needsReview ||
    amountCents > quote.remainingCents ||
    (sourceRevision && sourceRevision !== quote.sourceRevision)
  )
    return null;
  return { version: 1, amountCents, sourceRevision: quote.sourceRevision };
}

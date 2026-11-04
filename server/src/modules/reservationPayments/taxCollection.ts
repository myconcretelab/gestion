import { createHash } from "node:crypto";
import {
  paymentTouristTaxInputSchema,
  type PaymentTouristTaxInput,
  type RecordedPaymentTouristTax,
  type ReservationPaymentEntry,
  type ReservationPaymentTracking,
} from "@contrats/shared";

export const paymentTaxRevision = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message: string) =>
  Object.assign(new Error(message), { statusCode: 409 });

export function validatePaymentTaxCollection(
  tracking: ReservationPaymentTracking,
  amountCents: number,
  method: string | null,
  input: PaymentTouristTaxInput,
  previous?: ReservationPaymentEntry,
): RecordedPaymentTouristTax {
  const checked = paymentTouristTaxInputSchema.safeParse(input);
  if (!checked.success)
    throw fail("Vérifiez le montant de taxe et rechargez ses données.");
  if (tracking.requires_review)
    throw fail(
      "Vérifiez le paiement ou le remboursement avant de confirmer sa taxe.",
    );
  const quote = tracking.tourist_tax;
  if (!quote?.available)
    throw fail(
      quote?.reason ??
        "La taxe de ce séjour ne peut pas être affectée à ce règlement.",
    );
  if (method === "Versement plateforme")
    throw fail(
      "La collecte d’une plateforme se justifie dans le registre ; elle ne constitue pas une taxe encaissée par l’hébergeur.",
    );
  if (quote.sourceRevision !== input.source_revision)
    throw fail(
      "Le barème ou le séjour a changé. Rechargez les règlements avant de confirmer la taxe.",
    );
  if (
    !previous &&
    tracking.entries.some(
      (entry) => !entry.voided_at && entry.tourist_tax_stale,
    )
  )
    throw fail(
      "Vérifiez les parts de taxe déjà enregistrées avant d’en affecter une nouvelle.",
    );
  const available = Math.max(
    0,
    quote.expectedCents -
      (quote.allocatedCents - (previous?.tourist_tax?.amountCents ?? 0)),
  );
  if (input.amount_cents > amountCents)
    throw fail(
      "La taxe comprise dans ce règlement ne peut pas dépasser son montant.",
    );
  if (input.amount_cents > available)
    throw fail(
      "Cette part de taxe dépasse la taxe restant à affecter. Actualisez les règlements pour éviter une double collecte.",
    );
  return {
    version: 1,
    amountCents: input.amount_cents,
    sourceRevision: input.source_revision,
  };
}

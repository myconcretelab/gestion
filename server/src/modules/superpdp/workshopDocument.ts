import { z } from "zod";
import {
  invoiceFiscalInputSchema,
  invoiceFiscalIssues,
} from "@contrats/shared";
import { buildStructuredInvoice } from "../documents/invoiceFiscal.js";
import { buildSandboxRecipe, recipeBindingSchema } from "./sandboxRecipe.js";
import {
  workshopPaymentSchema,
  workshopReportingSchema,
} from "./workshopB2c.js";

export const workshopStateSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  boot: z.string().uuid(),
  revision: z.number().int().min(0).max(1000),
  createdAt: z.string().datetime(),
  createdBy: z.string(),
  lastActor: z.string(),
  date: z.string().date(),
  number: z.string(),
  binding: recipeBindingSchema,
  kind: z.enum(["invoice", "credit_note"]),
  scenario: z.enum(["b2b", "b2c"]).default("b2b"),
  payments: z.array(workshopPaymentSchema).max(2).default([]),
  reporting: workshopReportingSchema.nullable().default(null),
  source: z.object({
    reservationId: z.string(),
    label: z.string(),
    total: z.number().finite().min(0).max(1000000),
  }),
  original: z
    .object({
      id: z.string().uuid(),
      number: z.string(),
      date: z.string().date(),
    })
    .nullable(),
  input: invoiceFiscalInputSchema,
  status: z.enum([
    "draft",
    "issuing",
    "issued",
    "preparing",
    "ready",
    "sending",
    "submitted",
    "send_unknown",
    "issue_failed",
    "prepare_failed",
  ]),
  nativeSha: z.string().nullable(),
  artifactSha: z.string().nullable(),
  snapshotSha: z.string().nullable(),
  remoteId: z.string().nullable(),
  error: z.string().nullable(),
  validation: z
    .object({
      valid: z.boolean(),
      checks: z.number(),
      failures: z.array(z.string()),
    })
    .nullable(),
  events: z
    .array(
      z.object({
        id: z.string(),
        code: z.string(),
        text: z.string(),
        at: z.string(),
      }),
    )
    .max(100),
});
export type WorkshopState = z.infer<typeof workshopStateSchema>;
export const workshopIssues = (state: WorkshopState) =>
  invoiceFiscalIssues(state.input, state.source.total, {
    vatRegime: "reel_normal",
    sellerVatNumber: "FR18000000002",
    credit: state.kind === "credit_note",
  });

/** Same native PDF/fiscal engines; adapter confined to fictitious provider identities.
 * Source reservations supply amounts only, never guest identity, contacts or gîte bank details.
 */
export function workshopDocument(state: WorkshopState) {
  const seed = buildSandboxRecipe(state.binding, state.id, state.date);
  const credit = state.kind === "credit_note";
  const b2c = state.scenario === "b2c";
  if (credit && !state.original) throw new Error("WORKSHOP_SOURCE_MISSING");
  const issuedAt = new Date(`${state.date}T10:00:00Z`);
  const snapshot = buildStructuredInvoice({
    input: state.input,
    number: state.number,
    issuedAt,
    buyerName: b2c ? "Client particulier fictif" : "Tricatel",
    credit,
    periodStart: issuedAt,
    periodEnd: issuedAt,
    issuer: {
      entity: {
        legal_name: seed.render.invoice.seller!.legal_name,
        siren: "000000002",
        vat_number: "FR18000000002",
        address_line1: "2 rue de la Recette fictive",
        address_line2: null,
        postal_code: "75001",
        city: "Paris",
        country_code: "FR",
      },
      establishment: { siret: null },
    },
    ...(state.original
      ? {
          sourceNumber: state.original.number,
          sourceIssuedAt: new Date(`${state.original.date}T10:00:00Z`),
        }
      : {}),
  });
  const { identifiers: _noSiret, ...seller } =
    snapshot.en_invoice_candidate.seller;
  const payload = {
    ...snapshot.en_invoice_candidate,
    ...(b2c
      ? {
          process_control: {
            ...snapshot.en_invoice_candidate.process_control,
            business_process_type: "S1",
          },
          vat_point_date_code: "432",
        }
      : {}),
    seller: {
      ...seller,
      electronic_address: seed.payload.seller.electronic_address,
    },
    buyer: {
      ...snapshot.en_invoice_candidate.buyer,
      ...(!b2c
        ? { electronic_address: seed.payload.buyer.electronic_address }
        : {}),
    },
    notes: [
      ...snapshot.en_invoice_candidate.notes,
      ...(b2c ? [{ subject_code: "BAR", note: "B2C" }] : []),
      {
        subject_code: "AAI",
        note: "TEST SUPERPDP - BAC À SABLE - aucune valeur comptable.",
      },
    ],
  };
  return {
    payload,
    render: {
      ...seed.render,
      invoice: {
        ...seed.render.invoice,
        fiscal: state.input,
        locataire_nom: b2c ? "Client particulier fictif" : "Tricatel",
        numero_facture: state.number,
        document_kind: credit ? "credit_note" : "invoice",
        source_invoice_number: state.original?.number,
        solde_montant: state.source.total,
      },
      totals: {
        ...seed.render.totals,
        montantBase: state.source.total,
        totalSansOptions: state.source.total,
        totalGlobal: credit ? -state.source.total : state.source.total,
        solde: state.source.total,
      },
    },
  };
}

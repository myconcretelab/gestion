import assert from "node:assert/strict";
import { z } from "zod";
import type { SuperPdpTransport } from "./transport.js";

// A single declared technical scenario, NOT a tax default for rental properties.
export const workshopB2cProfile = {
  operation: "services",
  vat_regime: "monthly",
  has_vat_on_debits: false,
  confirm_no_other_reporting: true,
} as const;
export const workshopPaymentSchema = z.object({
  slot: z.union([z.literal(1), z.literal(2)]),
  reference: z.string().max(100),
  amount: z.literal("60.00"),
  date: z.string().date(),
  status: z.enum(["recorded", "sending", "submitted", "send_unknown"]),
  remoteEventId: z.string().nullable(),
});
export type WorkshopPayment = z.infer<typeof workshopPaymentSchema>;
export const workshopReportingSchema = z.object({
  checkedAt: z.string().datetime(),
  transaction: z.enum(["pending", "verified", "mismatch"]),
  transactionIds: z.array(z.string()).max(100),
  payments: z
    .array(
      z.object({
        slot: z.number(),
        result: z.enum(["pending", "verified", "mismatch"]),
        ids: z.array(z.string()).max(100),
      }),
    )
    .max(2),
  declarations: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["transaction", "payment"]),
        start: z.string(),
        end: z.string(),
        events: z
          .array(z.object({ code: z.string(), at: z.string() }))
          .max(100),
      }),
    )
    .max(3),
});

// Compare decimal strings exactly, including harmless provider trailing zeroes.
export const sameDecimal = (value: string, expected: string) => {
  const normalize = (s: string) => {
    if (!/^\d{1,14}(?:\.\d{1,8})?$/.test(s)) return null;
    const [whole, fraction = ""] = s.split(".");
    return `${BigInt(whole)}.${fraction.padEnd(8, "0")}`;
  };
  return normalize(value) !== null && normalize(value) === normalize(expected);
};
export const workshopPaymentDetails = (payment: WorkshopPayment) => [
  {
    reported_data: [
      {
        amount: payment.amount,
        currency_code: "EUR",
        type_code: "MEN",
        value_percent: "20.00",
        date: payment.date,
      },
    ],
  },
];

/** Read-only evidence, filtered by the exact invoice/event IDs, never aggregate POSTs.
 * Empty asynchronous results are pending, not successful or permission to resend.
 */
export async function readWorkshopReporting(
  transport: SuperPdpTransport,
  token: string,
  companyId: string,
  invoiceId: string,
  date: string,
  payments: WorkshopPayment[],
) {
  const transactions = await transport.b2cTransactions(token, invoiceId);
  const tx = transactions.data[0];
  const transactionValid =
    !transactions.has_more &&
    transactions.data.length === 1 &&
    tx.invoice_id === invoiceId &&
    tx.date === date &&
    tx.role_code === "SE" &&
    tx.currency === "EUR" &&
    tx.category_code === "TPS1" &&
    sameDecimal(tx.tax_exclusive_amount, "100.00") &&
    sameDecimal(tx.tax_total, "20.00") &&
    tx.tax_subtotals.length === 1 &&
    sameDecimal(tx.tax_subtotals[0].tax_percent, "20.00") &&
    sameDecimal(tx.tax_subtotals[0].taxable_amount, "100.00") &&
    sameDecimal(tx.tax_subtotals[0].tax_total, "20.00");
  const paymentProofs = [];
  const paymentEvidence = [];
  const declarations = new Map<
    string,
    { kind: "transaction" | "payment"; dates: string[] }
  >();
  const addDeclaration = (
    id: string | null | undefined,
    kind: "transaction" | "payment",
    date: string,
  ) => {
    if (!id) return;
    const previous = declarations.get(id);
    assert.ok(!previous || previous.kind === kind);
    declarations.set(id, { kind, dates: [...(previous?.dates ?? []), date] });
  };
  if (transactionValid)
    addDeclaration(tx.ppf_ereporting_id, "transaction", date);
  for (const payment of payments) {
    if (!payment.remoteEventId || payment.status !== "submitted") {
      paymentProofs.push({
        slot: payment.slot,
        result: "pending" as const,
        ids: [],
      });
      continue;
    }
    const result = await transport.b2cPayments(token, payment.remoteEventId);
    paymentEvidence.push({ eventId: payment.remoteEventId, result });
    const row = result.data[0];
    const valid =
      !result.has_more &&
      result.data.length === 1 &&
      row.invoice_event_id === payment.remoteEventId &&
      (!row.company_id || row.company_id === companyId) &&
      row.date === payment.date &&
      row.subtotals.length === 1 &&
      row.subtotals[0].currency_code === "EUR" &&
      sameDecimal(row.subtotals[0].amount, payment.amount) &&
      sameDecimal(row.subtotals[0].tax_percent, "20.00");
    paymentProofs.push({
      slot: payment.slot,
      result: valid
        ? ("verified" as const)
        : result.data.length || result.has_more
          ? ("mismatch" as const)
          : ("pending" as const),
      ids: result.data.map((r) => r.id),
    });
    if (valid) addDeclaration(row.ppf_ereporting_id, "payment", payment.date);
  }
  const reporting = [];
  const declarationEvidence = [];
  for (const [id, expected] of declarations) {
    const row = await transport.eReporting(token, id);
    declarationEvidence.push(row);
    assert.equal(row.id, id);
    assert.equal(row.company_id, companyId);
    assert.equal(row.role_code, "SE");
    assert.equal(row.kind, expected.kind);
    assert.ok(
      expected.dates.every((d) => row.start_period <= d && d <= row.end_period),
    );
    reporting.push({
      id,
      kind: row.kind,
      start: row.start_period,
      end: row.end_period,
      events: row.events.map((e) => ({
        code: e.status_code,
        at: e.created_at,
      })),
    });
  }
  const summary = workshopReportingSchema.parse({
    checkedAt: new Date().toISOString(),
    transaction: transactionValid
      ? "verified"
      : transactions.data.length || transactions.has_more
        ? "mismatch"
        : "pending",
    transactionIds: transactions.data.map((r) => r.id),
    payments: paymentProofs,
    declarations: reporting,
  });
  return {
    summary,
    evidence: {
      transactions,
      payments: paymentEvidence,
      declarations: declarationEvidence,
      summary,
    },
  };
}

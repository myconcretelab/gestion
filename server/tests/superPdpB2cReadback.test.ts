import assert from "node:assert/strict";
import { test } from "node:test";
import { SuperPdpTransport } from "../src/modules/superpdp/transport.js";
import {
  readWorkshopReporting,
  sameDecimal,
} from "../src/modules/superpdp/workshopB2c.js";

const date = "2026-10-18";
const invoiceId = "9007199254740993123";
const companyId = "114214";
const eventId = "9007199254740993124";
const payment = {
  slot: 1 as const,
  reference: "unique-test-P1",
  amount: "60.00" as const,
  date,
  status: "submitted" as const,
  remoteEventId: eventId,
};
function fixture(mode = "ok") {
  const requests: string[] = [];
  const transport = new SuperPdpTransport(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.superpdp.tech");
    assert.equal(
      init?.method ?? "GET",
      "GET",
      "reporting inspection must never POST aggregates",
    );
    assert.equal(init?.redirect, "error");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer fake-token",
    );
    requests.push(url.pathname);
    let data: unknown;
    if (url.pathname.endsWith("b2c_transactions")) {
      assert.equal(url.searchParams.get("invoice_id"), invoiceId);
      data = {
        data:
          mode === "pending"
            ? []
            : [
                {
                  id: "9007199254740993125",
                  invoice_id: mode === "foreign-invoice" ? "999" : invoiceId,
                  ppf_ereporting_id: "51",
                  date,
                  currency: "EUR",
                  category_code: "TPS1",
                  role_code: "SE",
                  tax_exclusive_amount: "100.0000",
                  tax_total: "20.00",
                  tax_subtotals: [
                    {
                      tax_percent: "20.0",
                      taxable_amount: "100",
                      tax_total: "20",
                    },
                  ],
                },
              ],
        has_more: mode === "partial",
      };
    } else if (url.pathname.endsWith("b2c_payments")) {
      assert.equal(url.searchParams.get("invoice_event_id"), eventId);
      data = {
        data: [
          {
            id: "62",
            invoice_event_id: eventId,
            company_id: companyId,
            ppf_ereporting_id: "52",
            date,
            subtotals: [
              {
                currency_code: "EUR",
                amount: mode === "wrong-payment" ? "60.01" : "60.0000",
                tax_percent: "20.00",
              },
            ],
          },
        ],
        has_more: false,
      };
    } else {
      const kind = url.pathname.endsWith("51") ? "transaction" : "payment";
      data = {
        id: kind === "transaction" ? "51" : "52",
        company_id: mode === "foreign-company" ? "123" : companyId,
        kind,
        role_code: "SE",
        start_period: "2026-10-11",
        end_period: "2026-10-20",
        events: [
          {
            id: "71",
            created_at: "2026-10-18T12:00:00Z",
            status_code: "ppf:ereporting-ack",
          },
        ],
      };
    }
    // Numeric identifiers on the wire, including those above JS safe integer precision.
    const wire = JSON.stringify(data).replaceAll(
      /"(900719925474099312[345])"/g,
      "$1",
    );
    return new Response(wire, {
      headers: { "Content-Type": "application/json" },
    });
  });
  return { transport, requests };
}
test("B2C lecture : filtres facture/événement exacts, grands identifiants, GET seuls et déclarations liées", async () => {
  const f = fixture();
  const proof = await readWorkshopReporting(
    f.transport,
    "fake-token",
    companyId,
    invoiceId,
    date,
    [payment],
  );
  assert.equal(proof.summary.transaction, "verified");
  assert.deepEqual(proof.summary.transactionIds, ["9007199254740993125"]);
  assert.equal(proof.summary.payments[0].result, "verified");
  assert.equal(proof.summary.declarations.length, 2);
  assert.equal(
    proof.summary.declarations[0].events[0].code,
    "ppf:ereporting-ack",
  );
  assert.equal(proof.evidence.payments.length, 1);
  assert.equal(proof.evidence.declarations.length, 2);
  assert.deepEqual(f.requests, [
    "/v1.beta/b2c_transactions",
    "/v1.beta/b2c_payments",
    "/v1.beta/ereportings/51",
    "/v1.beta/ereportings/52",
  ]);
});
test("B2C lecture : attente asynchrone distincte des écarts, pagination incomplète et autre entreprise", async () => {
  for (const mode of [
    "pending",
    "partial",
    "foreign-invoice",
    "wrong-payment",
  ]) {
    const f = fixture(mode);
    const proof = await readWorkshopReporting(
      f.transport,
      "fake-token",
      companyId,
      invoiceId,
      date,
      [],
    );
    assert.equal(
      proof.summary.transaction,
      mode === "pending"
        ? "pending"
        : mode === "wrong-payment"
          ? "verified"
          : "mismatch",
    );
  }
  const f = fixture("wrong-payment");
  const proof = await readWorkshopReporting(
    f.transport,
    "fake-token",
    companyId,
    invoiceId,
    date,
    [payment],
  );
  assert.equal(proof.summary.payments[0].result, "mismatch");
  await assert.rejects(
    readWorkshopReporting(
      fixture("foreign-company").transport,
      "fake-token",
      companyId,
      invoiceId,
      date,
      [],
    ),
  );
});
test("décimaux fournisseur : comparaison exacte, jamais de tolérance flottante ni de valeur négative", () => {
  assert.equal(sameDecimal("20.00000000", "20.00"), true);
  for (const value of ["20.00000001", "-20", "NaN", "20e0", "20.000000000"])
    assert.equal(sameDecimal(value, "20.00"), false);
});

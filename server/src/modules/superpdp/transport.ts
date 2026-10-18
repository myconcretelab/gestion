import { z } from "zod";
import { PROVIDER_ORIGIN } from "./provider.js";
import { superPdpError } from "./secrets.js";

// SUPER PDP 1.37.0.beta, reviewed 2026-10-16. Never round provider bigint identifiers.
export const remoteId = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const parseWireJson = (text: string) =>
  JSON.parse(text, (name, value, context?: { source?: string }) => {
    if ((name === "id" || name.endsWith("_id")) && typeof value === "number") {
      if (context?.source && /^[1-9]\d{0,18}$/.test(context.source))
        return context.source;
      if (Number.isSafeInteger(value) && value > 0) return String(value);
      throw new Error();
    }
    return value;
  });
const message = z.object({
  message: z.string().max(4000),
  location: z.string().max(1000).optional(),
});
export const validationSchema = z.object({
  data: z
    .array(
      z.object({
        file_name: z.string().max(250),
        file_size: z.number().int().nonnegative(),
        is_valid: z.boolean(),
        format: z.string().min(1).max(500),
        conformance_level: z.string().max(500),
        error: z.string().max(4000).optional(),
        subreports: z
          .array(
            z.object({
              validator: z.string().max(500),
              checks_count: z.number().int().nonnegative(),
              failures: z.array(message).max(100),
              messages: z.array(message).max(100),
            }),
          )
          .max(50),
      }),
    )
    .length(1),
});
export const remoteInvoiceSchema = z.object({
  id: remoteId,
  company_id: remoteId,
  direction: z.enum(["in", "out"]),
  external_id: z.string().max(64).optional(),
  processing_rule: z.string().optional(),
});
const decimal = z.string().regex(/^-?\d{1,14}(?:\.\d{1,8})?$/);
export const b2cTransactionSchema = z.object({
  id: remoteId,
  invoice_id: remoteId.optional(),
  ppf_ereporting_id: remoteId.nullable().optional(),
  date: z.string().date(),
  currency: z.string().max(3),
  category_code: z.string().max(20),
  role_code: z.enum(["BY", "SE"]),
  tax_due_date_type_code: z.string().max(20).optional(),
  tax_exclusive_amount: decimal,
  tax_total: decimal,
  tax_subtotals: z
    .array(
      z.object({
        tax_percent: decimal,
        taxable_amount: decimal,
        tax_total: decimal,
      }),
    )
    .max(100),
});
export const b2cPaymentSchema = z.object({
  id: remoteId,
  invoice_event_id: remoteId.optional(),
  company_id: remoteId.optional(),
  ppf_ereporting_id: remoteId.nullable().optional(),
  date: z.string().date(),
  subtotals: z
    .array(
      z.object({
        amount: decimal,
        currency_code: z.string().max(3).optional(),
        tax_percent: decimal,
      }),
    )
    .max(100),
});
export const eReportingSchema = z.object({
  id: remoteId,
  company_id: remoteId,
  kind: z.enum(["transaction", "payment"]),
  role_code: z.enum(["BY", "SE"]),
  start_period: z.string().date(),
  end_period: z.string().date(),
  events: z
    .array(
      z.object({
        id: remoteId,
        status_code: z.string().min(1).max(100),
        created_at: z.string().datetime({ offset: true }),
      }),
    )
    .max(100),
});
export const incomingStructuredSchema = z
  .object({
    number: z.string().min(1).max(500),
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type_code: z.number().int(),
    currency_code: z.string().regex(/^[A-Z]{3}$/),
    seller: z.object({ name: z.string().min(1).max(500) }).passthrough(),
    totals: z
      .object({
        total_without_vat: decimal,
        total_with_vat: decimal,
        total_vat_amount: z.object({ value: decimal }).passthrough().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export const incomingInvoiceSchema = remoteInvoiceSchema.extend({
  created_at: z.string().datetime({ offset: true }),
  // A just-created remote document may not have completed semantic extraction yet.
  en_invoice: z.record(z.unknown()).nullable().optional(),
});
export const eventSchema = z.object({
  id: remoteId,
  invoice_id: remoteId,
  status_code: z.string().min(1).max(100),
  created_at: z.string().datetime({ offset: true }),
  status_text: z.string().max(4000),
  data: z.object({ reason: z.string().max(4000).optional() }).optional(),
  attachments: z
    .array(
      z.object({
        file_name: z.string().max(250).optional(),
        index: z.number().int().nonnegative().optional(),
      }),
    )
    .max(50)
    .optional(),
  details: z
    .array(
      z.object({
        reason: z.string().max(500).optional(),
        notes: z
          .array(
            z.object({
              content_code: z.string().max(100).optional(),
              subject: z.string().max(1000).optional(),
              contents: z
                .array(z.object({ content: z.string().max(4000) }))
                .max(50)
                .optional(),
            }),
          )
          .max(50)
          .optional(),
        reported_data: z
          .array(
            z.record(
              z.union([z.string().max(4000), z.boolean(), z.number().finite()]),
            ),
          )
          .max(100)
          .optional(),
      }),
    )
    .max(50)
    .optional(),
});
export type RemoteInvoice = z.infer<typeof remoteInvoiceSchema>;
export type RemoteEvent = z.infer<typeof eventSchema>;
export type Validation = z.infer<typeof validationSchema>;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export class SuperPdpTransport {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async request(
    path: string,
    init: RequestInit,
    maxBytes = 2 * 1024 * 1024,
  ) {
    if (
      !path.startsWith("/v1.beta/") ||
      new URL(path, PROVIDER_ORIGIN).origin !== PROVIDER_ORIGIN
    )
      throw new Error("Endpoint refused");
    try {
      const response = await this.fetcher(PROVIDER_ORIGIN + path, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw superPdpError(
          "SUPERPDP_TRANSPORT_HTTP",
          `SuperPDP a refusé la requête (HTTP ${response.status}). Consultez l’état avant toute nouvelle tentative.`,
          502,
        );
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > maxBytes) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(part.value);
        }
      return Buffer.concat(chunks);
    } catch (error) {
      if ((error as { code?: string })?.code === "SUPERPDP_TRANSPORT_HTTP")
        throw error;
      throw superPdpError(
        "SUPERPDP_TRANSPORT_NETWORK",
        "Résultat SuperPDP non confirmé. Aucun renvoi automatique du dépôt n’est autorisé.",
        502,
      );
    }
  }
  private async json<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const bytes = await this.request(path, init);
    try {
      return schema.parse(parseWireJson(bytes.toString("utf8")));
    } catch {
      throw superPdpError(
        "SUPERPDP_TRANSPORT_RESPONSE",
        "Réponse SuperPDP inexploitable ; vérification nécessaire.",
        502,
      );
    }
  }
  private headers(token: string) {
    return { Authorization: `Bearer ${token}`, Accept: "application/json" };
  }
  async directory(token: string) {
    return this.json(
      "/v1.beta/directory_entries",
      { headers: this.headers(token) },
      z.object({
        data: z
          .array(
            z.object({
              company: z.object({ id: remoteId }),
              identifier: z.string().max(250),
              status: z.string().max(100),
            }),
          )
          .max(1000),
      }),
    );
  }
  async convert(payload: string, pdf: Buffer) {
    const form = new FormData();
    form.append(
      "invoice",
      new Blob([payload], { type: "application/json" }),
      "invoice.json",
    );
    form.append(
      "pdf",
      new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
      "original.pdf",
    );
    const result = await this.request(
      "/v1.beta/invoices/convert?from=en16931&to=factur-x",
      { method: "POST", body: form },
      MAX_DOCUMENT_BYTES,
    );
    if (!result.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw superPdpError(
        "SUPERPDP_TRANSPORT_FORMAT",
        "La conversion n’a pas retourné un PDF Factur-X exploitable.",
        502,
      );
    return result;
  }
  async validate(pdf: Buffer): Promise<Validation> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
      "invoice.pdf",
    );
    const report = await this.json(
      "/v1.beta/validation_reports",
      { method: "POST", body: form },
      validationSchema,
    );
    if (
      report.data[0].file_name !== "invoice.pdf" ||
      report.data[0].file_size !== pdf.length
    )
      throw superPdpError(
        "SUPERPDP_TRANSPORT_VALIDATION",
        "Le rapport ne correspond pas au fichier préparé.",
        502,
      );
    return report;
  }
  send(
    token: string,
    pdf: Buffer,
    externalId: string,
    rule: "B2B" | "B2C" = "B2B",
  ) {
    const query = new URLSearchParams({
      external_id: externalId,
      processing_rule: rule,
    });
    return this.json(
      `/v1.beta/invoices?${query}`,
      {
        method: "POST",
        headers: { ...this.headers(token), "Content-Type": "application/pdf" },
        body: new Uint8Array(pdf),
      },
      remoteInvoiceSchema,
    );
  }
  reportingCompany(token: string) {
    return this.json(
      "/v1.beta/companies/me",
      { headers: this.headers(token) },
      z.object({
        id: remoteId,
        env: z.literal("sandbox"),
        vat_regime: z
          .enum(["monthly", "quarterly", "simplified", "vat_exemption"])
          .or(z.literal("")),
        has_vat_on_debits: z.boolean(),
      }),
    );
  }
  payment(token: string, invoiceId: string, details: unknown) {
    // The API expects a JSON number. Do not pass a 64-bit identifier through Number.
    const body = `{"invoice_id":${remoteId.parse(invoiceId)},"status_code":"fr:212","details":${JSON.stringify(details)}}`;
    return this.json(
      "/v1.beta/invoice_events",
      {
        method: "POST",
        headers: { ...this.headers(token), "Content-Type": "application/json" },
        body,
      },
      eventSchema,
    );
  }
  b2cTransactions(token: string, invoiceId: string) {
    const query = new URLSearchParams({
      invoice_id: remoteId.parse(invoiceId),
      limit: "100",
      order: "asc",
    });
    return this.json(
      `/v1.beta/b2c_transactions?${query}`,
      { headers: this.headers(token) },
      z.object({
        data: z.array(b2cTransactionSchema).max(100),
        has_more: z.boolean(),
      }),
    );
  }
  b2cPayments(token: string, eventId: string) {
    const query = new URLSearchParams({
      invoice_event_id: remoteId.parse(eventId),
      limit: "100",
      order: "asc",
    });
    return this.json(
      `/v1.beta/b2c_payments?${query}`,
      { headers: this.headers(token) },
      z.object({
        data: z.array(b2cPaymentSchema).max(100),
        has_more: z.boolean(),
      }),
    );
  }
  eReporting(token: string, id: string) {
    return this.json(
      `/v1.beta/ereportings/${remoteId.parse(id)}`,
      { headers: this.headers(token) },
      eReportingSchema,
    );
  }
  list(token: string, cursor: string | null) {
    const query = new URLSearchParams({
      direction: "out",
      order: "asc",
      limit: "100",
    });
    if (cursor) query.set("starting_after_id", remoteId.parse(cursor));
    return this.json(
      `/v1.beta/invoices?${query}`,
      { headers: this.headers(token) },
      z.object({
        data: z.array(remoteInvoiceSchema).max(100),
        has_after: z.boolean(),
      }),
    );
  }
  invoice(token: string, id: string) {
    return this.json(
      `/v1.beta/invoices/${remoteId.parse(id)}`,
      { headers: this.headers(token) },
      remoteInvoiceSchema,
    );
  }
  events(token: string, id: string, cursor: string | null) {
    const query = new URLSearchParams({
      invoice_id: remoteId.parse(id),
      limit: "100",
    });
    if (cursor) query.set("starting_after_id", remoteId.parse(cursor));
    return this.json(
      `/v1.beta/invoice_events?${query}`,
      { headers: this.headers(token) },
      z.object({ data: z.array(eventSchema).max(100), has_after: z.boolean() }),
    );
  }
  incoming(token: string, cursor: string | null) {
    const query = new URLSearchParams({
      direction: "in",
      order: "asc",
      limit: "1",
    });
    if (cursor) query.set("starting_after_id", remoteId.parse(cursor));
    return this.json(
      `/v1.beta/invoices?${query}`,
      { headers: this.headers(token) },
      z.object({
        data: z.array(remoteInvoiceSchema).max(1),
        has_after: z.boolean(),
      }),
    );
  }
  incomingDetail(token: string, id: string) {
    return this.json(
      `/v1.beta/invoices/${remoteId.parse(id)}?format=en16931`,
      { headers: this.headers(token) },
      incomingInvoiceSchema,
    );
  }
  async incomingOriginal(token: string, id: string) {
    const contents = await this.request(
      `/v1.beta/invoices/${remoteId.parse(id)}?format=original`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/pdf, application/xml",
        },
      },
      MAX_DOCUMENT_BYTES,
    );
    const prefix = contents
      .subarray(0, 512)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trimStart();
    const format = prefix.startsWith("%PDF-")
      ? "pdf"
      : prefix.startsWith("<")
        ? "xml"
        : null;
    if (!format)
      throw superPdpError(
        "SUPERPDP_INCOMING_FORMAT",
        "Le document original n’est pas un fichier PDF/XML exploitable.",
        502,
      );
    return { contents, format };
  }
  incomingEvents(token: string, cursor: string | null) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("starting_after_id", remoteId.parse(cursor));
    return this.json(
      `/v1.beta/invoice_events?${query}`,
      { headers: this.headers(token) },
      z.object({ data: z.array(eventSchema).max(100), has_after: z.boolean() }),
    );
  }
}

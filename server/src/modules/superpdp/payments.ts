import crypto from "node:crypto";
import { z } from "zod";
import type {
  ElectronicInvoiceTransmission,
  ElectronicInvoicePayment,
} from "@prisma/client";
import prisma from "../../db/prisma.js";
import { getOrganizationId } from "../organizations/context.js";
import { digest, superPdpError } from "./secrets.js";
import { SuperPdpService, type OAuthActor } from "./service.js";
import { SuperPdpTransport, type RemoteEvent } from "./transport.js";
import { emissionEnabled } from "./emission.js";
import {
  assertRemoteProfile,
  b2cEnabled,
  centsMoney,
  moneyCents,
  reportingProfileSchema,
} from "./reporting.js";

const allocationSchema = z
  .object({
    vat_rate: z.string().regex(/^(?:0|[1-9]\d?)\.\d{2}$/),
    amount: z.string().regex(/^(?:0|[1-9]\d{0,6})\.\d{2}$/),
  })
  .strict();
export const paymentInputSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    reference: z.string().trim().min(1).max(120),
    payment_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const date = new Date(`${value}T12:00:00Z`);
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === value
        );
      }),
    allocations: z.array(allocationSchema).min(1).max(20),
    confirm_received: z.literal(true),
    confirm_test_data: z.literal(true),
  })
  .strict();
const enabled = () => {
  emissionEnabled();
  b2cEnabled();
};
const fail = (code: string, message: string) => superPdpError(code, message);
const profileOf = (row: ElectronicInvoiceTransmission) =>
  reportingProfileSchema.parse(
    JSON.parse(row.reporting_profile_json ?? "null"),
  );
const codeOf = (error: unknown) =>
  /^SUPERPDP_[A-Z_]+$/.test(String((error as { code?: string })?.code))
    ? (error as { code: string }).code
    : "SUPERPDP_PAYMENT_STORAGE";
const allocationsOf = (row: ElectronicInvoicePayment) =>
  z.array(allocationSchema).parse(JSON.parse(row.allocations_json));
const decimal2 = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,8})?$/.test(value))
    throw new Error();
  const [whole, fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(2))) throw new Error();
  return `${Number(whole)}.${fraction.padEnd(2, "0").slice(0, 2)}`;
};
export const matchesPaymentReceipt = (
  payment: Pick<ElectronicInvoicePayment, "allocations_json" | "payment_date">,
  event: RemoteEvent,
) => {
  try {
    const actual = event.details
      ?.flatMap((d) => d.reported_data ?? [])
      .map((d) => {
        if (
          d.type_code !== "MEN" ||
          d.currency_code !== "EUR" ||
          d.date !== payment.payment_date
        )
          throw new Error();
        return {
          vat_rate: decimal2(d.value_percent),
          amount: decimal2(d.amount),
        };
      })
      .sort((a, b) => a.vat_rate.localeCompare(b.vat_rate));
    return JSON.stringify(actual) === payment.allocations_json;
  } catch {
    return false;
  }
};

// This ledger describes verified receipts, not invoice balance estimates or rental deposits.
export class SuperPdpPayments {
  constructor(
    private readonly oauth = new SuperPdpService(),
    private readonly transport = new SuperPdpTransport(),
  ) {}
  private async transmission(invoiceId: string) {
    const invoice = await prisma.facture.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice)
      throw superPdpError(
        "SUPERPDP_INVOICE_NOT_FOUND",
        "Facture introuvable.",
        404,
      );
    return prisma.electronicInvoiceTransmission.findUnique({
      where: {
        organization_id_invoice_id_environment: {
          organization_id: getOrganizationId(),
          invoice_id: invoiceId,
          environment: "sandbox",
        },
      },
    });
  }
  private capacities(row: ElectronicInvoiceTransmission) {
    const payload = JSON.parse(row.payload_json);
    const profile = profileOf(row);
    if (
      payload.type_code !== 380 ||
      payload.currency_code !== "EUR" ||
      moneyCents(payload.totals.rounding_amount) !== 0
    )
      throw fail(
        "SUPERPDP_PAYMENT_UNSUPPORTED",
        "Seules les factures positives en EUR sans arrondi sont prises en charge. Les avoirs et remboursements nécessitent un parcours dédié.",
      );
    const rates = new Map<string, number>();
    for (const group of payload.vat_break_down) {
      if (
        group.vat_category_code !== "S" ||
        !/^\d{1,2}\.\d{2}$/.test(group.vat_category_rate) ||
        Number(group.vat_category_rate) <= 0
      )
        throw fail(
          "SUPERPDP_PAYMENT_UNSUPPORTED",
          "Le suivi des encaissements de ce lot exige uniquement des lignes soumises à TVA positive. Les exonérations, taux zéro et sommes hors TVA (dont taxe de séjour) nécessitent une recette dédiée.",
        );
      const amount =
        moneyCents(group.vat_category_taxable_amount) +
        moneyCents(group.vat_category_tax_amount);
      rates.set(
        group.vat_category_rate,
        (rates.get(group.vat_category_rate) ?? 0) + amount,
      );
    }
    if (
      [...rates.values()].reduce((a, b) => a + b, 0) !==
      moneyCents(payload.totals.total_with_vat)
    )
      throw fail(
        "SUPERPDP_PAYMENT_UNSUPPORTED",
        "La ventilation ne correspond pas au total TTC figé.",
      );
    return {
      rates,
      needsReporting:
        profile.operation === "services" &&
        !profile.has_vat_on_debits &&
        profile.vat_regime !== "vat_exemption",
    };
  }
  private async notCredited(invoiceId: string) {
    if (
      await prisma.facture.count({
        where: { credited_invoice_id: invoiceId, lifecycle_status: "issued" },
      })
    )
      throw fail(
        "SUPERPDP_PAYMENT_CREDITED",
        "Un avoir a été émis pour cette facture. Le traitement des encaissements/remboursements doit être vérifié séparément.",
      );
  }
  async view(invoiceId: string) {
    const row = await this.transmission(invoiceId);
    let available = false,
      reason =
        "Déposez d’abord une facture B2C de test pour suivre ses encaissements.",
      needsReporting = false;
    let rates: Array<{ vat_rate: string; total: string }> = [];
    try {
      enabled();
      if (
        row?.reporting_profile_json &&
        row.remote_invoice_id &&
        row.status === "submitted"
      ) {
        const limits = this.capacities(row);
        await this.notCredited(invoiceId);
        rates = [...limits.rates].map(([vat_rate, cents]) => ({
          vat_rate,
          total: centsMoney(cents),
        }));
        available = true;
        needsReporting = limits.needsReporting;
        reason = needsReporting
          ? "Chaque encaissement doit être vérifié, daté et ventilé en TTC par taux. Le reçu SuperPDP confirme la création du message, pas son acceptation par l’administration."
          : "Ce profil (biens ou TVA sur les débits) ne déclenche pas d’e-reporting de paiement dans ce lot. Le journal reste local ; aucun statut 212 n’est envoyé.";
      }
    } catch (error) {
      reason = (error as Error).message;
    }
    const payments = row
      ? await prisma.electronicInvoicePayment.findMany({
          where: { transmission_id: row.id },
          orderBy: { createdAt: "asc" },
          take: 200,
        })
      : [];
    return {
      available,
      reason,
      needs_reporting: needsReporting,
      revision: row?.payments_revision ?? 0,
      rates,
      payments: payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        payment_date: p.payment_date,
        amount: centsMoney(p.amount_cents),
        allocations: allocationsOf(p),
        status: p.status,
        post_started_at: p.post_started_at,
        remote_event_id: p.remote_event_id,
        last_error_code: p.last_error_code,
      })),
    };
  }
  async record(invoiceId: string, payload: unknown, actor: OAuthActor) {
    enabled();
    const input = paymentInputSchema.parse(payload);
    // No inferred dates: even paid-at-issue invoices need an explicit receipt.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (input.payment_date > today)
      throw fail(
        "SUPERPDP_PAYMENT_DATE",
        "Un encaissement futur ne peut pas être enregistré.",
      );
    const row = await this.transmission(invoiceId);
    if (
      !row?.reporting_profile_json ||
      !row.remote_invoice_id ||
      row.status !== "submitted"
    )
      throw fail(
        "SUPERPDP_PAYMENT_NOT_READY",
        "Une facture B2C de test déposée et identifiée est obligatoire.",
      );
    const limits = this.capacities(row);
    await this.notCredited(invoiceId);
    const sorted = [...input.allocations].sort((a, b) =>
      a.vat_rate.localeCompare(b.vat_rate),
    );
    const allocations = JSON.stringify(sorted);
    const total = sorted.reduce(
      (sum, item) => sum + moneyCents(item.amount),
      0,
    );
    if (
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      total > 1_000_000_000 ||
      new Set(sorted.map((a) => a.vat_rate)).size !== sorted.length ||
      sorted.some(
        (a) => moneyCents(a.amount) <= 0 || !limits.rates.has(a.vat_rate),
      )
    )
      throw fail(
        "SUPERPDP_PAYMENT_AMOUNT",
        "Vérifiez les montants TTC et les taux : chaque taux doit être présent une seule fois et correspondre à la facture.",
      );
    const details = [
      {
        reported_data: sorted.map((a) => ({
          amount: a.amount,
          currency_code: "EUR",
          type_code: "MEN",
          value_percent: a.vat_rate,
          date: input.payment_date,
        })),
      },
    ];
    const wire = JSON.stringify(details);
    await prisma.$transaction(
      async (tx) => {
        const previous = await tx.electronicInvoicePayment.findMany({
          where: { transmission_id: row.id },
        });
        const duplicate = previous.find((p) => p.reference === input.reference);
        if (duplicate) {
          if (
            duplicate.allocations_json !== allocations ||
            duplicate.payment_date !== input.payment_date
          )
            throw fail(
              "SUPERPDP_PAYMENT_REFERENCE",
              "Cette référence est déjà enregistrée avec un autre encaissement.",
            );
          return; // Same request is locally idempotent, including after an HTTP acknowledgement loss.
        }
        if (previous.length >= 200)
          throw fail(
            "SUPERPDP_PAYMENT_LIMIT",
            "La limite de 200 encaissements est atteinte pour cette facture.",
          );
        for (const part of sorted) {
          const used = previous.reduce(
            (sum, p) =>
              sum +
              allocationsOf(p)
                .filter((a) => a.vat_rate === part.vat_rate)
                .reduce((s, a) => s + moneyCents(a.amount), 0),
            0,
          );
          if (used + moneyCents(part.amount) > limits.rates.get(part.vat_rate)!)
            throw fail(
              "SUPERPDP_PAYMENT_EXCESS",
              "Le cumul TTC enregistré dépasse le montant de la facture pour ce taux. Aucun encaissement n’a été ajouté.",
            );
        }
        const changed = await tx.electronicInvoiceTransmission.updateMany({
          where: {
            id: row.id,
            payments_revision: input.revision,
            status: "submitted",
            remote_invoice_id: row.remote_invoice_id,
          },
          data: { payments_revision: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw fail(
            "SUPERPDP_PAYMENT_CONFLICT",
            "Le journal a changé. Actualisez avant de poursuivre.",
          );
        const payment = await tx.electronicInvoicePayment.create({
          data: {
            transmission_id: row.id,
            reference: input.reference,
            payment_date: input.payment_date,
            amount_cents: total,
            allocations_json: allocations,
            payload_json: wire,
            payload_sha256: digest(wire),
            requested_by: actor.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "superpdp.payment_recorded",
            organization_id: getOrganizationId(),
            resource_type: "electronic_invoice_payment",
            resource_id: payment.id,
            user_id: actor.userId,
            metadata_json: JSON.stringify({
              transmission_id: row.id,
              environment: "sandbox",
            }),
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
    return this.view(invoiceId);
  }
  async send(invoiceId: string, paymentId: string, actor: OAuthActor) {
    enabled();
    await this.notCredited(invoiceId);
    const row = await this.transmission(invoiceId);
    if (
      !row?.remote_invoice_id ||
      row.status !== "submitted" ||
      !this.capacities(row).needsReporting
    )
      throw fail(
        "SUPERPDP_PAYMENT_NOT_READY",
        "Ce profil ne permet pas l’envoi d’un encaissement.",
      );
    await prisma.$transaction(async (tx) => {
      const changed = await tx.electronicInvoicePayment.updateMany({
        where: {
          id: paymentId,
          transmission_id: row.id,
          status: "recorded",
          post_started_at: null,
        },
        data: { status: "queued", requested_by: actor.userId },
      });
      if (changed.count !== 1)
        throw fail(
          "SUPERPDP_PAYMENT_CONFLICT",
          "Cet encaissement ne peut pas être renvoyé.",
        );
      await tx.organizationJob.create({
        data: {
          type: "superpdp.payment",
          organization_id: getOrganizationId(),
          idempotency_key: `superpdp.payment:${paymentId}:${crypto.randomUUID()}`,
          payload_json: JSON.stringify({ payment_id: paymentId }),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "superpdp.payment_send_queued",
          organization_id: getOrganizationId(),
          resource_type: "electronic_invoice_payment",
          resource_id: paymentId,
          user_id: actor.userId,
          metadata_json: '{"environment":"sandbox"}',
        },
      });
    });
    return this.view(invoiceId);
  }
  async process(paymentId: string) {
    enabled();
    const p = await prisma.electronicInvoicePayment.findUnique({
      where: { id: paymentId },
    });
    if (!p || !["queued", "sending"].includes(p.status)) return;
    if (p.post_started_at) {
      if (!p.operation_expires_at || p.operation_expires_at < new Date())
        await prisma.electronicInvoicePayment.updateMany({
          where: { id: p.id, operation_id: p.operation_id, status: "sending" },
          data: {
            status: "send_unknown",
            operation_id: null,
            operation_expires_at: null,
            last_error_code: "SUPERPDP_PAYMENT_UNCONFIRMED",
          },
        });
      return;
    }
    const op = crypto.randomUUID();
    const claimed = await prisma.electronicInvoicePayment.updateMany({
      where: {
        id: p.id,
        status: "queued",
        post_started_at: null,
        OR: [
          { operation_id: null },
          { operation_expires_at: { lt: new Date() } },
        ],
      },
      data: {
        operation_id: op,
        operation_expires_at: new Date(Date.now() + 120_000),
      },
    });
    if (claimed.count !== 1)
      throw fail("SUPERPDP_BUSY", "Un encaissement est déjà en traitement.");
    const owner = async () => {
      const user = await prisma.appUser.findUnique({
        where: { id: p.requested_by },
      });
      const membership = user?.user_id
        ? await prisma.membership.findUnique({
            where: {
              user_id_organization_id: {
                user_id: user.user_id,
                organization_id: getOrganizationId(),
              },
            },
          })
        : null;
      if (
        !user?.is_active ||
        !user.is_owner ||
        (user.user_id && membership?.status !== "active")
      )
        throw fail(
          "SUPERPDP_OWNER_REQUIRED",
          "L’administrateur à l’origine de la demande n’est plus autorisé.",
        );
    };
    try {
      const row = await prisma.electronicInvoiceTransmission.findUniqueOrThrow({
        where: { id: p.transmission_id },
      });
      const invoice = await prisma.facture.findUniqueOrThrow({
        where: { id: row.invoice_id },
      });
      if (
        row.environment !== "sandbox" ||
        row.status !== "submitted" ||
        !row.remote_invoice_id ||
        !row.post_started_at ||
        digest(row.payload_json) !== row.payload_sha256 ||
        digest(String(invoice.immutable_snapshot)) !== row.snapshot_sha256 ||
        digest(p.payload_json) !== p.payload_sha256 ||
        !this.capacities(row).needsReporting
      )
        throw fail(
          "SUPERPDP_PAYMENT_NOT_READY",
          "La facture ou le profil d’encaissement doit être vérifié.",
        );
      await owner();
      await this.oauth.withSandboxAccess(
        row.fiscal_entity_id,
        { connectionId: row.connection_id, companyId: row.remote_company_id },
        { userId: p.requested_by, sessionHash: "background-job" },
        async (token) => {
          await assertRemoteProfile(
            this.transport,
            token,
            row.remote_company_id,
            profileOf(row),
          );
          const remote = await this.transport.invoice(
            token,
            row.remote_invoice_id!,
          );
          if (
            remote.id !== row.remote_invoice_id ||
            remote.company_id !== row.remote_company_id ||
            remote.direction !== "out" ||
            remote.external_id !== row.external_id ||
            remote.processing_rule !== "B2C"
          )
            throw fail(
              "SUPERPDP_REMOTE_INVOICE_MISMATCH",
              "La facture distante doit être confirmée comme B2C avant tout encaissement.",
            );
          // No public idempotency key exists for invoice_events. Unknown or externally-created
          // receipts require human investigation, never matching on date/amount alone.
          const history = await this.transport.events(
            token,
            row.remote_invoice_id!,
            null,
          );
          const payments = await prisma.electronicInvoicePayment.findMany({
            where: { transmission_id: row.id },
          });
          const known = new Set(
            payments.map((item) => item.remote_event_id).filter(Boolean),
          );
          if (
            history.has_after ||
            history.data.some(
              (event) =>
                event.invoice_id !== row.remote_invoice_id ||
                [
                  "api:invalid",
                  "api:rejected",
                  "fr:210",
                  "fr:213",
                  "fr:501",
                ].includes(event.status_code) ||
                (event.status_code.startsWith("ppf:") &&
                  /(?:ack-error|rejected)$/.test(event.status_code)) ||
                (event.status_code === "fr:212" && !known.has(event.id)),
            ) ||
            payments.some(
              (item) =>
                item.id !== p.id &&
                (item.status === "send_unknown" || item.status === "sending"),
            )
          )
            throw fail(
              "SUPERPDP_PAYMENT_HISTORY",
              "Un rejet, un encaissement distant non rapproché, un résultat incertain ou un historique volumineux nécessite une vérification humaine. Aucun envoi supplémentaire n’est autorisé.",
            );
          enabled();
          await owner();
          await this.notCredited(row.invoice_id);
          // Durable intent BEFORE the only possible POST; expired leases cannot dispatch.
          const started = await prisma.electronicInvoicePayment.updateMany({
            where: {
              id: p.id,
              operation_id: op,
              operation_expires_at: { gt: new Date() },
              post_started_at: null,
              status: "queued",
            },
            data: { status: "sending", post_started_at: new Date() },
          });
          if (started.count !== 1)
            throw fail(
              "SUPERPDP_PAYMENT_CONFLICT",
              "Le journal a changé avant l’envoi.",
            );
          const event = await this.transport.payment(
            token,
            row.remote_invoice_id!,
            JSON.parse(p.payload_json),
          );
          if (
            event.invoice_id !== row.remote_invoice_id ||
            event.status_code !== "fr:212" ||
            !matchesPaymentReceipt(p, event)
          )
            throw fail(
              "SUPERPDP_PAYMENT_UNCONFIRMED",
              "Le reçu d’encaissement ne correspond pas exactement à la demande.",
            );
          await prisma.$transaction(async (tx) => {
            const saved = await tx.electronicInvoicePayment.updateMany({
              where: { id: p.id, operation_id: op },
              data: {
                status: "submitted",
                remote_event_id: event.id,
                operation_id: null,
                operation_expires_at: null,
                last_error_code: null,
              },
            });
            if (saved.count !== 1)
              throw fail(
                "SUPERPDP_PAYMENT_CONFLICT",
                "Le reçu n’a pas pu être conservé.",
              );
            await tx.electronicInvoiceEvent.upsert({
              where: {
                organization_id_transmission_id_event_key: {
                  organization_id: getOrganizationId(),
                  transmission_id: row.id,
                  event_key: `remote:${event.id}`,
                },
              },
              create: {
                transmission_id: row.id,
                event_key: `remote:${event.id}`,
                status_code: event.status_code,
                occurred_at: new Date(event.created_at),
                payload_json: JSON.stringify(event),
              },
              update: {},
            });
            await tx.auditLog.create({
              data: {
                action: "superpdp.payment_receipt_confirmed",
                organization_id: getOrganizationId(),
                resource_type: "electronic_invoice_payment",
                resource_id: p.id,
                user_id: p.requested_by,
                metadata_json: JSON.stringify({
                  remote_event_id: event.id,
                  environment: "sandbox",
                }),
              },
            });
          });
        },
      );
    } catch (error) {
      const current = await prisma.electronicInvoicePayment.findUniqueOrThrow({
        where: { id: p.id },
      });
      await prisma.electronicInvoicePayment.updateMany({
        where: { id: p.id, operation_id: op },
        data: {
          status: current.post_started_at ? "send_unknown" : "recorded",
          operation_id: null,
          operation_expires_at: null,
          last_error_code: codeOf(error),
        },
      });
      // A background retry can never repeat a possibly accepted POST.
    }
  }
}

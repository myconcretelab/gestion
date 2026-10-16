import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  ElectronicInvoiceTransmission as Transmission,
  Prisma,
} from "@prisma/client";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getOrganizationId } from "../organizations/context.js";
import { fromJsonString } from "../../utils/jsonFields.js";
import { resolveDataDir } from "../../utils/paths.js";
import { readArchivedInvoicePdf } from "../documents/invoiceLifecycle.js";
import type { buildStructuredInvoice } from "../documents/invoiceFiscal.js";
import { registerGeneratedDocumentAsset } from "../documents/storage.js";
import { SuperPdpService, type OAuthActor } from "./service.js";
import { digest, sandboxConfig, superPdpError } from "./secrets.js";
import {
  b2cEnabled,
  reportingProfileSchema,
  assertLocalRegime,
  assertRemoteProfile,
} from "./reporting.js";
import {
  SuperPdpTransport,
  MAX_DOCUMENT_BYTES,
  type RemoteInvoice,
  validationSchema,
} from "./transport.js";

const electronicAddress = z
  .string()
  .trim()
  .regex(/^\d{4}:[A-Za-z0-9._*+@/-]{1,180}$/);
export const preparationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    seller_address: electronicAddress,
    buyer_address: electronicAddress.optional(),
    b2c: reportingProfileSchema.optional(),
    confirm_test_data: z.literal(true),
  })
  .strict();
export const revisionSchema = z
  .object({
    revision: z.number().int().positive(),
    confirm_test_data: z.literal(true),
  })
  .strict();
export const emissionEnabled = () => {
  sandboxConfig();
  if (!env.SUPERPDP_SANDBOX_EMISSION_ENABLED)
    throw superPdpError(
      "SUPERPDP_EMISSION_DISABLED",
      "L’émission SuperPDP de test n’est pas activée sur ce serveur.",
      503,
    );
};
const errorCode = (error: unknown) => {
  const code = (error as { code?: string })?.code ?? "";
  return /^SUPERPDP_[A-Z_]+$/.test(code) ? code : "SUPERPDP_EMISSION_STORAGE";
};
const failure = (code: string, message: string) => superPdpError(code, message);
const addressObject = (address: string) => ({
  scheme: address.slice(0, 4),
  value: address.slice(5),
});
const sourceSnapshot = (value: unknown) =>
  fromJsonString<{
    issuer: { entity: { id: string; siren: string; vat_regime: string } };
    structured_invoice: ReturnType<typeof buildStructuredInvoice>;
  } | null>(value, null);
const snapshotHash = (value: unknown) =>
  digest(typeof value === "string" ? value : JSON.stringify(value));
const actorOf = (row: Transmission): OAuthActor => ({
  userId: row.requested_by,
  sessionHash: "background-job",
});
const scopeOf = (row: Transmission) => ({
  connectionId: row.connection_id,
  companyId: row.remote_company_id,
});
const leaseDate = () => new Date(Date.now() + 120_000);
const opWhere = (row: Transmission, operationId: string) => ({
  id: row.id,
  revision: row.revision,
  operation_id: operationId,
});
const audit = (
  tx: TenantTransactionClient,
  row: Transmission,
  action: string,
  userId: string,
) =>
  tx.auditLog.create({
    data: {
      organization_id: getOrganizationId(),
      action,
      resource_type: "electronic_invoice_transmission",
      resource_id: row.id,
      user_id: userId,
      metadata_json: JSON.stringify({
        invoice_id: row.invoice_id,
        environment: "sandbox",
        revision: row.revision,
      }),
    },
  });
const localEvent = (
  tx: TenantTransactionClient,
  row: Transmission,
  code: string,
  metadata: Record<string, unknown> = {},
) =>
  tx.electronicInvoiceEvent.create({
    data: {
      transmission_id: row.id,
      event_key: `local:${crypto.randomUUID()}`,
      status_code: code,
      occurred_at: new Date(),
      payload_json: JSON.stringify({
        revision: row.revision,
        preparation_id: row.preparation_id,
        ...metadata,
      }),
    },
  });
const queue = (
  tx: TenantTransactionClient,
  row: Transmission,
  type: "prepare" | "send" | "reconcile",
  key: string,
) =>
  tx.organizationJob.upsert({
    where: {
      organization_id_idempotency_key: {
        organization_id: getOrganizationId(),
        idempotency_key: key,
      },
    },
    create: {
      organization_id: getOrganizationId(),
      type: `superpdp.${type}`,
      payload_json: JSON.stringify({
        transmission_id: row.id,
        revision: row.revision,
      }),
      idempotency_key: key,
    },
    update: {},
  });

export class SuperPdpEmission {
  constructor(
    private readonly oauth = new SuperPdpService(),
    private readonly transport = new SuperPdpTransport(),
  ) {}
  private async invoice(id: string) {
    const invoice = await prisma.facture.findUnique({ where: { id } });
    if (!invoice)
      throw superPdpError(
        "SUPERPDP_INVOICE_NOT_FOUND",
        "Facture introuvable.",
        404,
      );
    return invoice;
  }
  private async row(id: string) {
    const row = await prisma.electronicInvoiceTransmission.findUnique({
      where: { id },
    });
    if (!row || row.environment !== "sandbox")
      throw superPdpError(
        "SUPERPDP_TRANSMISSION_NOT_FOUND",
        "Transmission introuvable.",
        404,
      );
    return row;
  }
  async view(invoiceId: string) {
    const invoice = await this.invoice(invoiceId);
    const row = await prisma.electronicInvoiceTransmission.findUnique({
      where: {
        organization_id_invoice_id_environment: {
          organization_id: getOrganizationId(),
          invoice_id: invoice.id,
          environment: "sandbox",
        },
      },
    });
    let available = true,
      reason: string | null = null;
    try {
      emissionEnabled();
    } catch (error) {
      available = false;
      reason = (error as Error).message;
    }
    const structured = sourceSnapshot(
      invoice.immutable_snapshot,
    )?.structured_invoice;
    const isB2c = structured?.processing_rule_candidate === "B2C";
    if (available && isB2c) {
      try {
        b2cEnabled();
      } catch (error) {
        available = false;
        reason = (error as Error).message;
      }
    }
    if (
      available &&
      (invoice.lifecycle_status !== "issued" ||
        !["B2B", "B2C"].includes(structured?.processing_rule_candidate ?? "") ||
        (isB2c &&
          structured?.en_invoice_candidate.buyer.postal_address.country_code !==
            "FR"))
    ) {
      available = false;
      reason =
        "Ce lot accepte seulement les factures/avoirs émis avec données structurées B2B ou B2C France. Les historiques, brouillons et opérations internationales restent exclus.";
    }
    const events = row
      ? await prisma.electronicInvoiceEvent.findMany({
          where: { transmission_id: row.id },
          orderBy: [{ occurred_at: "desc" }, { id: "desc" }],
          take: 200,
        })
      : [];
    return {
      available,
      reason,
      environment: "sandbox",
      revision: row?.revision ?? 0,
      processing_rule: structured?.processing_rule_candidate ?? null,
      issuer_vat_regime:
        sourceSnapshot(invoice.immutable_snapshot)?.issuer.entity.vat_regime ??
        null,
      reporting_profile: row?.reporting_profile_json
        ? reportingProfileSchema.parse(JSON.parse(row.reporting_profile_json))
        : null,
      transmission: row
        ? {
            id: row.id,
            status: row.status,
            remote_invoice_id: row.remote_invoice_id,
            external_id: row.external_id,
            original_pdf_sha256: row.original_pdf_sha256,
            artifact_sha256: row.artifact_sha256,
            validation: row.validation_json
              ? validationSchema.parse(JSON.parse(row.validation_json))
              : null,
            last_error_code: row.last_error_code,
            last_synced_at: row.last_synced_at,
            post_started_at: row.post_started_at,
            seller_address: (() => {
              const a = JSON.parse(row.payload_json).seller.electronic_address;
              return `${a.scheme}:${a.value}`;
            })(),
            buyer_address: (() => {
              const a = JSON.parse(row.payload_json).buyer.electronic_address;
              return a ? `${a.scheme}:${a.value}` : "";
            })(),
            can_prepare:
              !row.post_started_at &&
              ["ready", "validation_failed", "prepare_failed"].includes(
                row.status,
              ),
            can_send:
              row.status === "ready" &&
              row.validation_valid &&
              !row.post_started_at,
          }
        : null,
      events: events.map((event) => ({
        id: event.id,
        status_code: event.status_code,
        occurred_at: event.occurred_at,
        details: JSON.parse(event.payload_json),
      })),
      history_truncated: events.length === 200,
    };
  }
  async prepare(invoiceId: string, payload: unknown, actor: OAuthActor) {
    emissionEnabled();
    const input = preparationSchema.parse(payload);
    const invoice = await this.invoice(invoiceId);
    const snapshot = sourceSnapshot(invoice.immutable_snapshot);
    if (
      invoice.lifecycle_status !== "issued" ||
      !invoice.fiscal_entity_id ||
      !invoice.pdf_sha256 ||
      snapshot?.issuer?.entity?.id !== invoice.fiscal_entity_id ||
      snapshot.structured_invoice?.version !== 1 ||
      !["B2B", "B2C"].includes(
        snapshot.structured_invoice.processing_rule_candidate,
      )
    ) {
      throw failure(
        "SUPERPDP_INVOICE_INELIGIBLE",
        "Seul un document émis et structuré B2B/B2C France peut être préparé. Aucun document historique ne sera transmis.",
      );
    }
    const connection = await prisma.superPdpConnection.findUnique({
      where: {
        organization_id_fiscal_entity_id_environment: {
          organization_id: getOrganizationId(),
          fiscal_entity_id: invoice.fiscal_entity_id,
          environment: "sandbox",
        },
      },
    });
    if (
      connection?.status !== "connected" ||
      !connection.remote_company_id ||
      connection.local_siren !== snapshot.issuer.entity.siren
    ) {
      throw failure(
        "SUPERPDP_CONNECTION_REQUIRED",
        "Connectez et vérifiez d’abord cette entreprise dans SuperPDP de test.",
      );
    }
    const source = snapshot.structured_invoice.en_invoice_candidate;
    const isB2c =
      snapshot.structured_invoice.processing_rule_candidate === "B2C";
    if (isB2c) {
      b2cEnabled();
      if (
        !input.b2c ||
        input.buyer_address ||
        source.buyer.postal_address.country_code !== "FR"
      )
        throw failure(
          "SUPERPDP_B2C_PROFILE",
          "Confirmez le profil B2C France sans adresse d’annuaire de particulier.",
        );
      assertLocalRegime(snapshot.issuer.entity.vat_regime, input.b2c);
      if (
        Number(source.totals.paid_amount) > 0 &&
        Number(source.totals.amount_due_for_payment) > 0
      )
        throw failure(
          "SUPERPDP_B2C_ADVANCE",
          "Le traitement des acomptes déduits à l’émission nécessite une recette dédiée. Ce document ne sera pas déposé dans ce lot.",
        );
    } else if (!input.buyer_address || input.b2c)
      throw failure(
        "SUPERPDP_BUYER_ADDRESS",
        "Une adresse d’acheteur B2B est obligatoire ; le profil B2C ne peut pas être appliqué à une entreprise.",
      );
    if (
      input.buyer_address?.startsWith("0225:") &&
      !input.buyer_address
        .slice(5)
        .startsWith(
          source.buyer.legal_registration_identifier?.value ?? "INVALID",
        )
    ) {
      throw failure(
        "SUPERPDP_BUYER_ADDRESS",
        "L’adresse française de destination ne correspond pas au SIREN de l’acheteur figé.",
      );
    }
    const pdf = await readArchivedInvoicePdf(invoice);
    if (pdf.contents.length > MAX_DOCUMENT_BYTES)
      throw failure(
        "SUPERPDP_DOCUMENT_SIZE",
        "Le PDF dépasse la taille autorisée pour ce pilote.",
      );
    const candidate = JSON.stringify({
      ...source,
      process_control: {
        specification_identifier: "urn:cen.eu:en16931:2017",
        ...(isB2c
          ? {
              business_process_type: `${input.b2c!.operation === "goods" ? "B" : "S"}${Number(source.totals.amount_due_for_payment) === 0 ? "2" : "1"}`,
            }
          : {}),
      },
      ...(isB2c
        ? {
            notes: [{ subject_code: "BAR", note: "B2C" }],
            vat_point_date_code:
              input.b2c!.operation === "goods"
                ? "35"
                : input.b2c!.has_vat_on_debits
                  ? "3"
                  : "432",
          }
        : {}),
      seller: {
        ...source.seller,
        electronic_address: addressObject(input.seller_address),
      },
      buyer: {
        ...source.buyer,
        ...(!isB2c
          ? { electronic_address: addressObject(input.buyer_address!) }
          : {}),
      },
    });
    if (Buffer.byteLength(candidate) > 512 * 1024)
      throw failure(
        "SUPERPDP_DOCUMENT_SIZE",
        "Le document structuré dépasse la taille autorisée.",
      );
    await prisma.$transaction(
      async (tx) => {
        const old = await tx.electronicInvoiceTransmission.findUnique({
          where: {
            organization_id_invoice_id_environment: {
              organization_id: getOrganizationId(),
              invoice_id: invoice.id,
              environment: "sandbox",
            },
          },
        });
        if (
          (old?.revision ?? 0) !== input.revision ||
          (old &&
            (old.post_started_at ||
              !["ready", "validation_failed", "prepare_failed"].includes(
                old.status,
              )))
        ) {
          throw failure(
            "SUPERPDP_EMISSION_CONFLICT",
            "La préparation a changé ou un dépôt a déjà été tenté. Rechargez son état.",
          );
        }
        const data = {
          connection_id: connection.id,
          remote_company_id: connection.remote_company_id!,
          preparation_id: crypto.randomUUID(),
          payload_json: candidate,
          payload_sha256: digest(candidate),
          reporting_profile_json: isB2c ? JSON.stringify(input.b2c) : null,
          snapshot_sha256: snapshotHash(invoice.immutable_snapshot),
          original_pdf_sha256: invoice.pdf_sha256!,
          artifact_path: null,
          artifact_sha256: null,
          validation_json: null,
          validation_valid: false,
          status: "queued_prepare",
          requested_by: actor.userId,
          last_error_code: null,
          operation_id: null,
          operation_expires_at: null,
        };
        const row = old
          ? await tx.electronicInvoiceTransmission.update({
              where: {
                id: old.id,
                revision: old.revision,
                post_started_at: null,
              },
              data: { ...data, revision: { increment: 1 } },
            })
          : await tx.electronicInvoiceTransmission.create({
              data: {
                ...data,
                invoice_id: invoice.id,
                fiscal_entity_id: invoice.fiscal_entity_id!,
                external_id: crypto.randomUUID(),
              },
            });
        // Each requested projection is retained append-only even if its subsequent conversion fails.
        await localEvent(tx, row, "local:preparation_queued", {
          payload: JSON.parse(candidate),
          payload_sha256: row.payload_sha256,
        });
        await queue(
          tx,
          row,
          "prepare",
          `superpdp.prepare:${row.id}:${row.revision}`,
        );
        await audit(
          tx,
          row,
          "superpdp.invoice_preparation_queued",
          actor.userId,
        );
      },
      { isolationLevel: "Serializable" },
    );
    return this.view(invoiceId);
  }
  async send(invoiceId: string, payload: unknown, actor: OAuthActor) {
    emissionEnabled();
    const input = revisionSchema.parse(payload);
    await prisma.$transaction(
      async (tx) => {
        const row = await tx.electronicInvoiceTransmission.findUnique({
          where: {
            organization_id_invoice_id_environment: {
              organization_id: getOrganizationId(),
              invoice_id: invoiceId,
              environment: "sandbox",
            },
          },
        });
        if (
          !row ||
          row.revision !== input.revision ||
          row.status !== "ready" ||
          !row.validation_valid ||
          row.post_started_at
        ) {
          throw failure(
            "SUPERPDP_EMISSION_CONFLICT",
            "La facture doit être préparée et validée, sans dépôt déjà tenté.",
          );
        }
        await tx.electronicInvoiceTransmission.update({
          where: {
            id: row.id,
            revision: input.revision,
            status: "ready",
            post_started_at: null,
          },
          data: { status: "queued_send", requested_by: actor.userId },
        });
        await queue(
          tx,
          row,
          "send",
          `superpdp.send:${row.id}:${crypto.randomUUID()}`,
        );
        await localEvent(tx, row, "local:send_queued");
        await audit(tx, row, "superpdp.invoice_send_queued", actor.userId);
      },
      { isolationLevel: "Serializable" },
    );
    return this.view(invoiceId);
  }
  async scheduleSync(invoiceId: string) {
    emissionEnabled();
    await this.invoice(invoiceId);
    const row = await prisma.electronicInvoiceTransmission.findUnique({
      where: {
        organization_id_invoice_id_environment: {
          organization_id: getOrganizationId(),
          invoice_id: invoiceId,
          environment: "sandbox",
        },
      },
    });
    if (!row?.post_started_at)
      throw failure(
        "SUPERPDP_NOT_SUBMITTED",
        "Aucun dépôt n’a encore été tenté.",
      );
    if (
      row.operation_id &&
      row.operation_expires_at &&
      row.operation_expires_at > new Date()
    )
      throw failure("SUPERPDP_BUSY", "Une opération est déjà en cours.");
    await prisma.$transaction(async (tx) => {
      await queue(
        tx,
        row,
        "reconcile",
        `superpdp.reconcile:${row.id}:${Math.floor(Date.now() / 30_000)}`,
      );
      await tx.electronicInvoiceTransmission.update({
        where: { id: row.id },
        data: { next_sync_at: new Date(Date.now() + 60_000) },
      });
    });
    return this.view(invoiceId);
  }
  private async claim(row: Transmission, status: string) {
    const operationId = crypto.randomUUID();
    const result = await prisma.electronicInvoiceTransmission.updateMany({
      where: {
        id: row.id,
        revision: row.revision,
        status: row.status,
        post_started_at: row.post_started_at,
        remote_invoice_id: row.remote_invoice_id,
        OR: [
          { operation_id: null },
          { operation_expires_at: { lt: new Date() } },
        ],
      },
      data: {
        operation_id: operationId,
        operation_expires_at: leaseDate(),
        status,
      },
    });
    if (result.count !== 1)
      throw failure(
        "SUPERPDP_BUSY",
        "Une opération de transmission est déjà en cours.",
      );
    return operationId;
  }
  private async original(row: Transmission) {
    const invoice = await this.invoice(row.invoice_id);
    if (
      invoice.lifecycle_status !== "issued" ||
      invoice.fiscal_entity_id !== row.fiscal_entity_id ||
      invoice.pdf_sha256 !== row.original_pdf_sha256 ||
      snapshotHash(invoice.immutable_snapshot) !== row.snapshot_sha256 ||
      digest(row.payload_json) !== row.payload_sha256
    ) {
      throw failure(
        "SUPERPDP_IMMUTABLE_MISMATCH",
        "L’instantané ou l’archive ne correspond plus à la préparation. Aucun dépôt n’est autorisé.",
      );
    }
    return readArchivedInvoicePdf(invoice);
  }
  private async activeOwner(row: Transmission) {
    const user = await prisma.appUser.findUnique({
      where: { id: row.requested_by },
    });
    if (!user?.is_active || !user.is_owner)
      throw failure(
        "SUPERPDP_OWNER_REQUIRED",
        "L’administrateur à l’origine de cette demande n’est plus autorisé.",
      );
    if (user.user_id) {
      const membership = await prisma.membership.findUnique({
        where: {
          user_id_organization_id: {
            user_id: user.user_id,
            organization_id: getOrganizationId(),
          },
        },
      });
      if (membership?.status !== "active")
        throw failure(
          "SUPERPDP_OWNER_REQUIRED",
          "L’accès de l’administrateur à ce compte n’est plus actif.",
        );
    }
  }
  private async directoryCheck(row: Transmission, token: string) {
    if (row.reporting_profile_json) {
      b2cEnabled();
      await assertRemoteProfile(
        this.transport,
        token,
        row.remote_company_id,
        reportingProfileSchema.parse(JSON.parse(row.reporting_profile_json)),
      );
    }
    const address = JSON.parse(row.payload_json).seller.electronic_address;
    const entries = await this.transport.directory(token);
    if (
      !entries.data.some(
        (entry) =>
          entry.company.id === row.remote_company_id &&
          entry.status === "created" &&
          entry.identifier === `${address.scheme}:${address.value}`,
      )
    ) {
      throw failure(
        "SUPERPDP_SELLER_ADDRESS",
        "L’adresse de réponse doit appartenir à l’entreprise SuperPDP de test connectée et être active. Aucun annuaire n’est créé automatiquement.",
      );
    }
  }
  private async saveResult(
    row: Transmission,
    operationId: string,
    data: Prisma.ElectronicInvoiceTransmissionUpdateManyMutationInput,
    code: string,
    metadata: Record<string, unknown> = {},
  ) {
    return prisma.$transaction(async (tx) => {
      const saved = await tx.electronicInvoiceTransmission.updateMany({
        where: opWhere(row, operationId),
        data: { ...data, operation_id: null, operation_expires_at: null },
      });
      if (saved.count !== 1)
        throw failure(
          "SUPERPDP_EMISSION_CONFLICT",
          "Le résultat n’a pas pu être confirmé.",
        );
      await localEvent(tx, row, code, metadata);
    });
  }
  async processPrepare(id: string, revision: number) {
    emissionEnabled();
    const row = await this.row(id);
    if (
      row.revision !== revision ||
      row.post_started_at ||
      !["queued_prepare", "preparing", "prepare_failed"].includes(row.status)
    )
      return;
    const operationId = await this.claim(row, "preparing");
    try {
      await this.activeOwner(row);
      const original = await this.original(row);
      await this.oauth.withSandboxAccess(
        row.fiscal_entity_id,
        scopeOf(row),
        actorOf(row),
        async (token) => {
          await this.directoryCheck(row, token);
          const converted = await this.transport.convert(
            row.payload_json,
            original.contents,
          );
          const report = await this.transport.validate(converted);
          const first = report.data[0];
          const valid =
            first.is_valid &&
            !first.error &&
            first.subreports.some((part) => part.checks_count > 0) &&
            first.subreports.every((part) => part.failures.length === 0);
          const storageKey = path.join(
            env.PDF_SUBDIR,
            "electronic",
            "sandbox",
            row.id,
            row.preparation_id,
            `${crypto.randomUUID()}.pdf`,
          );
          const target = path.join(
            resolveDataDir(),
            "organizations",
            getOrganizationId(),
            storageKey,
          );
          await fs.mkdir(path.dirname(target), {
            recursive: true,
            mode: 0o700,
          });
          await fs.writeFile(target, converted, { flag: "wx", mode: 0o600 });
          await registerGeneratedDocumentAsset({
            organizationId: getOrganizationId(),
            storageKey,
            absolutePath: target,
          });
          await this.saveResult(
            row,
            operationId,
            {
              status: valid ? "ready" : "validation_failed",
              artifact_path: storageKey,
              artifact_sha256: crypto
                .createHash("sha256")
                .update(converted)
                .digest("hex"),
              validation_json: JSON.stringify(report),
              validation_valid: valid,
              last_error_code: valid ? null : "SUPERPDP_VALIDATION_FAILED",
            },
            "local:validation_completed",
            {
              valid,
              validation: report,
              artifact_path: storageKey,
              artifact_sha256: crypto
                .createHash("sha256")
                .update(converted)
                .digest("hex"),
            },
          );
        },
      );
    } catch (error) {
      // Re-entrant after an acknowledgement loss: never overwrite a committed preparation result.
      const current = await this.row(id);
      if (current.operation_id === operationId)
        await this.saveResult(
          row,
          operationId,
          { status: "prepare_failed", last_error_code: errorCode(error) },
          "local:preparation_failed",
          { error_code: errorCode(error) },
        );
      throw failure(
        errorCode(error),
        "La préparation de test n’a pas été confirmée. Consultez son état et le rapport de validation.",
      );
    }
  }
  async artifact(invoiceId: string) {
    await this.invoice(invoiceId);
    const row = await prisma.electronicInvoiceTransmission.findUnique({
      where: {
        organization_id_invoice_id_environment: {
          organization_id: getOrganizationId(),
          invoice_id: invoiceId,
          environment: "sandbox",
        },
      },
    });
    if (!row?.artifact_path || !row.artifact_sha256)
      throw failure(
        "SUPERPDP_ARTIFACT_MISSING",
        "Aucun Factur-X préparé n’est disponible.",
      );
    const root = path.join(
      resolveDataDir(),
      "organizations",
      getOrganizationId(),
    );
    const target = await fs.realpath(path.resolve(root, row.artifact_path));
    const realRoot = await fs.realpath(root);
    const relative = path.relative(realRoot, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw failure(
        "SUPERPDP_ARTIFACT_PATH",
        "Archive électronique inaccessible.",
      );
    const stat = await fs.stat(target);
    if (stat.size > MAX_DOCUMENT_BYTES)
      throw failure("SUPERPDP_DOCUMENT_SIZE", "Archive trop volumineuse.");
    const contents = await fs.readFile(target);
    if (
      crypto.createHash("sha256").update(contents).digest("hex") !==
      row.artifact_sha256
    )
      throw failure(
        "SUPERPDP_ARTIFACT_MISMATCH",
        "L’empreinte du Factur-X ne correspond plus.",
      );
    return contents;
  }
  private assertRemote(row: Transmission, remote: RemoteInvoice) {
    if (
      remote.company_id !== row.remote_company_id ||
      remote.direction !== "out" ||
      remote.external_id !== row.external_id ||
      (row.reporting_profile_json && remote.processing_rule !== "B2C") ||
      (remote.processing_rule &&
        remote.processing_rule !==
          (row.reporting_profile_json ? "B2C" : "B2B")) ||
      (row.remote_invoice_id && remote.id !== row.remote_invoice_id)
    ) {
      throw failure(
        "SUPERPDP_REMOTE_INVOICE_MISMATCH",
        "La facture distante ne correspond pas à cette transmission.",
      );
    }
  }
  async processSend(id: string, revision: number) {
    emissionEnabled();
    const row = await this.row(id);
    if (row.revision !== revision) return;
    if (row.post_started_at) {
      // A lease expiration or response loss never authorizes a second POST.
      if (
        row.status === "sending" &&
        (!row.operation_expires_at || row.operation_expires_at < new Date())
      ) {
        await prisma.electronicInvoiceTransmission.updateMany({
          where: {
            id: row.id,
            status: "sending",
            operation_id: row.operation_id,
          },
          data: {
            status: "send_unknown",
            operation_id: null,
            operation_expires_at: null,
            next_sync_at: new Date(),
          },
        });
      }
      return;
    }
    if (row.status !== "queued_send") return;
    const operationId = await this.claim(row, "queued_send");
    try {
      await this.activeOwner(row);
      await this.original(row);
      const pdf = await this.artifact(row.invoice_id);
      const report = validationSchema.parse(
        JSON.parse(row.validation_json ?? "null"),
      );
      if (!row.validation_valid || !report.data[0].is_valid)
        throw failure(
          "SUPERPDP_VALIDATION_REQUIRED",
          "Une validation positive est obligatoire avant tout dépôt.",
        );
      await this.oauth.withSandboxAccess(
        row.fiscal_entity_id,
        scopeOf(row),
        actorOf(row),
        async (token) => {
          await this.directoryCheck(row, token);
          emissionEnabled();
          await this.activeOwner(row);
          const started = await prisma.electronicInvoiceTransmission.updateMany(
            {
              where: { ...opWhere(row, operationId), post_started_at: null },
              data: {
                status: "sending",
                post_started_at: new Date(),
                next_sync_at: new Date(Date.now() + 60_000),
              },
            },
          );
          if (started.count !== 1)
            throw failure(
              "SUPERPDP_EMISSION_CONFLICT",
              "Le dépôt a déjà été tenté ou la préparation a changé.",
            );
          const remote = await this.transport.send(
            token,
            pdf,
            row.external_id,
            row.reporting_profile_json ? "B2C" : "B2B",
          );
          this.assertRemote(row, remote);
          await this.saveResult(
            row,
            operationId,
            {
              remote_invoice_id: remote.id,
              status: "submitted",
              last_error_code: null,
              next_sync_at: new Date(),
            },
            "local:deposit_confirmed",
            { remote_invoice_id: remote.id },
          );
        },
      );
    } catch (error) {
      const current = await this.row(id);
      if (current.operation_id === operationId)
        await this.saveResult(
          row,
          operationId,
          {
            status: current.post_started_at ? "send_unknown" : "ready",
            last_error_code: errorCode(error),
            next_sync_at: current.post_started_at ? new Date() : null,
          },
          current.post_started_at
            ? "local:deposit_unknown"
            : "local:send_blocked",
          { error_code: errorCode(error) },
        );
      // No job retry may repeat a possibly accepted POST. Recovery is read-only reconciliation.
    }
  }
  async processReconcile(id: string) {
    emissionEnabled();
    const row = await this.row(id);
    if (!row.post_started_at) return;
    const operationId = await this.claim(
      row,
      row.remote_invoice_id ? "submitted" : "send_unknown",
    );
    try {
      await this.oauth.withSandboxAccess(
        row.fiscal_entity_id,
        scopeOf(row),
        actorOf(row),
        async (token) => {
          let remoteId = row.remote_invoice_id;
          if (!remoteId) {
            const list = await this.transport.list(token, row.reconcile_cursor);
            let last = row.reconcile_cursor;
            for (const remote of list.data) {
              if (last && BigInt(remote.id) <= BigInt(last))
                throw failure(
                  "SUPERPDP_CURSOR_INVALID",
                  "Pagination distante incohérente.",
                );
              last = remote.id;
            }
            if (list.has_after && (!last || last === row.reconcile_cursor))
              throw failure(
                "SUPERPDP_CURSOR_INVALID",
                "La pagination distante n’avance pas.",
              );
            const matches = list.data.filter(
              (item) => item.external_id === row.external_id,
            );
            if (matches.length > 1)
              throw failure(
                "SUPERPDP_REMOTE_DUPLICATE",
                "Plusieurs factures distantes portent la même référence. Intervention nécessaire.",
              );
            if (matches[0]) {
              this.assertRemote(row, matches[0]);
              remoteId = matches[0].id;
            }
            if (!remoteId) {
              await this.saveResult(
                row,
                operationId,
                {
                  status: "send_unknown",
                  reconcile_cursor: list.has_after ? last : null,
                  last_synced_at: new Date(),
                  next_sync_at: new Date(
                    Date.now() + (list.has_after ? 30_000 : 300_000),
                  ),
                  last_error_code: "SUPERPDP_DEPOSIT_UNCONFIRMED",
                },
                "local:reconciliation_pending",
                { has_more: list.has_after },
              );
              return;
            }
          }
          this.assertRemote(
            { ...row, remote_invoice_id: remoteId },
            await this.transport.invoice(token, remoteId),
          );
          const list = await this.transport.events(
            token,
            remoteId,
            row.events_cursor,
          );
          let cursor = row.events_cursor;
          for (const event of list.data) {
            if (
              event.invoice_id !== remoteId ||
              (cursor && BigInt(event.id) <= BigInt(cursor))
            )
              throw failure(
                "SUPERPDP_CURSOR_INVALID",
                "Événements distants incohérents.",
              );
            cursor = event.id;
          }
          if (list.has_after && (!cursor || cursor === row.events_cursor))
            throw failure(
              "SUPERPDP_CURSOR_INVALID",
              "La pagination des événements n’avance pas.",
            );
          await prisma.$transaction(
            async (tx) => {
              const saved = await tx.electronicInvoiceTransmission.updateMany({
                where: opWhere(row, operationId),
                data: {
                  remote_invoice_id: remoteId,
                  status: "submitted",
                  events_cursor: cursor,
                  reconcile_cursor: null,
                  operation_id: null,
                  operation_expires_at: null,
                  last_synced_at: new Date(),
                  next_sync_at: new Date(
                    Date.now() + (list.has_after ? 30_000 : 300_000),
                  ),
                  last_error_code: null,
                },
              });
              if (saved.count !== 1)
                throw failure(
                  "SUPERPDP_EMISSION_CONFLICT",
                  "La synchronisation n’a pas pu être confirmée.",
                );
              for (const event of list.data)
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
            },
            { isolationLevel: "Serializable" },
          );
        },
      );
    } catch (error) {
      const current = await this.row(id);
      if (current.operation_id === operationId)
        await this.saveResult(
          row,
          operationId,
          {
            status: current.remote_invoice_id ? "submitted" : "send_unknown",
            last_error_code: errorCode(error),
            next_sync_at: new Date(Date.now() + 300_000),
          },
          "local:sync_failed",
          { error_code: errorCode(error) },
        );
      throw failure(
        errorCode(error),
        "La synchronisation SuperPDP n’a pas été confirmée. Aucun nouveau dépôt n’a été effectué.",
      );
    }
  }
}

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  SuperPdpInboxSync as Sync,
  IncomingInvoice,
  IntervenantExpense,
} from "@prisma/client";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getOrganizationId } from "../organizations/context.js";
import { resolveDataDir } from "../../utils/paths.js";
import { registerGeneratedDocumentAsset } from "../documents/storage.js";
import { SuperPdpService, type OAuthActor } from "./service.js";
import {
  SuperPdpTransport,
  incomingStructuredSchema,
  MAX_DOCUMENT_BYTES,
} from "./transport.js";
import { sandboxConfig, superPdpError } from "./secrets.js";

export const inboxEnabled = () => {
  sandboxConfig();
  if (!env.SUPERPDP_SANDBOX_RECEPTION_ENABLED)
    throw superPdpError(
      "SUPERPDP_INBOX_DISABLED",
      "La synchronisation des achats de test n’est pas activée sur ce serveur.",
      503,
    );
};
const fail = (code: string, message: string, status = 409) =>
  superPdpError(code, message, status);
const codeOf = (error: unknown) =>
  /^SUPERPDP_[A-Z_]+$/.test((error as { code?: string })?.code ?? "")
    ? (error as { code: string }).code
    : "SUPERPDP_INBOX_STORAGE";
const hash = (value: string | Buffer) =>
  crypto.createHash("sha256").update(value).digest("hex");
const op = (sync: Sync, operationId: string) => ({
  id: sync.id,
  revision: sync.revision,
  enabled: true,
  operation_id: operationId,
});
export const inboxConfigSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    confirm_sandbox: z.literal(true),
  })
  .strict();
export const matchSchema = z
  .object({
    revision: z.number().int().positive(),
    expense_id: z.string().min(1).max(200),
    expense_updated_at: z.string().datetime(),
    confirm_match: z.literal(true),
  })
  .strict();
const expenseSnapshot = (expense: IntervenantExpense) => ({
  id: expense.id,
  label: expense.label,
  amount: Number(expense.amount),
  scope: expense.scope,
  gite_id: expense.gite_id,
  year: expense.year,
  month: expense.month,
  updated_at: expense.updatedAt.toISOString(),
});
export const exactCents = (value: string): bigint | null => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || /[1-9]/.test((match[3] ?? "").slice(2))) return null;
  return (
    (match[1] ? -1n : 1n) *
    (BigInt(match[2]) * 100n +
      BigInt((match[3] ?? "").padEnd(2, "0").slice(0, 2)))
  );
};
const activeOwner = async (userId: string) => {
  const user = await prisma.appUser.findUnique({ where: { id: userId } });
  if (!user?.is_active || !user.is_owner)
    throw fail(
      "SUPERPDP_OWNER_REQUIRED",
      "L’administrateur ayant activé la synchronisation n’est plus autorisé.",
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
      throw fail(
        "SUPERPDP_OWNER_REQUIRED",
        "L’accès de l’administrateur à ce compte n’est plus actif.",
      );
  }
};
const eventView = (event: {
  id: string;
  status_code: string;
  occurred_at: Date;
  payload_json: string;
}) => ({
  id: event.id,
  status_code: event.status_code,
  occurred_at: event.occurred_at,
  details: JSON.parse(event.payload_json),
});

export class SuperPdpInbox {
  constructor(
    private readonly oauth = new SuperPdpService(),
    private readonly transport = new SuperPdpTransport(),
  ) {}
  private async connection(entityId: string) {
    const entity = await prisma.fiscalEntity.findUnique({
      where: { id: entityId },
    });
    if (!entity)
      throw fail("SUPERPDP_NOT_FOUND", "Entreprise introuvable.", 404);
    const connection = await prisma.superPdpConnection.findUnique({
      where: {
        organization_id_fiscal_entity_id_environment: {
          organization_id: getOrganizationId(),
          fiscal_entity_id: entityId,
          environment: "sandbox",
        },
      },
    });
    return { entity, connection };
  }
  private async syncFor(entityId: string) {
    const { connection } = await this.connection(entityId);
    const current = connection?.remote_company_id
      ? await prisma.superPdpInboxSync.findUnique({
          where: {
            organization_id_connection_id_remote_company_id_environment: {
              organization_id: getOrganizationId(),
              connection_id: connection.id,
              remote_company_id: connection.remote_company_id,
              environment: "sandbox",
            },
          },
        })
      : null;
    return (
      current ??
      prisma.superPdpInboxSync.findFirst({
        where: { fiscal_entity_id: entityId, environment: "sandbox" },
        orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      })
    );
  }
  async state(entityId: string) {
    const { connection } = await this.connection(entityId);
    const sync = await this.syncFor(entityId);
    let available = true,
      reason: string | null = null;
    try {
      inboxEnabled();
    } catch (error) {
      available = false;
      reason = (error as Error).message;
    }
    if (available && connection?.status !== "connected") {
      available = false;
      reason = "Connectez et vérifiez d’abord l’entreprise SuperPDP de test.";
    }
    if (
      available &&
      sync &&
      sync.remote_company_id !== connection?.remote_company_id
    ) {
      available = false;
      reason =
        "La boîte historique est liée à une autre entreprise SuperPDP. Ne déplacez pas cet historique vers une autre identité.";
    }
    return {
      available,
      reason,
      environment: "sandbox",
      revision: sync?.revision ?? 0,
      sync: sync
        ? {
            id: sync.id,
            enabled: sync.enabled,
            busy:
              !!sync.operation_id &&
              !!sync.operation_expires_at &&
              sync.operation_expires_at > new Date(),
            last_synced_at: sync.last_synced_at,
            last_error_code: sync.last_error_code,
            invoices_cursor: sync.invoices_cursor,
            events_cursor: sync.events_cursor,
          }
        : null,
    };
  }
  async configure(entityId: string, payload: unknown, actor: OAuthActor) {
    const input = inboxConfigSchema.parse(payload);
    // Stopping local synchronization remains possible when the remote connector is unavailable.
    if (input.enabled) inboxEnabled();
    const { connection } = await this.connection(entityId);
    if (!input.enabled) {
      const old = await this.syncFor(entityId);
      if (!old) return this.state(entityId);
      await prisma.$transaction(async (tx) => {
        const stopped = await tx.superPdpInboxSync.updateMany({
          where: { id: old.id, revision: input.revision },
          data: {
            enabled: false,
            revision: { increment: 1 },
            operation_id: null,
            operation_expires_at: null,
            next_sync_at: null,
          },
        });
        if (stopped.count !== 1)
          throw fail(
            "SUPERPDP_INBOX_CONFLICT",
            "La configuration de réception a changé.",
          );
        await tx.auditLog.create({
          data: {
            organization_id: getOrganizationId(),
            action: "superpdp.inbox_disabled",
            resource_type: "superpdp_inbox_sync",
            resource_id: old.id,
            user_id: actor.userId,
          },
        });
      });
      return this.state(entityId);
    }
    if (
      !connection?.remote_company_id ||
      (input.enabled && connection.status !== "connected")
    )
      throw fail(
        "SUPERPDP_CONNECTION_REQUIRED",
        "Vérifiez la connexion SuperPDP de test avant d’activer la synchronisation.",
      );
    const previousSync = await this.syncFor(entityId);
    if (
      previousSync &&
      previousSync.remote_company_id !== connection.remote_company_id
    )
      throw fail(
        "SUPERPDP_INBOX_IDENTITY",
        "La boîte historique est liée à une autre entreprise distante. Utilisez une autre entité fiscale ou faites vérifier la configuration avant toute reprise.",
      );
    await prisma.$transaction(
      async (tx) => {
        const old = await tx.superPdpInboxSync.findUnique({
          where: {
            organization_id_connection_id_remote_company_id_environment: {
              organization_id: getOrganizationId(),
              connection_id: connection.id,
              remote_company_id: connection.remote_company_id!,
              environment: "sandbox",
            },
          },
        });
        if ((old?.revision ?? 0) !== input.revision)
          throw fail(
            "SUPERPDP_INBOX_CONFLICT",
            "La configuration de réception a changé. Rechargez son état.",
          );
        await tx.superPdpInboxSync.updateMany({
          where: {
            connection_id: connection.id,
            ...(old ? { id: { not: old.id } } : {}),
          },
          data: {
            enabled: false,
            revision: { increment: 1 },
            operation_id: null,
            operation_expires_at: null,
            next_sync_at: null,
          },
        });
        const data = {
          enabled: input.enabled,
          requested_by: actor.userId,
          operation_id: null,
          operation_expires_at: null,
          next_sync_at: input.enabled ? new Date() : null,
          last_error_code: null,
        };
        const sync = old
          ? await tx.superPdpInboxSync.update({
              where: { id: old.id, revision: old.revision },
              data: { ...data, revision: { increment: 1 } },
            })
          : await tx.superPdpInboxSync.create({
              data: {
                ...data,
                fiscal_entity_id: entityId,
                connection_id: connection.id,
                remote_company_id: connection.remote_company_id!,
              },
            });
        await tx.auditLog.create({
          data: {
            organization_id: getOrganizationId(),
            action: input.enabled
              ? "superpdp.inbox_enabled"
              : "superpdp.inbox_disabled",
            resource_type: "superpdp_inbox_sync",
            resource_id: sync.id,
            user_id: actor.userId,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
    if (input.enabled) await this.schedule(entityId);
    return this.state(entityId);
  }
  async schedule(entityId: string) {
    inboxEnabled();
    const sync = await this.syncFor(entityId);
    if (!sync?.enabled)
      throw fail(
        "SUPERPDP_INBOX_DISABLED",
        "Activez d’abord la synchronisation locale des achats pour cette entreprise.",
      );
    if (
      sync.operation_id &&
      sync.operation_expires_at &&
      sync.operation_expires_at > new Date()
    )
      throw fail("SUPERPDP_BUSY", "Une synchronisation est déjà en cours.");
    await prisma.$transaction(async (tx) => {
      const updated = await tx.superPdpInboxSync.updateMany({
        where: { id: sync.id, revision: sync.revision, enabled: true },
        data: { next_sync_at: new Date(Date.now() + 60_000) },
      });
      if (updated.count !== 1)
        throw fail("SUPERPDP_INBOX_CONFLICT", "La synchronisation a changé.");
      const key = `superpdp.inbox:${sync.id}:${sync.revision}:${Math.floor(Date.now() / 5_000)}`;
      await tx.organizationJob.upsert({
        where: {
          organization_id_idempotency_key: {
            organization_id: getOrganizationId(),
            idempotency_key: key,
          },
        },
        create: {
          organization_id: getOrganizationId(),
          type: "superpdp.inbox",
          payload_json: JSON.stringify({
            sync_id: sync.id,
            revision: sync.revision,
          }),
          idempotency_key: key,
        },
        update: {},
      });
    });
    return this.state(entityId);
  }
  private async saveOriginal(
    sync: Sync,
    remoteId: string,
    contents: Buffer,
    format: string,
  ) {
    const checksum = hash(contents);
    const storageKey = path.join(
      env.PDF_SUBDIR,
      "incoming",
      "sandbox",
      sync.id,
      remoteId,
      `${checksum}.${format}`,
    );
    const target = path.join(
      resolveDataDir(),
      "organizations",
      getOrganizationId(),
      storageKey,
    );
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    // Publish only complete files. A crash must not leave a partial file under its final hash.
    const temporary = path.join(
      path.dirname(target),
      `.${crypto.randomUUID()}.part`,
    );
    try {
      await fs.writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
      try {
        await fs.link(temporary, target);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          hash(await fs.readFile(target)) !== checksum
        )
          throw error;
      }
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
    await registerGeneratedDocumentAsset({
      organizationId: getOrganizationId(),
      storageKey,
      absolutePath: target,
      contentType: format === "pdf" ? "application/pdf" : "application/xml",
    });
    return {
      original_path: storageKey,
      original_sha256: checksum,
      original_format: format,
    };
  }
  private summary(value: unknown) {
    const parsed = incomingStructuredSchema.safeParse(value);
    const serialized = value ? JSON.stringify(value) : null;
    return {
      structured_json: serialized,
      structured_sha256: serialized ? hash(serialized) : null,
      invoice_number: parsed.success ? parsed.data.number : null,
      supplier_name: parsed.success ? parsed.data.seller.name : null,
      issue_date: parsed.success ? parsed.data.issue_date : null,
      type_code: parsed.success ? parsed.data.type_code : null,
      currency: parsed.success ? parsed.data.currency_code : null,
      total_without_vat: parsed.success
        ? parsed.data.totals.total_without_vat
        : null,
      total_with_vat: parsed.success ? parsed.data.totals.total_with_vat : null,
      total_vat: parsed.success
        ? (parsed.data.totals.total_vat_amount?.value ?? null)
        : null,
      details_next_check_at: parsed.success
        ? null
        : new Date(Date.now() + 300_000),
    };
  }
  async process(syncId: string, revision: number) {
    inboxEnabled();
    const sync = await prisma.superPdpInboxSync.findUnique({
      where: { id: syncId },
    });
    if (
      !sync ||
      sync.environment !== "sandbox" ||
      !sync.enabled ||
      sync.revision !== revision
    )
      return;
    const operationId = crypto.randomUUID();
    const claimed = await prisma.superPdpInboxSync.updateMany({
      where: {
        id: sync.id,
        revision,
        invoices_cursor: sync.invoices_cursor,
        events_cursor: sync.events_cursor,
        enabled: true,
        OR: [
          { operation_id: null },
          { operation_expires_at: { lt: new Date() } },
        ],
      },
      data: {
        operation_id: operationId,
        operation_expires_at: new Date(Date.now() + 120_000),
      },
    });
    if (claimed.count !== 1)
      throw fail(
        "SUPERPDP_BUSY",
        "Une synchronisation des achats est déjà en cours.",
      );
    try {
      await activeOwner(sync.requested_by);
      await this.oauth.withSandboxAccess(
        sync.fiscal_entity_id,
        { connectionId: sync.connection_id, companyId: sync.remote_company_id },
        { userId: sync.requested_by, sessionHash: "inbox-job" },
        async (token) => {
          inboxEnabled();
          const pending = await prisma.incomingInvoice.findFirst({
            where: {
              sync_id: sync.id,
              details_next_check_at: { lte: new Date() },
            },
            orderBy: { details_next_check_at: "asc" },
          });
          const page = await this.transport.incoming(
            token,
            sync.invoices_cursor,
          );
          let invoicesCursor = sync.invoices_cursor;
          const prepared: Array<{
            remoteId: string;
            created: Date;
            data: Awaited<ReturnType<SuperPdpInbox["saveOriginal"]>> &
              ReturnType<SuperPdpInbox["summary"]>;
          }> = [];
          for (const item of page.data) {
            if (
              item.company_id !== sync.remote_company_id ||
              item.direction !== "in" ||
              (invoicesCursor && BigInt(item.id) <= BigInt(invoicesCursor))
            )
              throw fail(
                "SUPERPDP_INBOX_IDENTITY",
                "La page de factures ne correspond pas à l’entreprise ou au curseur attendu.",
              );
            const detail = await this.transport.incomingDetail(token, item.id);
            if (
              detail.id !== item.id ||
              detail.company_id !== sync.remote_company_id ||
              detail.direction !== "in"
            )
              throw fail(
                "SUPERPDP_INBOX_IDENTITY",
                "La facture reçue ne correspond pas à l’entreprise attendue.",
              );
            const original = await this.transport.incomingOriginal(
              token,
              item.id,
            );
            prepared.push({
              remoteId: item.id,
              created: new Date(detail.created_at),
              data: {
                ...(await this.saveOriginal(
                  sync,
                  item.id,
                  original.contents,
                  original.format,
                )),
                ...this.summary(detail.en_invoice),
              },
            });
            invoicesCursor = item.id;
          }
          if (
            page.has_after &&
            (!invoicesCursor || invoicesCursor === sync.invoices_cursor)
          )
            throw fail(
              "SUPERPDP_CURSOR_INVALID",
              "La pagination des factures n’avance pas.",
            );
          const enrichment = pending
            ? await this.transport.incomingDetail(
                token,
                pending.remote_invoice_id,
              )
            : null;
          if (
            enrichment &&
            (enrichment.id !== pending!.remote_invoice_id ||
              enrichment.company_id !== sync.remote_company_id ||
              enrichment.direction !== "in")
          )
            throw fail(
              "SUPERPDP_INBOX_IDENTITY",
              "Les données complémentaires ne correspondent pas à la facture reçue.",
            );
          // The company-wide event journal retains events even when their invoice has not been imported yet.
          const events = await this.transport.incomingEvents(
            token,
            sync.events_cursor,
          );
          let eventsCursor = sync.events_cursor;
          for (const event of events.data) {
            if (eventsCursor && BigInt(event.id) <= BigInt(eventsCursor))
              throw fail(
                "SUPERPDP_CURSOR_INVALID",
                "Le journal d’événements n’est pas strictement croissant.",
              );
            eventsCursor = event.id;
          }
          if (
            events.has_after &&
            (!eventsCursor || eventsCursor === sync.events_cursor)
          )
            throw fail(
              "SUPERPDP_CURSOR_INVALID",
              "La pagination des événements n’avance pas.",
            );
          inboxEnabled();
          await activeOwner(sync.requested_by);
          await prisma.$transaction(
            async (tx) => {
              const saved = await tx.superPdpInboxSync.updateMany({
                where: op(sync, operationId),
                data: {
                  invoices_cursor: invoicesCursor,
                  events_cursor: eventsCursor,
                  last_synced_at: new Date(),
                  last_error_code: null,
                  operation_id: null,
                  operation_expires_at: null,
                  next_sync_at: new Date(
                    Date.now() +
                      (page.has_after || events.has_after ? 5_000 : 300_000),
                  ),
                },
              });
              if (saved.count !== 1)
                throw fail(
                  "SUPERPDP_INBOX_CONFLICT",
                  "La synchronisation a été arrêtée ou sa configuration a changé.",
                );
              for (const item of prepared) {
                const where = {
                  organization_id_remote_company_id_remote_invoice_id_environment:
                    {
                      organization_id: getOrganizationId(),
                      remote_company_id: sync.remote_company_id,
                      remote_invoice_id: item.remoteId,
                      environment: "sandbox",
                    },
                };
                const existing = await tx.incomingInvoice.findUnique({ where });
                if (
                  existing &&
                  (existing.sync_id !== sync.id ||
                    existing.original_sha256 !== item.data.original_sha256)
                )
                  throw fail(
                    "SUPERPDP_INBOX_ARCHIVE_CHANGED",
                    "Une archive déjà reçue est associée à une autre connexion ou son original a changé.",
                  );
                if (!existing)
                  await tx.incomingInvoice.create({
                    data: {
                      sync_id: sync.id,
                      remote_company_id: sync.remote_company_id,
                      remote_invoice_id: item.remoteId,
                      remote_created_at: item.created,
                      ...item.data,
                    },
                  });
              }
              if (pending && enrichment) {
                const summary = this.summary(enrichment.en_invoice);
                // Once extracted, semantic content is frozen locally; later differences are not silently applied.
                await tx.incomingInvoice.updateMany({
                  where: {
                    id: pending.id,
                    structured_sha256: pending.structured_sha256,
                    details_next_check_at: { not: null },
                  },
                  data: summary,
                });
              }
              for (const event of events.data)
                await tx.superPdpInboxEvent.upsert({
                  where: {
                    organization_id_sync_id_remote_event_id: {
                      organization_id: getOrganizationId(),
                      sync_id: sync.id,
                      remote_event_id: event.id,
                    },
                  },
                  create: {
                    sync_id: sync.id,
                    remote_event_id: event.id,
                    remote_invoice_id: event.invoice_id,
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
      await prisma.superPdpInboxSync.updateMany({
        where: op(sync, operationId),
        data: {
          operation_id: null,
          operation_expires_at: null,
          last_error_code: codeOf(error),
          next_sync_at: new Date(Date.now() + 300_000),
        },
      });
      throw fail(
        codeOf(error),
        "La synchronisation des achats n’est pas confirmée. Les curseurs non enregistrés seront repris sans saut de document.",
      );
    }
  }
  async list(query: unknown) {
    const input = z
      .object({
        entity_id: z.string().optional(),
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      })
      .parse(query);
    const where = input.entity_id
      ? { sync: { fiscal_entity_id: input.entity_id } }
      : {};
    const [items, count] = await Promise.all([
      prisma.incomingInvoice.findMany({
        where,
        include: {
          sync: { select: { fiscal_entity_id: true } },
          expense: true,
        },
        orderBy: [{ remote_created_at: "desc" }, { id: "desc" }],
        take: 50,
        skip: (input.page - 1) * 50,
      }),
      prisma.incomingInvoice.count({ where }),
    ]);
    return {
      items: items.map((item) =>
        this.view(item, item.expense, item.sync.fiscal_entity_id),
      ),
      count,
      page: input.page,
      page_size: 50,
    };
  }
  private view(
    item: IncomingInvoice & { sync?: unknown; expense?: unknown },
    expense: IntervenantExpense | null,
    entityId: string,
  ) {
    const {
      original_path: _path,
      structured_json: _json,
      expense_snapshot_json: _snapshot,
      sync: _sync,
      expense: _expense,
      ...safe
    } = item;
    return {
      ...safe,
      fiscal_entity_id: entityId,
      has_structured: !!item.structured_json,
      details_pending: !!item.details_next_check_at,
      expense: expense ? expenseSnapshot(expense) : null,
      expense_changed:
        !!expense &&
        item.expense_snapshot_json !== JSON.stringify(expenseSnapshot(expense)),
    };
  }
  private async invoice(id: string) {
    const row = await prisma.incomingInvoice.findUnique({
      where: { id },
      include: { sync: true, expense: true },
    });
    if (!row)
      throw fail(
        "SUPERPDP_INCOMING_NOT_FOUND",
        "Facture d’achat introuvable.",
        404,
      );
    return row;
  }
  async detail(id: string) {
    const row = await this.invoice(id);
    const events = await prisma.superPdpInboxEvent.findMany({
      where: { sync_id: row.sync_id, remote_invoice_id: row.remote_invoice_id },
      orderBy: [{ occurred_at: "desc" }, { id: "desc" }],
      take: 200,
    });
    return {
      invoice: this.view(row, row.expense, row.sync.fiscal_entity_id),
      events: events.map(eventView),
      history_truncated: events.length === 200,
    };
  }
  async structured(id: string) {
    const row = await this.invoice(id);
    if (
      !row.structured_json ||
      !row.structured_sha256 ||
      hash(row.structured_json) !== row.structured_sha256
    )
      throw fail(
        "SUPERPDP_INCOMING_STRUCTURED",
        "Les données structurées sont absentes ou leur empreinte est incohérente.",
      );
    return JSON.parse(row.structured_json);
  }
  async original(id: string) {
    const row = await this.invoice(id);
    const root = await fs.realpath(
      path.join(resolveDataDir(), "organizations", getOrganizationId()),
    );
    const target = await fs.realpath(path.resolve(root, row.original_path));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw fail("SUPERPDP_INCOMING_PATH", "Archive inaccessible.");
    const stat = await fs.stat(target);
    if (stat.size > MAX_DOCUMENT_BYTES)
      throw fail("SUPERPDP_INCOMING_SIZE", "Archive trop volumineuse.");
    const contents = await fs.readFile(target);
    if (hash(contents) !== row.original_sha256)
      throw fail(
        "SUPERPDP_INCOMING_CHECKSUM",
        "L’empreinte de l’archive originale ne correspond plus.",
      );
    return { contents, format: row.original_format };
  }
  private async eligibleExpense(
    expense: IntervenantExpense,
    entityId: string,
    db: TenantTransactionClient = prisma,
  ) {
    if (expense.scope === "all_gites") return true;
    if (expense.scope !== "gite" || !expense.gite_id) return false;
    const gite = await db.gite.findUnique({ where: { id: expense.gite_id } });
    const establishment = gite?.fiscal_establishment_id
      ? await db.fiscalEstablishment.findUnique({
          where: { id: gite.fiscal_establishment_id },
        })
      : null;
    return establishment?.fiscal_entity_id === entityId;
  }
  async candidates(id: string) {
    const row = await this.invoice(id);
    const cents = row.total_with_vat ? exactCents(row.total_with_vat) : null;
    if (
      row.currency !== "EUR" ||
      row.type_code !== 380 ||
      cents === null ||
      cents <= 0n ||
      cents > 100_000_000n ||
      row.details_next_check_at
    )
      return {
        items: [],
        reason:
          "Le rapprochement intégral exige une facture EUR positive de type 380, avec extraction terminée et montant à deux décimales maximum (plafond 1 000 000 €). Les avoirs et paiements partiels restent manuels.",
      };
    const expenses = await prisma.intervenantExpense.findMany({
      where: { amount: Number(cents) / 100, incoming_invoices: { none: {} } },
      orderBy: [{ year: "desc" }, { month: "desc" }, { id: "asc" }],
      take: 100,
    });
    const eligible: ReturnType<typeof expenseSnapshot>[] = [];
    for (const expense of expenses)
      if (await this.eligibleExpense(expense, row.sync.fiscal_entity_id))
        eligible.push(expenseSnapshot(expense));
    return {
      items: eligible,
      reason:
        "Propositions par montant TTC et périmètre uniquement ; vérifier fournisseur, période et gîte avant confirmation. Une dépense tous gîtes peut couvrir plusieurs entreprises.",
    };
  }
  async match(id: string, payload: unknown, actor: OAuthActor) {
    const input = matchSchema.parse(payload);
    const invoice = await this.invoice(id);
    const expense = await prisma.intervenantExpense.findUnique({
      where: { id: input.expense_id },
    });
    const cents = invoice.total_with_vat
      ? exactCents(invoice.total_with_vat)
      : null;
    if (
      !expense ||
      invoice.type_code !== 380 ||
      invoice.currency !== "EUR" ||
      invoice.details_next_check_at ||
      cents === null ||
      cents <= 0n ||
      cents > 100_000_000n ||
      exactCents(expense.amount.toString()) !== cents ||
      !(await this.eligibleExpense(expense, invoice.sync.fiscal_entity_id))
    )
      throw fail(
        "SUPERPDP_MATCH_INVALID",
        "La dépense doit appartenir au même compte et au bon périmètre, avec un montant TTC identique en EUR.",
      );
    if (expense.updatedAt.toISOString() !== input.expense_updated_at)
      throw fail(
        "SUPERPDP_MATCH_CONFLICT",
        "La dépense a changé. Rechargez les propositions.",
      );
    await prisma
      .$transaction(
        async (tx) => {
          // Fence both records against a concurrent expense edit or a second matching request.
          if (
            !(await this.eligibleExpense(
              expense,
              invoice.sync.fiscal_entity_id,
              tx,
            ))
          )
            throw fail(
              "SUPERPDP_MATCH_CONFLICT",
              "Le périmètre de la dépense a changé.",
            );
          const current = await tx.intervenantExpense.updateMany({
            where: {
              id: expense.id,
              updatedAt: expense.updatedAt,
              amount: expense.amount,
              scope: expense.scope,
              gite_id: expense.gite_id,
              year: expense.year,
              month: expense.month,
              label: expense.label,
              intervenant_id: expense.intervenant_id,
            },
            data: { updatedAt: expense.updatedAt },
          });
          if (current.count !== 1)
            throw fail("SUPERPDP_MATCH_CONFLICT", "La dépense a changé.");
          const saved = await tx.incomingInvoice.updateMany({
            where: {
              id,
              revision: input.revision,
              expense_id: null,
              structured_sha256: invoice.structured_sha256,
            },
            data: {
              expense_id: expense.id,
              expense_snapshot_json: JSON.stringify(expenseSnapshot(expense)),
              matched_at: new Date(),
              matched_by: actor.userId,
              revision: { increment: 1 },
            },
          });
          if (saved.count !== 1)
            throw fail(
              "SUPERPDP_MATCH_CONFLICT",
              "Cette facture a changé ou possède déjà un rapprochement.",
            );
          await tx.auditLog.create({
            data: {
              organization_id: getOrganizationId(),
              action: "superpdp.incoming_matched",
              resource_type: "incoming_invoice",
              resource_id: id,
              user_id: actor.userId,
              metadata_json: JSON.stringify({ expense_id: expense.id }),
            },
          });
        },
        { isolationLevel: "Serializable" },
      )
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "P2002")
          throw fail(
            "SUPERPDP_MATCH_CONFLICT",
            "Cette dépense est déjà rapprochée d’une autre facture.",
          );
        throw error;
      });
    return this.detail(id);
  }
  async unmatch(id: string, payload: unknown, actor: OAuthActor) {
    const input = z
      .object({
        revision: z.number().int().positive(),
        confirm_unlink: z.literal(true),
      })
      .strict()
      .parse(payload);
    await this.invoice(id);
    await prisma.$transaction(async (tx) => {
      const row = await tx.incomingInvoice.findUniqueOrThrow({ where: { id } });
      const saved = await tx.incomingInvoice.updateMany({
        where: { id, revision: input.revision, expense_id: { not: null } },
        data: {
          expense_id: null,
          expense_snapshot_json: null,
          matched_at: null,
          matched_by: null,
          revision: { increment: 1 },
        },
      });
      if (saved.count !== 1)
        throw fail("SUPERPDP_MATCH_CONFLICT", "Le rapprochement a changé.");
      await tx.auditLog.create({
        data: {
          organization_id: getOrganizationId(),
          action: "superpdp.incoming_unmatched",
          resource_type: "incoming_invoice",
          resource_id: id,
          user_id: actor.userId,
          metadata_json: JSON.stringify({ expense_id: row.expense_id }),
        },
      });
    });
    return this.detail(id);
  }
}

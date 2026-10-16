import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { systemPrisma } from "../../db/prisma.js";
import { runWithOrganization } from "../organizations/context.js";
import {
  runOrganizationJobBatch,
  type OrganizationJobHandler,
} from "../system/jobs.js";
import { SuperPdpEmission } from "./emission.js";
import { SuperPdpInbox } from "./inbox.js";
import { SuperPdpPayments } from "./payments.js";

export const createEmissionJobHandlers = (
  service = new SuperPdpEmission(),
): Record<string, OrganizationJobHandler> => {
  const handler =
    (kind: "prepare" | "send" | "reconcile"): OrganizationJobHandler =>
    async (job) => {
      const payload = z
        .object({
          transmission_id: z.string().uuid(),
          revision: z.number().int().positive(),
        })
        .parse(
          typeof job.payload_json === "string"
            ? JSON.parse(job.payload_json)
            : job.payload_json,
        );
      if (kind === "prepare")
        await service.processPrepare(payload.transmission_id, payload.revision);
      else if (kind === "send")
        await service.processSend(payload.transmission_id, payload.revision);
      else await service.processReconcile(payload.transmission_id);
      return {
        transmission_id: payload.transmission_id,
        environment: "sandbox",
      };
    };
  return {
    "superpdp.prepare": handler("prepare"),
    "superpdp.send": handler("send"),
    "superpdp.reconcile": handler("reconcile"),
  };
};

export const runSuperPdpJobBatch = async (
  workerId = `superpdp-${process.pid}-${crypto.randomUUID()}`,
) => {
  if (
    !env.SUPERPDP_SANDBOX_ENABLED ||
    (!env.SUPERPDP_SANDBOX_EMISSION_ENABLED &&
      !env.SUPERPDP_SANDBOX_RECEPTION_ENABLED)
  )
    return [];
  const service = new SuperPdpEmission();
  // Bounded scheduling; recovery jobs only read provider data and never submit an invoice again.
  const due = env.SUPERPDP_SANDBOX_EMISSION_ENABLED
    ? await systemPrisma.electronicInvoiceTransmission.findMany({
        where: {
          post_started_at: { not: null },
          next_sync_at: { lte: new Date() },
          organization_id: {
            in: (
              await systemPrisma.organization.findMany({
                where: { status: "active" },
                select: { id: true },
              })
            ).map((org) => org.id),
          },
          OR: [
            { operation_id: null },
            { operation_expires_at: { lt: new Date() } },
          ],
        },
        take: 25,
        orderBy: { next_sync_at: "asc" },
      })
    : [];
  for (const row of due)
    await runWithOrganization(
      { organizationId: row.organization_id, source: "job" },
      () => service.scheduleSync(row.invoice_id),
    );
  if (env.SUPERPDP_SANDBOX_RECEPTION_ENABLED) {
    const inbox = new SuperPdpInbox();
    const inboxes = await systemPrisma.superPdpInboxSync.findMany({
      where: {
        enabled: true,
        environment: "sandbox",
        next_sync_at: { lte: new Date() },
        OR: [
          { operation_id: null },
          { operation_expires_at: { lt: new Date() } },
        ],
      },
      take: 25,
      orderBy: { next_sync_at: "asc" },
    });
    for (const row of inboxes) {
      const organization = await systemPrisma.organization.findUnique({
        where: { id: row.organization_id },
        select: { status: true },
      });
      if (organization?.status !== "active") continue;
      await runWithOrganization(
        { organizationId: row.organization_id, source: "job" },
        async () => {
          try {
            await inbox.schedule(row.fiscal_entity_id);
          } catch (error) {
            const code = String((error as { code?: string })?.code ?? "");
            // A competing worker claiming the same inbox is normal, not a request to stop it.
            if (code === "SUPERPDP_BUSY") return;
            await systemPrisma.superPdpInboxSync.updateMany({
              where: { id: row.id, revision: row.revision, enabled: true },
              data: {
                next_sync_at: new Date(Date.now() + 300_000),
                last_error_code: /^SUPERPDP_[A-Z_]+$/.test(code)
                  ? code
                  : "SUPERPDP_INBOX_SCHEDULING",
              },
            });
          }
        },
      );
    }
  }
  return runOrganizationJobBatch({
    workerId,
    leaseMs: Math.max(300_000, env.ORGANIZATION_JOB_LEASE_MS),
    maxAttempts: env.ORGANIZATION_JOB_MAX_ATTEMPTS,
    handlers: {
      ...(env.SUPERPDP_SANDBOX_EMISSION_ENABLED
        ? createEmissionJobHandlers(service)
        : {}),
      ...(env.SUPERPDP_SANDBOX_RECEPTION_ENABLED
        ? createInboxJobHandlers()
        : {}),
      ...(env.SUPERPDP_SANDBOX_EMISSION_ENABLED &&
      env.SUPERPDP_SANDBOX_B2C_ENABLED
        ? createPaymentJobHandlers()
        : {}),
    },
    limit: 5,
  });
};
let timer: NodeJS.Timeout | null = null;
let running = false;
export const startSuperPdpJobWorker = () => {
  if (
    !env.ORGANIZATION_JOB_WORKER_ENABLED ||
    !env.SUPERPDP_SANDBOX_ENABLED ||
    (!env.SUPERPDP_SANDBOX_EMISSION_ENABLED &&
      !env.SUPERPDP_SANDBOX_RECEPTION_ENABLED) ||
    timer
  )
    return;
  const workerId = `superpdp-${process.pid}-${crypto.randomUUID()}`;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSuperPdpJobBatch(workerId);
    } catch {
      /* Never log provider bodies, credentials, invoice contents, or database parameters. */
    } finally {
      running = false;
    }
  };
  void tick();
  timer = setInterval(() => void tick(), env.ORGANIZATION_JOB_POLL_MS);
  timer.unref();
};
export const stopSuperPdpJobWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

export const createInboxJobHandlers = (
  service = new SuperPdpInbox(),
): Record<string, OrganizationJobHandler> => ({
  "superpdp.inbox": async (job) => {
    const payload = z
      .object({
        sync_id: z.string().uuid(),
        revision: z.number().int().positive(),
      })
      .parse(
        typeof job.payload_json === "string"
          ? JSON.parse(job.payload_json)
          : job.payload_json,
      );
    await service.process(payload.sync_id, payload.revision);
    return { sync_id: payload.sync_id, environment: "sandbox" };
  },
});

export const createPaymentJobHandlers = (
  service = new SuperPdpPayments(),
): Record<string, OrganizationJobHandler> => ({
  "superpdp.payment": async (job) => {
    const payload = z
      .object({ payment_id: z.string().uuid() })
      .strict()
      .parse(
        typeof job.payload_json === "string"
          ? JSON.parse(job.payload_json)
          : job.payload_json,
      );
    await service.process(payload.payment_id);
    return { payment_id: payload.payment_id, environment: "sandbox" };
  },
});

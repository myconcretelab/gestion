import { tenantDatabase } from "./tenantRepository.js";
import { systemPrisma } from "../../db/prisma.js";
import { runWithOrganization } from "../organizations/context.js";
import { recordAuditEvent } from "./audit.js";
import { logger } from "./observability.js";

export type EnqueueOrganizationJob = {
  organizationId: string;
  type: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  runAt?: Date;
};

export const enqueueOrganizationJob = async (input: EnqueueOrganizationJob) =>
  tenantDatabase(input.organizationId).organizationJob.upsert({
    where: {
      organization_id_idempotency_key: {
        organization_id: input.organizationId,
        idempotency_key: input.idempotencyKey,
      },
    },
    create: {
      organization_id: input.organizationId,
      type: input.type,
      payload_json: JSON.stringify(input.payload ?? {}),
      idempotency_key: input.idempotencyKey,
      run_at: input.runAt,
    },
    update: {},
  });

export const listRunnableOrganizationJobs = async (
  organizationId: string,
  now = new Date(),
) =>
  tenantDatabase(organizationId).organizationJob.findMany({
    where: { status: "queued", run_at: { lte: now } },
    orderBy: { run_at: "asc" },
  });

export type OrganizationJobHandler = (job: {
  id: string;
  organization_id: string;
  type: string;
  payload_json: string;
  attempts: number;
}) => Promise<Record<string, unknown> | void>;

export const claimNextOrganizationJob = async (input: {
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  now?: Date;
  types?: string[];
}) => {
  const now = input.now ?? new Date();
  const expired = new Date(now.getTime() - input.leaseMs);
  const expiredJobs = await systemPrisma.organizationJob.findMany({
    where: { status: "running", locked_at: { lt: expired } },
    select: { id: true },
  });
  if (expiredJobs.length) {
    const ids = expiredJobs.map((job) => job.id);
    await systemPrisma.$transaction([
      systemPrisma.organizationJobAttempt.updateMany({
        where: { job_id: { in: ids }, status: "running" },
        data: { status: "retrying", error_message: "Lease expiré, tentative reprise par un autre worker.", completed_at: now },
      }),
      systemPrisma.organizationJob.updateMany({
        where: { id: { in: ids }, status: "running", locked_at: { lt: expired } },
        data: { status: "queued", locked_at: null, lock_owner: null, run_at: now, last_error: "Lease expiré, job remis en file." },
      }),
    ]);
  }
  const candidates = await systemPrisma.organizationJob.findMany({
    where: {
      status: "queued",
      run_at: { lte: now },
      attempts: { lt: input.maxAttempts },
      ...(input.types?.length ? { type: { in: input.types } } : {}),
      organization: { status: "active" },
    },
    orderBy: [{ run_at: "asc" }, { createdAt: "asc" }],
    take: 20,
  });
  for (const candidate of candidates) {
    const claimed = await systemPrisma.organizationJob.updateMany({
      where: { id: candidate.id, status: "queued", attempts: candidate.attempts },
      data: { status: "running", attempts: { increment: 1 }, locked_at: now, lock_owner: input.workerId, last_error: null },
    });
    if (claimed.count === 1) return systemPrisma.organizationJob.findUniqueOrThrow({ where: { id: candidate.id } });
  }
  return null;
};

const retryDelayMs = (attempt: number) => Math.min(15 * 60_000, 1000 * 2 ** Math.max(0, attempt - 1));
const safeError = (error: unknown) => (error instanceof Error ? error.message : "Erreur inconnue").slice(0, 1000);

export const executeOrganizationJob = async (input: {
  job: NonNullable<Awaited<ReturnType<typeof claimNextOrganizationJob>>>;
  workerId: string;
  maxAttempts: number;
  handlers: Record<string, OrganizationJobHandler>;
  now?: Date;
}) => {
  const startedAt = input.now ?? new Date();
  const attempt = await systemPrisma.organizationJobAttempt.create({
    data: { organization_id: input.job.organization_id, job_id: input.job.id, attempt: input.job.attempts, status: "running", started_at: startedAt },
  });
  try {
    const handler = input.handlers[input.job.type];
    if (!handler) throw new Error(`Type de job non pris en charge: ${input.job.type}`);
    const result = await runWithOrganization(
      { organizationId: input.job.organization_id, source: "job" },
      () => handler(input.job),
    );
    const completedAt = new Date();
    await systemPrisma.$transaction([
      systemPrisma.organizationJobAttempt.update({ where: { id: attempt.id }, data: { status: "succeeded", result_json: JSON.stringify(result ?? {}), completed_at: completedAt } }),
      systemPrisma.organizationJob.update({ where: { id: input.job.id }, data: { status: "completed", completed_at: completedAt, locked_at: null, lock_owner: null, last_error: null } }),
    ]);
    await recordAuditEvent({ organizationId: input.job.organization_id, action: "organization_job.succeeded", resourceType: "organization_job", resourceId: input.job.id, metadata: { type: input.job.type, attempt: input.job.attempts } });
    logger.info("organization_job.succeeded", { organizationId: input.job.organization_id, jobId: input.job.id, type: input.job.type, attempt: input.job.attempts });
    return { status: "succeeded" as const, result };
  } catch (error) {
    const message = safeError(error);
    const terminal = input.job.attempts >= input.maxAttempts;
    const completedAt = new Date();
    await systemPrisma.$transaction([
      systemPrisma.organizationJobAttempt.update({ where: { id: attempt.id }, data: { status: terminal ? "failed" : "retrying", error_message: message, completed_at: completedAt } }),
      systemPrisma.organizationJob.update({
        where: { id: input.job.id },
        data: { status: terminal ? "failed" : "queued", run_at: terminal ? input.job.run_at : new Date(completedAt.getTime() + retryDelayMs(input.job.attempts)), locked_at: null, lock_owner: null, last_error: message },
      }),
    ]);
    await recordAuditEvent({ organizationId: input.job.organization_id, action: terminal ? "organization_job.failed" : "organization_job.retry_scheduled", resourceType: "organization_job", resourceId: input.job.id, metadata: { type: input.job.type, attempt: input.job.attempts, terminal } });
    logger.error("organization_job.failed", { organizationId: input.job.organization_id, jobId: input.job.id, type: input.job.type, attempt: input.job.attempts, terminal, error: message });
    return { status: terminal ? "failed" as const : "retrying" as const, error: message };
  }
};

export const runOrganizationJobBatch = async (input: {
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  handlers: Record<string, OrganizationJobHandler>;
  limit?: number;
}) => {
  const outcomes = [];
  for (let index = 0; index < (input.limit ?? 10); index += 1) {
    const job = await claimNextOrganizationJob({ workerId: input.workerId, leaseMs: input.leaseMs, maxAttempts: input.maxAttempts, types: Object.keys(input.handlers) });
    if (!job) break;
    outcomes.push({ jobId: job.id, organizationId: job.organization_id, ...(await executeOrganizationJob({ ...input, job })) });
  }
  return outcomes;
};

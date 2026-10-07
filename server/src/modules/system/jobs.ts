import { tenantDatabase } from "./tenantRepository.js";

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

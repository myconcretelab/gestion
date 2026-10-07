import crypto from "node:crypto";
import { systemPrisma } from "../../db/prisma.js";
import { isModuleEnabled, type ModuleKey } from "../../services/installationConfig.js";
import { runWithOrganization } from "../organizations/context.js";
import { logger } from "./observability.js";

export type TenantTaskOutcome = {
  organizationId: string;
  status: "succeeded" | "failed" | "skipped_disabled" | "skipped_locked" | "skipped_interval";
  error?: string;
};

export const runTenantTaskAcrossOrganizations = async (input: {
  taskKey: string;
  moduleKeys: ModuleKey[];
  handler: (organizationId: string) => Promise<unknown>;
  leaseMs?: number;
  minimumIntervalMs?: number;
  now?: Date;
  owner?: string;
}) => {
  const now = input.now ?? new Date();
  const owner = input.owner ?? `${input.taskKey}-${process.pid}-${crypto.randomUUID()}`;
  const organizations = await systemPrisma.organization.findMany({ where: { status: "active" }, select: { id: true }, orderBy: { id: "asc" } });
  const outcomes: TenantTaskOutcome[] = [];
  for (const organization of organizations) {
    await runWithOrganization({ organizationId: organization.id, source: "job" }, async () => {
      try {
        const enabled = (await Promise.all(input.moduleKeys.map((key) => isModuleEnabled(key)))).every(Boolean);
        if (!enabled) {
          outcomes.push({ organizationId: organization.id, status: "skipped_disabled" });
          return;
        }
        const lease = await systemPrisma.organizationTaskLease.upsert({
          where: { organization_id_task_key: { organization_id: organization.id, task_key: input.taskKey } },
          update: {},
          create: { organization_id: organization.id, task_key: input.taskKey },
        });
        if (input.minimumIntervalMs && lease.last_succeeded_at && lease.last_succeeded_at.getTime() > now.getTime() - input.minimumIntervalMs) {
          outcomes.push({ organizationId: organization.id, status: "skipped_interval" });
          return;
        }
        const claimed = await systemPrisma.organizationTaskLease.updateMany({
          where: { id: lease.id, OR: [{ lease_expires_at: null }, { lease_expires_at: { lt: now } }] },
          data: { lease_owner: owner, lease_expires_at: new Date(now.getTime() + (input.leaseMs ?? 15 * 60_000)), last_started_at: now, last_error: null },
        });
        if (claimed.count !== 1) {
          outcomes.push({ organizationId: organization.id, status: "skipped_locked" });
          return;
        }
        try {
          await input.handler(organization.id);
          await systemPrisma.organizationTaskLease.updateMany({ where: { id: lease.id, lease_owner: owner }, data: { lease_owner: null, lease_expires_at: null, last_succeeded_at: new Date(), last_error: null } });
          outcomes.push({ organizationId: organization.id, status: "succeeded" });
          logger.info("tenant_task.succeeded", { organizationId: organization.id, taskKey: input.taskKey });
        } catch (error) {
          const message = (error instanceof Error ? error.message : "Erreur inconnue").slice(0, 1000);
          await systemPrisma.organizationTaskLease.updateMany({ where: { id: lease.id, lease_owner: owner }, data: { lease_owner: null, lease_expires_at: null, last_failed_at: new Date(), last_error: message } });
          outcomes.push({ organizationId: organization.id, status: "failed", error: message });
          logger.error("tenant_task.failed", { organizationId: organization.id, taskKey: input.taskKey, error: message });
        }
      } catch (error) {
        const message = (error instanceof Error ? error.message : "Erreur inconnue").slice(0, 1000);
        outcomes.push({ organizationId: organization.id, status: "failed", error: message });
        logger.error("tenant_task.setup_failed", { organizationId: organization.id, taskKey: input.taskKey, error: message });
      }
    });
  }
  return outcomes;
};

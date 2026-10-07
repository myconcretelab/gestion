import { tenantDatabase } from "./tenantRepository.js";

export type AuditEvent = {
  organizationId: string;
  userId?: string;
  requestId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

export const recordAuditEvent = async (event: AuditEvent) =>
  tenantDatabase(event.organizationId).auditLog.create({
    data: {
      organization_id: event.organizationId,
      user_id: event.userId,
      request_id: event.requestId,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      metadata_json: JSON.stringify(event.metadata ?? {}),
    },
  });

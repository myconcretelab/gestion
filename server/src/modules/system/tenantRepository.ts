import { getTenantPrisma } from "../../db/prisma.js";
import { logger } from "./observability.js";

export const tenantDatabase = (organizationId: string) =>
  getTenantPrisma(organizationId);

export const tenantNotFound = (input: {
  organizationId: string;
  resourceType: string;
  resourceId: string;
  requestId?: string;
}) => {
  logger.warn("tenant_resource_not_found", input);
  return Object.assign(new Error("Ressource introuvable."), {
    status: 404,
    code: "NOT_FOUND",
  });
};

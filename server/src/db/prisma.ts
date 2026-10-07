import "../config/env.js";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { getOrganizationId } from "../modules/organizations/context.js";

const resolveDatabaseUrl = (value: string | undefined) => {
  if (!value) return value;
  if (!value.startsWith("file:")) return value;
  if (value.startsWith("file:/")) return value;

  const rawPath = value.slice("file:".length);
  const normalizedRawPath = rawPath.replace(/^[./]+/, "");
  const shouldResolveFromMonorepoRoot =
    path.basename(process.cwd()) === "server" && normalizedRawPath.startsWith("server/");

  const absPath = shouldResolveFromMonorepoRoot
    ? path.resolve(process.cwd(), "..", normalizedRawPath)
    : path.resolve(process.cwd(), rawPath);

  return `file:${absPath}`;
};

const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  if (databaseUrl.startsWith("file:")) {
    const rawPath = databaseUrl.slice("file:".length);
    const dir = path.dirname(rawPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export const systemPrisma = new PrismaClient();

const TENANT_MODELS = new Set([
  "InstallationConfig", "ContentTemplateVersion", "Gite", "GitePhoto", "WordPressWebhookJob",
  "Gestionnaire", "AppUser", "Membership", "OrganizationSettings", "ApiToken", "DocumentShare",
  "ExpenseCategory", "ExpenseRecurringRule", "ExpenseEntry", "UrssafDeclaration", "GuestNightDeclaration",
  "IcalSource", "Contrat", "ContratCounter", "Facture", "FactureCounter", "ReservationPlaceholder",
  "PlanningRelayPeriod", "PlanningRelayWorker", "IntervenantHourEntry", "UserIntervention",
  "IntervenantExpense", "PlanningRelayAssignment", "Reservation", "GiteSeasonRate", "BookingRequest",
  "GiteMonthlyEnergyReading",
  "OrganizationRuntimeSetting", "OrganizationJob", "AuditLog", "DocumentAsset",
  "Subscription", "OrganizationEntitlementOverride", "UsageCounter", "BillingEvent",
]);

const withTenantWhere = (where: Record<string, unknown> | undefined, organizationId: string) => ({
  ...(where ?? {}),
  organization_id: organizationId,
});

const scopeTenantOperation = (operation: string, args: Record<string, unknown>, organizationId: string) => {
  if (["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany"].includes(operation)) {
    args.where = withTenantWhere(args.where as Record<string, unknown> | undefined, organizationId);
  }
  if (operation === "create") {
    args.data = { ...(args.data as Record<string, unknown>), organization_id: organizationId };
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(args.data) ? args.data : [args.data];
    args.data = rows.map((row) => ({ ...(row as Record<string, unknown>), organization_id: organizationId }));
  }
  if (operation === "upsert") {
    args.where = withTenantWhere(args.where as Record<string, unknown> | undefined, organizationId);
    args.create = { ...(args.create as Record<string, unknown>), organization_id: organizationId };
  }
  return args;
};

const extendForTenant = (organizationId: () => string) => systemPrisma.$extends({
  name: "tenant-isolation",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model && TENANT_MODELS.has(model)) {
          scopeTenantOperation(operation, args as Record<string, unknown>, organizationId());
        }
        return query(args);
      },
    },
  },
});

export const getTenantPrisma = (organizationId: string) => extendForTenant(() => organizationId);

const prisma = extendForTenant(getOrganizationId);

export default prisma;

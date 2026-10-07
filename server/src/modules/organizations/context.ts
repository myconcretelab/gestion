import { AsyncLocalStorage } from "node:async_hooks";

export const HISTORICAL_ORGANIZATION_ID = "org_historical_broceliande";

export type OrganizationContext = {
  organizationId: string;
  source:
    "session" | "public-token" | "historical-compatibility" | "job" | "test";
};

const storage = new AsyncLocalStorage<OrganizationContext>();

export const getOrganizationContext = (): OrganizationContext =>
  storage.getStore() ?? {
    organizationId: HISTORICAL_ORGANIZATION_ID,
    source: "historical-compatibility",
  };

export const getOrganizationId = () => getOrganizationContext().organizationId;

export const runWithOrganization = <T>(
  context: OrganizationContext,
  callback: () => T,
): T => storage.run(context, callback);

export const enterOrganizationContext = (context: OrganizationContext) =>
  storage.enterWith(context);

export const assertRequestedOrganization = (
  requestedOrganizationId: unknown,
) => {
  if (
    requestedOrganizationId === undefined ||
    requestedOrganizationId === null ||
    requestedOrganizationId === ""
  )
    return;
  if (requestedOrganizationId !== getOrganizationId()) {
    throw Object.assign(new Error("Ressource introuvable."), {
      status: 404,
      code: "NOT_FOUND",
    });
  }
};

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { getOrganizationId, HISTORICAL_ORGANIZATION_ID } from "./organizationContext.js";

export const organizationDataPath = (filename: string) => {
  const organizationId = getOrganizationId();
  const base = organizationId === HISTORICAL_ORGANIZATION_ID
    ? env.DATA_DIR
    : path.join(env.DATA_DIR, "organizations", organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, filename);
};

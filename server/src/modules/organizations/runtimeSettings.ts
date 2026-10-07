import { z } from "zod";
import { tenantDatabase, tenantNotFound } from "../system/tenantRepository.js";

export type RuntimeSettingDefinition<T> = {
  key: string;
  version: number;
  schema: z.ZodType<T>;
  defaultValue: T;
  secret?: boolean;
};

const decode = (value: unknown) =>
  typeof value === "string" ? JSON.parse(value) : value;

export async function readRuntimeSetting<T>(
  organizationId: string,
  definition: RuntimeSettingDefinition<T>,
): Promise<T> {
  const row = await tenantDatabase(
    organizationId,
  ).organizationRuntimeSetting.findFirst({ where: { key: definition.key } });
  if (!row) return definition.defaultValue;
  return definition.schema.parse(decode(row.value_json));
}

export async function writeRuntimeSetting<T>(
  organizationId: string,
  definition: RuntimeSettingDefinition<T>,
  value: unknown,
): Promise<T> {
  const parsed = definition.schema.parse(value);
  await tenantDatabase(organizationId).organizationRuntimeSetting.upsert({
    where: {
      organization_id_key: {
        organization_id: organizationId,
        key: definition.key,
      },
    },
    create: {
      organization_id: organizationId,
      key: definition.key,
      version: definition.version,
      value_json: JSON.stringify(parsed),
      is_secret: Boolean(definition.secret),
    },
    update: {
      version: definition.version,
      value_json: JSON.stringify(parsed),
      is_secret: Boolean(definition.secret),
    },
  });
  return parsed;
}

export async function readPublicRuntimeSetting<T>(
  organizationId: string,
  definition: RuntimeSettingDefinition<T>,
): Promise<T> {
  if (definition.secret)
    throw tenantNotFound({
      organizationId,
      resourceType: "runtime_setting",
      resourceId: definition.key,
    });
  return readRuntimeSetting(organizationId, definition);
}

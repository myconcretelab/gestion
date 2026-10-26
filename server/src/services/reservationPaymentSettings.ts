import { z } from "zod";
import prisma, { type TenantTransactionClient } from "../db/prisma.js";
import { getOrganizationId } from "./organizationContext.js";
import { writeRuntimeSetting } from "../modules/organizations/runtimeSettings.js";

export const reservationPaymentSettingsSchema = z
  .object({
    platform_payments_received_automatically: z.boolean(),
    first_payment_default: z.enum(["full", "deposit"]).default("full"),
  })
  .strict();
const definition = {
  key: "reservation-payments",
  version: 1,
  schema: reservationPaymentSettingsSchema,
  defaultValue: reservationPaymentSettingsSchema.parse({
    platform_payments_received_automatically: true,
  }),
};
export const readReservationPaymentSettings = async (
  db: TenantTransactionClient = prisma,
) => {
  const row = await db.organizationRuntimeSetting.findFirst({
    where: { key: definition.key },
  });
  return row
    ? definition.schema.parse(JSON.parse(row.value_json))
    : definition.defaultValue;
};
export const saveReservationPaymentSettings = (value: unknown) =>
  writeRuntimeSetting(getOrganizationId(), definition, value);

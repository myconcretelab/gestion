import { z } from "zod";
import {
  DEFAULT_RESERVATION_PAYMENT_SHORTCUTS,
  RESERVATION_PAYMENT_METHODS,
  otaChannelSchema,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../db/prisma.js";
import { getOrganizationId } from "./organizationContext.js";
import { writeRuntimeSetting } from "../modules/organizations/runtimeSettings.js";

export const reservationPaymentSettingsSchema = z
  .object({
    platform_payments_received_automatically: z.boolean(),
    platforms: z.array(otaChannelSchema).max(30).refine(items => new Set(items.map(item => item.name.toLocaleLowerCase())).size === items.length, "Chaque canal doit être unique.").optional(),
    first_payment_default: z.enum(["full", "deposit"]).default("full"),
    shortcuts: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(12),
            target: z.enum(["remaining", "deposit"]),
            method: z.enum(RESERVATION_PAYMENT_METHODS),
            color: z
              .string()
              .regex(/^#[0-9a-f]{6}$/i, "Choisissez une couleur valide."),
          })
          .strict(),
      )
      .max(20)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "Chaque raccourci doit avoir un identifiant unique.",
      )
      .default(() =>
        DEFAULT_RESERVATION_PAYMENT_SHORTCUTS.map((item) => ({ ...item })),
      ),
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
    ? definition.schema.parse(
        typeof row.value_json === "string"
          ? JSON.parse(row.value_json)
          : row.value_json,
      )
    : definition.defaultValue;
};
export const saveReservationPaymentSettings = (value: unknown) =>
  writeRuntimeSetting(getOrganizationId(), definition, value);

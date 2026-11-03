import {
  BOOKING_SOURCES,
  DEFAULT_TOURIST_TAX_COLLECTION,
  getBookingSource,
  parseTouristTaxSettings,
  createTouristTaxStayForSource,
  touristTaxCollectionSettingsSchema,
  type TouristTaxCollectionSettings,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../db/prisma.js";
import { getOrganizationId } from "./organizationContext.js";
import { writeRuntimeSetting } from "../modules/organizations/runtimeSettings.js";
import { readReservationPaymentSettings } from "./reservationPaymentSettings.js";

const definition = {
  key: "tourist-tax-collection",
  version: 1,
  schema: touristTaxCollectionSettingsSchema,
  defaultValue: DEFAULT_TOURIST_TAX_COLLECTION,
};
export async function readTouristTaxCollectionSettings(
  db: TenantTransactionClient = prisma,
): Promise<TouristTaxCollectionSettings> {
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
}
export const saveTouristTaxCollectionSettings = (value: unknown) =>
  writeRuntimeSetting(getOrganizationId(), definition, value);
export async function touristTaxCollectionResponse() {
  const [settings, payments] = await Promise.all([
    readTouristTaxCollectionSettings(),
    readReservationPaymentSettings(),
  ]);
  const sources = new Map<string, string>();
  for (const source of [
    ...BOOKING_SOURCES,
    ...(payments.platforms?.map((channel) => channel.name) ?? []),
    ...settings.rules.map((rule) => rule.source),
  ]) {
    if (!sources.has(source.toLocaleLowerCase()))
      sources.set(source.toLocaleLowerCase(), source);
  }
  return { ...settings, sources: [...sources.values()] };
}
export async function newReservationTouristTax(
  giteId: string,
  source: string,
  db: TenantTransactionClient = prisma,
) {
  const [gite, collection] = await Promise.all([
    db.gite.findUnique({
      where: { id: giteId },
      select: { taxe_sejour_config: true },
    }),
    readTouristTaxCollectionSettings(db),
  ]);
  const settings = parseTouristTaxSettings(gite?.taxe_sejour_config);
  return settings
    ? createTouristTaxStayForSource(
        settings,
        getBookingSource({ booking_source: source }),
        collection,
      )
    : undefined;
}

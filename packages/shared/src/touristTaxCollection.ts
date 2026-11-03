import { z } from "zod";
import { AUTOMATIC_PAYMENT_PLATFORMS } from "./reservationPayments.js";
import {
  createTouristTaxStay,
  type TouristTaxSettings,
  type TouristTaxStay,
} from "./touristTax.js";

export const touristTaxCollectionRuleSchema = z
  .object({
    source: z.string().trim().min(1).max(100),
    collector: z.enum(["host", "platform", "unknown"]),
    price: z.enum(["gite", "included", "excluded"]),
  })
  .strict();
export type TouristTaxCollectionRule = z.infer<
  typeof touristTaxCollectionRuleSchema
>;
export const touristTaxCollectionSettingsSchema = z
  .object({
    rules: z
      .array(touristTaxCollectionRuleSchema)
      .max(100)
      .refine(
        (rules) =>
          new Set(rules.map((rule) => rule.source.toLocaleLowerCase())).size ===
          rules.length,
        "Chaque origine doit être unique.",
      ),
  })
  .strict();
export type TouristTaxCollectionSettings = z.infer<
  typeof touristTaxCollectionSettingsSchema
>;
export type TouristTaxCollectionResponse = TouristTaxCollectionSettings & {
  sources: string[];
};
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value);
    return (
      Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value
    );
  }, "Date invalide.");
export const touristTaxReapplySchema = z
  .object({
    from: date,
    to: date,
    gite_id: z.string().min(1).optional(),
    override_manual: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => value.from <= value.to,
    "La fin de période doit suivre le début.",
  );
export type TouristTaxReapplyInput = z.infer<typeof touristTaxReapplySchema>;
export type TouristTaxReapplyAmounts = {
  collector: string;
  platform: string;
  included: boolean | null;
  tax: number | null;
  total: number;
  accommodation: number;
};
export type TouristTaxReapplyRow = {
  id: string;
  guest: string;
  gite: string;
  start: string;
  source: string;
  before: TouristTaxReapplyAmounts;
  after: TouristTaxReapplyAmounts;
  eligible: boolean;
  reason: string | null;
};
export type TouristTaxReapplyPreview = {
  fingerprint: string;
  rows: TouristTaxReapplyRow[];
  eligible: number;
  excluded: number;
};
export const DEFAULT_TOURIST_TAX_COLLECTION: TouristTaxCollectionSettings = {
  rules: [
    { source: "Direct", collector: "host", price: "gite" },
    ...AUTOMATIC_PAYMENT_PLATFORMS.map((source) => ({
      source,
      collector: "platform" as const,
      price: "excluded" as const,
    })),
  ],
};
export const touristTaxCollectionRule = (
  source: string,
  settings: TouristTaxCollectionSettings,
): TouristTaxCollectionRule =>
  settings.rules.find(
    (rule) =>
      rule.source.toLocaleLowerCase() === source.trim().toLocaleLowerCase(),
  ) ?? { source, collector: "unknown", price: "gite" };

/** Saved manual exceptions and frozen rates survive changes to an origin's defaults. */
export function applyTouristTaxCollection(
  stay: TouristTaxStay,
  source: string,
  settings: TouristTaxCollectionSettings,
  force = false,
): TouristTaxStay {
  if (!force && stay.collection_source === source) return stay;
  const rule = touristTaxCollectionRule(source, settings);
  const collectorAutomatic =
    stay.collector_mode === "automatic" ||
    (!stay.collector_mode && stay.collector === "unknown");
  const priceAutomatic = stay.price_mode === "automatic";
  return {
    ...stay,
    ...(collectorAutomatic || priceAutomatic
      ? { collection_source: source }
      : {}),
    ...(collectorAutomatic
      ? {
          collector: rule.collector,
          platform: rule.collector === "platform" ? source : "",
          collector_mode: "automatic" as const,
        }
      : {}),
    ...(priceAutomatic
      ? {
          settings: {
            ...stay.settings,
            included:
              rule.price === "gite"
                ? (stay.gite_price_included ?? stay.settings.included)
                : rule.price === "included",
          },
        }
      : {}),
  };
}
export function createTouristTaxStayForSource(
  settings: TouristTaxSettings,
  source: string,
  collection: TouristTaxCollectionSettings,
): TouristTaxStay {
  return applyTouristTaxCollection(
    createAutomaticTouristTaxStay(settings),
    source,
    collection,
  );
}
export function createAutomaticTouristTaxStay(settings: TouristTaxSettings): TouristTaxStay {
  return { ...createTouristTaxStay(settings), collector_mode: "automatic", price_mode: "automatic", gite_price_included: settings.included };
}

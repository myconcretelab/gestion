import { z } from "zod";

export const OTA_OPTION_KEYS = [
  "menage",
  "draps",
  "linge_toilette",
  "depart_tardif",
  "chiens",
] as const;
export type OtaOptionKey = (typeof OTA_OPTION_KEYS)[number];
export type IncludedOption = {
  enabled: boolean;
  inclus?: boolean;
  offert?: boolean;
  montant_inclus?: number;
};
export const includedOptionAmounts = (
  options: Partial<Record<OtaOptionKey, IncludedOption>>,
) =>
  Object.fromEntries(
    OTA_OPTION_KEYS.map((key) => [
      key,
      options[key]?.enabled && options[key]?.inclus && !options[key]?.offert
        ? Math.round((options[key]?.montant_inclus ?? 0) * 100)
        : 0,
    ]),
  ) as Record<OtaOptionKey, number>;

export function reservationIncludedOptionCents(
  value: unknown,
  priceCents?: number,
): number {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return 0;
    }
  }
  if (!value || typeof value !== "object") return 0;
  const snapshot = (value as { ota_price?: OtaPriceSnapshot }).ota_price;
  if (
    snapshot?.rowIncluded &&
    priceCents === snapshot.rowGrossCents &&
    priceCents !== snapshot.grossCents
  )
    return otaIncludedTotal(snapshot.rowIncluded);
  return otaIncludedTotal(
    includedOptionAmounts(
      value as Partial<Record<OtaOptionKey, IncludedOption>>,
    ),
  );
}

export const otaRoundingSchema = z.enum(["cent", "euro"]);
export const otaCommissionScopeSchema = z.enum(["all", "accommodation"]);
const cents = z.number().int().min(0).max(1_000_000_000);
export const otaIncludedAmountsSchema = z
  .object({
    menage: cents,
    draps: cents,
    linge_toilette: cents,
    depart_tardif: cents,
    chiens: cents,
  })
  .strict();
export const otaPriceInputSchema = z
  .object({
    basis: z.enum(["rental", "gross", "net"]),
    amountCents: cents,
    feeCents: cents.optional(),
    included: otaIncludedAmountsSchema,
  })
  .strict();
export type OtaPriceInput = z.infer<typeof otaPriceInputSchema>;
export const otaPriceSnapshotSchema = otaPriceInputSchema
  .extend({
    channel: z.string().min(1).max(60).optional(),
    rowGrossCents: cents.optional(),
    rowIncluded: otaIncludedAmountsSchema.optional(),
    rateEffectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    feeSource: z.enum(["manual", "rate"]).optional(),
    grossCents: cents,
    feeCents: cents,
    netCents: cents,
    percent: z.number().min(0).max(99.99).optional(),
    rounding: otaRoundingSchema,
    scope: otaCommissionScopeSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.grossCents === value.netCents + value.feeCents &&
      value.grossCents >= otaIncludedTotal(value.included) &&
      (value.basis === "net"
        ? value.amountCents === value.netCents
        : value.basis === "gross"
          ? value.amountCents === value.grossCents
          : value.amountCents + otaIncludedTotal(value.included) ===
            value.grossCents),
    "Les montants de la plateforme sont incohérents.",
  );

export type OtaPriceSnapshot = z.infer<typeof otaPriceSnapshotSchema>;
export const otaIncludedTotal = (included: Record<OtaOptionKey, number>) =>
  OTA_OPTION_KEYS.reduce((total, key) => total + included[key], 0);

export function otaCommissionCents(
  amount: number,
  percent: number,
  rounding: "cent" | "euro" = "cent",
) {
  // Integer hundredths of a percent, so half-euro boundaries do not depend on floating point.
  const step = rounding === "euro" ? 100 : 1;
  return (
    Math.floor(
      (amount * Math.round(percent * 100) + 5000 * step) / (10000 * step),
    ) * step
  );
}

/** A rounded net can have several gross solutions. Never choose one silently. */
export function calculateOtaPrice(
  input: OtaPriceInput,
  rule: {
    percent?: number;
    effectiveFrom?: string;
    rounding?: "cent" | "euro";
    scope?: "all" | "accommodation";
  },
): OtaPriceSnapshot {
  otaPriceInputSchema.parse(input);
  const rounding = rule.rounding ?? "cent";
  const scope = rule.scope ?? "all";
  const included = otaIncludedTotal(input.included);
  const feeFor = (gross: number) =>
    otaCommissionCents(
      scope === "accommodation" ? gross - included : gross,
      rule.percent!,
      rounding,
    );
  let gross =
    input.basis === "rental" ? input.amountCents + included : input.amountCents;
  let fee = input.feeCents;
  if (fee === undefined && rule.percent === undefined)
    throw new Error(
      "Renseignez la commission réelle ou un taux applicable à la date du séjour.",
    );
  if (input.basis === "net") {
    if (fee !== undefined) gross += fee;
    else {
      const netBase =
        input.amountCents - (scope === "accommodation" ? included : 0);
      if (netBase < 0)
        throw new Error(
          "Le net propriétaire est inférieur aux options incluses.",
        );
      const step = rounding === "euro" ? 100 : 1;
      const p = Math.round(rule.percent! * 100);
      const denominator = step * (10000 - p);
      // gross = net + k * step; solve both inequalities of the rounding interval.
      const first = Math.max(
        0,
        Math.floor((p * netBase - 5000 * step) / denominator) + 1,
        Math.ceil((included - input.amountCents) / step),
      );
      const last = Math.min(
        Math.floor((p * netBase + 5000 * step) / denominator),
        Math.floor((1_000_000_000 - input.amountCents) / step),
      );
      if (first > last)
        throw new Error(
          "Ce net ne correspond à aucun prix avec ces règles. Renseignez la commission réelle.",
        );
      if (last > first)
        throw new Error(
          "Plusieurs prix bruts donnent ce net après arrondi. Renseignez la commission réelle ou saisissez le prix de location.",
        );
      gross = input.amountCents + first * step;
    }
  }
  if (gross < included)
    throw new Error("Le montant brut est inférieur aux options incluses.");
  fee ??= feeFor(gross);
  if (fee > gross || (scope === "accommodation" && fee > gross - included))
    throw new Error(
      "La commission dépasse le montant sur lequel elle s’applique.",
    );
  return otaPriceSnapshotSchema.parse({
    ...input,
    feeSource: input.feeCents === undefined ? "rate" : "manual",
    grossCents: gross,
    feeCents: fee,
    netCents: gross - fee,
    ...(rule.percent !== undefined ? { percent: rule.percent } : {}),
    rounding,
    scope,
    ...(rule.effectiveFrom ? { rateEffectiveFrom: rule.effectiveFrom } : {}),
  });
}

export const validOtaPriceSnapshot = (
  snapshot: OtaPriceSnapshot | undefined,
  gross: number,
  options: Partial<Record<OtaOptionKey, IncludedOption>>,
  source?: string,
) =>
  Boolean(
    snapshot &&
    (!source || snapshot.channel === source) &&
    snapshot.grossCents === gross &&
    snapshot.netCents === snapshot.grossCents - snapshot.feeCents &&
    OTA_OPTION_KEYS.every(
      (key) => snapshot.included[key] === includedOptionAmounts(options)[key],
    ),
  );

export const otaGrossInputBasis = (
  source: string,
  configured?: "rental" | "gross",
) => configured ?? (source === "Gites de France" ? "rental" : "gross");
export const otaStoredPriceBasis = (
  source: string,
  origin: string | null | undefined,
  configured?: "unknown" | "gross" | "net",
) =>
  source === "Airbnb" && origin === "pump" ? "net" : (configured ?? "unknown");
export const OTA_QUANTITY_KEYS = ["draps", "linge_toilette", "chiens"] as const;
export const otaOptionQuantitiesSchema = z
  .object({
    draps: z.number().int().min(1).max(1000).optional(),
    linge_toilette: z.number().int().min(1).max(1000).optional(),
    chiens: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type OtaOptionQuantities = z.infer<typeof otaOptionQuantitiesSchema>;
export type OtaPricingOption = {
  key: OtaOptionKey;
  label: string;
  enabled: boolean;
  included: boolean;
  amountCents: number;
  quantity?: number;
  unitAmountCents?: number;
  multiplier?: number;
  quantityLabel?: string;
};
export const otaOptionAmount = (
  option: OtaPricingOption,
  quantity = option.quantity ?? 1,
) =>
  quantity === (option.quantity ?? 1)
    ? option.amountCents
    : Math.round(
        (option.unitAmountCents ?? option.amountCents) *
          quantity *
          (option.multiplier ?? 1),
      );

export type OtaPricingContext = {
  revision: string;
  source: string;
  amountCents: number;
  grossInputBasis?: "rental" | "gross";
  preferredInputBasis?: "gross" | "net";
  storedPriceBasis?: "unknown" | "gross" | "net";
  importedNet?: boolean;
  rule: {
    percent?: number;
    effectiveFrom?: string;
    rounding: "cent" | "euro";
    scope: "all" | "accommodation";
  };
  options: OtaPricingOption[];
  saved?: OtaPriceSnapshot;
  blockedReason?: string;
};

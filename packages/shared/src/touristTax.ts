import { z } from "zod";

const money = z.number().finite().min(0).max(10_000_000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(new Date(value).getTime()) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Date invalide.",
  );
export const touristTaxSettingsSchema = z
  .object({
    version: z.literal(1),
    classified: z.boolean(),
    stars: z.number().int().min(0).max(5),
    included: z.boolean(),
    fixed_rate: money,
    percentage: z.number().finite().min(0).max(5),
    cap: money,
    additional_percentage: z.number().finite().min(0).max(200),
    accommodation_vat_rate: z.number().finite().min(0).max(100),
    authority: z.string().trim().max(200),
    effective_from: date,
  })
  .superRefine((settings, ctx) => {
    if (settings.classified && settings.stars === 0)
      ctx.addIssue({
        code: "custom",
        path: ["stars"],
        message: "Précisez le classement officiel en étoiles.",
      });
    if (!settings.classified && (settings.percentage < 1 || settings.cap <= 0))
      ctx.addIssue({
        code: "custom",
        path: ["percentage"],
        message:
          "Pour un meublé non classé, renseignez un taux de 1 à 5 % et un plafond positif.",
      });
  });
export type TouristTaxSettings = z.infer<typeof touristTaxSettingsSchema>;
export const touristTaxStaySchema = z.object({
  settings: touristTaxSettingsSchema,
  collector: z.enum(["unknown", "host", "platform", "not_applicable"]),
  platform: z.string().trim().max(100).default(""),
  infants: z.number().int().min(0).max(1000).default(0),
  exempt_adults: z.number().int().min(0).max(1000).default(0),
  exemption_reason: z.string().trim().max(500).default(""),
});
export type TouristTaxStay = z.infer<typeof touristTaxStaySchema>;
export const touristTaxResultSchema = z.object({
  version: z.literal(1),
  stay_label: z.string().max(500).default(""),
  collector: touristTaxStaySchema.shape.collector,
  platform: z.string().max(100),
  included: z.boolean(),
  classified: z.boolean(),
  nights: z.number().int().min(0),
  occupants: z.number().int().min(0),
  taxable_adults: z.number().int().min(0),
  exempt_people: z.number().int().min(0),
  exemption_reason: z.string().max(500),
  unit_amount: money,
  amount: money,
  host_amount: money,
  accommodation_amount: money,
  authority: z.string().max(200),
  issues: z.array(z.string().max(500)),
});
export type TouristTaxResult = z.infer<typeof touristTaxResultSchema>;

export function parseTouristTaxSettings(
  value: unknown,
): TouristTaxSettings | null {
  try {
    const parsed = touristTaxSettingsSchema.safeParse(
      typeof value === "string" ? JSON.parse(value) : value,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const createTouristTaxStay = (
  settings: TouristTaxSettings,
): TouristTaxStay => ({
  settings,
  collector: "unknown",
  platform: "",
  infants: 0,
  exempt_adults: 0,
  exemption_reason: "",
});
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const round = (value: number) => cents(value) / 100;

/** Taxe au réel. The quoted accommodation price is after its commercial discount,
 * before services. Children (including infants) enter the proportional divisor,
 * while only non-exempt adults pay. Stored settings freeze the applicable rules.
 */
export function computeTouristTax(params: {
  stay: TouristTaxStay;
  nights: number;
  adults: number;
  children: number;
  accommodation: number;
  start?: string;
}): TouristTaxResult {
  const { stay, nights, adults, children } = params;
  const policy = stay.settings;
  const issues: string[] = [];
  if (params.accommodation < 0)
    issues.push(
      "La remise dépasse le prix de l’hébergement. Corrigez le prix ou la remise avant de calculer la taxe de séjour.",
    );
  const price = Math.max(0, round(params.accommodation));
  const occupants = adults + children + stay.infants;
  const taxable = Math.max(0, adults - stay.exempt_adults);
  const applicable = stay.collector !== "not_applicable";
  if (stay.exempt_adults > adults)
    issues.push(
      "Le nombre d’adultes exonérés dépasse le nombre d’adultes du séjour.",
    );
  if ((stay.exempt_adults > 0 || !applicable) && !stay.exemption_reason.trim())
    issues.push(
      "Précisez le motif d’exonération ou de non-application de la taxe de séjour.",
    );
  if (params.start && params.start.slice(0, 10) < policy.effective_from)
    issues.push(
      "Le séjour commence avant la date d’application du barème enregistré. Choisissez le barème correspondant au séjour.",
    );
  if (stay.collector === "unknown")
    issues.push("Précisez qui collecte la taxe de séjour.");
  if (stay.collector === "platform" && !stay.platform.trim())
    issues.push("Précisez la plateforme qui collecte la taxe de séjour.");
  const known = stay.collector === "host" || stay.collector === "platform";
  // The tax-inclusive proportional price is solved in cents. Searching the
  // monotonic net-price + rounded-tax function avoids a floating-point cycle.
  const taxFor = (accommodationCents: number) => {
    if (!applicable || nights <= 0 || occupants <= 0 || taxable <= 0)
      return { unit: 0, total: 0 };
    const base = policy.classified
      ? policy.fixed_rate
      : Math.min(
          policy.cap,
          ((accommodationCents /
            100 /
            (1 + policy.accommodation_vat_rate / 100) /
            nights /
            occupants) *
            policy.percentage) /
            100,
        );
    const baseCents = cents(base);
    const unitCents =
      baseCents +
      cents(((baseCents / 100) * policy.additional_percentage) / 100);
    return { unit: unitCents, total: unitCents * nights * taxable };
  };
  const priceCents = cents(price);
  let netCents = priceCents;
  if (policy.included && known && applicable) {
    if (policy.classified)
      netCents = Math.max(0, priceCents - taxFor(priceCents).total);
    else {
      let low = 0,
        high = priceCents;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (mid + taxFor(mid).total < priceCents) low = mid + 1;
        else high = mid;
      }
      netCents = low;
    }
  }
  const calculated = taxFor(netCents);
  if (policy.included && known && calculated.total > priceCents)
    issues.push(
      "La taxe de séjour dépasse le prix annoncé. Vérifiez le tarif ou le prix du séjour.",
    );
  // Keep the advertised total exact when a rounded per-person rate has a gap.
  const accommodationCents =
    policy.included && known
      ? Math.max(0, priceCents - calculated.total)
      : priceCents;
  if (
    policy.included &&
    known &&
    !policy.classified &&
    taxFor(accommodationCents).total !== calculated.total
  )
    issues.push(
      "Le prix taxe comprise ne permet pas une ventilation exacte avec les arrondis par personne et par nuit. Ajustez le prix annoncé ou facturez la taxe en supplément.",
    );
  return {
    version: 1,
    stay_label: "",
    collector: stay.collector,
    platform: stay.platform,
    included: policy.included,
    classified: policy.classified,
    nights,
    occupants,
    taxable_adults: applicable ? taxable : 0,
    exempt_people: applicable
      ? children + stay.infants + stay.exempt_adults
      : occupants,
    exemption_reason: stay.exemption_reason,
    unit_amount: calculated.unit / 100,
    amount: calculated.total / 100,
    host_amount: stay.collector === "host" ? calculated.total / 100 : 0,
    accommodation_amount: accommodationCents / 100,
    authority: policy.authority,
    issues,
  };
}

export function reservationTouristTax(reservation: {
  nb_nuits: number;
  nb_adultes: number;
  nb_enfants_2_17?: number;
  prix_total: unknown;
  remise_montant?: unknown;
  date_entree?: string | Date;
  options?: unknown;
}): TouristTaxResult | null {
  let options: unknown = reservation.options;
  if (typeof options === "string") {
    try {
      options = JSON.parse(options);
    } catch {
      return null;
    }
  }
  const raw =
    options && typeof options === "object" && "tourist_tax" in options
      ? options.tourist_tax
      : null;
  const stay = touristTaxStaySchema.safeParse(raw);
  if (!stay.success) return null;
  return computeTouristTax({
    stay: stay.data,
    nights: reservation.nb_nuits,
    adults: reservation.nb_adultes,
    children: reservation.nb_enfants_2_17 ?? 0,
    accommodation:
      Number(reservation.prix_total ?? 0) -
      Number(reservation.remise_montant ?? 0),
    start:
      reservation.date_entree instanceof Date
        ? reservation.date_entree.toISOString()
        : reservation.date_entree,
  });
}
export function reservationAmountToCollect(
  reservation: Parameters<typeof reservationTouristTax>[0] & {
    frais_optionnels_montant?: unknown;
  },
) {
  const tax = reservationTouristTax(reservation);
  return round(
    (tax?.accommodation_amount ??
      Number(reservation.prix_total ?? 0) -
        Number(reservation.remise_montant ?? 0)) +
      Number(reservation.frais_optionnels_montant ?? 0) +
      (tax?.host_amount ?? 0),
  );
}

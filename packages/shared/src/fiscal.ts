import { z } from "zod";

export const vatRegimeLabels = {
  unknown: "À préciser",
  franchise_en_base: "Franchise en base de TVA",
  reel_simplifie: "Réel simplifié",
  reel_normal: "Réel normal",
  exonere: "Exonéré de TVA",
  hors_champ: "Hors champ de la TVA",
} as const;

export const vatRegimeSchema = z.enum([
  "unknown",
  "franchise_en_base",
  "reel_simplifie",
  "reel_normal",
  "exonere",
  "hors_champ",
]);
export type VatRegime = z.infer<typeof vatRegimeSchema>;

const emptyToNull = (value: unknown) =>
  typeof value === "string" && !value.trim() ? null : value;
const optionalText = (max: number) =>
  z
    .preprocess(emptyToNull, z.string().trim().max(max).nullable())
    .optional()
    .default(null);
const identifier = (length: number, label: string) =>
  z
    .preprocess(
      (value) =>
        typeof value === "string" ? value.replace(/\s/g, "") || null : value,
      z
        .string()
        .regex(
          new RegExp(`^\\d{${length}}$`),
          `${label} : ${length} chiffres attendus.`,
        )
        .nullable(),
    )
    .optional()
    .default(null);

const addressShape = {
  address_line1: optionalText(250),
  address_line2: optionalText(250),
  postal_code: optionalText(20),
  city: optionalText(120),
  country_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Code pays attendu sur deux lettres.")
    .default("FR"),
};

export const fiscalEntitySchema = z
  .object({
    legal_name: z
      .string()
      .trim()
      .min(1, "La raison sociale est obligatoire.")
      .max(250),
    gestionnaire_id: optionalText(160),
    siren: identifier(9, "SIREN"),
    vat_number: z
      .preprocess(
        (value) =>
          typeof value === "string"
            ? value.replace(/\s/g, "").toUpperCase() || null
            : value,
        z
          .string()
          .regex(/^[A-Z]{2}[A-Z0-9]{2,14}$/, "Numéro de TVA invalide.")
          .nullable(),
      )
      .optional()
      .default(null),
    vat_regime: vatRegimeSchema.default("unknown"),
    email: z
      .preprocess(
        emptyToNull,
        z.string().trim().email("Adresse email invalide.").max(250).nullable(),
      )
      .optional()
      .default(null),
    ...addressShape,
  })
  .superRefine((value, ctx) => {
    if (
      value.vat_number?.startsWith("FR") &&
      (!/^FR[A-Z0-9]{2}\d{9}$/.test(value.vat_number) ||
        (value.siren && value.vat_number.slice(-9) !== value.siren))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vat_number"],
        message: "Le numéro de TVA français doit correspondre au SIREN.",
      });
    }
  });

export const fiscalEstablishmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le nom de l’établissement est obligatoire.")
    .max(250),
  siret: identifier(14, "SIRET"),
  ...addressShape,
});

// This is a data inventory, not a fiscal eligibility or SuperPDP compliance check.
export const fiscalEntityMissingFields = (entity: {
  siren: string | null;
  vat_regime: string;
  vat_number: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
}) => [
  ...(!entity.siren ? ["SIREN"] : []),
  ...(entity.vat_regime === "unknown" ? ["Régime de TVA"] : []),
  ...(["reel_simplifie", "reel_normal"].includes(entity.vat_regime) &&
  !entity.vat_number
    ? ["Numéro de TVA"]
    : []),
  ...(!entity.address_line1 || !entity.postal_code || !entity.city
    ? ["Adresse du siège"]
    : []),
];

export type FiscalEntityInput = z.infer<typeof fiscalEntitySchema>;
export type FiscalEstablishmentInput = z.infer<
  typeof fiscalEstablishmentSchema
>;

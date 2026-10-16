import { z } from "zod";
import { env } from "../../config/env.js";
import { superPdpError } from "./secrets.js";
import { SuperPdpTransport } from "./transport.js";

export const reportingProfileSchema = z
  .object({
    operation: z.enum(["goods", "services"]),
    vat_regime: z.enum(["monthly", "quarterly", "simplified", "vat_exemption"]),
    has_vat_on_debits: z.boolean(),
    confirm_no_other_reporting: z.literal(true),
  })
  .strict();
export type ReportingProfile = z.infer<typeof reportingProfileSchema>;
export const b2cEnabled = () => {
  if (!env.SUPERPDP_SANDBOX_B2C_ENABLED)
    throw superPdpError(
      "SUPERPDP_B2C_DISABLED",
      "Le parcours B2C de test n’est pas activé.",
      503,
    );
};
export const assertLocalRegime = (local: string, profile: ReportingProfile) => {
  const allowed: Record<string, string[]> = {
    reel_normal: ["monthly", "quarterly"],
    reel_simplifie: ["simplified"],
    franchise_en_base: ["vat_exemption"],
  };
  if (!allowed[local]?.includes(profile.vat_regime))
    throw superPdpError(
      "SUPERPDP_REPORTING_REGIME",
      "Le régime de TVA choisi ne correspond pas à l’émetteur figé. Faites vérifier les paramètres fiscaux.",
    );
};
export const assertRemoteProfile = async (
  transport: SuperPdpTransport,
  token: string,
  companyId: string,
  profile: ReportingProfile,
) => {
  const company = await transport.reportingCompany(token);
  if (
    company.id !== companyId ||
    company.env !== "sandbox" ||
    company.vat_regime !== profile.vat_regime ||
    company.has_vat_on_debits !== profile.has_vat_on_debits
  )
    throw superPdpError(
      "SUPERPDP_REPORTING_CONFIGURATION",
      "Les paramètres de TVA SuperPDP ne correspondent pas à la préparation. Vérifiez-les dans l’entreprise de test ; aucun paramètre distant n’est modifié automatiquement.",
    );
};
export const moneyCents = (value: string) => {
  if (!/^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(value))
    throw superPdpError(
      "SUPERPDP_PAYMENT_AMOUNT",
      "Un montant positif en euros avec deux décimales est attendu.",
    );
  return Number(value.replace(".", ""));
};
export const centsMoney = (value: number) =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

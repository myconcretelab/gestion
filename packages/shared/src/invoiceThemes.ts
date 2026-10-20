import { z } from "zod";

/** Add one catalogue entry and its CSS file under server/templates/invoices/themes.
 * All themes share the same invoice content, calculations and archive lifecycle.
 */
export const invoiceThemes = {
  heritage: {
    name: "Héritage",
    description: "Naturel et chaleureux, aux accents sauge.",
    paper: "#fffdf8",
    ink: "#2f2a22",
    accent: "#6d7c63",
    surface: "#f4ecdc",
    stylesheet: null,
  },
  horizon: {
    name: "Horizon",
    description: "Bleu encre, lignes nettes et lecture immédiate.",
    paper: "#ffffff",
    ink: "#182b45",
    accent: "#245a7d",
    surface: "#edf3f8",
    stylesheet: "invoices/themes/horizon.css",
  },
  signature: {
    name: "Signature",
    description: "Élégance éditoriale, ivoire et détails cuivrés.",
    paper: "#fffefa",
    ink: "#302b28",
    accent: "#94603d",
    surface: "#f5eee5",
    stylesheet: "invoices/themes/signature.css",
  },
} as const;

export type InvoiceThemeId = keyof typeof invoiceThemes;
export const invoiceThemeIds = Object.keys(invoiceThemes) as [
  InvoiceThemeId,
  ...InvoiceThemeId[],
];
export const invoiceThemeIdSchema = z.enum(invoiceThemeIds);
export const defaultInvoiceTheme: InvoiceThemeId = "heritage";

export function resolveInvoiceTheme(clauses: unknown): InvoiceThemeId {
  const value =
    clauses && typeof clauses === "object" && "invoice_theme" in clauses
      ? clauses.invoice_theme
      : undefined;
  const result = invoiceThemeIdSchema.safeParse(value);
  return result.success ? result.data : defaultInvoiceTheme;
}

// Presentation lives in the existing JSON document settings: no database migration.
// Unknown historical keys remain readable; incoming theme IDs are allowlisted.
export const invoiceClausesSchema = z
  .object({ invoice_theme: invoiceThemeIdSchema.optional() })
  .catchall(z.unknown());

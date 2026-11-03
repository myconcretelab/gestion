import { z } from "zod";
import type { ReportOperation, ReportState } from "./reports.js";

export const reportMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const reportDefinitionSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["social", "tourist", "owner", "custom"]),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000),
    recipient: z.string().trim().min(1).max(160),
    dateBasis: z.enum(["payment", "stay"]),
    cadence: z.enum(["monthly", "quarterly", "yearly"]),
    categories: z
      .array(
        z.enum(["accommodation", "cleaning", "linen", "extras", "tourist_tax"]),
      )
      .min(1)
      .max(5),
    propertyIds: z.array(z.string().min(1).max(100)).min(1).max(1000),
    favorite: z.boolean(),
    operatorId: z.string().max(100).nullable().optional(),
    managerId: z.string().min(1).max(100).nullable().optional(),
    worklistStartMonth: reportMonthSchema.optional(),
    bookingSources: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(100)
      .optional(),
    otaAmountBasis: z.enum(["gross", "net"]).optional(),
    nightGuests: z
      .array(z.enum(["adults", "children", "infants"]))
      .min(1)
      .max(3)
      .optional(),
    nightReference: z.boolean().optional(),
    excludedBookingSources: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (
      report.kind !== "tourist" &&
      (report.nightGuests || report.nightReference)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Le choix des occupants et du rapport de référence concerne les rapports de nuitées.",
      });
    if (report.kind === "social" && !report.operatorId)
      ctx.addIssue({
        code: "custom",
        message: "Sélectionnez un exploitant pour les cotisations sociales.",
      });
    if (
      new Set(report.propertyIds).size !== report.propertyIds.length ||
      (report.bookingSources &&
        new Set(report.bookingSources).size !== report.bookingSources.length) ||
      new Set(report.categories).size !== report.categories.length ||
      (report.nightGuests &&
        new Set(report.nightGuests).size !== report.nightGuests.length) ||
      (report.excludedBookingSources &&
        new Set(report.excludedBookingSources).size !==
          report.excludedBookingSources.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Le périmètre contient des doublons.",
      });
    if (
      report.kind === "social" &&
      (report.dateBasis !== "payment" ||
        report.categories.includes("tourist_tax"))
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Les cotisations sociales portent sur les encaissements hors taxe de séjour.",
      });
    }
    if (
      report.kind === "tourist" &&
      (report.dateBasis !== "stay" ||
        report.categories.length !== 1 ||
        report.categories[0] !== "accommodation")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Le rapport de nuitées utilise les dates des nuits occupées.",
      });
    }
  });
export const reportDraftSchema = z
  .object({
    ...reportDefinitionSchema.shape,
    name: z.string().max(120),
    recipient: z.string().max(160),
    categories: z.array(reportDefinitionSchema.shape.categories.element).max(5),
    propertyIds: z.array(z.string().min(1).max(100)).max(1000),
    bookingSources: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .optional(),
  })
  .strict();
export const reportAllocationSchema = z
  .object({
    updatedAt: z.string().datetime(),
    amounts: z
      .object({
        cleaning: z.number().int().min(0),
        linen: z.number().int().min(0),
        extras: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type ReportAllocation = {
  reservationId: string;
  guest: string;
  property: string;
  totalCents: number;
  updatedAt: string;
  amounts: { cleaning: number; linen: number; extras: number } | null;
};
export const reportCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("worklist-start"),
      startMonth: reportMonthSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("save"), definition: reportDefinitionSchema })
    .strict(),
  z
    .object({
      type: z.literal("favorite"),
      reportId: z.string(),
      favorite: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("override"),
      reportId: z.string(),
      operationId: z.string(),
      override: z
        .object({
          status: z.enum(["included", "review", "excluded"]),
          note: z.string().trim().min(3).max(1000),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z.object({ type: z.literal("ready"), reportId: z.string() }).strict(),
  z.object({ type: z.literal("confirm"), reportId: z.string() }).strict(),
]);
export type ReportCommand = z.infer<typeof reportCommandSchema>;
export const reportMutationSchema = z
  .object({
    revision: z.number().int().min(0),
    factsRevision: z.string().min(1),
    month: reportMonthSchema,
    command: reportCommandSchema,
  })
  .strict();
export type ReportMutation = z.infer<typeof reportMutationSchema>;
export type ReportProperty = {
  id: string;
  name: string;
  initials: string;
  operatorId: string | null;
  managerId?: string | null;
};
export type ReportOperator = { id: string; name: string; legacy: boolean };
export type ReportManager = { id: string; name: string };
export type LegacyReportDeclaration = {
  id: string;
  kind: "social" | "tourist";
  period: string;
  subject: string;
  value: number;
  confirmedAt: string;
  propertyIds?: string[];
};
export type ReportWorkspaceData = ReportState & {
  calculatedAt?: string;
  organizationId: string;
  revision: number;
  factsRevision: string;
  properties: ReportProperty[];
  operators: ReportOperator[];
  managers?: ReportManager[];
  operations: ReportOperation[];
  legacyDeclarations: LegacyReportDeclaration[];
};

import { z } from "zod";
import { reportReference, type ReportState } from "./reports.js";

const id = z.string().min(1).max(100);
const cents = z.number().int().min(0).max(1_000_000_000);
const note = z.string().trim().max(1000);
const date = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Date invalide.",
  );
export type TaxRemittanceAccount = {
  id: string;
  name: string;
  propertyIds: string[];
};
export function taxRemittanceAccounts(state: {
  managers?: Array<{ id: string; name: string }>;
  properties: Array<{ id: string; managerId?: string | null }>;
  taxRemittances?: TaxRemittance[];
}): TaxRemittanceAccount[] {
  const owners = (state.managers ?? []).map((owner) => ({
    ...owner,
    propertyIds: state.properties
      .filter((p) => p.managerId === owner.id)
      .map((p) => p.id),
  }));
  for (const remittance of state.taxRemittances ?? []) {
    if (!owners.some((owner) => owner.id === remittance.accountId))
      owners.push({
        id: remittance.accountId,
        name: `${remittance.accountName} · ancien propriétaire`,
        propertyIds: [],
      });
  }
  return owners.filter(
    (owner) =>
      owner.propertyIds.length ||
      state.taxRemittances?.some((r) => r.accountId === owner.id),
  );
}
export const taxRemittanceInputSchema = z
  .object({
    id,
    accountId: id,
    label: z.string().trim().min(1).max(160),
    sourceKeys: z
      .array(z.string().min(1).max(250))
      .min(1)
      .max(1000)
      .refine((keys) => new Set(keys).size === keys.length),
    declaredAmountCents: cents,
    declarationReference: z.string().trim().max(200),
    note,
  })
  .strict();
export const taxRemittancePaymentSchema = z
  .object({
    id,
    paidOn: date,
    amountCents: cents.refine(
      (value) => value > 0,
      "Le montant doit être positif.",
    ),
    reference: z.string().trim().max(200),
    note,
  })
  .strict();
export type TaxRemittanceReceipt = {
  id: string;
  name: string;
  contentType: "application/pdf" | "image/png" | "image/jpeg";
  sizeBytes: number;
  checksumSha256: string;
  uploadedAt: string;
};
export type TaxRemittancePayment = z.infer<
  typeof taxRemittancePaymentSchema
> & {
  recordedAt: string;
  recordedBy: string | null;
  voidedAt?: string;
  voidReason?: string;
  receipts?: TaxRemittanceReceipt[];
};
export type TaxRemittanceSource = {
  key: string;
  revision: string;
  reportId: string;
  reportName: string;
  label: string;
  start: string;
  end: string;
  properties: Array<{
    id: string;
    name: string;
    hostCents: number;
    platformCents: number;
  }>;
};
export type TaxRemittance = Omit<
  z.infer<typeof taxRemittanceInputSchema>,
  "sourceKeys"
> & {
  accountName: string;
  sources: TaxRemittanceSource[];
  createdAt: string;
  updatedAt: string;
  payments: TaxRemittancePayment[];
  cancelledAt?: string;
  cancelReason?: string;
};
export type TaxRemittanceState = {
  taxRemittances?: TaxRemittance[];
};

/** Only confirmed declaration copies supply amounts; current reservations never do. */
export function taxRemittanceSources(
  state: Pick<ReportState, "progress">,
  account: TaxRemittanceAccount,
): TaxRemittanceSource[] {
  return Object.entries(state.progress)
    .flatMap(([key, progress]) => {
      const copy = reportReference(progress);
      const register = copy?.nightRegister;
      if (
        !copy?.definition.nightDeclaration ||
        !register ||
        register.incompleteCount
      )
        return [];
      const rows = register.summary.filter((row) =>
        account.propertyIds.includes(row.propertyId),
      );
      if (
        !rows.length ||
        rows.some(
          (row) =>
            row.hostCollectedCents === null ||
            row.platformCollectedCents === null,
        )
      )
        return [];
      return [
        {
          key,
          revision: register.revision,
          reportId: register.reportId,
          reportName: register.reportName,
          label: register.period.label,
          start: register.period.start,
          end: register.period.end,
          properties: rows.map((row) => ({
            id: row.propertyId,
            name: row.propertyName,
            hostCents: row.hostCollectedCents!,
            platformCents: row.platformCollectedCents!,
          })),
        },
      ];
    })
    .sort(
      (a, b) => b.start.localeCompare(a.start) || a.key.localeCompare(b.key),
    );
}

export function taxRemittanceSourcesOverlap(
  a: TaxRemittanceSource,
  b: TaxRemittanceSource,
) {
  return (
    a.start < b.end &&
    b.start < a.end &&
    a.properties.some((p) => b.properties.some((other) => other.id === p.id))
  );
}

export function taxRemittanceTotals(
  remittance: Pick<
    TaxRemittance,
    "sources" | "payments" | "declaredAmountCents" | "cancelledAt"
  >,
) {
  const collectedCents = remittance.sources.reduce(
    (sum, source) =>
      sum +
      source.properties.reduce(
        (total, property) => total + property.hostCents,
        0,
      ),
    0,
  );
  const platformCents = remittance.sources.reduce(
    (sum, source) =>
      sum +
      source.properties.reduce(
        (total, property) => total + property.platformCents,
        0,
      ),
    0,
  );
  const paidCents = remittance.payments
    .filter((payment) => !payment.voidedAt)
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const balanceCents = remittance.declaredAmountCents - paidCents;
  return {
    collectedCents,
    platformCents,
    paidCents,
    balanceCents,
    differenceCents: remittance.declaredAmountCents - collectedCents,
    status: remittance.cancelledAt
      ? "Annulé"
      : balanceCents < 0
        ? "Trop versé"
        : balanceCents === 0
          ? "Réglé"
          : paidCents
            ? "Partiellement réglé"
            : "À reverser",
  };
}

export function taxRemittanceSourcesChanged(
  state: Pick<ReportState, "progress">,
  remittance: TaxRemittance,
) {
  const latest = taxRemittanceSources(state, {
    id: remittance.accountId,
    name: remittance.accountName,
    propertyIds: [
      ...new Set(
        remittance.sources.flatMap((source) =>
          source.properties.map((p) => p.id),
        ),
      ),
    ],
  });
  return remittance.sources.some(
    (source) =>
      latest.find((row) => row.key === source.key)?.revision !==
      source.revision,
  );
}

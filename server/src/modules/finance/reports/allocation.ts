import { createHash } from "node:crypto";
import {
  reportAllocationSchema,
  type ReportAllocation,
} from "@contrats/shared";
import prisma from "../../../db/prisma.js";
import { fromJsonString } from "../../../utils/jsonFields.js";
import type { NumericLike } from "../../../utils/money.js";
const fail = (message: string, status = 409) =>
  Object.assign(new Error(message), { status, statusCode: status });
/** SQLite stores JSON text; PostgreSQL returns JSON objects and Decimal amounts. */
export function reportOptionsSignature(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)]),
      );
    return item;
  };
  return JSON.stringify(canonical(fromJsonString(value, {})));
}
export const allocationSource = (row: {
  options: unknown;
  frais_optionnels_montant: NumericLike;
}) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        reportOptionsSignature(row.options),
        Number(row.frais_optionnels_montant),
      ]),
    )
    .digest("hex");
export function storedAllocation(row: {
  options: unknown;
  frais_optionnels_montant: NumericLike;
  reporting_amounts: string | null;
}) {
  if (!row.reporting_amounts) return null;
  try {
    const saved = JSON.parse(row.reporting_amounts);
    const parsed = reportAllocationSchema.shape.amounts.safeParse(
      saved.amounts,
    );
    return parsed.success &&
      saved.source === allocationSource(row) &&
      Object.values(parsed.data).reduce((a, b) => a + b, 0) ===
        Math.round(Number(row.frais_optionnels_montant) * 100)
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
export async function getReportAllocation(
  id: string,
): Promise<ReportAllocation> {
  const row = await prisma.reservation.findFirst({
    where: { id },
    include: { gite: { select: { nom: true } } },
  });
  if (!row) throw fail("Réservation introuvable.", 404);
  return {
    reservationId: row.id,
    guest: row.hote_nom,
    property: row.gite?.nom ?? "Sans logement",
    totalCents: Math.round(Number(row.frais_optionnels_montant) * 100),
    updatedAt: row.updatedAt.toISOString(),
    amounts: storedAllocation(row),
  };
}
export async function saveReportAllocation(
  id: string,
  input: unknown,
  userId?: string,
) {
  const payload = reportAllocationSchema.parse(input);
  await prisma.$transaction(async (db) => {
    const row = await db.reservation.findFirst({ where: { id } });
    if (!row) throw fail("Réservation introuvable.", 404);
    if (row.updatedAt.toISOString() !== payload.updatedAt)
      throw fail(
        "La réservation a changé. Rechargez la ventilation avant de réessayer.",
      );
    const total = Object.values(payload.amounts).reduce((a, b) => a + b, 0);
    if (total !== Math.round(Number(row.frais_optionnels_montant) * 100))
      throw fail(
        "La ventilation doit correspondre exactement au total des prestations de la réservation.",
        400,
      );
    const result = await db.reservation.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: {
        reporting_amounts: JSON.stringify({
          source: allocationSource(row),
          amounts: payload.amounts,
        }),
      },
    });
    if (result.count !== 1)
      throw fail(
        "La réservation a changé. Rechargez la ventilation avant de réessayer.",
      );
    await db.auditLog.create({
      data: {
        organization_id: row.organization_id,
        user_id: userId,
        action: "report.allocate",
        resource_type: "reservation",
        resource_id: id,
        metadata_json: JSON.stringify(payload.amounts),
      },
    });
  });
  return getReportAllocation(id);
}

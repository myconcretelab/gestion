import prisma from "../db/prisma.js";
import { getOrganizationId } from "./organizationContext.js";

export const USER_INTERVENTION_KINDS = ["cleaning_check", "full_cleaning"] as const;
export type UserInterventionKind = (typeof USER_INTERVENTION_KINDS)[number];

export const toParisIsoDate = (value: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(value);

export const recordCleaningCheckIntervention = async (
  reservationId: string,
  userId: string | null,
  checkedAt: Date,
) => {
  if (!userId) return null;
  const [user, reservation] = await Promise.all([
    prisma.appUser.findUnique({
      where: { id: userId },
      select: { id: true, display_name: true, cleaning_check_rate: true },
    }),
    prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, gite_id: true, gite: { select: { nom: true } } },
    }),
  ]);
  if (!user || !reservation) return null;
  return prisma.userIntervention.upsert({
    where: { organization_id_source_key: { organization_id: getOrganizationId(), source_key: `cleaning-check:${reservation.id}` } },
    update: {},
    create: {
      user_id: user.id,
      user_name: user.display_name,
      kind: "cleaning_check",
      occurred_on: toParisIsoDate(checkedAt),
      gite_id: reservation.gite_id,
      gite_name: reservation.gite?.nom ?? null,
      reservation_id: reservation.id,
      source_key: `cleaning-check:${reservation.id}`,
      amount_snapshot: Number(user.cleaning_check_rate ?? 0),
    },
  });
};

export const removeUnpaidCleaningCheckIntervention = async (reservationId: string) =>
  prisma.userIntervention.deleteMany({
    where: {
      source_key: `cleaning-check:${reservationId}`,
      paid_at: null,
    },
  });

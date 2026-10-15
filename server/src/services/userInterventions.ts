import prisma from "../db/prisma.js";
import { getOrganizationId } from "./organizationContext.js";
import { fromJsonString } from "../utils/jsonFields.js";

export const USER_INTERVENTION_KINDS = ["cleaning_check", "full_cleaning"] as const;
export type UserInterventionKind = (typeof USER_INTERVENTION_KINDS)[number];

export const toParisIsoDate = (value: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(value);

export const fullCleaningAmount = (giteRate: unknown, rates: unknown, giteId: string) => {
  const overrides = fromJsonString<Record<string, unknown>>(rates, {});
  const override = overrides && !Array.isArray(overrides) && Object.hasOwn(overrides, giteId)
    ? Number(overrides[giteId]) : null;
  return override !== null && Number.isFinite(override) ? override : Number(giteRate ?? 0);
};

export const listCleaningRateGites = async () => {
  const gites = await prisma.gite.findMany({
    select: { id: true, nom: true, options_menage_forfait: true },
    orderBy: [{ ordre: "asc" }, { nom: "asc" }],
  });
  return gites.map((gite) => ({ id: gite.id, nom: gite.nom, cleaningRate: Number(gite.options_menage_forfait) }));
};

export const validateCleaningRateGites = async (rates: Record<string, number> | undefined) => {
  if (!rates) return true;
  const ids = Object.keys(rates);
  if (!ids.length) return true;
  const count = await prisma.gite.count({ where: { id: { in: ids } } });
  return count === ids.length;
};

export const isActiveCleaningWorker = async (userId: string) => {
  const worker = await prisma.appUser.findUnique({
    where: { id: userId }, select: { intervenant_id: true, is_active: true },
  });
  return Boolean(worker?.intervenant_id && worker.is_active);
};

export const recordFullCleaningIntervention = async (
  reservationId: string, userId: string | null, occurredOn: string, automatic: boolean,
) => {
  if (!userId) return null;
  const [user, reservation] = await Promise.all([
    prisma.appUser.findUnique({ where: { id: userId }, select: {
      id: true, display_name: true, intervenant_id: true, full_cleaning_rates: true,
    } }),
    prisma.reservation.findUnique({ where: { id: reservationId }, select: {
      id: true, gite_id: true, gite: { select: { nom: true, options_menage_forfait: true } },
    } }),
  ]);
  if (!user || !user.intervenant_id || !reservation?.gite_id || !reservation.gite) return null;
  const sourceKey = `full-cleaning:${reservation.id}`;
  return prisma.userIntervention.upsert({
    where: { organization_id_source_key: { organization_id: getOrganizationId(), source_key: sourceKey } },
    update: {},
    create: {
      user_id: user.id,
      user_name: user.display_name,
      kind: "full_cleaning",
      occurred_on: occurredOn,
      gite_id: reservation.gite_id,
      gite_name: reservation.gite.nom,
      reservation_id: reservation.id,
      source_key: sourceKey,
      amount_snapshot: fullCleaningAmount(reservation.gite.options_menage_forfait, user.full_cleaning_rates, reservation.gite_id),
      automatic,
    },
  });
};

export const removeUnpaidAutomaticFullCleaningIntervention = async (reservationId: string) =>
  prisma.userIntervention.deleteMany({ where: {
    source_key: `full-cleaning:${reservationId}`, paid_at: null, automatic: true,
  } });

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

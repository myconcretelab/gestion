import type { RequestHandler } from "express";
import { getReservationOriginSystem } from "../utils/reservationOrigin.js";
import type { NumericLike } from "../utils/money.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_DAY_COUNT = 3;
const RECENT_ACTIVITY_LIMIT = 36;
const DEFAULT_NOTIFICATION_DAY_COUNT = 1;
const MAX_NOTIFICATION_DAY_COUNT = 5;

type OpenIcalConflictRecord = {
  reservation_id: string;
  detected_at: string;
  [key: string]: unknown;
};

type RecentImportLogEntry = {
  at: string;
  [key: string]: unknown;
};

type OverviewReservation = {
  id: string;
  energy_tracking: unknown;
  gite?: {
    electricity_price_per_kwh: NumericLike;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

type OverviewHandlerDependencies = {
  loadGites: () => Promise<unknown[]>;
  loadReservations: (today: Date, endExclusive: Date) => Promise<OverviewReservation[]>;
  countUnassignedReservations: (today: Date, endExclusive: Date) => Promise<number>;
  loadRecentAppActivity: (since: Date) => Promise<unknown[]>;
  listOpenIcalConflicts: () => OpenIcalConflictRecord[];
  loadConflictReservations: (reservationIds: string[]) => Promise<Array<{ id: string; [key: string]: unknown }>>;
  buildNewReservations: (windowStart: Date, windowEnd: Date) => Promise<unknown[]>;
  loadLiveEnergyByReservationId: (
    reservations: OverviewReservation[]
  ) => Promise<Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>>>;
  readTraceabilityLog: () => RecentImportLogEntry[];
  readSourceColors: () => Record<string, string>;
};

const getRecentActivitySince = () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(today.getTime() - (RECENT_ACTIVITY_DAY_COUNT - 1) * DAY_MS);
};

const getNotificationSince = (dayCount: number) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(today.getTime() - (dayCount - 1) * DAY_MS);
};

export const parseDateTime = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseOverviewParams = (query: Record<string, unknown>) => {
  const daysRaw = typeof query.days === "string" ? Number.parseInt(query.days, 10) : 14;
  const days = Number.isFinite(daysRaw) ? Math.min(21, Math.max(7, daysRaw)) : 14;
  const notificationDaysRaw =
    typeof query.notification_days === "string"
      ? Number.parseInt(query.notification_days, 10)
      : DEFAULT_NOTIFICATION_DAY_COUNT;
  const notificationDays = Number.isFinite(notificationDaysRaw)
    ? Math.min(MAX_NOTIFICATION_DAY_COUNT, Math.max(1, notificationDaysRaw))
    : DEFAULT_NOTIFICATION_DAY_COUNT;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return {
    days,
    notificationDays,
    today,
    endExclusive: new Date(today.getTime() + days * DAY_MS),
    notificationSince: getNotificationSince(notificationDays),
    recentActivitySince: getRecentActivitySince(),
  };
};

export const buildOverviewReservationsWhere = (today: Date, endExclusive: Date) => ({
  gite_id: { not: null },
  date_entree: { lt: endExclusive },
  date_sortie: { gte: today },
});

export const buildRecentAppActivity = async (
  since: Date,
  loadRows: () => Promise<
    Array<{
      id: string;
      gite_id: string | null;
      hote_nom: string | null;
      source_paiement: string | null;
      commentaire: string | null;
      prix_total: NumericLike | null;
      prix_par_nuit: NumericLike | null;
      origin_system: string | null;
      createdAt: string | Date | null;
      updatedAt: string | Date | null;
      gite: { nom: string | null } | null;
    }>
  >
) => {
  const rows = await loadRows();

  const items = rows.flatMap((reservation) => {
    if (getReservationOriginSystem(reservation) !== "app") return [];

    const createdAt = parseDateTime(reservation.createdAt);
    const updatedAt = parseDateTime(reservation.updatedAt);
    const guestName = String(reservation.hote_nom ?? "").trim() || "Réservation";
    const giteName = String(reservation.gite?.nom ?? "").trim() || "Sans gîte";
    const source = String(reservation.source_paiement ?? "").trim() || null;
    const events: Array<{
      id: string;
      at: string;
      type: "created" | "updated";
      reservation_id: string;
      gite_id: string | null;
      gite_name: string;
      guest_name: string;
      source: string | null;
    }> = [];

    if (createdAt && createdAt.getTime() >= since.getTime()) {
      events.push({
        id: `app-created:${reservation.id}`,
        at: createdAt.toISOString(),
        type: "created",
        reservation_id: reservation.id,
        gite_id: reservation.gite_id ?? null,
        gite_name: giteName,
        guest_name: guestName,
        source,
      });
    }

    if (updatedAt && updatedAt.getTime() >= since.getTime() && (!createdAt || updatedAt.getTime() !== createdAt.getTime())) {
      events.push({
        id: `app-updated:${reservation.id}:${updatedAt.toISOString()}`,
        at: updatedAt.toISOString(),
        type: "updated",
        reservation_id: reservation.id,
        gite_id: reservation.gite_id ?? null,
        gite_name: giteName,
        guest_name: guestName,
        source,
      });
    }

    return events;
  });

  return items
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT);
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const toLiveEnergyMap = (
  value: Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>>
) => (value instanceof Map ? value : new Map(Object.entries(value ?? {})));

export const createOverviewHandler = (deps: OverviewHandlerDependencies): RequestHandler => async (req, res, next) => {
  try {
    const { days, notificationDays, today, endExclusive, recentActivitySince, notificationSince } = parseOverviewParams(
      req.query as Record<string, unknown>
    );

    const openIcalConflicts = deps.listOpenIcalConflicts();
    const [gites, reservations, unassignedCount, recentAppActivity, conflictReservations, newReservations] = await Promise.all([
      deps.loadGites(),
      deps.loadReservations(today, endExclusive),
      deps.countUnassignedReservations(today, endExclusive),
      deps.loadRecentAppActivity(recentActivitySince),
      openIcalConflicts.length > 0
        ? deps.loadConflictReservations(openIcalConflicts.map((item) => item.reservation_id))
        : Promise.resolve([]),
      deps.buildNewReservations(notificationSince, new Date()),
    ]);

    const liveEnergyByReservationId = toLiveEnergyMap(await deps.loadLiveEnergyByReservationId(reservations));
    const recentImportLog = deps
      .readTraceabilityLog()
      .filter((entry) => {
        const parsed = parseDateTime(entry.at);
        return parsed ? parsed.getTime() >= recentActivitySince.getTime() : false;
      })
      .slice(0, RECENT_ACTIVITY_LIMIT);
    const conflictReservationById = new Map(conflictReservations.map((reservation) => [reservation.id, reservation]));

    return res.json({
      today: toIsoDate(today),
      days,
      notification_days: notificationDays,
      gites,
      reservations: reservations.map((reservation) => ({
        ...reservation,
        ...(liveEnergyByReservationId.get(reservation.id) ?? {}),
      })),
      source_colors: deps.readSourceColors(),
      unassigned_count: unassignedCount,
      new_reservations: newReservations,
      recent_import_log: recentImportLog,
      recent_app_activity: recentAppActivity,
      ical_conflicts: openIcalConflicts
        .filter((conflict) => {
          const detectedAt = parseDateTime(conflict.detected_at);
          return detectedAt ? detectedAt.getTime() >= notificationSince.getTime() : false;
        })
        .map((conflict) => ({
          ...conflict,
          reservation: conflictReservationById.get(conflict.reservation_id) ?? null,
        })),
    });
  } catch (error) {
    return next(error);
  }
};

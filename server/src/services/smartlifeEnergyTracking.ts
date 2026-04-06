import crypto from "node:crypto";
import prisma from "../db/prisma.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";
import { round2, toNumber } from "../utils/money.js";
import type { NumericLike } from "../utils/money.js";
import type {
  SmartlifeAutomationConfig,
  SmartlifeAutomationRuleAction,
  SmartlifeEnergyMeterAssignment,
} from "./smartlifeSettings.js";
import { isSmartlifeEnergyTrackingAction } from "./smartlifeSettings.js";
import { getSmartlifeDeviceTotalElectricityKwh } from "./smartlifeClient.js";

export type ReservationEnergyTrackingEntry = {
  session_id: string;
  device_id: string;
  device_name: string;
  status: "open" | "closed";
  started_at: string;
  ended_at: string | null;
  started_total_kwh: number;
  ended_total_kwh: number | null;
  total_kwh: number | null;
  total_cost_eur: number | null;
  stay_total_kwh: number | null;
  stay_total_cost_eur: number | null;
  allocation_ratio: number;
  started_by_rule_id: string | null;
  ended_by_rule_id: string | null;
};

export type ReservationLiveEnergySummary = {
  energy_live_consumption_kwh: number;
  energy_live_cost_eur: number;
  energy_live_price_per_kwh: number | null;
  energy_live_recorded_at: string;
};

type ReservationEnergyRow = {
  id: string;
  stay_group_id: string | null;
  nb_nuits: number;
  energy_tracking: unknown;
  gite: {
    id: string;
    nom: string;
    electricity_price_per_kwh: NumericLike;
  } | null;
};

type SmartlifeEnergyEvent = {
  reservation_id: string;
  gite_id: string | null;
  device_id: string;
  device_name: string;
  action: SmartlifeAutomationRuleAction;
  command_value: boolean;
  rule_id: string;
};

export const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

const normalizeTrackingEntry = (
  value: Partial<ReservationEnergyTrackingEntry> | null | undefined,
): ReservationEnergyTrackingEntry | null => {
  if (!value) return null;
  const sessionId = String(value.session_id ?? "").trim();
  const deviceId = String(value.device_id ?? "").trim();
  if (!sessionId || !deviceId) return null;

  return {
    session_id: sessionId,
    device_id: deviceId,
    device_name: String(value.device_name ?? "").trim() || deviceId,
    status: value.status === "closed" ? "closed" : "open",
    started_at: String(value.started_at ?? "").trim(),
    ended_at:
      typeof value.ended_at === "string" && value.ended_at.trim()
        ? value.ended_at.trim()
        : null,
    started_total_kwh: round4(Math.max(0, toNumber(value.started_total_kwh))),
    ended_total_kwh:
      value.ended_total_kwh == null
        ? null
        : round4(Math.max(0, toNumber(value.ended_total_kwh))),
    total_kwh:
      value.total_kwh == null
        ? null
        : round4(Math.max(0, toNumber(value.total_kwh))),
    total_cost_eur:
      value.total_cost_eur == null
        ? null
        : round2(Math.max(0, toNumber(value.total_cost_eur))),
    stay_total_kwh:
      value.stay_total_kwh == null
        ? null
        : round4(Math.max(0, toNumber(value.stay_total_kwh))),
    stay_total_cost_eur:
      value.stay_total_cost_eur == null
        ? null
        : round2(Math.max(0, toNumber(value.stay_total_cost_eur))),
    allocation_ratio: Math.max(0, toNumber(value.allocation_ratio)),
    started_by_rule_id:
      typeof value.started_by_rule_id === "string" &&
      value.started_by_rule_id.trim()
        ? value.started_by_rule_id.trim()
        : null,
    ended_by_rule_id:
      typeof value.ended_by_rule_id === "string" && value.ended_by_rule_id.trim()
        ? value.ended_by_rule_id.trim()
        : null,
  };
};

export const parseReservationEnergyTracking = (value: unknown) => {
  const parsed = fromJsonString<unknown>(value, []);
  if (!Array.isArray(parsed)) return [] as ReservationEnergyTrackingEntry[];
  return parsed
    .map((item) =>
      item && typeof item === "object"
        ? normalizeTrackingEntry(item as Partial<ReservationEnergyTrackingEntry>)
        : null,
    )
    .filter((item): item is ReservationEnergyTrackingEntry => item !== null);
};

export const summarizeReservationEnergyTracking = (
  entries: ReservationEnergyTrackingEntry[],
) => {
  const closedEntries = entries.filter((entry) => entry.status === "closed");
  const energyConsumptionKwh = round4(
    closedEntries.reduce((sum, entry) => sum + (entry.total_kwh ?? 0), 0),
  );
  const energyCostEur = round2(
    closedEntries.reduce((sum, entry) => sum + (entry.total_cost_eur ?? 0), 0),
  );
  const latestClosedEntry = [...closedEntries]
    .sort((left, right) =>
      String(right.ended_at ?? "").localeCompare(String(left.ended_at ?? "")),
    )
    .at(0);

  return {
    energy_consumption_kwh: energyConsumptionKwh,
    energy_cost_eur: energyCostEur,
    energy_price_per_kwh:
      latestClosedEntry?.stay_total_cost_eur != null &&
      latestClosedEntry.stay_total_kwh != null &&
      latestClosedEntry.stay_total_kwh > 0
        ? round4(
            latestClosedEntry.stay_total_cost_eur /
              latestClosedEntry.stay_total_kwh,
          )
        : null,
  };
};

export const summarizeLiveReservationEnergyTracking = (
  entries: ReservationEnergyTrackingEntry[],
  options: {
    deviceTotalsById:
      | Map<string, number>
      | Record<string, number | null | undefined>;
    electricity_price_per_kwh: NumericLike;
    recorded_at?: Date | string;
  },
): ReservationLiveEnergySummary | null => {
  const openEntries = entries.filter((entry) => entry.status === "open");
  if (openEntries.length === 0) return null;

  const getCurrentTotalKwh = (deviceId: string) => {
    if (options.deviceTotalsById instanceof Map) {
      return options.deviceTotalsById.get(deviceId);
    }
    return options.deviceTotalsById[deviceId];
  };

  const totalKwh = round4(
    openEntries.reduce((sum, entry) => {
      const currentTotalKwh = getCurrentTotalKwh(entry.device_id);
      if (currentTotalKwh == null || !Number.isFinite(currentTotalKwh)) {
        return sum;
      }
      return sum + Math.max(0, currentTotalKwh - entry.started_total_kwh);
    }, 0),
  );

  const hasMatchedDevice = openEntries.some((entry) => {
    const currentTotalKwh = getCurrentTotalKwh(entry.device_id);
    return currentTotalKwh != null && Number.isFinite(currentTotalKwh);
  });
  if (!hasMatchedDevice) return null;

  const electricityPricePerKwh = round4(
    Math.max(0, toNumber(options.electricity_price_per_kwh)),
  );
  const recordedAt =
    options.recorded_at instanceof Date
      ? options.recorded_at.toISOString()
      : typeof options.recorded_at === "string" && options.recorded_at.trim()
        ? options.recorded_at.trim()
        : new Date().toISOString();

  return {
    energy_live_consumption_kwh: totalKwh,
    energy_live_cost_eur: round2(totalKwh * electricityPricePerKwh),
    energy_live_price_per_kwh: electricityPricePerKwh,
    energy_live_recorded_at: recordedAt,
  };
};

const allocateByWeight = (
  total: number,
  weights: number[],
  digits: number,
): number[] => {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (totalWeight <= 0) {
    const equalWeight = weights.map(() => 1);
    return allocateByWeight(total, equalWeight, digits);
  }

  const round =
    digits === 4 ? round4 : digits === 2 ? round2 : (value: number) => value;
  let allocated = 0;

  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return round(total - allocated);
    }
    const amount = round((total * Math.max(0, weight)) / totalWeight);
    allocated += amount;
    return amount;
  });
};

const getEnabledMeterAssignment = (
  config: SmartlifeAutomationConfig,
  event: SmartlifeEnergyEvent,
): SmartlifeEnergyMeterAssignment | null => {
  if (!event.gite_id) return null;
  return (
    config.meter_assignments.find(
      (assignment) =>
        assignment.enabled &&
        assignment.gite_id === event.gite_id &&
        assignment.device_id === event.device_id,
    ) ?? null
  );
};

const loadStayReservations = async (reservationId: string) => {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      stay_group_id: true,
      nb_nuits: true,
      energy_tracking: true,
      gite: {
        select: {
          id: true,
          nom: true,
          electricity_price_per_kwh: true,
        },
      },
    },
  });

  if (!reservation) {
    throw new Error(`Réservation introuvable: ${reservationId}.`);
  }

  const stayGroupId = reservation.stay_group_id ?? reservation.id;
  const stayReservations = await prisma.reservation.findMany({
    where: { stay_group_id: stayGroupId },
    select: {
      id: true,
      stay_group_id: true,
      nb_nuits: true,
      energy_tracking: true,
      gite: {
        select: {
          id: true,
          nom: true,
          electricity_price_per_kwh: true,
        },
      },
    },
    orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  return stayReservations.length > 0
    ? stayReservations
    : [reservation];
};

const buildOpenEntry = (event: SmartlifeEnergyEvent, totalKwh: number) => ({
  session_id: crypto.randomUUID(),
  device_id: event.device_id,
  device_name: event.device_name.trim() || event.device_id,
  status: "open" as const,
  started_at: new Date().toISOString(),
  ended_at: null,
  started_total_kwh: round4(totalKwh),
  ended_total_kwh: null,
  total_kwh: null,
  total_cost_eur: null,
  stay_total_kwh: null,
  stay_total_cost_eur: null,
  allocation_ratio: 1,
  started_by_rule_id: event.rule_id,
  ended_by_rule_id: null,
});

const updateStayReservationTracking = async (
  reservations: ReservationEnergyRow[],
  entriesByReservationId: Map<string, ReservationEnergyTrackingEntry[]>,
) => {
  await prisma.$transaction(
    reservations.map((reservation) => {
      const entries = entriesByReservationId.get(reservation.id) ?? [];
      const summary = summarizeReservationEnergyTracking(entries);
      return prisma.reservation.update({
        where: { id: reservation.id },
        data: {
          energy_tracking: encodeJsonField(entries),
          energy_consumption_kwh: summary.energy_consumption_kwh,
          energy_cost_eur: summary.energy_cost_eur,
          energy_price_per_kwh: summary.energy_price_per_kwh,
        },
      });
    }),
  );
};

export const trackSmartlifeEnergyForAutomationEvent = async (
  config: SmartlifeAutomationConfig,
  event: SmartlifeEnergyEvent,
) => {
  const assignment = getEnabledMeterAssignment(config, event);
  if (!assignment) {
    if (isSmartlifeEnergyTrackingAction(event.action)) {
      throw new Error(
        `Aucun compteur total_ele actif n'est associé au gîte pour ${event.device_name || event.device_id}.`,
      );
    }
    return null;
  }

  const reading = await getSmartlifeDeviceTotalElectricityKwh(
    config,
    event.device_id,
  );
  const reservations = await loadStayReservations(event.reservation_id);
  const entriesByReservationId = new Map(
    reservations.map((reservation) => [
      reservation.id,
      parseReservationEnergyTracking(reservation.energy_tracking),
    ]),
  );
  const referenceEntries = entriesByReservationId.get(reservations[0]?.id ?? "") ?? [];

  if (event.command_value) {
    const hasOpenSession = referenceEntries.some(
      (entry) => entry.device_id === event.device_id && entry.status === "open",
    );
    if (hasOpenSession) {
      return `Compteur ${assignment.device_name || event.device_id}: session déjà ouverte.`;
    }

    const openEntry = buildOpenEntry(event, reading.total_kwh);
    reservations.forEach((reservation) => {
      const entries = entriesByReservationId.get(reservation.id) ?? [];
      entriesByReservationId.set(reservation.id, [...entries, openEntry]);
    });
    await updateStayReservationTracking(reservations, entriesByReservationId);
    return `Compteur ${assignment.device_name || event.device_id}: départ relevé à ${reading.total_kwh.toFixed(2)} kWh.`;
  }

  const openEntry = [...referenceEntries]
    .reverse()
    .find(
      (entry) => entry.device_id === event.device_id && entry.status === "open",
    );
  if (!openEntry) {
    return `Compteur ${assignment.device_name || event.device_id}: aucune session ouverte à clôturer.`;
  }

  const stayTotalKwh = round4(
    Math.max(0, reading.total_kwh - openEntry.started_total_kwh),
  );
  const electricityPricePerKwh = round4(
    Math.max(0, toNumber(reservations[0]?.gite?.electricity_price_per_kwh ?? 0)),
  );
  const stayTotalCostEur = round2(stayTotalKwh * electricityPricePerKwh);
  const weights = reservations.map((reservation) =>
    Math.max(1, reservation.nb_nuits || 0),
  );
  const allocatedKwh = allocateByWeight(stayTotalKwh, weights, 4);
  const allocatedCost = allocateByWeight(stayTotalCostEur, weights, 2);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const endedAt = new Date().toISOString();

  reservations.forEach((reservation, index) => {
    const entries = entriesByReservationId.get(reservation.id) ?? [];
    const filteredEntries = entries.filter(
      (entry) => entry.session_id !== openEntry.session_id,
    );
    filteredEntries.push({
      ...openEntry,
      status: "closed",
      ended_at: endedAt,
      ended_total_kwh: round4(reading.total_kwh),
      total_kwh: allocatedKwh[index] ?? 0,
      total_cost_eur: allocatedCost[index] ?? 0,
      stay_total_kwh: stayTotalKwh,
      stay_total_cost_eur: stayTotalCostEur,
      allocation_ratio: round4((weights[index] ?? 0) / totalWeight),
      ended_by_rule_id: event.rule_id,
    });
    entriesByReservationId.set(reservation.id, filteredEntries);
  });

  await updateStayReservationTracking(reservations, entriesByReservationId);
  return `Compteur ${assignment.device_name || event.device_id}: ${stayTotalKwh.toFixed(2)} kWh · ${stayTotalCostEur.toFixed(2)} EUR.`;
};

export const loadLiveReservationEnergySummaries = async (
  config: SmartlifeAutomationConfig,
  reservations: Array<{
    id: string;
    energy_tracking: unknown;
    gite?: {
      electricity_price_per_kwh: NumericLike;
    } | null;
  }>,
) => {
  const entriesByReservationId = new Map(
    reservations.map((reservation) => [
      reservation.id,
      parseReservationEnergyTracking(reservation.energy_tracking),
    ]),
  );
  const deviceIds = [
    ...new Set(
      [...entriesByReservationId.values()]
        .flat()
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.device_id),
    ),
  ];
  if (deviceIds.length === 0) {
    return new Map<string, ReservationLiveEnergySummary>();
  }

  const deviceTotalsById = new Map<string, number>();
  await Promise.all(
    deviceIds.map(async (deviceId) => {
      try {
        const reading = await getSmartlifeDeviceTotalElectricityKwh(config, deviceId);
        deviceTotalsById.set(deviceId, round4(reading.total_kwh));
      } catch {
        // Ignore per-device failures so a single offline meter does not hide every other live reading.
      }
    }),
  );

  const recordedAt = new Date().toISOString();
  return reservations.reduce((summaries, reservation) => {
    const entries = entriesByReservationId.get(reservation.id) ?? [];
    const summary = summarizeLiveReservationEnergyTracking(entries, {
      deviceTotalsById,
      electricity_price_per_kwh:
        reservation.gite?.electricity_price_per_kwh ?? 0,
      recorded_at: recordedAt,
    });
    if (summary) {
      summaries.set(reservation.id, summary);
    }
    return summaries;
  }, new Map<string, ReservationLiveEnergySummary>());
};

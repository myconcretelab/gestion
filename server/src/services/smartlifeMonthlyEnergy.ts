import prisma from "../db/prisma.js";
import { round2, toNumber, type NumericLike } from "../utils/money.js";
import type { SmartlifeAutomationConfig } from "./smartlifeSettings.js";
import { getSmartlifeDeviceTotalElectricityKwh } from "./smartlifeClient.js";

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

type EnabledAssignment = {
  gite_id: string;
  device_id: string;
  device_name: string;
};

type MonthPeriod = {
  year: number;
  month: number;
};

type MonthlyReadingRow = {
  id: string;
  gite_id: string;
  year: number;
  month: number;
  device_id: string;
  device_name: string;
  opening_total_kwh: NumericLike | null;
  opening_recorded_at: Date | null;
  closing_total_kwh: NumericLike | null;
  closing_recorded_at: Date | null;
  gite: {
    id: string;
    electricity_price_per_kwh: NumericLike | null;
  } | null;
};

type StoredMonthlyReadingRow = Omit<MonthlyReadingRow, "gite">;

export type SmartlifeMonthlyEnergyCaptureResult = {
  triggered: boolean;
  opened_count: number;
  closed_count: number;
  error_count: number;
  errors: string[];
};

export type GiteMonthlyEnergySummary = {
  gite_id: string;
  year: number;
  month: number;
  total_kwh: number;
  total_cost_eur: number;
  device_count: number;
};

const buildPeriodKey = (
  giteId: string,
  year: number,
  month: number,
  deviceId: string,
) => `${giteId}:${year}-${String(month).padStart(2, "0")}:${deviceId}`;

const getEnabledAssignments = (config: SmartlifeAutomationConfig) => {
  const seen = new Set<string>();
  return config.meter_assignments.reduce<EnabledAssignment[]>(
    (items, assignment) => {
      if (!assignment.enabled) return items;
      const giteId = String(assignment.gite_id ?? "").trim();
      const deviceId = String(assignment.device_id ?? "").trim();
      if (!giteId || !deviceId) return items;
      const key = `${giteId}:${deviceId}`;
      if (seen.has(key)) return items;
      seen.add(key);
      items.push({
        gite_id: giteId,
        device_id: deviceId,
        device_name: String(assignment.device_name ?? "").trim() || deviceId,
      });
      return items;
    },
    [],
  );
};

const getLocalMonthPeriod = (value: Date): MonthPeriod => ({
  year: value.getFullYear(),
  month: value.getMonth() + 1,
});

const getPreviousMonthPeriod = (value: Date): MonthPeriod => {
  const previous = new Date(value);
  previous.setMonth(previous.getMonth() - 1, 1);
  return getLocalMonthPeriod(previous);
};

const isCompleteMonthlyRow = (row: MonthlyReadingRow) => {
  const opening = toNumber(row.opening_total_kwh);
  const closing = toNumber(row.closing_total_kwh);
  if (row.opening_recorded_at == null || row.closing_recorded_at == null) {
    return false;
  }
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) {
    return false;
  }
  return closing >= opening;
};

export const recordSmartlifeMonthlyEnergySnapshots = async (
  config: SmartlifeAutomationConfig,
  now: Date = new Date(),
): Promise<SmartlifeMonthlyEnergyCaptureResult> => {
  if (now.getDate() !== 1) {
    return {
      triggered: false,
      opened_count: 0,
      closed_count: 0,
      error_count: 0,
      errors: [],
    };
  }

  const assignments = getEnabledAssignments(config);
  if (assignments.length === 0) {
    return {
      triggered: true,
      opened_count: 0,
      closed_count: 0,
      error_count: 0,
      errors: [],
    };
  }

  const currentPeriod = getLocalMonthPeriod(now);
  const previousPeriod = getPreviousMonthPeriod(now);
  const giteIds = [...new Set(assignments.map((assignment) => assignment.gite_id))];
  const deviceIds = [...new Set(assignments.map((assignment) => assignment.device_id))];
  const existingRows = await prisma.giteMonthlyEnergyReading.findMany({
    where: {
      gite_id: { in: giteIds },
      device_id: { in: deviceIds },
      OR: [
        { year: currentPeriod.year, month: currentPeriod.month },
        { year: previousPeriod.year, month: previousPeriod.month },
      ],
    },
    select: {
      id: true,
      gite_id: true,
      year: true,
      month: true,
      device_id: true,
      device_name: true,
      opening_total_kwh: true,
      opening_recorded_at: true,
      closing_total_kwh: true,
      closing_recorded_at: true,
    },
  });

  const existingByKey = new Map<string, StoredMonthlyReadingRow>(
    existingRows.map((row) => [
      buildPeriodKey(row.gite_id, row.year, row.month, row.device_id),
      row as StoredMonthlyReadingRow,
    ]),
  );

  let openedCount = 0;
  let closedCount = 0;
  const errors: string[] = [];

  for (const assignment of assignments) {
    try {
      const reading = await getSmartlifeDeviceTotalElectricityKwh(
        config,
        assignment.device_id,
      );
      const totalKwh = round4(reading.total_kwh);

      const currentKey = buildPeriodKey(
        assignment.gite_id,
        currentPeriod.year,
        currentPeriod.month,
        assignment.device_id,
      );
      const currentRow = existingByKey.get(currentKey);
      if (!currentRow) {
        const created = await prisma.giteMonthlyEnergyReading.create({
          data: {
            gite_id: assignment.gite_id,
            year: currentPeriod.year,
            month: currentPeriod.month,
            device_id: assignment.device_id,
            device_name: assignment.device_name,
            opening_total_kwh: totalKwh,
            opening_recorded_at: now,
          },
        });
        existingByKey.set(currentKey, created as StoredMonthlyReadingRow);
        openedCount += 1;
      } else if (currentRow.opening_recorded_at == null) {
        const updated = await prisma.giteMonthlyEnergyReading.update({
          where: { id: currentRow.id },
          data: {
            device_name: assignment.device_name,
            opening_total_kwh: totalKwh,
            opening_recorded_at: now,
          },
        });
        existingByKey.set(currentKey, updated as StoredMonthlyReadingRow);
        openedCount += 1;
      }

      const previousKey = buildPeriodKey(
        assignment.gite_id,
        previousPeriod.year,
        previousPeriod.month,
        assignment.device_id,
      );
      const previousRow = existingByKey.get(previousKey);
      if (!previousRow) {
        const created = await prisma.giteMonthlyEnergyReading.create({
          data: {
            gite_id: assignment.gite_id,
            year: previousPeriod.year,
            month: previousPeriod.month,
            device_id: assignment.device_id,
            device_name: assignment.device_name,
            closing_total_kwh: totalKwh,
            closing_recorded_at: now,
          },
        });
        existingByKey.set(previousKey, created as StoredMonthlyReadingRow);
        closedCount += 1;
      } else if (previousRow.closing_recorded_at == null) {
        const updated = await prisma.giteMonthlyEnergyReading.update({
          where: { id: previousRow.id },
          data: {
            device_name: assignment.device_name,
            closing_total_kwh: totalKwh,
            closing_recorded_at: now,
          },
        });
        existingByKey.set(previousKey, updated as StoredMonthlyReadingRow);
        closedCount += 1;
      }
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `Impossible de relever ${assignment.device_name}.`,
      );
    }
  }

  return {
    triggered: true,
    opened_count: openedCount,
    closed_count: closedCount,
    error_count: errors.length,
    errors,
  };
};

export const summarizeGiteMonthlyEnergyRows = (rows: MonthlyReadingRow[]) => {
  const rowsByPeriod = new Map<string, MonthlyReadingRow[]>();

  for (const row of rows) {
    const key = `${row.gite_id}:${row.year}-${String(row.month).padStart(2, "0")}`;
    const bucket = rowsByPeriod.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByPeriod.set(key, [row]);
    }
  }

  const summaries: GiteMonthlyEnergySummary[] = [];
  rowsByPeriod.forEach((periodRows) => {
    if (periodRows.length === 0) return;
    if (periodRows.some((row) => !isCompleteMonthlyRow(row))) return;

    const giteId = periodRows[0]?.gite_id ?? "";
    const year = periodRows[0]?.year ?? 0;
    const month = periodRows[0]?.month ?? 0;
    const electricityPricePerKwh = round4(
      Math.max(0, toNumber(periodRows[0]?.gite?.electricity_price_per_kwh ?? 0)),
    );

    let totalKwh = 0;
    for (const row of periodRows) {
      totalKwh +=
        toNumber(row.closing_total_kwh) - toNumber(row.opening_total_kwh);
    }

    summaries.push({
      gite_id: giteId,
      year,
      month,
      total_kwh: round4(totalKwh),
      total_cost_eur: round2(totalKwh * electricityPricePerKwh),
      device_count: periodRows.length,
    });
  });

  return summaries.sort((left, right) => {
    if (left.year !== right.year) return left.year - right.year;
    if (left.month !== right.month) return left.month - right.month;
    return left.gite_id.localeCompare(right.gite_id);
  });
};

export const getGiteMonthlyEnergySummaries = async (params: {
  year: number;
  month?: number | null;
  gite_id?: string | null;
}) => {
  const month =
    params.month && params.month >= 1 && params.month <= 12 ? params.month : null;
  const rows = await prisma.giteMonthlyEnergyReading.findMany({
    where: {
      year: params.year,
      ...(month ? { month } : {}),
      ...(params.gite_id ? { gite_id: params.gite_id } : {}),
    },
    select: {
      id: true,
      gite_id: true,
      year: true,
      month: true,
      device_id: true,
      device_name: true,
      opening_total_kwh: true,
      opening_recorded_at: true,
      closing_total_kwh: true,
      closing_recorded_at: true,
      gite: {
        select: {
          id: true,
          electricity_price_per_kwh: true,
        },
      },
    },
    orderBy: [
      { year: "asc" },
      { month: "asc" },
      { gite_id: "asc" },
      { device_id: "asc" },
    ],
  });

  return summarizeGiteMonthlyEnergyRows(rows);
};

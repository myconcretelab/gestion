import { formatEuro } from "./format";
import type { Reservation } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ARRIVAL_TIME = "17:00";
const DEFAULT_DEPARTURE_TIME = "12:00";

const parseIsoTimestamp = (value: string | null | undefined) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const parseTime = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
};

const buildUtcTimestamp = (dateValue: string, timeValue: string) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const time = parseTime(timeValue);
  if (!time) return null;

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    time.hours,
    time.minutes,
  );
};

const getReservationFallbackBounds = (reservation: Reservation) => {
  const arrivalTime =
    reservation.linked_contract?.heure_arrivee ??
    reservation.gite?.heure_arrivee_defaut ??
    DEFAULT_ARRIVAL_TIME;
  const departureTime =
    reservation.linked_contract?.heure_depart ??
    reservation.gite?.heure_depart_defaut ??
    DEFAULT_DEPARTURE_TIME;

  const start = buildUtcTimestamp(reservation.date_entree, arrivalTime);
  const end = buildUtcTimestamp(reservation.date_sortie, departureTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
};

const getTrackedDurationDays = (
  reservation: Reservation,
  mode: "live" | "saved",
) => {
  const entries = reservation.energy_tracking ?? [];
  if (mode === "live") {
    const openEntries = entries.filter((entry) => entry.status === "open");
    if (openEntries.length === 0) return null;

    const starts = openEntries
      .map((entry) => parseIsoTimestamp(entry.started_at))
      .filter((value): value is number => value !== null);
    const end = parseIsoTimestamp(reservation.energy_live_recorded_at);
    if (starts.length === 0 || end === null) return null;

    const start = Math.min(...starts);
    return end > start ? (end - start) / DAY_MS : null;
  }

  const closedEntries = entries.filter((entry) => entry.status === "closed");
  if (closedEntries.length === 0) return null;

  const starts = closedEntries
    .map((entry) => parseIsoTimestamp(entry.started_at))
    .filter((value): value is number => value !== null);
  const ends = closedEntries
    .map((entry) => parseIsoTimestamp(entry.ended_at))
    .filter((value): value is number => value !== null);
  if (starts.length === 0 || ends.length === 0) return null;

  const start = Math.min(...starts);
  const end = Math.max(...ends);
  return end > start ? (end - start) / DAY_MS : null;
};

export const getReservationEnergyAverageDailyCost = (
  reservation: Reservation,
  mode: "live" | "saved",
) => {
  const totalCost =
    mode === "live"
      ? reservation.energy_live_cost_eur ?? null
      : reservation.energy_cost_eur;
  if (totalCost === null || !Number.isFinite(totalCost) || totalCost <= 0) return null;

  const trackedDurationDays = getTrackedDurationDays(reservation, mode);
  if (trackedDurationDays && trackedDurationDays > 0) {
    return totalCost / trackedDurationDays;
  }

  const fallbackBounds = getReservationFallbackBounds(reservation);
  if (!fallbackBounds) return null;

  return totalCost / ((fallbackBounds.end - fallbackBounds.start) / DAY_MS);
};

export const formatEuroPerDay = (value: number) =>
  `${formatEuro(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s*€/u, "€")}/j`;

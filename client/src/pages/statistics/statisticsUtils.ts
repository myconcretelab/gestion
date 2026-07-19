import { getPaymentColor } from "../../utils/paymentColors";

export type StatisticsGite = {
  id: string;
  nom: string;
  ordre: number;
  prefixe_contrat: string;
  proprietaires_noms: string;
  gestionnaire_id?: string | null;
  date_debut_activite?: string | null;
  gestionnaire?: {
    id: string;
    prenom: string;
    nom: string;
  } | null;
};

export type StatisticsEntry = {
  reservationId: string;
  giteId: string;
  debut: string;
  fin: string;
  mois: number;
  nuits: number;
  adultes: number;
  prixNuit: number;
  revenus: number;
  fraisOptionnelsTotal: number;
  fraisOptionnelsDeclares: number;
  paiement: string;
  proprietaires: string;
};

export type StatisticsPayload = {
  gites: StatisticsGite[];
  entriesByGite: Record<string, StatisticsEntry[]>;
  availableYears: number[];
};

export type UrssafManagerAmount = {
  managerId: string;
  manager: string;
  amount: number;
};

export type GuestNightGiteAmount = {
  giteId: string;
  giteName: string;
  managerName: string | null;
  guestNights: number;
};

export type ParsedStatisticsEntry = StatisticsEntry & {
  debutDate: Date;
};

export type ParsedStatisticsPayload = {
  gites: StatisticsGite[];
  entriesByGite: Record<string, ParsedStatisticsEntry[]>;
  availableYears: number[];
};

type PeriodYear = number | "all";
type PeriodMonth = number | "";
type ActivityStart = string | Date | null | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

const URSSAF_PAYMENTS = ["Abritel", "Airbnb", "Cheque", "Chèque", "Virement", "Gites de France"];

const normalizeLabel = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const isHomeExchange = (entry: ParsedStatisticsEntry) => normalizeLabel(entry.paiement) === "homeexchange";

export const getEntryUrssafBase = (entry: StatisticsEntry) => {
  if (!URSSAF_PAYMENTS.some((label) => normalizeLabel(entry.paiement).includes(normalizeLabel(label)))) return 0;
  return (Number(entry.revenus) || 0) + (Number(entry.fraisOptionnelsDeclares) || 0);
};

export const getEntryGrossCA = (entry: StatisticsEntry) =>
  (Number(entry.revenus) || 0) + (Number(entry.fraisOptionnelsTotal) || 0);

const entryMatch = (entry: ParsedStatisticsEntry, year: PeriodYear, month: PeriodMonth) => {
  const entryYear = entry.debutDate.getUTCFullYear();
  const entryMonth = entry.debutDate.getUTCMonth() + 1;
  if (month) return (year === "all" || entryYear === year) && entryMonth === Number(month);
  return year === "all" ? true : entryYear === year;
};

const filterByPeriod = (entries: ParsedStatisticsEntry[], year: PeriodYear, month: PeriodMonth) =>
  entries.filter((entry) => entryMatch(entry, year, month) && !isHomeExchange(entry));

const getActivityStartTime = (activityStart: ActivityStart) => {
  if (!activityStart) return null;
  const time =
    activityStart instanceof Date
      ? Date.UTC(activityStart.getUTCFullYear(), activityStart.getUTCMonth(), activityStart.getUTCDate())
      : new Date(`${activityStart.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

const getPeriodBounds = (year: number, month: PeriodMonth, now = new Date()) => {
  if (month) {
    return {
      start: Date.UTC(year, Number(month) - 1, 1),
      end: Date.UTC(year, Number(month), 1),
    };
  }

  if (year === now.getUTCFullYear()) {
    return {
      start: Date.UTC(year, 0, 1),
      end: Date.UTC(year, now.getUTCMonth(), now.getUTCDate() + 1),
    };
  }

  return {
    start: Date.UTC(year, 0, 1),
    end: Date.UTC(year + 1, 0, 1),
  };
};

const isActivityPeriodAvailable = (
  activityStart: ActivityStart,
  year: number,
  month: PeriodMonth,
  now = new Date()
) => {
  const activityStartTime = getActivityStartTime(activityStart);
  if (activityStartTime === null) return true;
  return activityStartTime < getPeriodBounds(year, month, now).end;
};

const isFullyActivePeriod = (
  activityStart: ActivityStart,
  year: number,
  month: PeriodMonth,
  now = new Date()
) => {
  const activityStartTime = getActivityStartTime(activityStart);
  if (activityStartTime === null) return true;
  return activityStartTime <= getPeriodBounds(year, month, now).start;
};

export const parseStatisticsPayload = (payload: StatisticsPayload): ParsedStatisticsPayload => {
  const entriesByGite: Record<string, ParsedStatisticsEntry[]> = {};
  for (const [giteId, entries] of Object.entries(payload.entriesByGite ?? {})) {
    entriesByGite[giteId] = (entries ?? [])
      .map((entry) => ({
        ...entry,
        fraisOptionnelsTotal: Number(entry.fraisOptionnelsTotal ?? 0),
        fraisOptionnelsDeclares: Number(entry.fraisOptionnelsDeclares ?? 0),
        debutDate: new Date(`${entry.debut}T00:00:00.000Z`),
      }))
      .filter((entry) => !Number.isNaN(entry.debutDate.getTime()));
  }

  return {
    gites: payload.gites ?? [],
    entriesByGite,
    availableYears: payload.availableYears ?? [],
  };
};

export const computeGlobalStats = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  year: PeriodYear,
  month: PeriodMonth
) => {
  let totalReservations = 0;
  let totalNights = 0;
  let totalCA = 0;

  for (const entries of Object.values(entriesByGite)) {
    const filtered = filterByPeriod(entries, year, month);
    totalReservations += filtered.length;
    totalNights += filtered.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
    totalCA += filtered.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  }

  return { totalReservations, totalNights, totalCA };
};

export const computeGiteStats = (entries: ParsedStatisticsEntry[], year: PeriodYear, month: PeriodMonth) => {
  const filtered = filterByPeriod(entries, year, month);
  const reservations = filtered.length;
  const totalNights = filtered.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  const totalCA = filtered.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  const meanStay = reservations ? totalNights / reservations : 0;
  const meanPrice = totalNights ? totalCA / totalNights : 0;
  const payments: Record<string, number> = {};

  for (const entry of filtered) {
    const payment = entry.paiement?.trim() || "Indéfini";
    payments[payment] = (payments[payment] ?? 0) + getEntryGrossCA(entry);
  }

  return {
    reservations,
    totalNights,
    totalCA,
    meanStay,
    meanPrice,
    payments,
  };
};

const computeValue = (entries: ParsedStatisticsEntry[], metric: "CA" | "reservations" | "nights" | "price") => {
  if (metric === "CA") return entries.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  if (metric === "reservations") return entries.length;
  if (metric === "nights") return entries.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  const totalCA = entries.reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  const totalNights = entries.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  return totalNights > 0 ? totalCA / totalNights : 0;
};

const computeAverageMetric = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  metric: "CA" | "reservations" | "nights" | "price",
  activityStart?: ActivityStart
) => {
  if (!entries.length) return 0;

  const years = [...new Set(entries.map((entry) => entry.debutDate.getUTCFullYear()))];
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentDay = now.getUTCDate();

  if (selectedYear === "all") {
    const values = years
      .filter((year) => isFullyActivePeriod(activityStart, year, selectedMonth, now))
      .map((year) => {
        const filtered = filterByPeriod(entries, year, selectedMonth);
        return filtered.length > 0 ? computeValue(filtered, metric) : null;
      })
      .filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  const values = years
    .filter(
      (year) =>
        year !== selectedYear &&
        isFullyActivePeriod(activityStart, year, selectedMonth, now)
    )
    .map((year) => {
      let filtered: ParsedStatisticsEntry[];

      if (selectedMonth) {
        filtered = entries.filter(
          (entry) =>
            entry.debutDate.getUTCFullYear() === year &&
            entry.debutDate.getUTCMonth() + 1 === Number(selectedMonth) &&
            !isHomeExchange(entry)
        );
      } else if (selectedYear === currentYear || year === currentYear) {
        const start = Date.UTC(year, 0, 1);
        const end = Date.UTC(year, currentMonth, currentDay + 1);
        filtered = entries.filter((entry) => {
          const time = entry.debutDate.getTime();
          return entry.debutDate.getUTCFullYear() === year && time >= start && time < end && !isHomeExchange(entry);
        });
      } else {
        filtered = entries.filter((entry) => entry.debutDate.getUTCFullYear() === year && !isHomeExchange(entry));
      }

      return filtered.length > 0 ? computeValue(filtered, metric) : null;
    })
    .filter((value): value is number => value !== null);

  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
};

export const computeAverageCA = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "CA", activityStart);

export const computeAverageReservations = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "reservations", activityStart);

export const computeAverageNights = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "nights", activityStart);

export const computeAveragePrice = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) => computeAverageMetric(entries, selectedYear, selectedMonth, "price", activityStart);

const getEntryNightsInPeriod = (entry: ParsedStatisticsEntry, periodStart: number, periodEnd: number) => {
  const entryStart = entry.debutDate.getTime();
  const entryEnd = entryStart + Math.max(0, Number(entry.nuits) || 0) * DAY_MS;
  const overlapStart = Math.max(entryStart, periodStart);
  const overlapEnd = Math.min(entryEnd, periodEnd);
  return overlapEnd > overlapStart ? Math.round((overlapEnd - overlapStart) / DAY_MS) : 0;
};

export const computeOccupation = (
  entries: ParsedStatisticsEntry[],
  year: number,
  month: PeriodMonth,
  activityStart: ActivityStart = null,
  now = new Date()
) => {
  const filtered = filterByPeriod(entries, year, month);
  const bounds = getPeriodBounds(year, month, now);
  const activityStartTime = getActivityStartTime(activityStart);
  const periodStart = activityStartTime === null ? bounds.start : Math.max(bounds.start, activityStartTime);
  const periodEnd = bounds.end;
  if (periodStart >= periodEnd) return 0;

  const totalNights = filtered.reduce(
    (sum, entry) => sum + getEntryNightsInPeriod(entry, periodStart, periodEnd),
    0
  );
  const daysInPeriod = Math.round((periodEnd - periodStart) / DAY_MS);

  return daysInPeriod > 0 ? totalNights / daysInPeriod : 0;
};

export const getOccupationPerYear = (
  entries: ParsedStatisticsEntry[],
  years: number[],
  selectedMonth: PeriodMonth,
  activityStart?: ActivityStart
) =>
  years
    .filter((year) => isActivityPeriodAvailable(activityStart, year, selectedMonth))
    .map((year) => ({
      year,
      occupation: computeOccupation(entries, year, selectedMonth, activityStart),
    }));

export const getMonthlyCAByYear = (entriesByGite: Record<string, ParsedStatisticsEntry[]>) => {
  const result: Record<number, { months: Array<{ month: number; ca: number }>; total: number }> = {};

  for (const entries of Object.values(entriesByGite)) {
    for (const entry of entries) {
      if (isHomeExchange(entry)) continue;
      const year = entry.debutDate.getUTCFullYear();
      const monthIdx = entry.debutDate.getUTCMonth();
      if (!result[year]) result[year] = { months: Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, ca: 0 })), total: 0 };
      const grossCA = getEntryGrossCA(entry);
      result[year].months[monthIdx].ca += grossCA;
      result[year].total += grossCA;
    }
  }

  return result;
};

export const getMonthlyCAByGiteForYear = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  year: number
) => {
  const result: Record<string, { months: Array<{ month: number; ca: number }>; total: number }> = {};

  for (const gite of gites) {
    const months = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, ca: 0 }));
    let total = 0;

    for (const entry of entriesByGite[gite.id] ?? []) {
      if (isHomeExchange(entry)) continue;
      if (entry.debutDate.getUTCFullYear() !== year) continue;
      const monthIdx = entry.debutDate.getUTCMonth();
      const grossCA = getEntryGrossCA(entry);
      months[monthIdx].ca += grossCA;
      total += grossCA;
    }

    result[gite.id] = { months, total };
  }

  return result;
};

export const getMonthlyAverageCA = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  options?: {
    excludeFutureMonthsInCurrentYear?: boolean;
    activityStart?: ActivityStart;
  }
) => {
  const byYear = getMonthlyCAByYear(entriesByGite);
  const years = Object.keys(byYear).map(Number);
  const sums = Array(12).fill(0);
  const counts = Array(12).fill(0);
  const excludeFutureMonthsInCurrentYear = options?.excludeFutureMonthsInCurrentYear ?? true;
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  for (const year of years) {
    byYear[year].months.forEach((monthStat, idx) => {
      if (excludeFutureMonthsInCurrentYear && year === currentYear && idx > currentMonth) return;
      if (!isFullyActivePeriod(options?.activityStart, year, idx + 1, now)) return;
      sums[idx] += monthStat.ca;
      counts[idx] += 1;
    });
  }

  return sums.map((sum, idx) => ({ month: idx + 1, ca: counts[idx] ? sum / counts[idx] : 0 }));
};

export const computeUrssafByManager = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth
) => {
  const byManager: Record<string, UrssafManagerAmount> = {};

  for (const gite of gites) {
    if (!gite.gestionnaire?.id) continue;
    if (!byManager[gite.gestionnaire.id]) {
      byManager[gite.gestionnaire.id] = {
        managerId: gite.gestionnaire.id,
        manager: `${gite.gestionnaire.prenom} ${gite.gestionnaire.nom}`.trim(),
        amount: 0,
      };
    }
  }

  for (const gite of gites) {
    if (!gite.gestionnaire?.id) continue;
    for (const entry of entriesByGite[gite.id] ?? []) {
      if (!entryMatch(entry, selectedYear, selectedMonth)) continue;
      byManager[gite.gestionnaire.id].amount += getEntryUrssafBase(entry);
    }
  }

  return Object.values(byManager)
    .sort((left, right) => right.amount - left.amount || left.manager.localeCompare(right.manager, "fr"));
};

export const computeGuestNightsByGite = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  excludedSources: string[]
) => {
  const excludedSourceKeys = new Set(excludedSources.map((source) => normalizeLabel(source)).filter(Boolean));
  const byGite: Record<string, GuestNightGiteAmount> = {};

  for (const gite of gites) {
    byGite[gite.id] = {
      giteId: gite.id,
      giteName: gite.nom,
      managerName: gite.gestionnaire ? `${gite.gestionnaire.nom} ${gite.gestionnaire.prenom}`.trim() : null,
      guestNights: 0,
    };
  }

  for (const gite of gites) {
    for (const entry of entriesByGite[gite.id] ?? []) {
      if (!entryMatch(entry, selectedYear, selectedMonth)) continue;
      if (excludedSourceKeys.has(normalizeLabel(entry.paiement))) continue;
      byGite[gite.id].guestNights += Math.max(0, Number(entry.nuits || 0)) * Math.max(0, Number(entry.adultes || 0));
    }
  }

  return Object.values(byGite)
    .filter((item) => item.guestNights > 0)
    .sort((left, right) => left.giteName.localeCompare(right.giteName, "fr", { sensitivity: "base" }));
};

export const computeChequeVirementNightsByGite = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth
) => {
  const nights: Record<string, number> = {};

  for (const gite of gites) {
    let sum = 0;
    for (const entry of entriesByGite[gite.id] ?? []) {
      if (!entryMatch(entry, selectedYear, selectedMonth)) continue;
      const payment = normalizeLabel(entry.paiement);
      if (payment.includes("virement") || payment.includes("cheque")) {
        sum += (entry.nuits || 0) * (entry.adultes || 0);
      }
    }
    nights[gite.id] = sum;
  }

  return nights;
};

export { getPaymentColor };

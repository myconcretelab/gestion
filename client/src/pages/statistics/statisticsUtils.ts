export type StatisticsGite = {
  id: string;
  nom: string;
  ordre: number;
  prefixe_contrat: string;
  proprietaires_noms: string;
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
  paiement: string;
  proprietaires: string;
};

export type StatisticsPayload = {
  gites: StatisticsGite[];
  entriesByGite: Record<string, StatisticsEntry[]>;
  availableYears: number[];
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

const URSSAF_PAYMENTS = ["Abritel", "Airbnb", "Cheque", "Chèque", "Virement", "Gites de France"];

const normalizeLabel = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const isHomeExchange = (entry: ParsedStatisticsEntry) => normalizeLabel(entry.paiement) === "homeexchange";

const entryMatch = (entry: ParsedStatisticsEntry, year: PeriodYear, month: PeriodMonth) => {
  const entryYear = entry.debutDate.getUTCFullYear();
  const entryMonth = entry.debutDate.getUTCMonth() + 1;
  if (month) return (year === "all" || entryYear === year) && entryMonth === Number(month);
  return year === "all" ? true : entryYear === year;
};

const filterByPeriod = (entries: ParsedStatisticsEntry[], year: PeriodYear, month: PeriodMonth) =>
  entries.filter((entry) => entryMatch(entry, year, month) && !isHomeExchange(entry));

export const parseStatisticsPayload = (payload: StatisticsPayload): ParsedStatisticsPayload => {
  const entriesByGite: Record<string, ParsedStatisticsEntry[]> = {};
  for (const [giteId, entries] of Object.entries(payload.entriesByGite ?? {})) {
    entriesByGite[giteId] = (entries ?? [])
      .map((entry) => ({
        ...entry,
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
    totalCA += filtered.reduce((sum, entry) => sum + (entry.revenus || 0), 0);
  }

  return { totalReservations, totalNights, totalCA };
};

export const computeGiteStats = (entries: ParsedStatisticsEntry[], year: PeriodYear, month: PeriodMonth) => {
  const filtered = filterByPeriod(entries, year, month);
  const reservations = filtered.length;
  const totalNights = filtered.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  const totalCA = filtered.reduce((sum, entry) => sum + (entry.revenus || 0), 0);
  const meanStay = reservations ? totalNights / reservations : 0;
  const meanPrice = totalNights ? totalCA / totalNights : 0;
  const payments: Record<string, number> = {};

  for (const entry of filtered) {
    const payment = entry.paiement?.trim() || "Indéfini";
    payments[payment] = (payments[payment] ?? 0) + (entry.revenus || 0);
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
  if (metric === "CA") return entries.reduce((sum, entry) => sum + (entry.revenus || 0), 0);
  if (metric === "reservations") return entries.length;
  if (metric === "nights") return entries.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  const totalCA = entries.reduce((sum, entry) => sum + (entry.revenus || 0), 0);
  const totalNights = entries.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  return totalNights > 0 ? totalCA / totalNights : 0;
};

const computeAverageMetric = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth,
  metric: "CA" | "reservations" | "nights" | "price"
) => {
  if (!entries.length) return 0;

  const years = [...new Set(entries.map((entry) => entry.debutDate.getUTCFullYear()))];
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentDay = now.getUTCDate();

  if (selectedYear === "all") {
    const values = years
      .map((year) => {
        const filtered = filterByPeriod(entries, year, selectedMonth);
        return filtered.length > 0 ? computeValue(filtered, metric) : null;
      })
      .filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  const values = years
    .filter((year) => year !== selectedYear)
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

export const computeAverageCA = (entries: ParsedStatisticsEntry[], selectedYear: PeriodYear, selectedMonth: PeriodMonth) =>
  computeAverageMetric(entries, selectedYear, selectedMonth, "CA");

export const computeAverageReservations = (
  entries: ParsedStatisticsEntry[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth
) => computeAverageMetric(entries, selectedYear, selectedMonth, "reservations");

export const computeAverageNights = (entries: ParsedStatisticsEntry[], selectedYear: PeriodYear, selectedMonth: PeriodMonth) =>
  computeAverageMetric(entries, selectedYear, selectedMonth, "nights");

export const computeAveragePrice = (entries: ParsedStatisticsEntry[], selectedYear: PeriodYear, selectedMonth: PeriodMonth) =>
  computeAverageMetric(entries, selectedYear, selectedMonth, "price");

const isLeapYear = (year: number) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0);

const daysInMonth = (month: number, year: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const computeOccupation = (entries: ParsedStatisticsEntry[], year: number, month: PeriodMonth) => {
  const filtered = filterByPeriod(entries, year, month);
  const totalNights = filtered.reduce((sum, entry) => sum + (entry.nuits || 0), 0);
  let daysInPeriod = 0;
  const currentYear = new Date().getUTCFullYear();

  if (month) {
    daysInPeriod = daysInMonth(Number(month), year);
  } else if (year === currentYear) {
    const now = new Date();
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year, now.getUTCMonth(), now.getUTCDate() + 1);
    daysInPeriod = Math.round((end - start) / (24 * 60 * 60 * 1000));
  } else {
    daysInPeriod = isLeapYear(year) ? 366 : 365;
  }

  return daysInPeriod > 0 ? totalNights / daysInPeriod : 0;
};

export const getOccupationPerYear = (
  entries: ParsedStatisticsEntry[],
  years: number[],
  selectedMonth: PeriodMonth
) => years.map((year) => ({ year, occupation: computeOccupation(entries, year, selectedMonth) }));

export const getMonthlyCAByYear = (entriesByGite: Record<string, ParsedStatisticsEntry[]>) => {
  const result: Record<number, { months: Array<{ month: number; ca: number }>; total: number }> = {};

  for (const entries of Object.values(entriesByGite)) {
    for (const entry of entries) {
      if (isHomeExchange(entry)) continue;
      const year = entry.debutDate.getUTCFullYear();
      const monthIdx = entry.debutDate.getUTCMonth();
      if (!result[year]) result[year] = { months: Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, ca: 0 })), total: 0 };
      result[year].months[monthIdx].ca += entry.revenus || 0;
      result[year].total += entry.revenus || 0;
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
      months[monthIdx].ca += entry.revenus || 0;
      total += entry.revenus || 0;
    }

    result[gite.id] = { months, total };
  }

  return result;
};

export const getMonthlyAverageCA = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  options?: { excludeFutureMonthsInCurrentYear?: boolean }
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
      sums[idx] += monthStat.ca;
      counts[idx] += 1;
    });
  }

  return sums.map((sum, idx) => ({ month: idx + 1, ca: counts[idx] ? sum / counts[idx] : 0 }));
};

export const computeUrssafByOwner = (
  entriesByGite: Record<string, ParsedStatisticsEntry[]>,
  gites: StatisticsGite[],
  selectedYear: PeriodYear,
  selectedMonth: PeriodMonth
) => {
  const byOwner: Record<string, number> = {};

  for (const gite of gites) {
    const owner = gite.proprietaires_noms?.trim() || "Propriétaire non renseigné";
    for (const entry of entriesByGite[gite.id] ?? []) {
      if (!entryMatch(entry, selectedYear, selectedMonth)) continue;
      if (!URSSAF_PAYMENTS.some((label) => normalizeLabel(entry.paiement).includes(normalizeLabel(label)))) continue;
      byOwner[owner] = (byOwner[owner] ?? 0) + (entry.revenus || 0);
    }
  }

  return Object.entries(byOwner)
    .map(([owner, amount]) => ({ owner, amount }))
    .sort((left, right) => right.amount - left.amount);
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

export const getPaymentColor = (label: string) => {
  const payment = normalizeLabel(label);
  if (payment.includes("airbnb")) return "#ff1920";
  if (payment.includes("abritel")) return "#2d8cff";
  if (payment.includes("gites de france")) return "#ffd700";
  if (payment.includes("cheque") || payment.includes("chq")) return "#258aa0";
  if (payment.includes("virement")) return "#247595";
  if (payment.includes("especes")) return "#ef18c8";
  if (payment.includes("a definir") || payment.includes("indefini")) return "#d3d3d3";
  if (payment.includes("virmnt/chq")) return "#258aa0";
  return "#d3d3d3";
};

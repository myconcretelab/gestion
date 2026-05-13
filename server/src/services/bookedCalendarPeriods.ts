import { getSchoolHolidaysForRange, type SchoolHoliday } from "./schoolHolidays.js";
import { formatBookedDateInput } from "./booked.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type BookedCalendarPeriodType = "school_holiday" | "bridge" | "july_august";

export type BookedCalendarPeriod = {
  start: string;
  end: string;
  type: BookedCalendarPeriodType;
  label: string;
};

type DateInterval = {
  start: string;
  end: string;
  type: BookedCalendarPeriodType;
  labels: string[];
};

const addUtcDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const parseIsoDateUtc = (value: string) => {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const clampIsoRange = (value: string, min: string, max: string) => {
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
};

const isSchoolBridgeHoliday = (holiday: Pick<SchoolHoliday, "description">) => /^pont\b/i.test(String(holiday.description ?? "").trim());

const computeEasterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
};

const getFrenchPublicHolidays = (year: number) => {
  const easter = computeEasterSunday(year);
  return [
    { date: new Date(Date.UTC(year, 0, 1)), name: "Jour de l'an" },
    { date: addUtcDays(easter, 1), name: "Lundi de Pâques" },
    { date: new Date(Date.UTC(year, 4, 1)), name: "Fête du Travail" },
    { date: new Date(Date.UTC(year, 4, 8)), name: "Victoire 1945" },
    { date: addUtcDays(easter, 39), name: "Ascension" },
    { date: addUtcDays(easter, 50), name: "Lundi de Pentecôte" },
    { date: new Date(Date.UTC(year, 6, 14)), name: "Fête nationale" },
    { date: new Date(Date.UTC(year, 7, 15)), name: "Assomption" },
    { date: new Date(Date.UTC(year, 10, 1)), name: "Toussaint" },
    { date: new Date(Date.UTC(year, 10, 11)), name: "Armistice 1918" },
    { date: new Date(Date.UTC(year, 11, 25)), name: "Noël" },
  ];
};

const mergeIntervals = (intervals: DateInterval[]) => {
  const sorted = intervals
    .filter((interval) => interval.start < interval.end)
    .sort((left, right) => left.type.localeCompare(right.type) || left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
  const merged: DateInterval[] = [];

  sorted.forEach((interval) => {
    const current = merged[merged.length - 1];
    if (!current || current.type !== interval.type || interval.start > current.end) {
      merged.push({ ...interval, labels: [...interval.labels] });
      return;
    }
    if (interval.end > current.end) {
      current.end = interval.end;
    }
    interval.labels.forEach((label) => {
      if (label && !current.labels.includes(label)) {
        current.labels.push(label);
      }
    });
  });

  return merged;
};

const buildSchoolHolidayIntervals = (holidays: SchoolHoliday[], from: string, to: string) =>
  mergeIntervals(
    holidays
      .filter((holiday) => !isSchoolBridgeHoliday(holiday))
      .flatMap((holiday) => {
        const holidayEnd = parseIsoDateUtc(holiday.end);
        if (!holidayEnd) return [];
        return [{
          start: clampIsoRange(holiday.start, from, to),
          end: clampIsoRange(formatBookedDateInput(addUtcDays(holidayEnd, 1)), from, to),
          type: "school_holiday" as const,
          labels: [String(holiday.description ?? "").trim()].filter(Boolean),
        }];
      })
  );

const buildBridgeIntervals = (from: string, to: string) => {
  const fromDate = parseIsoDateUtc(from);
  const toDate = parseIsoDateUtc(to);
  if (!fromDate || !toDate || toDate.getTime() <= fromDate.getTime()) return [];

  const intervals: DateInterval[] = [];
  for (let year = fromDate.getUTCFullYear() - 1; year <= toDate.getUTCFullYear() + 1; year += 1) {
    getFrenchPublicHolidays(year).forEach((holiday) => {
      const day = holiday.date.getUTCDay();
      let start: Date | null = null;
      let end: Date | null = null;

      if (day === 1) {
        start = addUtcDays(holiday.date, -3);
        end = holiday.date;
      } else if (day === 2) {
        start = addUtcDays(holiday.date, -4);
        end = holiday.date;
      } else if (day === 4 || day === 5) {
        start = holiday.date;
        end = addUtcDays(holiday.date, 3);
      }

      if (!start || !end) return;
      intervals.push({
        start: clampIsoRange(formatBookedDateInput(start), from, to),
        end: clampIsoRange(formatBookedDateInput(end), from, to),
        type: "bridge",
        labels: [`Pont ${holiday.name}`],
      });
    });
  }

  return mergeIntervals(intervals);
};

const buildJulyAugustIntervals = (from: string, to: string) => {
  const fromDate = parseIsoDateUtc(from);
  const toDate = parseIsoDateUtc(to);
  if (!fromDate || !toDate || toDate.getTime() <= fromDate.getTime()) return [];

  const intervals: DateInterval[] = [];
  for (let year = fromDate.getUTCFullYear() - 1; year <= toDate.getUTCFullYear() + 1; year += 1) {
    intervals.push({
      start: clampIsoRange(`${year}-07-01`, from, to),
      end: clampIsoRange(`${year}-09-01`, from, to),
      type: "july_august",
      labels: ["Juillet / août"],
    });
  }
  return mergeIntervals(intervals);
};

const isFullyCovered = (intervals: DateInterval[], start: string, end: string) =>
  intervals.some((interval) => interval.start <= start && interval.end >= end);

const getCoveringInterval = (intervals: DateInterval[], start: string, end: string) =>
  intervals.find((interval) => interval.start <= start && interval.end >= end) ?? null;

export const buildBookedCalendarPeriods = (params: {
  from: string;
  to: string;
  holidays: SchoolHoliday[];
}): BookedCalendarPeriod[] => {
  const schoolHolidayIntervals = buildSchoolHolidayIntervals(params.holidays, params.from, params.to);
  const bridgeIntervals = buildBridgeIntervals(params.from, params.to);
  const julyAugustIntervals = buildJulyAugustIntervals(params.from, params.to);
  const boundaries = [
    params.from,
    params.to,
    ...schoolHolidayIntervals.flatMap((interval) => [interval.start, interval.end]),
    ...bridgeIntervals.flatMap((interval) => [interval.start, interval.end]),
    ...julyAugustIntervals.flatMap((interval) => [interval.start, interval.end]),
  ].filter((value, index, values) => value >= params.from && value <= params.to && values.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));

  const periods: DateInterval[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start >= end) continue;

    const schoolHoliday = getCoveringInterval(schoolHolidayIntervals, start, end);
    const bridge = !schoolHoliday ? getCoveringInterval(bridgeIntervals, start, end) : null;
    const julyAugust = !schoolHoliday && !bridge && isFullyCovered(julyAugustIntervals, start, end)
      ? getCoveringInterval(julyAugustIntervals, start, end)
      : null;
    const period = schoolHoliday ?? bridge ?? julyAugust;
    if (period) {
      periods.push({ start, end, type: period.type, labels: [...period.labels] });
    }
  }

  return mergeIntervals(periods).map((period) => ({
    start: period.start,
    end: period.end,
    type: period.type,
    label: period.labels[0] ?? "",
  }));
};

export const getBookedCalendarPeriodsForRange = async (params: {
  from: string;
  to: string;
  zone?: string;
}) => {
  const holidays = await getSchoolHolidaysForRange({
    from: params.from,
    to: params.to,
    zone: params.zone ?? "B",
  });
  return buildBookedCalendarPeriods({
    from: params.from,
    to: params.to,
    holidays,
  });
};

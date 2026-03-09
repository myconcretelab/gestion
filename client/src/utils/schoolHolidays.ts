import type { Reservation } from "./types";

export type SchoolHoliday = {
  zone: string;
  start: string;
  end: string;
  description: string;
  anneeScolaire: string;
  population: string;
};

export type SchoolHolidayMonthSegment = {
  key: string;
  name: string | null;
  start: string;
  end: string;
  label: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (value: number) => String(value).padStart(2, "0");

export const parseIsoDateUtc = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
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

export const formatUtcDateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

export const buildSchoolHolidayDateSet = (holidays: SchoolHoliday[]) => {
  const dates = new Set<string>();

  holidays.forEach((holiday) => {
    const start = parseIsoDateUtc(holiday.start);
    const end = parseIsoDateUtc(holiday.end);
    if (!start || !end || start.getTime() > end.getTime()) return;

    for (let current = start.getTime(); current <= end.getTime(); current += DAY_MS) {
      dates.add(formatUtcDateKey(new Date(current)));
    }
  });

  return dates;
};

export const computeReservationHolidayNightCount = (
  reservation: Pick<Reservation, "date_entree" | "date_sortie">,
  holidayDates: ReadonlySet<string>
) => {
  if (holidayDates.size === 0) return 0;

  const start = parseIsoDateUtc(reservation.date_entree);
  const end = parseIsoDateUtc(reservation.date_sortie);
  if (!start || !end || start.getTime() >= end.getTime()) return 0;

  let nights = 0;
  for (let current = start.getTime(); current < end.getTime(); current += DAY_MS) {
    if (holidayDates.has(formatUtcDateKey(new Date(current)))) {
      nights += 1;
    }
  }

  return nights;
};

export const getReservationDateRange = (reservations: Array<Pick<Reservation, "date_entree" | "date_sortie">>) => {
  let minStart: Date | null = null;
  let maxEnd: Date | null = null;

  reservations.forEach((reservation) => {
    const start = parseIsoDateUtc(reservation.date_entree);
    const end = parseIsoDateUtc(reservation.date_sortie);
    if (!start || !end) return;

    if (!minStart || start.getTime() < minStart.getTime()) {
      minStart = start;
    }
    if (!maxEnd || end.getTime() > maxEnd.getTime()) {
      maxEnd = end;
    }
  });

  if (!minStart || !maxEnd) return null;

  return {
    from: formatUtcDateKey(minStart),
    to: formatUtcDateKey(maxEnd),
    key: `${formatUtcDateKey(minStart)}:${formatUtcDateKey(maxEnd)}`,
  };
};

const formatShortDate = (date: Date) => `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}`;

export const getSchoolHolidaySegmentsForMonth = (
  holidays: SchoolHoliday[],
  year: number,
  month: number
): SchoolHolidayMonthSegment[] => {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const seen = new Set<string>();

  return holidays
    .flatMap((holiday) => {
      const holidayStart = parseIsoDateUtc(holiday.start);
      const holidayEnd = parseIsoDateUtc(holiday.end);
      if (!holidayStart || !holidayEnd || holidayStart.getTime() > holidayEnd.getTime()) return [];
      if (holidayStart.getTime() > monthEnd.getTime() || holidayEnd.getTime() < monthStart.getTime()) return [];

      const segmentStart = holidayStart.getTime() > monthStart.getTime() ? holidayStart : monthStart;
      const segmentEnd = holidayEnd.getTime() < monthEnd.getTime() ? holidayEnd : monthEnd;
      const name = holiday.description.trim() || null;
      const rangeLabel =
        formatUtcDateKey(segmentStart) === formatUtcDateKey(segmentEnd)
          ? formatShortDate(segmentStart)
          : `${formatShortDate(segmentStart)} au ${formatShortDate(segmentEnd)}`;

      const segment = {
        key: `${holiday.start}:${holiday.end}:${holiday.description}:${formatUtcDateKey(segmentStart)}:${formatUtcDateKey(segmentEnd)}`,
        name,
        start: formatUtcDateKey(segmentStart),
        end: formatUtcDateKey(segmentEnd),
        label: name ? `${name} · ${rangeLabel}` : rangeLabel,
      };
      if (seen.has(segment.key)) return [];
      seen.add(segment.key);

      return [segment];
    })
    .sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
};

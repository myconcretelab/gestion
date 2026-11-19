export type MonthRange = { first: number; last: number };

export const monthKey = (year: number, month: number) => year * 12 + month - 1;
export const monthParts = (key: number) => ({
  year: Math.floor(key / 12),
  month: (key % 12) + 1,
});
export const monthKeyForDate = (date: Date) =>
  monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);

const businessDayFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const timelineToday = (now = new Date()) => {
  const [year, month, day] = businessDayFormatter
    .format(now)
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

export const overlappingMonthKeys = (
  entry: Date,
  exit: Date,
  range: MonthRange,
) => {
  if (entry >= exit) return [];
  const lastNight = new Date(exit.getTime() - 1);
  return monthsInRange({
    first: Math.max(range.first, monthKeyForDate(entry)),
    last: Math.min(range.last, monthKeyForDate(lastNight)),
  });
};

export const MIN_TIMELINE_MONTH = monthKey(2000, 1);
export const MAX_TIMELINE_MONTH = monthKey(2100, 12);
export const timelineMonthIsValid = (key: number) =>
  Number.isInteger(key) &&
  key >= MIN_TIMELINE_MONTH &&
  key <= MAX_TIMELINE_MONTH;

export const monthsInRange = ({ first, last }: MonthRange) =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i);

export const yearsInRange = ({ first, last }: MonthRange) => {
  const start = monthParts(first).year;
  return Array.from(
    { length: monthParts(last).year - start + 1 },
    (_, i) => start + i,
  );
};

export const monthRangeDates = ({ first, last }: MonthRange) => {
  const start = monthParts(first);
  const end = monthParts(last);
  return {
    from: new Date(Date.UTC(start.year, start.month - 1, 1))
      .toISOString()
      .slice(0, 10),
    to: new Date(Date.UTC(end.year, end.month, 0)).toISOString().slice(0, 10),
  };
};

export const mergeTimelineRows = <T extends { id: string }>(
  previous: T[],
  incoming: T[],
) => {
  const rows = new Map(previous.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()];
};

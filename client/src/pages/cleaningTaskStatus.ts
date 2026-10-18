export type CleaningTaskTiming = {
  status: string;
  arrival_at: string | null;
};

export type CleaningReadinessTiming = {
  departure_date: string;
  next_arrival_date: string | null;
  next_arrival_at?: string | null;
};

const getParisDateIso = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
};

export const isMissedCleaningTask = (task: CleaningTaskTiming, now: Date) =>
  task.status !== "verified" && task.arrival_at !== null && Date.parse(task.arrival_at) <= now.getTime();

export const isCleaningReadinessVisible = (
  readiness: CleaningReadinessTiming,
  now: Date,
) => {
  const today = getParisDateIso(now);
  return readiness.departure_date <= today
    && (readiness.next_arrival_date === null || today <= readiness.next_arrival_date);
};

export const isCleaningReadinessLate = (
  readiness: Pick<CleaningReadinessTiming, "next_arrival_at">,
  now: Date,
) => typeof readiness.next_arrival_at === "string"
  && Date.parse(readiness.next_arrival_at) <= now.getTime();

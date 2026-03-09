const SCHOOL_DATASET_BASE =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records";

const PAGE_SIZE = 100;

export type SchoolHoliday = {
  zone: string;
  start: string;
  end: string;
  description: string;
  anneeScolaire: string;
  population: string;
};

type SchoolHolidayQuery = {
  from: string;
  to: string;
  zone?: string | null;
  population?: string | null;
};

const academicYearCache = new Map<string, Promise<SchoolHoliday[]>>();
const buildHolidayDedupKey = (holiday: Pick<SchoolHoliday, "zone" | "start" | "end" | "description" | "anneeScolaire">) =>
  [holiday.zone.trim().toUpperCase(), holiday.start, holiday.end, holiday.description.trim(), holiday.anneeScolaire].join("|");

const parseIsoDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
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

const getAcademicYearCacheKey = (startYear: number, population: string | null) =>
  `${startYear}:${population?.trim() ?? ""}`;

const normalizeZones = (value: unknown) =>
  String(value ?? "")
    .split(/[/,;]| et /i)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/Zone\s*/i, "").trim());

const fetchAcademicYear = async (startYear: number, population: string | null): Promise<SchoolHoliday[]> => {
  const cacheKey = getAcademicYearCacheKey(startYear, population);
  const cached = academicYearCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const academicYear = `${startYear}-${startYear + 1}`;
    const rows: any[] = [];
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        order_by: "start_date",
      });
      params.append("refine", `annee_scolaire:${academicYear}`);
      if (population?.trim()) {
        params.append("refine", `population:${population.trim()}`);
      }

      const response = await fetch(`${SCHOOL_DATASET_BASE}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Impossible de charger les vacances scolaires (${response.status})`);
      }

      const payload = (await response.json()) as { results?: any[] };
      const chunk = Array.isArray(payload.results) ? payload.results : [];
      rows.push(...chunk);

      if (chunk.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const holidays: SchoolHoliday[] = [];
    const seen = new Set<string>();
    rows.forEach((item) => {
      const start = String(item.start_date ?? "").slice(0, 10);
      const end = String(item.end_date ?? "").slice(0, 10);
      if (!parseIsoDate(start) || !parseIsoDate(end)) return;

      const description = String(item.description ?? item.vacances ?? item.intitule ?? "");
      const recordPopulation = String(item.population ?? "");
      const zones = normalizeZones(item.zones);
      const zonesToPush = zones.length > 0 ? zones : ["-"];

      zonesToPush.forEach((zone) => {
        const holiday = {
          zone,
          start,
          end,
          description,
          anneeScolaire: String(item.annee_scolaire ?? academicYear),
          population: recordPopulation,
        };
        const dedupKey = buildHolidayDedupKey(holiday);
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        holidays.push(holiday);
      });
    });

    return holidays;
  })().catch((error) => {
    academicYearCache.delete(cacheKey);
    throw error;
  });

  academicYearCache.set(cacheKey, promise);
  return promise;
};

const overlapsRange = (holiday: SchoolHoliday, fromDate: Date, toDate: Date) => {
  const holidayStart = parseIsoDate(holiday.start);
  const holidayEnd = parseIsoDate(holiday.end);
  if (!holidayStart || !holidayEnd) return false;
  return holidayStart.getTime() <= toDate.getTime() && holidayEnd.getTime() >= fromDate.getTime();
};

export const getSchoolHolidaysForRange = async ({
  from,
  to,
  zone = "B",
  population = null,
}: SchoolHolidayQuery): Promise<SchoolHoliday[]> => {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate || !toDate) {
    throw new Error("Dates de vacances invalides.");
  }

  const minDate = fromDate.getTime() <= toDate.getTime() ? fromDate : toDate;
  const maxDate = minDate === fromDate ? toDate : fromDate;
  const academicStartYears: number[] = [];

  for (let year = minDate.getUTCFullYear() - 1; year <= maxDate.getUTCFullYear(); year += 1) {
    academicStartYears.push(year);
  }

  const requestedZone = String(zone ?? "").trim().toUpperCase();
  const records = await Promise.all(academicStartYears.map((startYear) => fetchAcademicYear(startYear, population)));

  return records
    .flat()
    .filter((holiday) => (requestedZone ? holiday.zone.toUpperCase() === requestedZone : true))
    .filter((holiday) => overlapsRange(holiday, minDate, maxDate))
    .sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
};

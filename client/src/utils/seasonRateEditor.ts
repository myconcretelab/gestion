import type {
  Gite,
  SeasonRate,
  SeasonRateEditorPayload,
  SeasonRateEditorResponse,
} from "./types";
import type { SchoolHoliday } from "./schoolHolidays";
import { formatUtcDateKey, parseIsoDateUtc } from "./schoolHolidays";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SeasonRateEditorHolidayStatus = "holiday" | "non_holiday" | "mixed";
export type SeasonRateEditorRule = "normal" | "school_holiday" | "bridge" | "july_august" | "manual";

export type SeasonRateEditorSegment = {
  date_debut: string;
  date_fin: string;
  min_nuits: number | null;
  min_nuits_by_gite: Record<string, number | null>;
  has_mixed_min_nights: boolean;
  holiday_status: SeasonRateEditorHolidayStatus;
  holiday_names: string[];
  rule: SeasonRateEditorRule;
  rule_names: string[];
  prices_by_gite: Record<string, number | null>;
};

export type SeasonRateEditorPrefillDraft = Record<
  string,
  {
    low: string;
    high: string;
  }
>;

type DateInterval = {
  start: string;
  end: string;
  names: string[];
};

type PublicHolidayInterval = DateInterval & {
  kind: "bridge" | "july_august";
};

const addUtcDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const sortIsoDateStrings = (values: Iterable<string>) => [...new Set(values)].sort((left, right) => left.localeCompare(right));

const diffUtcDays = (startIso: string, endIso: string) => {
  const start = parseIsoDateUtc(startIso);
  const end = parseIsoDateUtc(endIso);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
};

export const buildDefaultSeasonRateEditorRange = (base = new Date()) => {
  const from = new Date(Date.UTC(base.getFullYear(), base.getMonth(), 1));
  const to = new Date(Date.UTC(base.getFullYear(), base.getMonth() + 12, 1));
  return {
    from: formatUtcDateKey(from),
    to: formatUtcDateKey(to),
  };
};

export const addDaysToIso = (value: string, days: number) => {
  const date = parseIsoDateUtc(value);
  if (!date) return value;
  return formatUtcDateKey(addUtcDays(date, days));
};

const clampPositiveInt = (value: unknown, fallback = 1) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.trunc(numeric)) : fallback;
};

const round2 = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(Math.max(0, numeric) * 100) / 100 : 0;
};

const getLowNightlyPrice = (
  gite: Pick<Gite, "prix_nuit_basse_saison" | "prix_nuit_haute_saison" | "prix_nuit_liste">
) => {
  const low = round2(gite.prix_nuit_basse_saison);
  if (low > 0) return low;
  const suggestions = getSortedNightSuggestions(gite);
  if (suggestions[0] != null) return suggestions[0];
  return round2(gite.prix_nuit_haute_saison);
};

const getHighNightlyPrice = (
  gite: Pick<Gite, "prix_nuit_basse_saison" | "prix_nuit_haute_saison" | "prix_nuit_liste">
) => {
  const high = round2(gite.prix_nuit_haute_saison);
  if (high > 0) return high;
  const suggestions = getSortedNightSuggestions(gite);
  if (suggestions.length > 0) return suggestions[suggestions.length - 1];
  return round2(gite.prix_nuit_basse_saison);
};

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

export const buildFrenchBridgeIntervals = (from: string, to: string): PublicHolidayInterval[] => {
  const fromDate = parseIsoDateUtc(from);
  const toDate = parseIsoDateUtc(to);
  if (!fromDate || !toDate || toDate.getTime() <= fromDate.getTime()) return [];

  const intervals: PublicHolidayInterval[] = [];
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
      } else if (day === 4) {
        start = holiday.date;
        end = addUtcDays(holiday.date, 3);
      } else if (day === 5) {
        start = holiday.date;
        end = addUtcDays(holiday.date, 3);
      }

      if (!start || !end) return;
      const interval = {
        kind: "bridge" as const,
        start: clampIsoRange(formatUtcDateKey(start), from, to),
        end: clampIsoRange(formatUtcDateKey(end), from, to),
        names: [`Pont ${holiday.name}`],
      };
      if (interval.start < interval.end) intervals.push(interval);
    });
  }

  return mergeRuleIntervals(intervals);
};

export const buildJulyAugustIntervals = (from: string, to: string): PublicHolidayInterval[] => {
  const fromDate = parseIsoDateUtc(from);
  const toDate = parseIsoDateUtc(to);
  if (!fromDate || !toDate || toDate.getTime() <= fromDate.getTime()) return [];

  const intervals: PublicHolidayInterval[] = [];
  for (let year = fromDate.getUTCFullYear() - 1; year <= toDate.getUTCFullYear() + 1; year += 1) {
    const interval = {
      kind: "july_august" as const,
      start: clampIsoRange(`${year}-07-01`, from, to),
      end: clampIsoRange(`${year}-09-01`, from, to),
      names: ["Juillet / août"],
    };
    if (interval.start < interval.end) intervals.push(interval);
  }
  return intervals;
};

export const getExclusiveEndDisplayLabel = (value: string) => addDaysToIso(value, -1);

const normalizeRateDate = (value: string) => value.slice(0, 10);

const clampIsoRange = (value: string, min: string, max: string) => {
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
};

export const buildHolidayIntervals = (holidays: SchoolHoliday[], from: string, to: string): DateInterval[] => {
  const intervals = holidays
    .map((holiday) => ({
      start: clampIsoRange(holiday.start, from, to),
      end: clampIsoRange(addDaysToIso(holiday.end, 1), from, to),
      names: [String(holiday.description ?? "").trim()].filter(Boolean),
    }))
    .filter((interval) => interval.start < interval.end)
    .sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));

  if (intervals.length === 0) return [];

  const merged: DateInterval[] = [];
  intervals.forEach((interval) => {
    const current = merged[merged.length - 1];
    if (!current || interval.start > current.end) {
      merged.push({ ...interval, names: [...interval.names] });
      return;
    }
    if (interval.end > current.end) {
      current.end = interval.end;
    }
    interval.names.forEach((name) => {
      if (name && !current.names.includes(name)) {
        current.names.push(name);
      }
    });
  });

  return merged;
};

const mergeRuleIntervals = <T extends DateInterval & { kind: string }>(intervals: T[]): T[] => {
  const sorted = intervals
    .filter((interval) => interval.start < interval.end)
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
  const merged: T[] = [];

  sorted.forEach((interval) => {
    const current = merged[merged.length - 1];
    if (!current || current.kind !== interval.kind || interval.start > current.end) {
      merged.push({ ...interval, names: [...interval.names] });
      return;
    }
    if (interval.end > current.end) {
      current.end = interval.end;
    }
    interval.names.forEach((name) => {
      if (name && !current.names.includes(name)) {
        current.names.push(name);
      }
    });
  });

  return merged;
};

export const getHolidayStatusForRange = (intervals: DateInterval[], start: string, end: string): SeasonRateEditorHolidayStatus => {
  const totalDays = diffUtcDays(start, end);
  if (totalDays <= 0) return "non_holiday";

  let overlapDays = 0;
  intervals.forEach((interval) => {
    const overlapStart = interval.start > start ? interval.start : start;
    const overlapEnd = interval.end < end ? interval.end : end;
    if (overlapStart < overlapEnd) {
      overlapDays += diffUtcDays(overlapStart, overlapEnd);
    }
  });

  if (overlapDays <= 0) return "non_holiday";
  if (overlapDays >= totalDays) return "holiday";
  return "mixed";
};

export const getHolidayNamesForRange = (intervals: DateInterval[], start: string, end: string) => {
  const names: string[] = [];
  intervals.forEach((interval) => {
    const overlapStart = interval.start > start ? interval.start : start;
    const overlapEnd = interval.end < end ? interval.end : end;
    if (overlapStart >= overlapEnd) return;
    interval.names.forEach((name) => {
      if (name && !names.includes(name)) {
        names.push(name);
      }
    });
  });
  return names;
};

const getIntervalNamesForRange = (intervals: DateInterval[], start: string, end: string) => getHolidayNamesForRange(intervals, start, end);

const hasFullIntervalCoverage = (intervals: DateInterval[], start: string, end: string) =>
  getHolidayStatusForRange(intervals, start, end) === "holiday";

const getUniqueMinNights = (values: Array<number | null>) => {
  const validValues = values.filter((value): value is number => value != null);
  const uniqueValues = [...new Set(validValues)];
  return {
    min_nuits: uniqueValues.length === 0 ? 1 : uniqueValues.length === 1 ? uniqueValues[0] : null,
    has_mixed_min_nights: uniqueValues.length > 1,
  };
};

const recordsEqual = (left: Record<string, number | null>, right: Record<string, number | null>) => {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
};

const mergeAdjacentAutomaticSegments = (segments: SeasonRateEditorSegment[]) => {
  const merged: SeasonRateEditorSegment[] = [];
  segments.forEach((segment) => {
    const current = merged[merged.length - 1];
    const sameHolidayMetadata =
      current?.rule === "july_august" ||
      (current?.holiday_status === segment.holiday_status && current?.holiday_names.join("|") === segment.holiday_names.join("|"));
    if (
      current &&
      current.date_fin === segment.date_debut &&
      current.rule === segment.rule &&
      sameHolidayMetadata &&
      current.rule_names.join("|") === segment.rule_names.join("|") &&
      recordsEqual(current.prices_by_gite, segment.prices_by_gite) &&
      recordsEqual(current.min_nuits_by_gite, segment.min_nuits_by_gite)
    ) {
      current.date_fin = segment.date_fin;
      return;
    }
    merged.push({
      ...segment,
      min_nuits_by_gite: { ...segment.min_nuits_by_gite },
      prices_by_gite: { ...segment.prices_by_gite },
      holiday_names: [...segment.holiday_names],
      rule_names: [...segment.rule_names],
    });
  });
  return merged;
};

export const buildAutomaticSeasonRateSegments = (params: {
  from: string;
  to: string;
  holidays: SchoolHoliday[];
  gites: Array<
    Pick<
      Gite,
      | "id"
      | "prix_nuit_liste"
      | "prix_nuit_basse_saison"
      | "prix_nuit_haute_saison"
      | "min_nuits_toute_annee"
      | "min_nuits_vacances_scolaires"
      | "min_nuits_juillet_aout"
    >
  >;
}) => {
  const holidayIntervals = buildHolidayIntervals(params.holidays, params.from, params.to);
  const bridgeIntervals = buildFrenchBridgeIntervals(params.from, params.to);
  const julyAugustIntervals = buildJulyAugustIntervals(params.from, params.to);
  const boundaries = sortIsoDateStrings([
    params.from,
    params.to,
    ...holidayIntervals.flatMap((interval) => [interval.start, interval.end]),
    ...bridgeIntervals.flatMap((interval) => [interval.start, interval.end]),
    ...julyAugustIntervals.flatMap((interval) => [interval.start, interval.end]),
  ]);

  const segments: SeasonRateEditorSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start >= end) continue;

    const isJulyAugust = hasFullIntervalCoverage(julyAugustIntervals, start, end);
    const isBridge = hasFullIntervalCoverage(bridgeIntervals, start, end);
    const holidayStatus = getHolidayStatusForRange(holidayIntervals, start, end);
    const isSchoolHoliday = holidayStatus === "holiday";
    const rule: SeasonRateEditorRule = isJulyAugust
      ? "july_august"
      : isBridge
        ? "bridge"
        : isSchoolHoliday
          ? "school_holiday"
          : "normal";
    const ruleNames =
      rule === "july_august"
        ? getIntervalNamesForRange(julyAugustIntervals, start, end)
        : rule === "bridge"
          ? getIntervalNamesForRange(bridgeIntervals, start, end)
          : rule === "school_holiday"
            ? getHolidayNamesForRange(holidayIntervals, start, end)
            : [];
    const pricesByGite: Record<string, number | null> = {};
    const minNightsByGite: Record<string, number | null> = {};

    params.gites.forEach((gite) => {
      const lowPrice = getLowNightlyPrice(gite);
      const highPrice = getHighNightlyPrice(gite);
      pricesByGite[gite.id] = rule === "school_holiday" || rule === "july_august" ? highPrice : lowPrice;
      minNightsByGite[gite.id] =
        rule === "july_august"
          ? clampPositiveInt(gite.min_nuits_juillet_aout, 1)
          : rule === "bridge"
            ? 3
            : rule === "school_holiday"
              ? clampPositiveInt(gite.min_nuits_vacances_scolaires, 1)
              : clampPositiveInt(gite.min_nuits_toute_annee, 1);
    });

    const minNightSummary = getUniqueMinNights(Object.values(minNightsByGite));
    segments.push({
      date_debut: start,
      date_fin: end,
      min_nuits: minNightSummary.min_nuits,
      min_nuits_by_gite: minNightsByGite,
      has_mixed_min_nights: minNightSummary.has_mixed_min_nights,
      holiday_status: holidayStatus,
      holiday_names: getHolidayNamesForRange(holidayIntervals, start, end),
      rule,
      rule_names: ruleNames,
      prices_by_gite: pricesByGite,
    });
  }

  return mergeAdjacentAutomaticSegments(segments);
};

const resolveCoveringRate = (rates: SeasonRate[], dateDebut: string, dateFin: string) =>
  rates.find((rate) => normalizeRateDate(rate.date_debut) <= dateDebut && normalizeRateDate(rate.date_fin) >= dateFin) ?? null;

export const buildSeasonRateEditorSegments = (data: Pick<SeasonRateEditorResponse, "from" | "to" | "holidays" | "gites" | "rates_by_gite">) => {
  const boundaries = new Set<string>([data.from, data.to]);
  const holidayIntervals = buildHolidayIntervals(data.holidays, data.from, data.to);

  holidayIntervals.forEach((interval) => {
    boundaries.add(interval.start);
    boundaries.add(interval.end);
  });

  data.gites.forEach((gite) => {
    const rates = data.rates_by_gite[gite.id] ?? [];
    rates.forEach((rate) => {
      const start = normalizeRateDate(rate.date_debut);
      const end = normalizeRateDate(rate.date_fin);
      if (start > data.from && start < data.to) boundaries.add(start);
      if (end > data.from && end < data.to) boundaries.add(end);
    });
  });

  const sortedBoundaries = sortIsoDateStrings(boundaries);
  const segments: SeasonRateEditorSegment[] = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    if (start >= end) continue;

    const pricesByGite: Record<string, number | null> = {};
    const minNightsByGite: Record<string, number | null> = {};
    const minNights: number[] = [];

    data.gites.forEach((gite) => {
      const rate = resolveCoveringRate(data.rates_by_gite[gite.id] ?? [], start, end);
      if (!rate) {
        pricesByGite[gite.id] = null;
        minNightsByGite[gite.id] = null;
        return;
      }
      pricesByGite[gite.id] = Number(rate.prix_par_nuit);
      const minNuits = Math.max(1, Number(rate.min_nuits) || 1);
      minNightsByGite[gite.id] = minNuits;
      minNights.push(minNuits);
    });

    const uniqueMinNights = [...new Set(minNights)];
    segments.push({
      date_debut: start,
      date_fin: end,
      min_nuits: uniqueMinNights.length === 0 ? 1 : uniqueMinNights.length === 1 ? uniqueMinNights[0] : null,
      min_nuits_by_gite: minNightsByGite,
      has_mixed_min_nights: uniqueMinNights.length > 1,
      holiday_status: getHolidayStatusForRange(holidayIntervals, start, end),
      holiday_names: getHolidayNamesForRange(holidayIntervals, start, end),
      rule: "manual",
      rule_names: [],
      prices_by_gite: pricesByGite,
    });
  }

  return segments;
};

const getSortedNightSuggestions = (gite: Pick<Gite, "prix_nuit_liste">) =>
  [...new Set((Array.isArray(gite.prix_nuit_liste) ? gite.prix_nuit_liste : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0))].sort(
    (left, right) => left - right
  );

export const buildSeasonRatePrefillDraft = (gites: Array<Pick<Gite, "id" | "prix_nuit_liste">>) => {
  const draft: SeasonRateEditorPrefillDraft = {};
  let requiresConfirmation = false;

  gites.forEach((gite) => {
    const suggestions = getSortedNightSuggestions(gite);
    if (suggestions.length >= 2) {
      draft[gite.id] = {
        low: String(suggestions[0]),
        high: String(suggestions[suggestions.length - 1]),
      };
      return;
    }

    requiresConfirmation = true;
    const fallback = suggestions[0];
    draft[gite.id] = {
      low: fallback == null ? "" : String(fallback),
      high: fallback == null ? "" : String(fallback),
    };
  });

  return {
    draft,
    requiresConfirmation,
  };
};

export const buildPrefilledSeasonRateSegments = (params: {
  from: string;
  to: string;
  holidays: SchoolHoliday[];
  gites: Array<Pick<Gite, "id">>;
  pricesByGite: Record<string, { low: number; high: number }>;
  minNuits: number;
}) => {
  const holidayIntervals = buildHolidayIntervals(params.holidays, params.from, params.to);
  const boundaries = sortIsoDateStrings(
    [params.from, params.to, ...holidayIntervals.flatMap((interval) => [interval.start, interval.end])]
  );

  const segments: SeasonRateEditorSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start >= end) continue;

    const holidayStatus = getHolidayStatusForRange(holidayIntervals, start, end);
    const pricesByGite: Record<string, number | null> = {};
    const minNightsByGite: Record<string, number | null> = {};
    params.gites.forEach((gite) => {
      const priceSet = params.pricesByGite[gite.id];
      pricesByGite[gite.id] = holidayStatus === "holiday" ? priceSet.high : priceSet.low;
      minNightsByGite[gite.id] = params.minNuits;
    });

    segments.push({
      date_debut: start,
      date_fin: end,
      min_nuits: params.minNuits,
      min_nuits_by_gite: minNightsByGite,
      has_mixed_min_nights: false,
      holiday_status: holidayStatus,
      holiday_names: getHolidayNamesForRange(holidayIntervals, start, end),
      rule: holidayStatus === "holiday" ? "school_holiday" : "normal",
      rule_names: getHolidayNamesForRange(holidayIntervals, start, end),
      prices_by_gite: pricesByGite,
    });
  }

  return segments;
};

export const recalculateSeasonRateEditorSegments = (
  segments: SeasonRateEditorSegment[],
  holidays: SchoolHoliday[],
  from: string,
  to: string
) => {
  const holidayIntervals = buildHolidayIntervals(holidays, from, to);
  return segments.map((segment) => ({
    ...segment,
    min_nuits_by_gite: { ...segment.min_nuits_by_gite },
    prices_by_gite: { ...segment.prices_by_gite },
    holiday_status: getHolidayStatusForRange(holidayIntervals, segment.date_debut, segment.date_fin),
    holiday_names: getHolidayNamesForRange(holidayIntervals, segment.date_debut, segment.date_fin),
  }));
};

export const shiftSeasonRateBoundary = (
  segments: SeasonRateEditorSegment[],
  segmentIndex: number,
  side: "start" | "end",
  nextDate: string
) => {
  const next = segments.map((segment) => ({
    ...segment,
    min_nuits_by_gite: { ...segment.min_nuits_by_gite },
    prices_by_gite: { ...segment.prices_by_gite },
  }));

  if (side === "start") {
    if (segmentIndex <= 0) return null;
    const current = next[segmentIndex];
    const previous = next[segmentIndex - 1];
    if (!(previous.date_debut < nextDate && nextDate < current.date_fin)) return null;
    previous.date_fin = nextDate;
    current.date_debut = nextDate;
    return next;
  }

  if (segmentIndex >= next.length - 1) return null;
  const current = next[segmentIndex];
  const following = next[segmentIndex + 1];
  if (!(current.date_debut < nextDate && nextDate < following.date_fin)) return null;
  current.date_fin = nextDate;
  following.date_debut = nextDate;
  return next;
};

export const splitSeasonRateSegment = (segments: SeasonRateEditorSegment[], segmentIndex: number, splitDate: string) => {
  const target = segments[segmentIndex];
  if (!target) return null;
  if (!(target.date_debut < splitDate && splitDate < target.date_fin)) return null;

  const left: SeasonRateEditorSegment = {
    ...target,
    date_fin: splitDate,
    min_nuits_by_gite: { ...target.min_nuits_by_gite },
    prices_by_gite: { ...target.prices_by_gite },
  };
  const right: SeasonRateEditorSegment = {
    ...target,
    date_debut: splitDate,
    min_nuits_by_gite: { ...target.min_nuits_by_gite },
    prices_by_gite: { ...target.prices_by_gite },
  };

  return [...segments.slice(0, segmentIndex), left, right, ...segments.slice(segmentIndex + 1)];
};

export const insertSeasonRateSegment = (
  segments: SeasonRateEditorSegment[],
  segmentIndex: number,
  nextSegment: Pick<SeasonRateEditorSegment, "date_debut" | "date_fin" | "min_nuits" | "min_nuits_by_gite" | "prices_by_gite">
) => {
  const target = segments[segmentIndex];
  if (!target) return null;
  if (!(target.date_debut <= nextSegment.date_debut && nextSegment.date_debut < nextSegment.date_fin && nextSegment.date_fin <= target.date_fin)) {
    return null;
  }
  if (nextSegment.date_debut === target.date_debut && nextSegment.date_fin === target.date_fin) {
    return null;
  }

  const replacement: SeasonRateEditorSegment[] = [];
  if (target.date_debut < nextSegment.date_debut) {
    replacement.push({
      ...target,
      date_fin: nextSegment.date_debut,
      min_nuits_by_gite: { ...target.min_nuits_by_gite },
      prices_by_gite: { ...target.prices_by_gite },
    });
  }

  replacement.push({
    ...target,
    date_debut: nextSegment.date_debut,
    date_fin: nextSegment.date_fin,
    min_nuits: nextSegment.min_nuits,
    min_nuits_by_gite: { ...nextSegment.min_nuits_by_gite },
    has_mixed_min_nights: new Set(Object.values(nextSegment.min_nuits_by_gite).filter((value) => value != null)).size > 1,
    rule: "manual",
    prices_by_gite: { ...nextSegment.prices_by_gite },
  });

  if (nextSegment.date_fin < target.date_fin) {
    replacement.push({
      ...target,
      date_debut: nextSegment.date_fin,
      min_nuits_by_gite: { ...target.min_nuits_by_gite },
      prices_by_gite: { ...target.prices_by_gite },
    });
  }

  return [...segments.slice(0, segmentIndex), ...replacement, ...segments.slice(segmentIndex + 1)];
};

export const mergeSeasonRateSegmentWithNext = (segments: SeasonRateEditorSegment[], segmentIndex: number) => {
  const current = segments[segmentIndex];
  const next = segments[segmentIndex + 1];
  if (!current || !next || current.date_fin !== next.date_debut) return null;

  const merged: SeasonRateEditorSegment = {
    ...current,
    date_fin: next.date_fin,
    holiday_status: current.holiday_status,
    min_nuits_by_gite: { ...current.min_nuits_by_gite },
    prices_by_gite: { ...current.prices_by_gite },
  };

  return [...segments.slice(0, segmentIndex), merged, ...segments.slice(segmentIndex + 2)];
};

export const mergeSeasonRateSegmentWithPrevious = (segments: SeasonRateEditorSegment[], segmentIndex: number) => {
  if (segmentIndex <= 0) return null;
  return mergeSeasonRateSegmentWithNext(segments, segmentIndex - 1);
};

export const removeSeasonRateSegment = (segments: SeasonRateEditorSegment[], segmentIndex: number) => {
  if (segments.length <= 1) return null;
  const target = segments[segmentIndex];
  if (!target) return null;

  if (segmentIndex === 0) {
    const next = segments[1];
    if (!next) return null;
    const expandedNext: SeasonRateEditorSegment = {
      ...next,
      date_debut: target.date_debut,
      min_nuits_by_gite: { ...next.min_nuits_by_gite },
      prices_by_gite: { ...next.prices_by_gite },
    };
    return [expandedNext, ...segments.slice(2)];
  }

  const previous = segments[segmentIndex - 1];
  if (!previous) return null;
  const expandedPrevious: SeasonRateEditorSegment = {
    ...previous,
    date_fin: target.date_fin,
    min_nuits_by_gite: { ...previous.min_nuits_by_gite },
    prices_by_gite: { ...previous.prices_by_gite },
  };

  return [...segments.slice(0, segmentIndex - 1), expandedPrevious, ...segments.slice(segmentIndex + 1)];
};

export const buildSeasonRateEditorPayload = (params: {
  from: string;
  to: string;
  zone: string;
  segments: SeasonRateEditorSegment[];
}): SeasonRateEditorPayload => {
  const normalizedSegments = params.segments.map((segment) => {
    const pricesByGite = Object.entries(segment.prices_by_gite).reduce<Record<string, number>>((accumulator, [giteId, price]) => {
      if (price == null || !Number.isFinite(price)) {
        throw new Error("Tous les gîtes doivent avoir un prix / nuit sur chaque segment avant enregistrement.");
      }
      accumulator[giteId] = Number(price);
      return accumulator;
    }, {});
    const minNightsByGite = Object.keys(pricesByGite).reduce<Record<string, number>>((accumulator, giteId) => {
      const minNuits = segment.min_nuits_by_gite[giteId] ?? segment.min_nuits;
      if (minNuits == null || !Number.isInteger(minNuits) || minNuits < 1) {
        throw new Error("Tous les gîtes doivent avoir un minimum de nuits sur chaque segment avant enregistrement.");
      }
      accumulator[giteId] = minNuits;
      return accumulator;
    }, {});
    const uniqueMinNights = [...new Set(Object.values(minNightsByGite))];
    const minNuits = uniqueMinNights.length === 1 ? uniqueMinNights[0] : Math.max(...uniqueMinNights);

    return {
      date_debut: segment.date_debut,
      date_fin: segment.date_fin,
      min_nuits: minNuits,
      min_nuits_by_gite: minNightsByGite,
      prices_by_gite: pricesByGite,
    };
  });

  return {
    from: params.from,
    to: params.to,
    zone: params.zone,
    segments: normalizedSegments,
  };
};

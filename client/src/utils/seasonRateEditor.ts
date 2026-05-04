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

export type SeasonRateEditorSegment = {
  date_debut: string;
  date_fin: string;
  min_nuits: number | null;
  has_mixed_min_nights: boolean;
  holiday_status: SeasonRateEditorHolidayStatus;
  holiday_names: string[];
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
    const minNights: number[] = [];

    data.gites.forEach((gite) => {
      const rate = resolveCoveringRate(data.rates_by_gite[gite.id] ?? [], start, end);
      if (!rate) {
        pricesByGite[gite.id] = null;
        return;
      }
      pricesByGite[gite.id] = Number(rate.prix_par_nuit);
      minNights.push(Math.max(1, Number(rate.min_nuits) || 1));
    });

    const uniqueMinNights = [...new Set(minNights)];
    segments.push({
      date_debut: start,
      date_fin: end,
      min_nuits: uniqueMinNights.length === 0 ? 1 : uniqueMinNights.length === 1 ? uniqueMinNights[0] : null,
      has_mixed_min_nights: uniqueMinNights.length > 1,
      holiday_status: getHolidayStatusForRange(holidayIntervals, start, end),
      holiday_names: getHolidayNamesForRange(holidayIntervals, start, end),
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
    params.gites.forEach((gite) => {
      const priceSet = params.pricesByGite[gite.id];
      pricesByGite[gite.id] = holidayStatus === "holiday" ? priceSet.high : priceSet.low;
    });

    segments.push({
      date_debut: start,
      date_fin: end,
      min_nuits: params.minNuits,
      has_mixed_min_nights: false,
      holiday_status: holidayStatus,
      holiday_names: getHolidayNamesForRange(holidayIntervals, start, end),
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
    prices_by_gite: { ...target.prices_by_gite },
  };
  const right: SeasonRateEditorSegment = {
    ...target,
    date_debut: splitDate,
    prices_by_gite: { ...target.prices_by_gite },
  };

  return [...segments.slice(0, segmentIndex), left, right, ...segments.slice(segmentIndex + 1)];
};

export const insertSeasonRateSegment = (
  segments: SeasonRateEditorSegment[],
  segmentIndex: number,
  nextSegment: Pick<SeasonRateEditorSegment, "date_debut" | "date_fin" | "min_nuits" | "prices_by_gite">
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
      prices_by_gite: { ...target.prices_by_gite },
    });
  }

  replacement.push({
    ...target,
    date_debut: nextSegment.date_debut,
    date_fin: nextSegment.date_fin,
    min_nuits: nextSegment.min_nuits,
    has_mixed_min_nights: false,
    prices_by_gite: { ...nextSegment.prices_by_gite },
  });

  if (nextSegment.date_fin < target.date_fin) {
    replacement.push({
      ...target,
      date_debut: nextSegment.date_fin,
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
      prices_by_gite: { ...next.prices_by_gite },
    };
    return [expandedNext, ...segments.slice(2)];
  }

  const previous = segments[segmentIndex - 1];
  if (!previous) return null;
  const expandedPrevious: SeasonRateEditorSegment = {
    ...previous,
    date_fin: target.date_fin,
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
    if (segment.min_nuits == null || segment.has_mixed_min_nights) {
      throw new Error("Tous les segments doivent avoir un minimum de nuits uniforme avant enregistrement.");
    }

    const pricesByGite = Object.entries(segment.prices_by_gite).reduce<Record<string, number>>((accumulator, [giteId, price]) => {
      if (price == null || !Number.isFinite(price)) {
        throw new Error("Tous les gîtes doivent avoir un prix / nuit sur chaque segment avant enregistrement.");
      }
      accumulator[giteId] = Number(price);
      return accumulator;
    }, {});

    return {
      date_debut: segment.date_debut,
      date_fin: segment.date_fin,
      min_nuits: segment.min_nuits,
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

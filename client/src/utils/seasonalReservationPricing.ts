import type { Gite } from "./types";
import { formatUtcDateKey, parseIsoDateUtc } from "./schoolHolidays";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SeasonalReservationPrice = {
  prix_par_nuit: number;
  prix_total: number;
  high_nights: number;
  low_nights: number;
  is_mixed: boolean;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export const hasSeasonalNightlyPrices = (gite: Gite | null | undefined) =>
  round2(Number(gite?.prix_nuit_basse_saison ?? 0)) > 0 || round2(Number(gite?.prix_nuit_haute_saison ?? 0)) > 0;

export const getGiteNightlyPriceSuggestions = (gite: Gite | null | undefined) => {
  const seen = new Set<number>();
  const suggestions: number[] = [];
  const add = (value: unknown) => {
    const price = round2(Math.max(0, Number(value)));
    if (!Number.isFinite(price) || seen.has(price)) return;
    seen.add(price);
    suggestions.push(price);
  };

  add(gite?.prix_nuit_basse_saison);
  add(gite?.prix_nuit_haute_saison);
  if (Array.isArray(gite?.prix_nuit_liste)) {
    gite.prix_nuit_liste.forEach(add);
  }

  return suggestions;
};

export const computeSeasonalReservationPrice = (params: {
  gite: Gite | null | undefined;
  date_entree: string;
  date_sortie: string;
  schoolHolidayDates: ReadonlySet<string>;
}): SeasonalReservationPrice | null => {
  const { gite, date_entree, date_sortie, schoolHolidayDates } = params;
  if (!gite || !hasSeasonalNightlyPrices(gite)) return null;

  const start = parseIsoDateUtc(date_entree);
  const end = parseIsoDateUtc(date_sortie);
  if (!start || !end || end.getTime() <= start.getTime()) return null;

  const lowPrice = round2(Math.max(0, Number(gite.prix_nuit_basse_saison ?? 0)));
  const highPrice = round2(Math.max(0, Number(gite.prix_nuit_haute_saison ?? 0)));
  const fallbackPrice = highPrice > 0 ? highPrice : lowPrice;
  let lowNights = 0;
  let highNights = 0;
  let total = 0;

  for (let current = start.getTime(); current < end.getTime(); current += DAY_MS) {
    const isHighSeason = schoolHolidayDates.has(formatUtcDateKey(new Date(current)));
    if (isHighSeason) {
      highNights += 1;
      total += highPrice > 0 ? highPrice : fallbackPrice;
    } else {
      lowNights += 1;
      total += lowPrice > 0 ? lowPrice : fallbackPrice;
    }
  }

  const nights = lowNights + highNights;
  if (nights <= 0 || total <= 0) return null;

  return {
    prix_par_nuit: round2(total / nights),
    prix_total: round2(total),
    high_nights: highNights,
    low_nights: lowNights,
    is_mixed: highNights > 0 && lowNights > 0,
  };
};

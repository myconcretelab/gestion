import prisma from "../db/prisma.js";
import { getSchoolHolidaysForRange, type SchoolHoliday } from "./schoolHolidays.js";
import {
  BookedValidationError,
  formatBookedDateInput,
  hydrateSeasonRate,
  parseBookedDateInput,
} from "./booked.js";
import { toNumber } from "../utils/money.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type GiteLite = {
  id: string;
  nom: string;
  ordre: number;
  prefixe_contrat: string;
  prix_nuit_liste: string | null;
};

type SeasonRateRow = {
  id: string;
  gite_id: string;
  date_debut: Date;
  date_fin: Date;
  prix_par_nuit: unknown;
  min_nuits: number;
  ordre: number;
  createdAt?: Date;
};

export type SeasonRateEditorSegment = {
  date_debut: string;
  date_fin: string;
  min_nuits: number;
  prices_by_gite: Record<string, number>;
};

export type SeasonRateEditorPayload = {
  from: string;
  to: string;
  zone?: string;
  segments: SeasonRateEditorSegment[];
};

export type SeasonRateEditorResponse = {
  from: string;
  to: string;
  zone: string;
  holidays: SchoolHoliday[];
  gites: Array<{
    id: string;
    nom: string;
    ordre: number;
    prefixe_contrat: string;
    prix_nuit_liste: number[];
  }>;
  rates_by_gite: Record<string, ReturnType<typeof hydrateSeasonRate>[]>;
};

type ParsedRange = {
  fromDate: Date;
  toDate: Date;
  from: string;
  to: string;
};

export type SeasonRateWritePlan = {
  delete_ids: string[];
  create_rows: Array<{
    gite_id: string;
    date_debut: Date;
    date_fin: Date;
    prix_par_nuit: number;
    min_nuits: number;
  }>;
};

const addUtcDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const parseRange = (from: string, to: string): ParsedRange => {
  const fromDate = parseBookedDateInput(from, "from");
  const toDate = parseBookedDateInput(to, "to");
  if (toDate.getTime() <= fromDate.getTime()) {
    throw new BookedValidationError({
      code: "invalid_range",
      message: "La plage d'édition doit avoir une date de fin postérieure à la date de début.",
      statusCode: 400,
    });
  }
  return { fromDate, toDate, from: formatBookedDateInput(fromDate), to: formatBookedDateInput(toDate) };
};

const parseNightlySuggestionList = (raw: string | null) => {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed)
      ? parsed.map((value) => toNumber(value as any)).filter((value) => Number.isFinite(value) && value >= 0)
      : [];
  } catch {
    return [];
  }
};

const normalizeGite = (gite: GiteLite) => ({
  id: gite.id,
  nom: gite.nom,
  ordre: gite.ordre,
  prefixe_contrat: gite.prefixe_contrat,
  prix_nuit_liste: parseNightlySuggestionList(gite.prix_nuit_liste),
});

const buildMissingPriceError = (giteId: string) =>
  new BookedValidationError({
    code: "missing_price",
    message: `Un prix / nuit est obligatoire pour le gîte ${giteId}.`,
    statusCode: 400,
    details: { gite_id: giteId },
  });

export const validateSeasonRateEditorPayload = (payload: SeasonRateEditorPayload, giteIds: string[]) => {
  const range = parseRange(payload.from, payload.to);
  if (!Array.isArray(payload.segments) || payload.segments.length === 0) {
    throw new BookedValidationError({
      code: "segments_required",
      message: "Au moins un segment tarifaire est requis.",
      statusCode: 400,
    });
  }

  const allowedGiteIds = new Set(giteIds);
  let cursor = range.fromDate;

  payload.segments.forEach((segment, index) => {
    const start = parseBookedDateInput(segment.date_debut, `segments[${index}].date_debut`);
    const end = parseBookedDateInput(segment.date_fin, `segments[${index}].date_fin`);

    if (end.getTime() <= start.getTime()) {
      throw new BookedValidationError({
        code: "invalid_segment_range",
        message: "Chaque segment doit avoir une date de fin postérieure à sa date de début.",
        statusCode: 400,
        details: { index },
      });
    }

    if (segment.min_nuits < 1 || !Number.isInteger(segment.min_nuits)) {
      throw new BookedValidationError({
        code: "invalid_min_nights",
        message: "Le minimum de nuits doit être un entier supérieur ou égal à 1.",
        statusCode: 400,
        details: { index },
      });
    }

    if (start.getTime() !== cursor.getTime()) {
      throw new BookedValidationError({
        code: "segments_not_contiguous",
        message: "Les segments doivent couvrir toute la plage sans trou ni chevauchement.",
        statusCode: 400,
        details: {
          index,
          expected_date_debut: formatBookedDateInput(cursor),
          received_date_debut: formatBookedDateInput(start),
        },
      });
    }

    const priceEntries = Object.entries(segment.prices_by_gite ?? {});
    if (priceEntries.some(([giteId]) => !allowedGiteIds.has(giteId))) {
      throw new BookedValidationError({
        code: "unknown_gite",
        message: "Le payload contient un identifiant de gîte inconnu.",
        statusCode: 400,
        details: { index },
      });
    }

    giteIds.forEach((giteId) => {
      if (!(giteId in (segment.prices_by_gite ?? {}))) {
        throw buildMissingPriceError(giteId);
      }
      const price = Number(segment.prices_by_gite[giteId]);
      if (!Number.isFinite(price) || price < 0) {
        throw new BookedValidationError({
          code: "invalid_price",
          message: `Le prix / nuit du gîte ${giteId} est invalide.`,
          statusCode: 400,
          details: { index, gite_id: giteId },
        });
      }
    });

    cursor = end;
  });

  if (cursor.getTime() !== range.toDate.getTime()) {
    throw new BookedValidationError({
      code: "segments_incomplete",
      message: "Les segments doivent couvrir toute la plage sans trou ni chevauchement.",
      statusCode: 400,
      details: {
        expected_date_fin: range.to,
        received_date_fin: formatBookedDateInput(cursor),
      },
    });
  }

  return range;
};

export const buildSeasonRateWritePlan = (params: {
  giteId: string;
  from: string;
  to: string;
  segments: SeasonRateEditorSegment[];
  existingRates: SeasonRateRow[];
}): SeasonRateWritePlan => {
  const { fromDate, toDate } = parseRange(params.from, params.to);
  const overlapping = params.existingRates.filter(
    (rate) => rate.date_debut.getTime() < toDate.getTime() && rate.date_fin.getTime() > fromDate.getTime()
  );

  const createRows: SeasonRateWritePlan["create_rows"] = [];

  overlapping.forEach((rate) => {
    if (rate.date_debut.getTime() < fromDate.getTime()) {
      createRows.push({
        gite_id: params.giteId,
        date_debut: rate.date_debut,
        date_fin: fromDate,
        prix_par_nuit: toNumber(rate.prix_par_nuit as any),
        min_nuits: Math.max(1, Number(rate.min_nuits) || 1),
      });
    }

    if (rate.date_fin.getTime() > toDate.getTime()) {
      createRows.push({
        gite_id: params.giteId,
        date_debut: toDate,
        date_fin: rate.date_fin,
        prix_par_nuit: toNumber(rate.prix_par_nuit as any),
        min_nuits: Math.max(1, Number(rate.min_nuits) || 1),
      });
    }
  });

  params.segments.forEach((segment) => {
    createRows.push({
      gite_id: params.giteId,
      date_debut: parseBookedDateInput(segment.date_debut, "segment.date_debut"),
      date_fin: parseBookedDateInput(segment.date_fin, "segment.date_fin"),
      prix_par_nuit: Number(segment.prices_by_gite[params.giteId]),
      min_nuits: Math.max(1, Number(segment.min_nuits) || 1),
    });
  });

  return {
    delete_ids: overlapping.map((rate) => rate.id),
    create_rows: createRows.sort(
      (left, right) =>
        left.date_debut.getTime() - right.date_debut.getTime() || left.date_fin.getTime() - right.date_fin.getTime()
    ),
  };
};

export const loadSeasonRateEditorData = async (params: {
  from: string;
  to: string;
  zone?: string;
}): Promise<SeasonRateEditorResponse> => {
  const range = parseRange(params.from, params.to);
  const zone = String(params.zone ?? "B").trim().toUpperCase() || "B";
  const holidayTo = formatBookedDateInput(addUtcDays(range.toDate, -1));

  const gites = await prisma.gite.findMany({
    orderBy: [{ ordre: "asc" }, { nom: "asc" }],
    select: {
      id: true,
      nom: true,
      ordre: true,
      prefixe_contrat: true,
      prix_nuit_liste: true,
    },
  });

  const giteIds = gites.map((gite) => gite.id);
  const [holidays, rates] = await Promise.all([
    getSchoolHolidaysForRange({
      from: range.from,
      to: holidayTo,
      zone,
    }),
    prisma.giteSeasonRate.findMany({
      where: {
        gite_id: { in: giteIds },
        date_debut: { lt: range.toDate },
        date_fin: { gt: range.fromDate },
      },
      orderBy: [{ gite_id: "asc" }, { ordre: "asc" }, { date_debut: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const ratesByGite: Record<string, ReturnType<typeof hydrateSeasonRate>[]> = {};
  giteIds.forEach((giteId) => {
    ratesByGite[giteId] = [];
  });
  rates.forEach((rate) => {
    const bucket = ratesByGite[rate.gite_id] ?? [];
    bucket.push(hydrateSeasonRate(rate as any));
    ratesByGite[rate.gite_id] = bucket;
  });

  return {
    from: range.from,
    to: range.to,
    zone,
    holidays,
    gites: gites.map(normalizeGite),
    rates_by_gite: ratesByGite,
  };
};

export const saveSeasonRateEditorPayload = async (payload: SeasonRateEditorPayload) => {
  const gites = await prisma.gite.findMany({
    orderBy: [{ ordre: "asc" }, { nom: "asc" }],
    select: { id: true },
  });
  const giteIds = gites.map((gite) => gite.id);
  validateSeasonRateEditorPayload(payload, giteIds);

  await prisma.$transaction(async (tx) => {
    for (const giteId of giteIds) {
      const existingRates = (await tx.giteSeasonRate.findMany({
        where: { gite_id: giteId },
        orderBy: [{ ordre: "asc" }, { date_debut: "asc" }, { createdAt: "asc" }],
      })) as SeasonRateRow[];

      const writePlan = buildSeasonRateWritePlan({
        giteId,
        from: payload.from,
        to: payload.to,
        segments: payload.segments,
        existingRates,
      });

      if (writePlan.delete_ids.length > 0) {
        await tx.giteSeasonRate.deleteMany({
          where: { id: { in: writePlan.delete_ids } },
        });
      }

      if (writePlan.create_rows.length > 0) {
        await tx.giteSeasonRate.createMany({
          data: writePlan.create_rows,
        });
      }

      const orderedRates = await tx.giteSeasonRate.findMany({
        where: { gite_id: giteId },
        orderBy: [{ date_debut: "asc" }, { date_fin: "asc" }, { ordre: "asc" }, { createdAt: "asc" }],
      });

      await Promise.all(
        orderedRates.map((rate, index) =>
          tx.giteSeasonRate.update({
            where: { id: rate.id },
            data: { ordre: index },
          })
        )
      );
    }
  });

  return loadSeasonRateEditorData({
    from: payload.from,
    to: payload.to,
    zone: payload.zone ?? "B",
  });
};

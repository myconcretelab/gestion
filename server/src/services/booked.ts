import prisma from "../db/prisma.js";
import { normalizeOptions, validateDocumentOccupancy } from "../routes/shared/rentalDocument.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";
import { round2, toNumber } from "../utils/money.js";
import type { OptionsInput } from "./contractCalculator.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const BOOKING_REQUEST_STATUS_VALUES = ["pending", "approved", "rejected", "expired"] as const;
export type BookingRequestStatus = (typeof BOOKING_REQUEST_STATUS_VALUES)[number];
export const BOOKING_REQUEST_HOLD_HOURS = 24;

export class BookedValidationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    code: string;
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "BookedValidationError";
    this.code = params.code;
    this.statusCode = params.statusCode ?? 400;
    this.details = params.details;
  }
}

export type BookingQuote = {
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  required_min_nights: number;
  nightly_breakdown: Array<{
    date: string;
    prix_par_nuit: number;
    min_nuits: number;
    season_rate_id: string;
  }>;
  montant_hebergement: number;
  total_options: number;
  taxe_sejour: number;
  total_global: number;
  arrhes_theoriques: number;
  options_detail: {
    draps: number;
    linge: number;
    menage: number;
    depart_tardif: number;
    chiens: number;
  };
};

type SeasonRateRow = {
  id: string;
  gite_id: string;
  date_debut: Date;
  date_fin: Date;
  prix_par_nuit: unknown;
  min_nuits: number;
  ordre: number;
};

const toUtcDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BookedValidationError({
      code: "invalid_date",
      message: "Date invalide.",
    });
  }
  return date;
};

export const parseBookedDateInput = (value: string, fieldLabel: string) => {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new BookedValidationError({
      code: "invalid_date",
      message: `Date invalide pour ${fieldLabel}.`,
      details: { field: fieldLabel },
    });
  }
  return toUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
};

export const formatBookedDateInput = (value: Date | string) => {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addUtcDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const enumerateNightStarts = (dateEntree: Date, dateSortie: Date) => {
  const nights: Date[] = [];
  for (let cursor = dateEntree; cursor.getTime() < dateSortie.getTime(); cursor = addUtcDays(cursor, 1)) {
    nights.push(cursor);
  }
  return nights;
};

const normalizeSeasonRate = (row: SeasonRateRow) => ({
  ...row,
  prix_par_nuit: toNumber(row.prix_par_nuit as any),
});

const normalizeOptionsForGite = (gite: {
  regle_animaux_acceptes: boolean;
  regle_bois_premiere_flambee: boolean;
  regle_tiers_personnes_info: boolean;
}, options: OptionsInput | null | undefined) => normalizeOptions(options ?? {}, gite);

export const expireStaleBookingRequests = async (now = new Date()) =>
  prisma.bookingRequest.updateMany({
    where: {
      status: "pending",
      hold_expires_at: { lte: now },
    },
    data: {
      status: "expired",
      decided_at: now,
    },
  });

export const getBookingRequestHoldExpiresAt = (now = new Date()) =>
  new Date(now.getTime() + BOOKING_REQUEST_HOLD_HOURS * 60 * 60 * 1000);

export const ensureBookingRequestPending = (bookingRequest: {
  status: string;
  hold_expires_at: Date;
}) => {
  if (bookingRequest.status !== "pending") {
    throw new BookedValidationError({
      code: "invalid_status",
      message: "Cette demande n'est plus en attente.",
      statusCode: 409,
    });
  }
  if (bookingRequest.hold_expires_at.getTime() <= Date.now()) {
    throw new BookedValidationError({
      code: "request_expired",
      message: "Cette demande a expiré.",
      statusCode: 409,
    });
  }
};

export const loadSeasonRatesForGite = async (giteId: string) =>
  (await prisma.giteSeasonRate.findMany({
    where: { gite_id: giteId },
    orderBy: [{ ordre: "asc" }, { date_debut: "asc" }, { createdAt: "asc" }],
  })) as SeasonRateRow[];

export const findOverlappingSeasonRates = async (params: {
  giteId: string;
  dateDebut: Date;
  dateFin: Date;
  excludeId?: string;
}) =>
  prisma.giteSeasonRate.findMany({
    where: {
      gite_id: params.giteId,
      date_debut: { lt: params.dateFin },
      date_fin: { gt: params.dateDebut },
      ...(params.excludeId ? { NOT: { id: params.excludeId } } : {}),
    },
    orderBy: [{ date_debut: "asc" }, { ordre: "asc" }],
  });

export const assertNoSeasonRateOverlap = async (params: {
  giteId: string;
  dateDebut: Date;
  dateFin: Date;
  excludeId?: string;
}) => {
  const overlaps = await findOverlappingSeasonRates(params);
  if (overlaps.length > 0) {
    throw new BookedValidationError({
      code: "season_overlap",
      message: "Cette période chevauche une autre saison pour ce gîte.",
      statusCode: 409,
    });
  }
};

const resolveOptionAmounts = (params: {
  gite: {
    taxe_sejour_par_personne_par_nuit: unknown;
    options_draps_par_lit: unknown;
    options_linge_toilette_par_personne: unknown;
    options_menage_forfait: unknown;
    options_depart_tardif_forfait: unknown;
    options_chiens_forfait: unknown;
  };
  options: OptionsInput;
  nbNuits: number;
  nbAdultes: number;
}) => {
  const drapsTarif =
    params.options.draps?.prix_unitaire !== undefined
      ? toNumber(params.options.draps.prix_unitaire)
      : toNumber(params.gite.options_draps_par_lit as any);
  const lingeTarif = toNumber(params.gite.options_linge_toilette_par_personne as any);
  const menageTarif = toNumber(params.gite.options_menage_forfait as any);
  const departTardifTarif =
    params.options.depart_tardif?.prix_forfait !== undefined
      ? toNumber(params.options.depart_tardif.prix_forfait)
      : toNumber(params.gite.options_depart_tardif_forfait as any);
  const chiensTarif =
    params.options.chiens?.prix_unitaire !== undefined
      ? toNumber(params.options.chiens.prix_unitaire)
      : toNumber(params.gite.options_chiens_forfait as any);

  const draps = params.options.draps?.enabled
    ? params.options.draps?.offert
      ? 0
      : round2(drapsTarif * Math.max(0, params.options.draps.nb_lits ?? 0))
    : 0;
  const linge = params.options.linge_toilette?.enabled
    ? params.options.linge_toilette?.offert
      ? 0
      : round2(lingeTarif * Math.max(0, params.options.linge_toilette.nb_personnes ?? 0))
    : 0;
  const menage = params.options.menage?.enabled ? (params.options.menage.offert ? 0 : round2(menageTarif)) : 0;
  const departTardif = params.options.depart_tardif?.enabled
    ? params.options.depart_tardif.offert
      ? 0
      : round2(departTardifTarif)
    : 0;
  const chiens = params.options.chiens?.enabled
    ? params.options.chiens.offert
      ? 0
      : round2(chiensTarif * Math.max(0, params.options.chiens.nb ?? 1) * params.nbNuits)
    : 0;
  const total_options = round2(draps + linge + menage + departTardif + chiens);
  const taxe_sejour = round2(params.nbAdultes * params.nbNuits * toNumber(params.gite.taxe_sejour_par_personne_par_nuit as any));

  return {
    total_options,
    taxe_sejour,
    options_detail: {
      draps,
      linge,
      menage,
      depart_tardif: departTardif,
      chiens,
    },
  };
};

export const computeSeasonQuote = async (params: {
  gite: {
    id: string;
    capacite_max: number;
    nb_adultes_max: number;
    nb_enfants_max?: number | null;
    taxe_sejour_par_personne_par_nuit: unknown;
    options_draps_par_lit: unknown;
    options_linge_toilette_par_personne: unknown;
    options_menage_forfait: unknown;
    options_depart_tardif_forfait: unknown;
    options_chiens_forfait: unknown;
    arrhes_taux_defaut: unknown;
    regle_animaux_acceptes: boolean;
    regle_bois_premiere_flambee: boolean;
    regle_tiers_personnes_info: boolean;
  };
  dateEntree: Date;
  dateSortie: Date;
  nbAdultes: number;
  nbEnfants: number;
  options?: OptionsInput | null;
  seasonRates?: SeasonRateRow[];
}) => {
  const nbNuits = Math.round((params.dateSortie.getTime() - params.dateEntree.getTime()) / DAY_MS);
  if (nbNuits <= 0) {
    throw new BookedValidationError({
      code: "invalid_range",
      message: "La date de sortie doit être postérieure à la date d'entrée.",
    });
  }

  const occupancyError = validateDocumentOccupancy({
    gite: {
      capacite_max: params.gite.capacite_max,
      nb_adultes_max: params.gite.nb_adultes_max,
      nb_enfants_max: params.gite.nb_enfants_max ?? 0,
    },
    nbAdultes: params.nbAdultes,
    nbEnfants: params.nbEnfants,
  });
  if (occupancyError) {
    const firstIssue = occupancyError.issues[0];
    throw new BookedValidationError({
      code: "occupancy_invalid",
      message: firstIssue?.message ?? "Capacité invalide pour ce gîte.",
      details: { path: firstIssue?.path ?? [] },
    });
  }

  const seasonRates = (params.seasonRates ?? (await loadSeasonRatesForGite(params.gite.id))).map(normalizeSeasonRate);
  const nightlyBreakdown = enumerateNightStarts(params.dateEntree, params.dateSortie).map((nightStart) => {
    const seasonRate = seasonRates.find(
      (item) => item.date_debut.getTime() <= nightStart.getTime() && item.date_fin.getTime() > nightStart.getTime(),
    );
    if (!seasonRate) {
      throw new BookedValidationError({
        code: "season_gap",
        message: `Aucun tarif saisonnier n'est configuré pour la nuit du ${formatBookedDateInput(nightStart)}.`,
        statusCode: 409,
        details: {
          date: formatBookedDateInput(nightStart),
        },
      });
    }

    return {
      date: formatBookedDateInput(nightStart),
      prix_par_nuit: seasonRate.prix_par_nuit,
      min_nuits: Math.max(1, Number(seasonRate.min_nuits) || 1),
      season_rate_id: seasonRate.id,
    };
  });

  const required_min_nights = nightlyBreakdown.reduce((max, item) => Math.max(max, item.min_nuits), 1);
  if (nbNuits < required_min_nights) {
    throw new BookedValidationError({
      code: "min_nights",
      message: `La durée minimale pour cette période est de ${required_min_nights} nuit(s).`,
      statusCode: 409,
      details: {
        required_min_nights,
      },
    });
  }

  const normalizedOptions = normalizeOptionsForGite(params.gite, params.options);
  const montant_hebergement = round2(
    nightlyBreakdown.reduce((sum, item) => sum + item.prix_par_nuit, 0),
  );
  const resolvedOptions = resolveOptionAmounts({
    gite: params.gite,
    options: normalizedOptions,
    nbNuits,
    nbAdultes: params.nbAdultes,
  });
  const total_global = round2(montant_hebergement + resolvedOptions.total_options);
  const arrhes_theoriques = round2(montant_hebergement * toNumber(params.gite.arrhes_taux_defaut as any));

  return {
    date_entree: formatBookedDateInput(params.dateEntree),
    date_sortie: formatBookedDateInput(params.dateSortie),
    nb_nuits: nbNuits,
    required_min_nights,
    nightly_breakdown: nightlyBreakdown,
    montant_hebergement,
    total_options: resolvedOptions.total_options,
    taxe_sejour: resolvedOptions.taxe_sejour,
    total_global,
    arrhes_theoriques,
    options_detail: resolvedOptions.options_detail,
  } satisfies BookingQuote;
};

export const loadBookedConflicts = async (params: {
  giteId: string;
  dateEntree: Date;
  dateSortie: Date;
  excludeBookingRequestId?: string;
}) => {
  await expireStaleBookingRequests();

  const [reservations, bookingRequests] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        gite_id: params.giteId,
        date_entree: { lt: params.dateSortie },
        date_sortie: { gt: params.dateEntree },
      },
      orderBy: { date_entree: "asc" },
      select: {
        id: true,
        hote_nom: true,
        date_entree: true,
        date_sortie: true,
      },
    }),
    prisma.bookingRequest.findMany({
      where: {
        gite_id: params.giteId,
        status: "pending",
        hold_expires_at: { gt: new Date() },
        date_entree: { lt: params.dateSortie },
        date_sortie: { gt: params.dateEntree },
        ...(params.excludeBookingRequestId ? { NOT: { id: params.excludeBookingRequestId } } : {}),
      },
      orderBy: { date_entree: "asc" },
      select: {
        id: true,
        hote_nom: true,
        date_entree: true,
        date_sortie: true,
        hold_expires_at: true,
      },
    }),
  ]);

  return {
    reservations,
    bookingRequests,
  };
};

export const assertBookedAvailability = async (params: {
  giteId: string;
  dateEntree: Date;
  dateSortie: Date;
  excludeBookingRequestId?: string;
}) => {
  const conflicts = await loadBookedConflicts(params);
  if (conflicts.reservations.length > 0) {
    throw new BookedValidationError({
      code: "reservation_conflict",
      message: "Le gîte est déjà réservé sur cette période.",
      statusCode: 409,
      details: {
        conflicts: conflicts.reservations.map((item) => ({
          type: "reservation",
          id: item.id,
          hote_nom: item.hote_nom,
          date_entree: item.date_entree,
          date_sortie: item.date_sortie,
        })),
      },
    });
  }
  if (conflicts.bookingRequests.length > 0) {
    throw new BookedValidationError({
      code: "booking_request_conflict",
      message: "Le gîte est temporairement bloqué par une autre demande.",
      statusCode: 409,
      details: {
        conflicts: conflicts.bookingRequests.map((item) => ({
          type: "booking_request",
          id: item.id,
          hote_nom: item.hote_nom,
          date_entree: item.date_entree,
          date_sortie: item.date_sortie,
          hold_expires_at: item.hold_expires_at,
        })),
      },
    });
  }
};

export const hydrateSeasonRate = (seasonRate: SeasonRateRow) => ({
  ...seasonRate,
  prix_par_nuit: toNumber(seasonRate.prix_par_nuit as any),
});

export const hydrateBookingRequest = (bookingRequest: any) => ({
  ...bookingRequest,
  nb_enfants_2_17: Math.max(0, Number(bookingRequest.nb_enfants_2_17) || 0),
  options: fromJsonString<OptionsInput>(bookingRequest.options, {}),
  pricing_snapshot: fromJsonString<BookingQuote>(bookingRequest.pricing_snapshot, {} as BookingQuote),
});

export const encodeBookingRequestOptions = (options: OptionsInput | undefined) =>
  encodeJsonField(options ?? {});

export const encodeBookingRequestPricingSnapshot = (pricingSnapshot: BookingQuote) =>
  encodeJsonField(pricingSnapshot);

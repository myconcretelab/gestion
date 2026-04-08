import { Router } from "express";
import crypto from "node:crypto";
import { format } from "date-fns";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { round2, toNumber } from "../utils/money.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";
import { type OptionsInput } from "../services/contractCalculator.js";
import {
  loadLiveReservationEnergySummaries,
  parseReservationEnergyTracking,
  startManualReservationEnergyTracking,
  summarizeReservationEnergyTracking,
} from "../services/smartlifeEnergyTracking.js";
import {
  getGiteMonthlyEnergySummaries,
  getEnabledMonthlyEnergyGiteIds,
  startSmartlifeCurrentMonthForGite,
} from "../services/smartlifeMonthlyEnergy.js";
import {
  buildDefaultSmartlifeAutomationConfig,
  hasSmartlifeCredentials,
  readSmartlifeAutomationConfig,
} from "../services/smartlifeSettings.js";
import {
  getAirbnbCalendarRefreshJobStatus,
  queueAirbnbCalendarRefresh,
  type AirbnbCalendarRefreshCreateResult,
} from "../services/airbnbCalendarRefresh.js";
import {
  normalizeReservationCommissionMode,
  sanitizeReservationAmount,
  sanitizeReservationCommissionValue,
} from "../services/reservationPricing.js";
import { optionsSchema } from "./shared/rentalDocument.js";
import {
  buildReservationOriginData,
  getReservationOriginSystem,
  shouldExportReservationToIcal,
} from "../utils/reservationOrigin.js";

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const reservationGiteSelect = {
  id: true,
  nom: true,
  prefixe_contrat: true,
  ordre: true,
  electricity_price_per_kwh: true,
} as const;
const reservationPlaceholderSelect = {
  id: true,
  abbreviation: true,
  label: true,
} as const;
const reservationLinkedContractSelect = {
  id: true,
  reservation_id: true,
  numero_contrat: true,
  statut_paiement_arrhes: true,
  statut_paiement_solde: true,
  solde_montant: true,
} as const;

const emptyStringToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const optionalNumberField = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
}, z.coerce.number().min(0).optional());

const reservationPayloadSchema = z.object({
  gite_id: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable()).optional(),
  placeholder_id: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable()).optional(),
  airbnb_url: z.preprocess(emptyStringToNull, z.string().trim().url().nullable()).optional(),
  hote_nom: z.string().trim().min(1),
  telephone: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  email: z.preprocess(emptyStringToNull, z.string().trim().email().nullable()).optional(),
  date_entree: z.string().trim().min(1),
  date_sortie: z.string().trim().min(1),
  nb_adultes: z.coerce.number().int().min(0),
  prix_par_nuit: optionalNumberField,
  prix_total: optionalNumberField,
  price_driver: z.enum(["nightly", "total"]).optional(),
  source_paiement: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  commentaire: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  remise_montant: z.coerce.number().min(0).max(999999).optional().default(0),
  commission_channel_mode: z.enum(["euro", "percent"]).optional().default("euro"),
  commission_channel_value: z.coerce.number().min(0).max(999999).optional().default(0),
  frais_optionnels_montant: z.coerce.number().min(0).optional().default(0),
  frais_optionnels_libelle: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  frais_optionnels_declares: z.boolean().optional().default(false),
  options: optionsSchema.optional().default({}),
});
const integrationReservationPayloadSchema = reservationPayloadSchema.extend({
  origin_reference: z.string().trim().min(1),
});
const integrationReservationBatchSchema = z.object({
  reservations: z.array(integrationReservationPayloadSchema).min(1),
});

const importPayloadSchema = z.object({
  format: z.enum(["csv", "json"]),
  content: z.string().min(1),
  delimiter: z.enum([",", ";", "\t"]).optional(),
  gite_id: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable()).optional(),
  abbreviation_map: z.record(z.string().trim().min(1)).optional().default({}),
  column_map: z.record(z.string().trim()).optional().default({}),
});

const assignPlaceholderSchema = z.object({
  gite_id: z.string().trim().min(1),
});

const monthlyEnergyStartSchema = z.object({
  gite_id: z.string().trim().min(1),
});

type ReservationAssociation = {
  gite_id: string | null;
  placeholder_id: string | null;
};

type ReservationComputation = {
  dateEntree: Date;
  dateSortie: Date;
  nbNuits: number;
  prixParNuit: number;
  prixTotal: number;
};

type ReservationPeriodSegment = {
  dateEntree: Date;
  dateSortie: Date;
  nbNuits: number;
};

type ReservationPayload = z.infer<typeof reservationPayloadSchema>;
type IntegrationReservationPayload = z.infer<typeof integrationReservationPayloadSchema>;

type ImportRawRow = {
  index: number;
  data: Record<string, unknown>;
};

type ParsedImportRaw = {
  rows: ImportRawRow[];
  columnLabels: Record<string, string>;
};

type ParsedImportRow = {
  rowNumber: number;
  hote_nom: string;
  telephone: string | null;
  email: string | null;
  date_entree: string;
  date_sortie: string;
  nb_adultes: number;
  prix_par_nuit?: number;
  prix_total?: number;
  source_paiement: ReservationSource;
  commentaire: string | null;
  frais_optionnels_montant: number;
  frais_optionnels_libelle: string | null;
  frais_optionnels_declares: boolean;
  gite_abbreviation: string | null;
};

type ImportIssue = {
  row: number;
  message: string;
  blocking?: boolean;
};

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const RESERVATION_SOURCES = [
  "Abritel",
  "Airbnb",
  "Chèque",
  "Espèces",
  "HomeExchange",
  "Virement",
  "A définir",
  "Gites de France",
] as const;

type ReservationSource = (typeof RESERVATION_SOURCES)[number];

const DEFAULT_RESERVATION_SOURCE: ReservationSource = "A définir";

const SOURCE_BY_NORMALIZED_KEY = new Map<string, ReservationSource>([
  [normalizeTextKey("Abritel"), "Abritel"],
  [normalizeTextKey("Airbnb"), "Airbnb"],
  [normalizeTextKey("Airbnb (Not available)"), "A définir"],
  [normalizeTextKey("Chèque"), "Chèque"],
  [normalizeTextKey("Cheques"), "Chèque"],
  [normalizeTextKey("Espèces"), "Espèces"],
  [normalizeTextKey("HomeExchange"), "HomeExchange"],
  [normalizeTextKey("Virement"), "Virement"],
  [normalizeTextKey("A définir"), "A définir"],
  [normalizeTextKey("A Définir"), "A définir"],
  [normalizeTextKey("Gites de France"), "Gites de France"],
  [normalizeTextKey("Gite de France"), "Gites de France"],
]);

const normalizeReservationSource = (value: unknown): ReservationSource | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return SOURCE_BY_NORMALIZED_KEY.get(normalizeTextKey(trimmed)) ?? null;
};

const resolveReservationSource = (value: unknown, options?: { strict?: boolean }): ReservationSource => {
  const normalized = normalizeReservationSource(value);
  if (normalized) return normalized;

  const hasValue = typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
  if (!hasValue) return DEFAULT_RESERVATION_SOURCE;

  if (options?.strict) {
    throw new Error(
      `Source invalide. Valeurs autorisées: ${RESERVATION_SOURCES.join(", ")}.`
    );
  }

  return DEFAULT_RESERVATION_SOURCE;
};

const makeUtcDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Date invalide");
  }
  return date;
};

const parseDateInput = (value: string, label: string) => {
  const raw = value.trim();
  if (!raw) throw new Error(`Date manquante: ${label}`);

  const frMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]);
    const year = Number(frMatch[3]);
    return makeUtcDate(year, month, day);
  }

  const isoDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const month = Number(isoDateMatch[2]);
    const day = Number(isoDateMatch[3]);
    return makeUtcDate(year, month, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Date invalide: ${label}`);
  }

  return makeUtcDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
};

const formatDateFr = (value: Date | string) => format(new Date(value), "dd/MM/yyyy");

const buildAirbnbCalendarRefreshCreateResult = async (
  association: ReservationAssociation
): Promise<AirbnbCalendarRefreshCreateResult> => {
  try {
    if (!association.gite_id) {
      return {
        status: "skipped",
        message: "Réservation sans gîte: aucun rafraîchissement Airbnb à lancer.",
      };
    }

    const gite = await prisma.gite.findUnique({
      where: { id: association.gite_id },
      select: {
        id: true,
        airbnb_listing_id: true,
      },
    });

    if (!gite?.airbnb_listing_id) {
      return {
        status: "skipped",
        message: "Le gîte n'a pas d'ID Airbnb configuré.",
      };
    }

    return queueAirbnbCalendarRefresh({
      giteId: gite.id,
      listingId: gite.airbnb_listing_id,
    });
  } catch (error) {
    return {
      status: "skipped",
      message: error instanceof Error ? error.message : "Le rafraîchissement Airbnb n'a pas pu être préparé.",
    };
  }
};

const computePrices = (
  nights: number,
  prixParNuit: number | undefined,
  prixTotal: number | undefined,
  priceDriver: "nightly" | "total" | undefined
) => {
  if (!prixParNuit && prixParNuit !== 0 && !prixTotal && prixTotal !== 0) {
    throw new Error("Renseignez au moins un prix (par nuit ou total).");
  }

  const hasNightly = prixParNuit !== undefined;
  const hasTotal = prixTotal !== undefined;

  if ((priceDriver === "nightly" || (!hasTotal && hasNightly)) && hasNightly) {
    const nightly = round2(prixParNuit);
    return {
      prixParNuit: nightly,
      prixTotal: round2(nightly * nights),
    };
  }

  if ((priceDriver === "total" || (!hasNightly && hasTotal)) && hasTotal) {
    const total = round2(prixTotal);
    return {
      prixTotal: total,
      prixParNuit: nights > 0 ? round2(total / nights) : 0,
    };
  }

  const nightly = round2(prixParNuit ?? 0);
  return {
    prixParNuit: nightly,
    prixTotal: round2(nightly * nights),
  };
};

const computeReservationFields = (payload: z.infer<typeof reservationPayloadSchema>): ReservationComputation => {
  const dateEntree = parseDateInput(payload.date_entree, "date_entree");
  const dateSortie = parseDateInput(payload.date_sortie, "date_sortie");
  const nbNuits = Math.round((dateSortie.getTime() - dateEntree.getTime()) / DAY_MS);

  if (nbNuits <= 0) {
    throw new Error("La date de sortie doit être postérieure à la date d'entrée.");
  }

  const prices = computePrices(nbNuits, payload.prix_par_nuit, payload.prix_total, payload.price_driver);

  return {
    dateEntree,
    dateSortie,
    nbNuits,
    prixParNuit: prices.prixParNuit,
    prixTotal: prices.prixTotal,
  };
};

const parseBearerToken = (authorizationHeader: string | undefined) => {
  const [type, token] = String(authorizationHeader ?? "").split(" ");
  if (type !== "Bearer" || !token) return null;
  return token.trim();
};

const requireIntegrationToken = (req: any, res: any, next: (err?: unknown) => void) => {
  if (!env.INTEGRATION_API_TOKEN) {
    return res.status(503).json({ error: "INTEGRATION_API_TOKEN non configuré." });
  }

  const token = parseBearerToken(req.headers.authorization);
  if (!token || token !== env.INTEGRATION_API_TOKEN) {
    return res.status(401).json({ error: "Token d'intégration invalide." });
  }

  return next();
};

const splitReservationByMonth = (dateEntree: Date, dateSortie: Date): ReservationPeriodSegment[] => {
  if (dateSortie.getTime() <= dateEntree.getTime()) return [];

  const segments: ReservationPeriodSegment[] = [];
  let cursor = dateEntree;

  while (cursor.getTime() < dateSortie.getTime()) {
    const monthStartNext = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const segmentEnd = monthStartNext.getTime() < dateSortie.getTime() ? monthStartNext : dateSortie;
    const nbNuits = Math.round((segmentEnd.getTime() - cursor.getTime()) / DAY_MS);

    if (nbNuits > 0) {
      segments.push({
        dateEntree: cursor,
        dateSortie: segmentEnd,
        nbNuits,
      });
    }

    cursor = segmentEnd;
  }

  return segments;
};

const allocateAmountByNights = (total: number, segments: ReservationPeriodSegment[]) => {
  if (segments.length === 0) return [] as number[];

  const roundedTotal = round2(total);
  const totalNights = segments.reduce((sum, segment) => sum + segment.nbNuits, 0);
  if (totalNights <= 0) return segments.map(() => 0);

  let allocated = 0;
  return segments.map((segment, index) => {
    if (index === segments.length - 1) {
      const remaining = round2(roundedTotal - allocated);
      return remaining === 0 ? 0 : remaining;
    }

    const amount = round2((roundedTotal * segment.nbNuits) / totalNights);
    allocated = round2(allocated + amount);
    return amount;
  });
};

const buildReservationSegmentRecords = (
  payload: ReservationPayload | IntegrationReservationPayload,
  association: ReservationAssociation,
  originData?: ReturnType<typeof buildReservationOriginData>,
  stayGroupId?: string,
) => {
  const computed = computeReservationFields(payload);
  const segments = splitReservationByMonth(computed.dateEntree, computed.dateSortie);
  if (segments.length === 0) {
    throw new Error("La date de sortie doit être postérieure à la date d'entrée.");
  }

  const priceTotalsBySegment = allocateAmountByNights(computed.prixTotal, segments);
  const optionalFeesBySegment = allocateAmountByNights(round2(payload.frais_optionnels_montant ?? 0), segments);
  const remiseBySegment = allocateAmountByNights(round2(payload.remise_montant ?? 0), segments);
  const commissionMode = normalizeReservationCommissionMode(payload.commission_channel_mode);
  const commissionValue = sanitizeReservationCommissionValue(payload.commission_channel_value ?? 0, commissionMode);
  const commissionBySegment =
    commissionMode === "euro" ? allocateAmountByNights(round2(commissionValue), segments) : segments.map(() => commissionValue);
  const encodedOptions = encodeJsonField(payload.options ?? {});
  const source_paiement = resolveReservationSource(payload.source_paiement, { strict: true });

  return {
    computed,
    source_paiement,
    records: segments.map((segment, index) => {
      const prixTotal = priceTotalsBySegment[index] ?? 0;
      const prixParNuit = segment.nbNuits > 0 ? round2(prixTotal / segment.nbNuits) : 0;

      return {
        segment,
        data: {
          gite_id: association.gite_id,
          stay_group_id: stayGroupId ?? crypto.randomUUID(),
          placeholder_id: association.placeholder_id,
          ...(originData ?? {}),
          airbnb_url: payload.airbnb_url ?? null,
          hote_nom: payload.hote_nom,
          telephone: payload.telephone ?? null,
          email: payload.email ?? null,
          date_entree: segment.dateEntree,
          date_sortie: segment.dateSortie,
          nb_nuits: segment.nbNuits,
          nb_adultes: payload.nb_adultes,
          prix_par_nuit: prixParNuit,
          prix_total: prixTotal,
          source_paiement,
          commentaire: payload.commentaire ?? null,
          remise_montant: remiseBySegment[index] ?? 0,
          commission_channel_mode: commissionMode,
          commission_channel_value: commissionBySegment[index] ?? 0,
          frais_optionnels_montant: optionalFeesBySegment[index] ?? 0,
          frais_optionnels_libelle: payload.frais_optionnels_libelle ?? null,
          frais_optionnels_declares: payload.frais_optionnels_declares ?? false,
          options: encodedOptions,
        },
      };
    }),
  };
};

const normalizeAssociation = (payload: z.infer<typeof reservationPayloadSchema>): ReservationAssociation => {
  const giteId = payload.gite_id ?? null;
  const placeholderId = giteId ? null : payload.placeholder_id ?? null;

  if (!giteId && !placeholderId) {
    throw new Error("Chaque réservation doit être associée à un gîte ou à un placeholder.");
  }

  return {
    gite_id: giteId,
    placeholder_id: placeholderId,
  };
};

const ensureAssociationExists = async (association: ReservationAssociation) => {
  if (association.gite_id) {
    const gite = await prisma.gite.findUnique({ where: { id: association.gite_id }, select: { id: true } });
    if (!gite) throw new Error("Gîte introuvable pour cette réservation.");
  }

  if (association.placeholder_id) {
    const placeholder = await prisma.reservationPlaceholder.findUnique({
      where: { id: association.placeholder_id },
      select: { id: true },
    });
    if (!placeholder) throw new Error("Placeholder introuvable pour cette réservation.");
  }
};

const findConflicts = async (params: {
  association: ReservationAssociation;
  dateEntree: Date;
  dateSortie: Date;
  excludeId?: string;
  excludeIds?: string[];
}) => {
  const where: any = {
    date_entree: { lt: params.dateSortie },
    date_sortie: { gt: params.dateEntree },
  };

  if (params.association.gite_id) where.gite_id = params.association.gite_id;
  if (params.association.placeholder_id) where.placeholder_id = params.association.placeholder_id;
  const excludedIds = [...new Set([params.excludeId, ...(params.excludeIds ?? [])].filter(Boolean))];
  if (excludedIds.length === 1) where.NOT = { id: excludedIds[0] };
  if (excludedIds.length > 1) where.NOT = { id: { in: excludedIds } };

  return prisma.reservation.findMany({
    where,
    include: {
      gite: { select: reservationGiteSelect },
      placeholder: { select: reservationPlaceholderSelect },
    },
    orderBy: { date_entree: "asc" },
  });
};

const buildConflictPayload = (conflicts: any[]) => ({
  error: "Chevauchement détecté sur ce gîte.",
  conflicts: conflicts.map((conflict) => ({
    id: conflict.id,
    hote_nom: conflict.hote_nom,
    date_entree: conflict.date_entree,
    date_sortie: conflict.date_sortie,
    gite: conflict.gite,
    placeholder: conflict.placeholder,
    label: `${conflict.hote_nom} (${formatDateFr(conflict.date_entree)} - ${formatDateFr(conflict.date_sortie)})`,
  })),
});

const hydrateReservation = (reservation: any) => {
  const energyTracking = parseReservationEnergyTracking(reservation.energy_tracking);
  const energySummary = summarizeReservationEnergyTracking(energyTracking);

  return {
    ...reservation,
    origin_system: getReservationOriginSystem(reservation),
    origin_reference: reservation.origin_reference ?? null,
    export_to_ical: shouldExportReservationToIcal(reservation),
    prix_par_nuit: toNumber(reservation.prix_par_nuit),
    prix_total: toNumber(reservation.prix_total),
    remise_montant: toNumber(reservation.remise_montant),
    commission_channel_mode: normalizeReservationCommissionMode(reservation.commission_channel_mode),
    commission_channel_value: toNumber(reservation.commission_channel_value),
    frais_optionnels_montant: toNumber(reservation.frais_optionnels_montant),
    options: fromJsonString<OptionsInput>(reservation.options, {}),
    stay_group_id: typeof reservation.stay_group_id === "string" ? reservation.stay_group_id : null,
    energy_consumption_kwh:
      toNumber(reservation.energy_consumption_kwh) || energySummary.energy_consumption_kwh,
    energy_cost_eur:
      toNumber(reservation.energy_cost_eur) || energySummary.energy_cost_eur,
    energy_price_per_kwh:
      reservation.energy_price_per_kwh == null
        ? energySummary.energy_price_per_kwh
        : toNumber(reservation.energy_price_per_kwh),
    energy_tracking: energyTracking,
  };
};

const hydrateReservationLinkedContract = (contract: any) => ({
  id: contract.id,
  numero_contrat: contract.numero_contrat,
  statut_paiement_arrhes: contract.statut_paiement_arrhes,
  statut_paiement_solde: contract.statut_paiement_solde,
  solde_montant: toNumber(contract.solde_montant),
});

const attachLinkedContractsToReservations = async <T extends { id: string }>(
  reservations: T[],
) => {
  if (reservations.length === 0) {
    return reservations.map((reservation) => ({
      ...reservation,
      linked_contract: null,
    }));
  }

  if (!process.env.DATABASE_URL) {
    return reservations.map((reservation) => ({
      ...reservation,
      linked_contract: null,
    }));
  }

  const contracts = await prisma.contrat.findMany({
    where: {
      reservation_id: {
        in: reservations.map((reservation) => reservation.id),
      },
    },
    select: reservationLinkedContractSelect,
    orderBy: [{ date_creation: "desc" }, { id: "desc" }],
  });

  const linkedContractByReservationId = new Map<
    string,
    ReturnType<typeof hydrateReservationLinkedContract>
  >();
  for (const contract of contracts) {
    if (!contract.reservation_id) continue;
    if (linkedContractByReservationId.has(contract.reservation_id)) continue;
    linkedContractByReservationId.set(
      contract.reservation_id,
      hydrateReservationLinkedContract(contract),
    );
  }

  return reservations.map((reservation) => ({
    ...reservation,
    linked_contract: linkedContractByReservationId.get(reservation.id) ?? null,
  }));
};

const hydrateReservationWithLinkedContract = async (reservation: any) => {
  const [hydrated] = await attachLinkedContractsToReservations([
    hydrateReservation(reservation),
  ]);
  return hydrated;
};

const loadIntegratedReservationRows = async (originReference: string) =>
  prisma.reservation.findMany({
    where: {
      origin_system: "what-today",
      origin_reference: originReference,
    },
    orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

const syncIntegratedReservationRows = async (params: {
  payload: IntegrationReservationPayload;
  association: ReservationAssociation;
  existingRows: any[];
}) => {
  const prepared = buildReservationSegmentRecords(
    params.payload,
    params.association,
    buildReservationOriginData({
      originSystem: "what-today",
      originReference: params.payload.origin_reference,
      exportToIcal: true,
    }),
    params.existingRows[0]?.stay_group_id || crypto.randomUUID(),
  );
  const existingIds = params.existingRows.map((row) => row.id);
  const conflictById = new Map<string, any>();

  for (const { segment } of prepared.records) {
    const conflicts = await findConflicts({
      association: params.association,
      dateEntree: segment.dateEntree,
      dateSortie: segment.dateSortie,
      excludeIds: existingIds,
    });
    for (const conflict of conflicts) {
      conflictById.set(conflict.id, conflict);
    }
  }

  if (conflictById.size > 0) {
    return {
      conflict: buildConflictPayload([...conflictById.values()]),
      reservations: null,
      createdCount: 0,
      updatedCount: 0,
    };
  }

  const reservations = await prisma.$transaction(async (tx) => {
    const synced: any[] = [];

    for (let index = 0; index < prepared.records.length; index += 1) {
      const record = prepared.records[index];
      const existing = params.existingRows[index];

      if (existing) {
        const updated = await tx.reservation.update({
          where: { id: existing.id },
          data: record.data,
          include: {
            gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
            placeholder: { select: { id: true, abbreviation: true, label: true } },
          },
        });
        synced.push(updated);
        continue;
      }

      const created = await tx.reservation.create({
        data: record.data,
        include: {
          gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
          placeholder: { select: { id: true, abbreviation: true, label: true } },
        },
      });
      synced.push(created);
    }

    const primaryReservationId = synced[0]?.id ?? null;
    if (primaryReservationId) {
      for (const extra of params.existingRows.slice(prepared.records.length)) {
        await tx.contrat.updateMany({
          where: { reservation_id: extra.id },
          data: { reservation_id: primaryReservationId },
        });
        await tx.facture.updateMany({
          where: { reservation_id: extra.id },
          data: { reservation_id: primaryReservationId },
        });
        await tx.reservation.delete({ where: { id: extra.id } });
      }
    }

    return synced;
  });

  return {
    conflict: null,
    reservations,
    createdCount: Math.max(0, prepared.records.length - params.existingRows.length),
    updatedCount: Math.min(prepared.records.length, params.existingRows.length),
  };
};

const toUnix = (value: Date | string) => new Date(value).getTime();

const isSameStayIdentity = (
  left: Pick<{ hote_nom: string; date_entree: Date | string; date_sortie: Date | string }, "hote_nom" | "date_entree" | "date_sortie">,
  right: Pick<{ hote_nom: string; date_entree: Date | string; date_sortie: Date | string }, "hote_nom" | "date_entree" | "date_sortie">
) =>
  normalizeTextKey(left.hote_nom) === normalizeTextKey(right.hote_nom) &&
  toUnix(left.date_entree) === toUnix(right.date_entree) &&
  toUnix(left.date_sortie) === toUnix(right.date_sortie);

const IMPORT_JSON_KEYS = {
  hote_nom: normalizeTextKey("hote"),
  telephone: normalizeTextKey("telephone"),
  email: normalizeTextKey("email"),
  date_entree: normalizeTextKey("date entree"),
  date_sortie: normalizeTextKey("date sortie"),
  nb_adultes: normalizeTextKey("nb adultes"),
  prix_par_nuit: normalizeTextKey("prix par nuit"),
  prix_total: normalizeTextKey("prix total"),
  source_paiement: normalizeTextKey("source"),
  commentaire: normalizeTextKey("commentaire"),
  gite_abbreviation: normalizeTextKey("gite"),
} as const;

const GROUPED_GITE_KEYS = new Set([
  IMPORT_JSON_KEYS.gite_abbreviation,
  normalizeTextKey("gîte"),
  normalizeTextKey("abbreviation"),
  normalizeTextKey("abreviation"),
  normalizeTextKey("prefixe"),
  normalizeTextKey("codegite"),
]);

const IMPORT_DEFAULT_COLUMN_LABELS: Record<string, string> = {
  [IMPORT_JSON_KEYS.hote_nom]: "Hôte",
  [IMPORT_JSON_KEYS.telephone]: "Téléphone",
  [IMPORT_JSON_KEYS.email]: "Email",
  [IMPORT_JSON_KEYS.date_entree]: "Date entrée",
  [IMPORT_JSON_KEYS.date_sortie]: "Date sortie",
  [IMPORT_JSON_KEYS.nb_adultes]: "Nb adultes",
  [IMPORT_JSON_KEYS.prix_par_nuit]: "Prix par nuit",
  [IMPORT_JSON_KEYS.prix_total]: "Prix total",
  [IMPORT_JSON_KEYS.source_paiement]: "Source paiement",
  [IMPORT_JSON_KEYS.commentaire]: "Commentaire",
  [IMPORT_JSON_KEYS.gite_abbreviation]: "Gîte",
};

const registerColumnLabel = (labels: Record<string, string>, normalizedKey: string, rawLabel: string) => {
  if (!normalizedKey) return;
  if (labels[normalizedKey]) return;
  const trimmed = rawLabel.trim();
  labels[normalizedKey] = trimmed.length > 0 ? trimmed : normalizedKey;
};

const toNormalizedImportRow = (source: Record<string, unknown>, columnLabels: Record<string, string>) => {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = normalizeTextKey(key);
    if (!normalizedKey) continue;
    data[normalizedKey] = value;
    registerColumnLabel(columnLabels, normalizedKey, key);
  }
  return data;
};

const inferArchiveSourceIndex = (row: unknown[]) => {
  for (let index = row.length - 1; index >= 3; index -= 1) {
    if (normalizeReservationSource(row[index])) return index;
  }

  if (row.length >= 9) {
    const lastIndex = row.length - 1;
    const last = row[lastIndex];
    const beforeLast = row[lastIndex - 1];
    if (typeof last === "string" && typeof beforeLast === "string") return lastIndex - 1;
    if (typeof last === "string") return lastIndex;
    if (typeof beforeLast === "string") return lastIndex - 1;
  }

  if (row.length === 8) {
    return 7;
  }

  return -1;
};

const buildArchiveIndexedRow = (
  row: unknown[],
  groupedGite: string | null,
  columnLabels: Record<string, string>
): Record<string, unknown> => {
  const sourceIndex = inferArchiveSourceIndex(row);
  const nbAdultesIndex = sourceIndex >= 3 ? sourceIndex - 3 : 5;
  const prixParNuitIndex = sourceIndex >= 2 ? sourceIndex - 2 : 6;
  const prixTotalIndex = sourceIndex >= 1 ? sourceIndex - 1 : 7;
  for (const [key, label] of Object.entries(IMPORT_DEFAULT_COLUMN_LABELS)) {
    registerColumnLabel(columnLabels, key, label);
  }
  const data: Record<string, unknown> = {
    [IMPORT_JSON_KEYS.hote_nom]: row[0],
    [IMPORT_JSON_KEYS.date_entree]: row[1],
    [IMPORT_JSON_KEYS.date_sortie]: row[2],
    [IMPORT_JSON_KEYS.nb_adultes]: row[nbAdultesIndex],
    [IMPORT_JSON_KEYS.prix_par_nuit]: row[prixParNuitIndex],
    [IMPORT_JSON_KEYS.prix_total]: row[prixTotalIndex],
    [IMPORT_JSON_KEYS.source_paiement]: sourceIndex >= 0 ? row[sourceIndex] : undefined,
  };

  if (groupedGite && groupedGite.trim().length > 0) {
    data[IMPORT_JSON_KEYS.gite_abbreviation] = groupedGite;
  }
  const commentaireIndex = sourceIndex >= 0 ? sourceIndex + 1 : 8;
  if (row[commentaireIndex] !== undefined) {
    data[IMPORT_JSON_KEYS.commentaire] = row[commentaireIndex];
  }
  return data;
};

const parseMoney = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const normalized = text.replace(/\s/g, "").replace(/€/g, "").replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseInteger = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
};

const parseBoolean = (value: unknown, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return fallback;
  const normalized = normalizeTextKey(value);
  if (["oui", "true", "1", "declare", "declared"].includes(normalized)) return true;
  if (["non", "false", "0", "nondeclare", "undeclared"].includes(normalized)) return false;
  return fallback;
};

const parseCsvLine = (line: string, delimiter: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
};

const parseCsvRows = (content: string, delimiter?: string): ParsedImportRaw => {
  const lines = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("Le CSV doit contenir un en-tête et au moins une ligne.");
  }

  const detectedDelimiter =
    delimiter ??
    (() => {
      const header = lines[0] ?? "";
      const semicolons = (header.match(/;/g) ?? []).length;
      const commas = (header.match(/,/g) ?? []).length;
      return semicolons >= commas ? ";" : ",";
    })();

  const rawHeaders = parseCsvLine(lines[0], detectedDelimiter);
  const headers = rawHeaders.map((header, idx) => normalizeTextKey(header) || `column${idx + 1}`);
  const columnLabels: Record<string, string> = {};
  headers.forEach((header, idx) => {
    registerColumnLabel(columnLabels, header, rawHeaders[idx] ?? "");
  });

  const rows: ImportRawRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i], detectedDelimiter);
    const data: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      data[header] = values[idx] ?? "";
    });
    rows.push({ index: i + 1, data });
  }

  return { rows, columnLabels };
};

const parseJsonRows = (content: string): ParsedImportRaw => {
  const parsed = JSON.parse(content);
  const columnLabels: Record<string, string> = { ...IMPORT_DEFAULT_COLUMN_LABELS };
  const rows = Array.isArray(parsed)
    ? (parsed as unknown[])
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).rows)
      ? ((parsed as any).rows as unknown[])
      : null;

  if (rows) {
    return {
      rows: rows.map((row, idx) => {
        if (Array.isArray(row)) {
          return { index: idx + 1, data: buildArchiveIndexedRow(row, null, columnLabels) };
        }

        const source = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
        return { index: idx + 1, data: toNormalizedImportRow(source, columnLabels) };
      }),
      columnLabels,
    };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const groupedRows: ImportRawRow[] = [];
    let index = 1;

    for (const [groupedGite, groupRows] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(groupRows)) continue;

      for (const row of groupRows) {
        let data: Record<string, unknown>;
        if (Array.isArray(row)) {
          data = buildArchiveIndexedRow(row, groupedGite, columnLabels);
        } else if (row && typeof row === "object") {
          data = toNormalizedImportRow(row as Record<string, unknown>, columnLabels);
          const hasGiteKey = [...GROUPED_GITE_KEYS].some((key) => data[key] !== undefined);
          if (!hasGiteKey && groupedGite.trim().length > 0) {
            data[IMPORT_JSON_KEYS.gite_abbreviation] = groupedGite;
            registerColumnLabel(columnLabels, IMPORT_JSON_KEYS.gite_abbreviation, "Gîte");
          }
        } else {
          data = {};
        }

        groupedRows.push({ index, data });
        index += 1;
      }
    }

    if (groupedRows.length > 0) {
      return { rows: groupedRows, columnLabels };
    }
  }

  throw new Error(
    "Le JSON doit être un tableau d'objets, un objet avec une clé rows, ou un objet d'archives groupées par gîte."
  );
};

const pickRawField = (row: Record<string, unknown>, aliases: string[]) => {
  for (const alias of aliases) {
    const key = normalizeTextKey(alias);
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
};

const importFieldAliases = {
  hote_nom: ["nom de l'hote", "nom hote", "hote", "host", "nom", "locataire", "locataire_nom"],
  telephone: ["telephone", "téléphone", "tel", "numero", "numero de telephone", "portable", "mobile", "phone"],
  email: ["email", "e-mail", "mail", "courriel", "locataire_email"],
  date_entree: ["date entree", "date d'entree", "entree", "checkin", "date_arrivee", "arrivee"],
  date_sortie: ["date sortie", "sortie", "checkout", "date_depart", "depart"],
  nb_adultes: ["nb adultes", "adultes", "adults", "nombre adultes"],
  prix_par_nuit: ["prix par nuit", "prix_nuit", "prixnuit", "nightly", "nightly rate"],
  prix_total: ["prix total", "total", "totalprice", "montant total"],
  source_paiement: ["source", "source paiement", "source/paiement", "source_paiement", "paiement", "payment"],
  commentaire: ["commentaire", "comment", "note", "notes"],
  gite_abbreviation: ["gite", "gîte", "abreviation", "abbreviation", "prefixe", "codegite"],
  frais_optionnels_montant: ["frais optionnels", "frais", "optional fees", "frais_montant"],
  frais_optionnels_libelle: ["frais libelle", "libelle frais", "fee label"],
  frais_optionnels_declares: ["declare", "declared", "frais declares", "statut declare"],
} as const;

type ImportFieldKey = keyof typeof importFieldAliases;

const IMPORT_REQUIRED_FIELDS = ["hote_nom", "date_entree", "date_sortie"] as const satisfies ImportFieldKey[];

const IMPORT_FIELD_LABELS: Record<ImportFieldKey, string> = {
  hote_nom: "Nom de l'hôte",
  telephone: "Téléphone",
  email: "Email",
  date_entree: "Date d'entrée",
  date_sortie: "Date de sortie",
  nb_adultes: "Nombre d'adultes",
  prix_par_nuit: "Prix par nuit",
  prix_total: "Prix total",
  source_paiement: "Source de paiement",
  commentaire: "Commentaire",
  gite_abbreviation: "Abréviation gîte",
  frais_optionnels_montant: "Montant frais optionnels",
  frais_optionnels_libelle: "Libellé frais optionnels",
  frais_optionnels_declares: "Frais optionnels déclarés",
};

const resolveImportColumnMap = (
  rows: ImportRawRow[],
  requestedMap: Record<string, string> | undefined
): {
  detectedColumns: string[];
  appliedColumnMap: Partial<Record<ImportFieldKey, string>>;
  missingRequiredFields: ImportFieldKey[];
  issues: ImportIssue[];
} => {
  const detectedColumnsSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (key) detectedColumnsSet.add(key);
    }
  }

  const detectedColumns = [...detectedColumnsSet].sort((left, right) => left.localeCompare(right));
  const appliedColumnMap: Partial<Record<ImportFieldKey, string>> = {};
  const issues: ImportIssue[] = [];

  for (const [rawField, rawColumn] of Object.entries(requestedMap ?? {})) {
    if (!(rawField in importFieldAliases)) continue;
    const field = rawField as ImportFieldKey;
    const normalizedColumn = normalizeTextKey(String(rawColumn));
    if (!normalizedColumn) continue;
    if (!detectedColumnsSet.has(normalizedColumn)) {
      issues.push({
        row: 0,
        message: `Colonne introuvable pour "${IMPORT_FIELD_LABELS[field]}": "${rawColumn}".`,
      });
      continue;
    }
    appliedColumnMap[field] = normalizedColumn;
  }

  for (const [field, aliases] of Object.entries(importFieldAliases) as [ImportFieldKey, readonly string[]][]) {
    if (appliedColumnMap[field]) continue;
    const detected = aliases.map((alias) => normalizeTextKey(alias)).find((alias) => detectedColumnsSet.has(alias));
    if (detected) {
      appliedColumnMap[field] = detected;
    }
  }

  const missingRequiredFields = IMPORT_REQUIRED_FIELDS.filter((field) => !appliedColumnMap[field]);
  for (const field of missingRequiredFields) {
    issues.push({
      row: 0,
      message: `Colonne manquante pour le champ obligatoire "${IMPORT_FIELD_LABELS[field]}".`,
    });
  }

  return { detectedColumns, appliedColumnMap, missingRequiredFields, issues };
};

const pickImportField = (
  row: Record<string, unknown>,
  field: ImportFieldKey,
  columnMap: Partial<Record<ImportFieldKey, string>>
) => {
  const mappedColumn = columnMap[field];
  if (mappedColumn) {
    return row[mappedColumn];
  }
  return pickRawField(row, [...importFieldAliases[field]]);
};

const parseImportRows = (
  rows: ImportRawRow[],
  options?: { columnMap?: Partial<Record<ImportFieldKey, string>> }
): { parsedRows: ParsedImportRow[]; issues: ImportIssue[] } => {
  const parsedRows: ParsedImportRow[] = [];
  const issues: ImportIssue[] = [];
  const columnMap = options?.columnMap ?? {};

  for (const row of rows) {
    const hoteRaw = pickImportField(row.data, "hote_nom", columnMap);
    const entreeRaw = pickImportField(row.data, "date_entree", columnMap);
    const sortieRaw = pickImportField(row.data, "date_sortie", columnMap);

    const hostNameRaw = String(hoteRaw ?? "").trim();
    const hote_nom = hostNameRaw || `Hote inconnu (ligne ${row.index})`;
    const date_entree = String(entreeRaw ?? "").trim();
    const date_sortie = String(sortieRaw ?? "").trim();

    if (!hostNameRaw) {
      issues.push({
        row: row.index,
        message: `Nom de l'hote manquant, remplace par "${hote_nom}".`,
        blocking: false,
      });
    }
    if (!date_entree || !date_sortie) {
      issues.push({ row: row.index, message: "Dates d'entrée/sortie manquantes." });
      continue;
    }

    let prix_par_nuit = parseMoney(pickImportField(row.data, "prix_par_nuit", columnMap));
    let prix_total = parseMoney(pickImportField(row.data, "prix_total", columnMap));
    if (prix_par_nuit === undefined && prix_total === undefined) {
      prix_par_nuit = 0;
      prix_total = 0;
      issues.push({
        row: row.index,
        message: "Prix par nuit et prix total manquants, remplaces par \"0\".",
        blocking: false,
      });
    }

    const rawSource = pickImportField(row.data, "source_paiement", columnMap);
    const sourceText = typeof rawSource === "string" ? rawSource.trim() : "";
    const normalizedSource = normalizeReservationSource(rawSource);
    let commentaire = String(pickImportField(row.data, "commentaire", columnMap) ?? "").trim() || null;
    const source_paiement = normalizedSource ?? DEFAULT_RESERVATION_SOURCE;

    if (sourceText.length > 0 && !normalizedSource) {
      const movedToComment = !commentaire;
      if (movedToComment) {
        commentaire = sourceText;
      }
      issues.push({
        row: row.index,
        message: movedToComment
          ? `Source "${sourceText}" non autorisee: remplacee par "${DEFAULT_RESERVATION_SOURCE}" et deplacee dans commentaire.`
          : `Source "${sourceText}" non autorisee: remplacee par "${DEFAULT_RESERVATION_SOURCE}".`,
        blocking: false,
      });
    }

    const parsed: ParsedImportRow = {
      rowNumber: row.index,
      hote_nom,
      telephone: String(pickImportField(row.data, "telephone", columnMap) ?? "").trim() || null,
      email: String(pickImportField(row.data, "email", columnMap) ?? "").trim() || null,
      date_entree,
      date_sortie,
      nb_adultes: parseInteger(pickImportField(row.data, "nb_adultes", columnMap), 0),
      prix_par_nuit,
      prix_total,
      source_paiement,
      commentaire,
      frais_optionnels_montant: parseMoney(pickImportField(row.data, "frais_optionnels_montant", columnMap)) ?? 0,
      frais_optionnels_libelle:
        String(pickImportField(row.data, "frais_optionnels_libelle", columnMap) ?? "").trim() || null,
      frais_optionnels_declares: parseBoolean(pickImportField(row.data, "frais_optionnels_declares", columnMap), false),
      gite_abbreviation:
        String(pickImportField(row.data, "gite_abbreviation", columnMap) ?? "").trim().toUpperCase() || null,
    };

    parsedRows.push(parsed);
  }

  return { parsedRows, issues };
};

const parseImportContent = (payload: z.infer<typeof importPayloadSchema>) => {
  const parsedRaw = payload.format === "csv" ? parseCsvRows(payload.content, payload.delimiter) : parseJsonRows(payload.content);
  const { detectedColumns, appliedColumnMap, missingRequiredFields, issues: mappingIssues } = resolveImportColumnMap(
    parsedRaw.rows,
    payload.column_map
  );
  const { parsedRows, issues } = parseImportRows(parsedRaw.rows, { columnMap: appliedColumnMap });

  return {
    parsedRows,
    issues: [...mappingIssues, ...issues],
    detectedColumns,
    columnLabels: parsedRaw.columnLabels,
    appliedColumnMap,
    missingRequiredFields,
  };
};

router.get("/years", async (_req, res, next) => {
  try {
    const rows = await prisma.reservation.findMany({
      select: { date_entree: true },
    });

    const years = new Set<number>();
    for (const row of rows) {
      const parsed = new Date(row.date_entree);
      if (!Number.isNaN(parsed.getTime())) {
        years.add(parsed.getUTCFullYear());
      }
    }

    res.json([...years].sort((a, b) => b - a));
  } catch (err) {
    next(err);
  }
});

router.get("/recent-imports/count", async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - DAY_MS);
    const count = await prisma.reservation.count({
      where: {
        origin_system: { in: ["ical", "pump"] },
        createdAt: { gte: since },
      },
    });

    res.json({ count, since: since.toISOString() });
  } catch (err) {
    next(err);
  }
});

router.get("/airbnb-calendar-refresh/:jobId", async (req, res, next) => {
  try {
    const status = getAirbnbCalendarRefreshJobStatus(req.params.jobId);
    if (!status) {
      return res.status(404).json({ error: "Job de rafraîchissement Airbnb introuvable." });
    }

    return res.json(status);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const giteId = typeof req.query.giteId === "string" ? req.query.giteId : undefined;
    const yearRaw = typeof req.query.year === "string" ? Number(req.query.year) : undefined;
    const monthRaw = typeof req.query.month === "string" ? Number(req.query.month) : undefined;

    const where: any = {};

    if (giteId) {
      where.gite_id = giteId;
    }

    if (Number.isFinite(yearRaw)) {
      const year = Number(yearRaw);
      const month = Number.isFinite(monthRaw) && monthRaw && monthRaw >= 1 && monthRaw <= 12 ? Number(monthRaw) : null;
      const from = month ? makeUtcDate(year, month, 1) : makeUtcDate(year, 1, 1);
      const to = month ? makeUtcDate(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) : makeUtcDate(year + 1, 1, 1);
      where.date_entree = {
        gte: from,
        lt: to,
      };
    }

    const reservations = await prisma.reservation.findMany({
      where,
      include: {
        gite: { select: reservationGiteSelect },
        placeholder: { select: reservationPlaceholderSelect },
      },
      orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }],
    });

    const filtered = q
      ? reservations.filter((reservation) => {
          const entree = formatDateFr(reservation.date_entree).toLowerCase();
          const sortie = formatDateFr(reservation.date_sortie).toLowerCase();
          const source = (reservation.source_paiement ?? "").toLowerCase();
          const commentaire = (reservation.commentaire ?? "").toLowerCase();
          const telephone = (reservation.telephone ?? "").toLowerCase();
          const email = (reservation.email ?? "").toLowerCase();
          return (
            entree.includes(q) ||
            sortie.includes(q) ||
            reservation.hote_nom.toLowerCase().includes(q) ||
            telephone.includes(q) ||
            email.includes(q) ||
            source.includes(q) ||
            commentaire.includes(q)
          );
        })
      : reservations;

    const hydratedReservations = await attachLinkedContractsToReservations(
      filtered.map(hydrateReservation),
    );
    const smartlifeConfig = readSmartlifeAutomationConfig(
      buildDefaultSmartlifeAutomationConfig(),
    );
    const liveEnergyByReservationId = hasSmartlifeCredentials(smartlifeConfig)
      ? await loadLiveReservationEnergySummaries(
          smartlifeConfig,
          hydratedReservations,
        )
      : new Map();

    res.json(
      hydratedReservations.map((reservation) => ({
        ...reservation,
        ...(liveEnergyByReservationId.get(reservation.id) ?? {}),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/monthly-energy", async (req, res, next) => {
  try {
    const year = typeof req.query.year === "string" ? Number(req.query.year) : NaN;
    const month = typeof req.query.month === "string" ? Number(req.query.month) : NaN;
    const giteId = typeof req.query.giteId === "string" ? req.query.giteId.trim() : "";

    if (!Number.isFinite(year) || year <= 0) {
      return res.status(400).json({ error: "Paramètre year invalide." });
    }

    const smartlifeConfig = readSmartlifeAutomationConfig(
      buildDefaultSmartlifeAutomationConfig(),
    );
    const summaries = await getGiteMonthlyEnergySummaries({
      year: Number(year),
      month: Number.isFinite(month) && month >= 1 && month <= 12 ? Number(month) : null,
      gite_id: giteId || null,
      config: hasSmartlifeCredentials(smartlifeConfig) ? smartlifeConfig : null,
    });

    return res.json(summaries);
  } catch (err) {
    next(err);
  }
});

router.get("/monthly-energy/eligible-gites", async (_req, res, next) => {
  try {
    const smartlifeConfig = readSmartlifeAutomationConfig(
      buildDefaultSmartlifeAutomationConfig(),
    );
    if (!hasSmartlifeCredentials(smartlifeConfig)) {
      return res.json([] as string[]);
    }

    return res.json(getEnabledMonthlyEnergyGiteIds(smartlifeConfig));
  } catch (err) {
    next(err);
  }
});

router.post("/monthly-energy/start", async (req, res, next) => {
  try {
    const smartlifeConfig = readSmartlifeAutomationConfig(
      buildDefaultSmartlifeAutomationConfig(),
    );
    if (!hasSmartlifeCredentials(smartlifeConfig)) {
      return res.status(400).json({
        error: "Le suivi Smart Life n'est pas configuré.",
      });
    }

    const payload = monthlyEnergyStartSchema.parse(req.body);
    const result = await startSmartlifeCurrentMonthForGite(smartlifeConfig, {
      gite_id: payload.gite_id,
    });

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/prefill/:id", async (req, res, next) => {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      include: {
        gite: {
          select: {
            ...reservationGiteSelect,
            heure_arrivee_defaut: true,
            heure_depart_defaut: true,
          },
        },
        placeholder: { select: reservationPlaceholderSelect },
      },
    });
    if (!reservation) return res.status(404).json({ error: "Réservation introuvable" });

    if (!reservation.gite_id) {
      return res.status(400).json({ error: "La réservation doit être associée à un gîte pour préremplir un document." });
    }

    return res.json(await hydrateReservationWithLinkedContract(reservation));
  } catch (err) {
    next(err);
  }
});

router.get("/placeholders", async (_req, res, next) => {
  try {
    const placeholders = await prisma.reservationPlaceholder.findMany({
      where: {
        reservations: {
          some: {},
        },
      },
      include: {
        _count: { select: { reservations: true } },
      },
      orderBy: { abbreviation: "asc" },
    });

    res.json(
      placeholders.map((placeholder) => ({
        id: placeholder.id,
        abbreviation: placeholder.abbreviation,
        label: placeholder.label,
        reservations_count: placeholder._count.reservations,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      include: {
        gite: { select: reservationGiteSelect },
        placeholder: { select: reservationPlaceholderSelect },
      },
    });

    if (!reservation) {
      return res.status(404).json({ error: "Réservation introuvable" });
    }

    return res.json(await hydrateReservationWithLinkedContract(reservation));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/energy/start", async (req, res, next) => {
  try {
    const smartlifeConfig = readSmartlifeAutomationConfig(
      buildDefaultSmartlifeAutomationConfig(),
    );
    if (!hasSmartlifeCredentials(smartlifeConfig)) {
      return res.status(400).json({
        error: "Le suivi Smart Life n'est pas configuré.",
      });
    }

    const targetReservation = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        stay_group_id: true,
      },
    });
    if (!targetReservation) {
      return res.status(404).json({ error: "Réservation introuvable" });
    }

    const result = await startManualReservationEnergyTracking(
      smartlifeConfig,
      targetReservation.id,
    );
    const stayGroupId = targetReservation.stay_group_id ?? targetReservation.id;
    const reservations = await prisma.reservation.findMany({
      where: {
        OR: [{ id: targetReservation.id }, { stay_group_id: stayGroupId }],
      },
      include: {
        gite: { select: reservationGiteSelect },
        placeholder: { select: reservationPlaceholderSelect },
      },
      orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    const hydratedReservations = reservations.map(hydrateReservation);
    const liveEnergyByReservationId = await loadLiveReservationEnergySummaries(
      smartlifeConfig,
      hydratedReservations,
    );

    return res.json({
      updated_reservations: hydratedReservations.map((reservation) => ({
        ...reservation,
        ...(liveEnergyByReservationId.get(reservation.id) ?? {}),
      })),
      messages: result.messages,
      errors: result.errors,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = reservationPayloadSchema.parse(req.body);
    const association = normalizeAssociation(payload);
    await ensureAssociationExists(association);
    const prepared = buildReservationSegmentRecords(
      payload,
      association,
      buildReservationOriginData({ originSystem: "app", exportToIcal: true }),
      crypto.randomUUID(),
    );
    const conflictById = new Map<string, any>();

    for (const { segment } of prepared.records) {
      const conflicts = await findConflicts({
        association,
        dateEntree: segment.dateEntree,
        dateSortie: segment.dateSortie,
      });
      for (const conflict of conflicts) {
        conflictById.set(conflict.id, conflict);
      }
    }

    if (conflictById.size > 0) {
      return res.status(409).json(buildConflictPayload([...conflictById.values()]));
    }

    const createdReservations = await prisma.$transaction(
      prepared.records.map(({ data }) => {
        return prisma.reservation.create({
          data,
          include: {
            gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
            placeholder: { select: { id: true, abbreviation: true, label: true } },
          },
        });
      })
    );

    const hydratedCreated = await attachLinkedContractsToReservations(
      createdReservations.map(hydrateReservation),
    );
    const airbnbCalendarRefresh = await buildAirbnbCalendarRefreshCreateResult(association);
    if (hydratedCreated.length > 1) {
      return res.status(201).json({
        ...hydratedCreated[0],
        created_reservations: hydratedCreated,
        airbnb_calendar_refresh: airbnbCalendarRefresh,
      });
    }

    return res.status(201).json({
      ...hydratedCreated[0],
      airbnb_calendar_refresh: airbnbCalendarRefresh,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/integrations/what-today", requireIntegrationToken, async (req, res, next) => {
  try {
    const payload = integrationReservationBatchSchema.parse(req.body);
    const seenOriginReferences = new Set<string>();
    const results: any[] = [];
    let createdCount = 0;
    let updatedCount = 0;

    for (const item of payload.reservations) {
      if (seenOriginReferences.has(item.origin_reference)) {
        return res.status(400).json({ error: `Référence externe dupliquée: ${item.origin_reference}` });
      }
      seenOriginReferences.add(item.origin_reference);

      const association = normalizeAssociation(item);
      await ensureAssociationExists(association);
      const existingRows = await loadIntegratedReservationRows(item.origin_reference);
      const outcome = await syncIntegratedReservationRows({
        payload: item,
        association,
        existingRows,
      });

      if (outcome.conflict) {
        return res.status(409).json({
          ...outcome.conflict,
          origin_reference: item.origin_reference,
        });
      }

      createdCount += outcome.createdCount;
      updatedCount += outcome.updatedCount;
      results.push(...(outcome.reservations ?? []).map(hydrateReservation));
    }

    return res.status(200).json({
      created_count: createdCount,
      updated_count: updatedCount,
      reservations: results,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/split", async (req, res, next) => {
  try {
    const existing = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      include: {
        gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
        placeholder: { select: { id: true, abbreviation: true, label: true } },
      },
    });
    if (!existing) return res.status(404).json({ error: "Réservation introuvable" });

    if (!existing.gite_id && !existing.placeholder_id) {
      return res.status(400).json({ error: "La réservation ne peut pas être scindée sans gîte ou placeholder." });
    }

    const segments = splitReservationByMonth(existing.date_entree, existing.date_sortie);
    if (segments.length <= 1) {
      return res.status(400).json({ error: "La réservation ne chevauche pas plusieurs mois." });
    }

    const association: ReservationAssociation = {
      gite_id: existing.gite_id ?? null,
      placeholder_id: existing.placeholder_id ?? null,
    };

    const conflictById = new Map<string, any>();
    for (const segment of segments) {
      const conflicts = await findConflicts({
        association,
        dateEntree: segment.dateEntree,
        dateSortie: segment.dateSortie,
        excludeId: existing.id,
      });
      for (const conflict of conflicts) {
        conflictById.set(conflict.id, conflict);
      }
    }

    if (conflictById.size > 0) {
      return res.status(409).json(buildConflictPayload([...conflictById.values()]));
    }

    const priceTotalsBySegment = allocateAmountByNights(toNumber(existing.prix_total), segments);
    const optionalFeesBySegment = allocateAmountByNights(toNumber(existing.frais_optionnels_montant), segments);
    const remiseBySegment = allocateAmountByNights(toNumber(existing.remise_montant), segments);
    const existingCommissionMode = normalizeReservationCommissionMode(existing.commission_channel_mode);
    const existingCommissionValue = sanitizeReservationCommissionValue(
      existing.commission_channel_value,
      existingCommissionMode
    );
    const commissionBySegment =
      existingCommissionMode === "euro"
        ? allocateAmountByNights(round2(existingCommissionValue), segments)
        : segments.map(() => existingCommissionValue);
    const encodedOptions = encodeJsonField(fromJsonString<OptionsInput>(existing.options, {}));

    const createdReservations = await prisma.$transaction(async (tx) => {
      const created: any[] = [];
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const prixTotal = priceTotalsBySegment[index] ?? 0;
        const prixParNuit = segment.nbNuits > 0 ? round2(prixTotal / segment.nbNuits) : 0;

        const createdReservation = await tx.reservation.create({
          data: {
            gite_id: association.gite_id,
            stay_group_id: existing.stay_group_id ?? existing.id,
            placeholder_id: association.placeholder_id,
            origin_system: existing.origin_system,
            origin_reference: existing.origin_reference,
            export_to_ical: existing.export_to_ical,
            airbnb_url: existing.airbnb_url,
            hote_nom: existing.hote_nom,
            telephone: existing.telephone,
            date_entree: segment.dateEntree,
            date_sortie: segment.dateSortie,
            nb_nuits: segment.nbNuits,
            nb_adultes: existing.nb_adultes,
            prix_par_nuit: prixParNuit,
            prix_total: prixTotal,
            source_paiement: existing.source_paiement,
            commentaire: existing.commentaire,
            remise_montant: remiseBySegment[index] ?? 0,
            commission_channel_mode: existingCommissionMode,
            commission_channel_value: commissionBySegment[index] ?? 0,
            frais_optionnels_montant: optionalFeesBySegment[index] ?? 0,
            frais_optionnels_libelle: existing.frais_optionnels_libelle,
            frais_optionnels_declares: existing.frais_optionnels_declares,
            options: encodedOptions,
          },
          include: {
            gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
            placeholder: { select: { id: true, abbreviation: true, label: true } },
          },
        });

        created.push(createdReservation);
      }

      const firstCreatedId = created[0]?.id ?? null;
      if (firstCreatedId) {
        await tx.contrat.updateMany({
          where: { reservation_id: existing.id },
          data: { reservation_id: firstCreatedId },
        });
        await tx.facture.updateMany({
          where: { reservation_id: existing.id },
          data: { reservation_id: firstCreatedId },
        });
      }

      await tx.reservation.delete({
        where: { id: existing.id },
      });

      return created;
    });

    const hydratedCreated = await attachLinkedContractsToReservations(
      createdReservations.map(hydrateReservation),
    );
    return res.status(201).json({
      ...hydratedCreated[0],
      created_reservations: hydratedCreated,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.reservation.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Réservation introuvable" });

    const payload = reservationPayloadSchema.parse(req.body);
    const association = normalizeAssociation(payload);
    await ensureAssociationExists(association);
    const source_paiement = resolveReservationSource(payload.source_paiement, { strict: true });

    const computed = computeReservationFields(payload);
    const conflicts = await findConflicts({
      association,
      dateEntree: computed.dateEntree,
      dateSortie: computed.dateSortie,
      excludeId: existing.id,
    });
    if (conflicts.length > 0) {
      return res.status(409).json(buildConflictPayload(conflicts));
    }

    const reservation = await prisma.reservation.update({
      where: { id: existing.id },
      data: {
        gite_id: association.gite_id,
        stay_group_id: existing.stay_group_id ?? existing.id,
        placeholder_id: association.placeholder_id,
        airbnb_url: payload.airbnb_url !== undefined ? payload.airbnb_url ?? null : existing.airbnb_url,
        hote_nom: payload.hote_nom,
        telephone: payload.telephone ?? null,
        email: payload.email ?? null,
        date_entree: computed.dateEntree,
        date_sortie: computed.dateSortie,
        nb_nuits: computed.nbNuits,
        nb_adultes: payload.nb_adultes,
        prix_par_nuit: computed.prixParNuit,
        prix_total: computed.prixTotal,
        source_paiement,
        commentaire: payload.commentaire ?? null,
        remise_montant: sanitizeReservationAmount(payload.remise_montant ?? 0),
        commission_channel_mode: normalizeReservationCommissionMode(payload.commission_channel_mode),
        commission_channel_value: sanitizeReservationCommissionValue(
          payload.commission_channel_value ?? 0,
          normalizeReservationCommissionMode(payload.commission_channel_mode)
        ),
        frais_optionnels_montant: round2(payload.frais_optionnels_montant ?? 0),
        frais_optionnels_libelle: payload.frais_optionnels_libelle ?? null,
        frais_optionnels_declares: payload.frais_optionnels_declares ?? false,
        options: encodeJsonField(payload.options ?? {}),
      },
      include: {
        gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
        placeholder: { select: { id: true, abbreviation: true, label: true } },
      },
    });

    return res.json(await hydrateReservationWithLinkedContract(reservation));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.reservation.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Réservation introuvable" });

    await prisma.reservation.delete({ where: { id: existing.id } });
    return res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/placeholders/:id/assign", async (req, res, next) => {
  try {
    const placeholderId = req.params.id;
    const { gite_id } = assignPlaceholderSchema.parse(req.body);

    const [gite, placeholder, placeholderReservations, targetReservations] = await Promise.all([
      prisma.gite.findUnique({ where: { id: gite_id }, select: { id: true, nom: true } }),
      prisma.reservationPlaceholder.findUnique({ where: { id: placeholderId } }),
      prisma.reservation.findMany({
        where: { placeholder_id: placeholderId },
        orderBy: { date_entree: "asc" },
      }),
      prisma.reservation.findMany({
        where: { gite_id },
        orderBy: { date_entree: "asc" },
      }),
    ]);

    if (!gite) return res.status(404).json({ error: "Gîte introuvable" });
    if (!placeholder) return res.status(404).json({ error: "Placeholder introuvable" });

    const conflicts: any[] = [];
    const duplicatePairs: Array<{ moved: any; existing: any }> = [];
    const reservationsToMove: string[] = [];
    const duplicatesToDelete: string[] = [];

    for (const moved of placeholderReservations) {
      const overlapping = targetReservations.filter(
        (existing) => existing.date_entree < moved.date_sortie && existing.date_sortie > moved.date_entree
      );
      if (overlapping.length === 0) {
        reservationsToMove.push(moved.id);
        continue;
      }

      const exactDuplicate = overlapping.find((existing) => isSameStayIdentity(existing, moved));
      const hasNonDuplicateOverlap = overlapping.some((existing) => !isSameStayIdentity(existing, moved));

      if (exactDuplicate && !hasNonDuplicateOverlap) {
        duplicatePairs.push({ moved, existing: exactDuplicate });
        duplicatesToDelete.push(moved.id);
        continue;
      }

      conflicts.push({ moved, existing: overlapping[0] });
    }

    if (conflicts.length > 0) {
      return res.status(409).json({
        error: `Rattachement impossible: des réservations entrent en conflit avec ${gite.nom}.`,
        skipped_duplicates_count: duplicatesToDelete.length,
        conflicts: conflicts.map((conflict) => ({
          moved: {
            id: conflict.moved.id,
            hote_nom: conflict.moved.hote_nom,
            date_entree: conflict.moved.date_entree,
            date_sortie: conflict.moved.date_sortie,
          },
          existing: {
            id: conflict.existing.id,
            hote_nom: conflict.existing.hote_nom,
            date_entree: conflict.existing.date_entree,
            date_sortie: conflict.existing.date_sortie,
          },
        })),
      });
    }

    await prisma.$transaction(async (tx) => {
      if (reservationsToMove.length > 0) {
        await tx.reservation.updateMany({
          where: { id: { in: reservationsToMove } },
          data: {
            gite_id,
            placeholder_id: null,
          },
        });
      }

      if (duplicatesToDelete.length > 0) {
        await tx.reservation.deleteMany({
          where: { id: { in: duplicatesToDelete } },
        });
      }

      await tx.reservationPlaceholder.delete({ where: { id: placeholderId } });
    });

    res.status(200).json({
      moved_count: reservationsToMove.length,
      deduplicated_count: duplicatePairs.length,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/import/preview", async (req, res, next) => {
  try {
    const payload = importPayloadSchema.parse(req.body);
    const { parsedRows, issues, detectedColumns, columnLabels, appliedColumnMap, missingRequiredFields } =
      parseImportContent(payload);

    const gites = await prisma.gite.findMany({
      select: { id: true, nom: true, prefixe_contrat: true },
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
    });
    const byPrefix = new Map(gites.map((gite) => [gite.prefixe_contrat.toUpperCase(), gite]));

    const abbreviationStats = new Map<string, { abbreviation: string; count: number }>();
    let withoutGiteCount = 0;

    for (const row of parsedRows) {
      if (!row.gite_abbreviation) {
        withoutGiteCount += 1;
        continue;
      }
      const current = abbreviationStats.get(row.gite_abbreviation) ?? {
        abbreviation: row.gite_abbreviation,
        count: 0,
      };
      current.count += 1;
      abbreviationStats.set(row.gite_abbreviation, current);
    }

    const abbreviations = [...abbreviationStats.values()]
      .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation))
      .map((entry) => {
        const match = byPrefix.get(entry.abbreviation);
        return {
          ...entry,
          matched_gite_id: match?.id ?? null,
          matched_gite_nom: match?.nom ?? null,
          matched_gite_prefixe: match?.prefixe_contrat ?? null,
        };
      });

    const unknown = abbreviations.filter((entry) => !entry.matched_gite_id).map((entry) => entry.abbreviation);

    res.json({
      rows_count: parsedRows.length,
      issues,
      abbreviations,
      unknown_abbreviations: unknown,
      rows_without_gite: withoutGiteCount,
      detected_columns: detectedColumns.map((key) => ({
        key,
        label: columnLabels[key] ?? key,
      })),
      applied_column_map: appliedColumnMap,
      missing_required_fields: missingRequiredFields,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/import", async (req, res, next) => {
  try {
    const payload = importPayloadSchema.parse(req.body);
    const { parsedRows, issues } = parseImportContent(payload);
    const blockingIssues = issues.filter((issue) => issue.blocking !== false);
    const nonBlockingIssues = issues.filter((issue) => issue.blocking === false);
    if (blockingIssues.length > 0) {
      return res.status(400).json({ error: "Import invalide", issues: blockingIssues });
    }

    const fallbackGiteId = payload.gite_id ?? null;
    if (fallbackGiteId) {
      const fallbackGite = await prisma.gite.findUnique({ where: { id: fallbackGiteId }, select: { id: true } });
      if (!fallbackGite) {
        return res.status(404).json({ error: "Gîte de destination introuvable." });
      }
    }

    const gites = await prisma.gite.findMany({
      select: { id: true, prefixe_contrat: true },
    });
    const giteByPrefix = new Map(gites.map((gite) => [gite.prefixe_contrat.toUpperCase(), gite.id]));
    const knownGiteIds = new Set(gites.map((gite) => gite.id));

    const normalizedMap = new Map<string, string>();
    for (const [abbr, giteId] of Object.entries(payload.abbreviation_map ?? {})) {
      normalizedMap.set(abbr.toUpperCase(), giteId);
    }

    const placeholders = await prisma.reservationPlaceholder.findMany({
      select: { id: true, abbreviation: true },
    });
    const placeholderByAbbr = new Map(placeholders.map((placeholder) => [placeholder.abbreviation, placeholder.id]));

    const rowsToCreate: Array<{ data: any; rowNumber: number }> = [];
    const importIssues: ImportIssue[] = [];
    const intervalsBySlot = new Map<string, Array<{ from: Date; to: Date; rowNumber: number; hote_nom: string }>>();

    const ensurePlaceholder = async (abbreviation: string) => {
      const existingId = placeholderByAbbr.get(abbreviation);
      if (existingId) return existingId;

      const created = await prisma.reservationPlaceholder.upsert({
        where: { abbreviation },
        create: {
          abbreviation,
          label: `Import ${abbreviation}`,
        },
        update: {},
      });

      placeholderByAbbr.set(abbreviation, created.id);
      return created.id;
    };

    for (const row of parsedRows) {
      const sourceAbbreviation = row.gite_abbreviation?.toUpperCase() ?? null;
      let association: ReservationAssociation = { gite_id: null, placeholder_id: null };

      if (sourceAbbreviation) {
        const mappedGiteId = normalizedMap.get(sourceAbbreviation) ?? giteByPrefix.get(sourceAbbreviation) ?? null;
        if (mappedGiteId) {
          if (!knownGiteIds.has(mappedGiteId)) {
            importIssues.push({
              row: row.rowNumber,
              message: `Mapping invalide: le gîte ${mappedGiteId} n'existe pas.`,
            });
            continue;
          }
          association = { gite_id: mappedGiteId, placeholder_id: null };
        } else {
          const placeholderId = await ensurePlaceholder(sourceAbbreviation);
          association = { gite_id: null, placeholder_id: placeholderId };
        }
      } else if (fallbackGiteId) {
        association = { gite_id: fallbackGiteId, placeholder_id: null };
      } else {
        importIssues.push({
          row: row.rowNumber,
          message: "Aucun gîte détecté. Choisissez un gîte de destination ou mappez les abréviations.",
        });
        continue;
      }

      let computed: ReservationComputation;
      try {
        computed = computeReservationFields({
          gite_id: association.gite_id,
          placeholder_id: association.placeholder_id,
          hote_nom: row.hote_nom,
          telephone: row.telephone,
          email: row.email,
          date_entree: row.date_entree,
          date_sortie: row.date_sortie,
          nb_adultes: row.nb_adultes,
          prix_par_nuit: row.prix_par_nuit,
          prix_total: row.prix_total,
          source_paiement: row.source_paiement,
          commentaire: row.commentaire,
          remise_montant: 0,
          commission_channel_mode: "euro",
          commission_channel_value: 0,
          frais_optionnels_montant: row.frais_optionnels_montant,
          frais_optionnels_libelle: row.frais_optionnels_libelle,
          frais_optionnels_declares: row.frais_optionnels_declares,
          options: {},
        });
      } catch (err) {
        importIssues.push({
          row: row.rowNumber,
          message: (err as Error).message,
        });
        continue;
      }

      const slotKey = association.gite_id ? `gite:${association.gite_id}` : `placeholder:${association.placeholder_id}`;
      const plannedIntervals = intervalsBySlot.get(slotKey) ?? [];
      const plannedConflict = plannedIntervals.find(
        (entry) => entry.from < computed.dateSortie && entry.to > computed.dateEntree
      );
      if (plannedConflict) {
        importIssues.push({
          row: row.rowNumber,
          message: `Conflit avec la ligne ${plannedConflict.rowNumber} dans le même import.`,
          blocking: false,
        });
        continue;
      }

      const dbConflicts = await findConflicts({
        association,
        dateEntree: computed.dateEntree,
        dateSortie: computed.dateSortie,
      });
      if (dbConflicts.length > 0) {
        const first = dbConflicts[0];
        importIssues.push({
          row: row.rowNumber,
          message: `Chevauchement avec ${first.hote_nom} (${formatDateFr(first.date_entree)} - ${formatDateFr(first.date_sortie)}).`,
          blocking: false,
        });
        continue;
      }

      plannedIntervals.push({
        from: computed.dateEntree,
        to: computed.dateSortie,
        rowNumber: row.rowNumber,
        hote_nom: row.hote_nom,
      });
      intervalsBySlot.set(slotKey, plannedIntervals);

      rowsToCreate.push({
        rowNumber: row.rowNumber,
        data: {
          gite_id: association.gite_id,
          stay_group_id: crypto.randomUUID(),
          placeholder_id: association.placeholder_id,
          ...buildReservationOriginData({
            originSystem: "csv",
            originReference: `${payload.format}-${row.rowNumber}`,
            exportToIcal: false,
          }),
          hote_nom: row.hote_nom,
          telephone: row.telephone,
          email: row.email,
          date_entree: computed.dateEntree,
          date_sortie: computed.dateSortie,
          nb_nuits: computed.nbNuits,
          nb_adultes: row.nb_adultes,
          prix_par_nuit: computed.prixParNuit,
          prix_total: computed.prixTotal,
          source_paiement: row.source_paiement,
          commentaire: row.commentaire,
          remise_montant: 0,
          commission_channel_mode: "euro",
          commission_channel_value: 0,
          frais_optionnels_montant: round2(row.frais_optionnels_montant),
          frais_optionnels_libelle: row.frais_optionnels_libelle,
          frais_optionnels_declares: row.frais_optionnels_declares,
        },
      });
    }

    if (rowsToCreate.length === 0) {
      const blockingImportIssues = importIssues.filter((issue) => issue.blocking !== false);
      if (blockingImportIssues.length > 0 || importIssues.length === 0) {
        return res.status(400).json({
          error: "Import invalide",
          issues: blockingImportIssues.length > 0 ? blockingImportIssues : [{ row: 0, message: "Aucune ligne importable." }],
        });
      }

      return res.status(200).json({
        created_count: 0,
        skipped_count: importIssues.length,
        issues: [...nonBlockingIssues, ...importIssues],
        reservations: [],
      });
    }

    const created = await prisma.$transaction(
      rowsToCreate.map((row) =>
        prisma.reservation.create({
          data: row.data,
          include: {
            gite: { select: { id: true, nom: true, prefixe_contrat: true, ordre: true } },
            placeholder: { select: { id: true, abbreviation: true, label: true } },
          },
        })
      )
    );

    return res.status(201).json({
      created_count: created.length,
      skipped_count: importIssues.length,
      issues: [...nonBlockingIssues, ...importIssues],
      reservations: created.map(hydrateReservation),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

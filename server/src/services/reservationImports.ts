import prisma from "../db/prisma.js";
import { appendImportLog, buildImportLogEntry } from "./importLog.js";
import { listIcalSources, type IcalSourceRow } from "./icalSync.js";
import {
  hasMeaningfulImportedComment,
  isUnknownHostName,
  normalizeImportedComment,
  normalizeImportedHostName,
  toImportedReservationHostName,
} from "../utils/reservationText.js";
import {
  resolveImportedReservationSourceType,
  type ImportedReservationType,
} from "../utils/importedReservationSource.js";
import { buildReservationOriginData, type ReservationOriginSystem } from "../utils/reservationOrigin.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SOURCE = "A définir";

export type ReservationImportPreviewStatus = "new" | "existing" | "existing_updatable" | "conflict" | "unmapped_listing";

export type ReservationImportPreviewItem = {
  id: string;
  listing_id: string;
  gite_id: string | null;
  gite_nom: string | null;
  source_type: string;
  status: ReservationImportPreviewStatus;
  check_in: string;
  check_out: string;
  nights: number;
  hote_nom: string | null;
  prix_total: number | null;
  commentaire: string | null;
  existing_id: string | null;
  conflict_id: string | null;
  update_fields: Array<"hote_nom" | "source_paiement" | "commentaire" | "prix_total">;
};

export type ReservationImportPreview = {
  reservations: ReservationImportPreviewItem[];
  counts: {
    new: number;
    existing: number;
    existing_updatable: number;
    conflict: number;
    unmapped_listing: number;
  };
};

export type ReservationImportResult = ReservationImportPreview & {
  selected_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
};

export type ParsedImportedReservation = {
  id: string;
  listingId: string;
  type: ImportedReservationType;
  checkIn: string;
  checkOut: string;
  nights: number;
  name: string | null;
  payout: number | null;
  comment: string | null;
};

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const SOURCE_BY_NORMALIZED_KEY = new Map<string, string>([
  [normalizeTextKey("Abritel"), "Abritel"],
  [normalizeTextKey("Airbnb"), "Airbnb"],
  [normalizeTextKey("Chèque"), "Chèque"],
  [normalizeTextKey("Cheques"), "Chèque"],
  [normalizeTextKey("Espèces"), "Espèces"],
  [normalizeTextKey("HomeExchange"), "HomeExchange"],
  [normalizeTextKey("Virement"), "Virement"],
  [normalizeTextKey("A définir"), DEFAULT_SOURCE],
  [normalizeTextKey("A Définir"), DEFAULT_SOURCE],
  [normalizeTextKey("Gites de France"), "Gites de France"],
  [normalizeTextKey("Gite de France"), "Gites de France"],
]);

const normalizeSource = (value: string) => SOURCE_BY_NORMALIZED_KEY.get(normalizeTextKey(value.trim())) ?? DEFAULT_SOURCE;

const extractAirbnbListingId = (url: string) => {
  const byIcal = url.match(/calendar\/ical\/(\d+)\.ics/i);
  if (byIcal?.[1]) return byIcal[1];
  const byMultiCalendar = url.match(/multicalendar\/(\d+)/i);
  if (byMultiCalendar?.[1]) return byMultiCalendar[1];
  return null;
};

const parseIsoDateToUtc = (iso: string) => {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(value.getTime()) ||
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const resolveImportOriginSystem = (importSource: string): ReservationOriginSystem => {
  const normalized = importSource.trim().toLowerCase();
  if (normalized.startsWith("pump")) return "pump";
  if (normalized === "csv") return "csv";
  return "legacy";
};

const getDefaultAdultsByGiteIds = async (giteIds: string[]) => {
  const uniqueIds = [...new Set(giteIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map<string, number>();

  const gites = await prisma.gite.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, nb_adultes_habituel: true },
  });

  return new Map(gites.map((gite) => [gite.id, Math.max(1, Number(gite.nb_adultes_habituel) || 1)]));
};

const getListingMap = async () => {
  const sources = (await listIcalSources(false)) as IcalSourceRow[];
  const listingMap = new Map<
    string,
    {
      gite_id: string;
      gite_nom: string;
      source_type: string;
    }
  >();

  for (const source of sources) {
    const listingId = extractAirbnbListingId(source.url);
    if (!listingId) continue;

    if (!listingMap.has(listingId)) {
      listingMap.set(listingId, {
        gite_id: source.gite.id,
        gite_nom: source.gite.nom,
        source_type: normalizeSource(source.type),
      });
    }
  }

  return listingMap;
};

const buildUpdateData = (existing: any, item: ReservationImportPreviewItem) => {
  const data: Record<string, unknown> = {};
  const normalizedHostName = normalizeImportedHostName(item.hote_nom);
  const normalizedComment = normalizeImportedComment(item.commentaire);

  if (normalizedHostName && isUnknownHostName(existing.hote_nom)) {
    data.hote_nom = normalizedHostName;
  }

  const hasSource = typeof existing.source_paiement === "string" && existing.source_paiement.trim().length > 0;
  if ((!hasSource || existing.source_paiement === DEFAULT_SOURCE) && item.source_type !== DEFAULT_SOURCE) {
    data.source_paiement = item.source_type;
  }

  const hasComment = hasMeaningfulImportedComment(existing.commentaire);
  if (!hasComment && normalizedComment) {
    data.commentaire = normalizedComment;
  }

  const existingTotal = Number(existing.prix_total ?? 0);
  if (item.prix_total && Number.isFinite(item.prix_total) && item.prix_total > 0 && (!Number.isFinite(existingTotal) || existingTotal <= 0)) {
    data.prix_total = round2(item.prix_total);
    data.prix_par_nuit = item.nights > 0 ? round2(item.prix_total / item.nights) : 0;
  }

  return data;
};

export const buildReservationsPreview = async (
  parsed: ParsedImportedReservation[]
): Promise<ReservationImportPreview> => {
  const listingMap = await getListingMap();
  const preview: ReservationImportPreviewItem[] = [];

  for (const reservation of parsed) {
    const mapped = listingMap.get(reservation.listingId);
    const sourceType = resolveImportedReservationSourceType({
      reservationType: reservation.type,
      mappedSourceType: mapped?.source_type,
    });
    const normalizedHostName = normalizeImportedHostName(reservation.name);
    const normalizedComment = normalizeImportedComment(reservation.comment);

    if (!mapped) {
      preview.push({
        id: reservation.id,
        listing_id: reservation.listingId,
        gite_id: null,
        gite_nom: null,
        source_type: sourceType,
        status: "unmapped_listing",
        check_in: reservation.checkIn,
        check_out: reservation.checkOut,
        nights: reservation.nights,
        hote_nom: normalizedHostName,
        prix_total: reservation.payout,
        commentaire: normalizedComment,
        existing_id: null,
        conflict_id: null,
        update_fields: [],
      });
      continue;
    }

    const dateEntree = parseIsoDateToUtc(reservation.checkIn);
    const dateSortie = parseIsoDateToUtc(reservation.checkOut);

    if (!dateEntree || !dateSortie) {
      preview.push({
        id: reservation.id,
        listing_id: reservation.listingId,
        gite_id: mapped.gite_id,
        gite_nom: mapped.gite_nom,
        source_type: sourceType,
        status: "conflict",
        check_in: reservation.checkIn,
        check_out: reservation.checkOut,
        nights: reservation.nights,
        hote_nom: normalizedHostName,
        prix_total: reservation.payout,
        commentaire: normalizedComment,
        existing_id: null,
        conflict_id: null,
        update_fields: [],
      });
      continue;
    }

    const exact = await prisma.reservation.findFirst({
      where: {
        gite_id: mapped.gite_id,
        date_entree: dateEntree,
        date_sortie: dateSortie,
      },
      select: {
        id: true,
        hote_nom: true,
        source_paiement: true,
        commentaire: true,
        prix_total: true,
      },
    });

    if (exact) {
      const updateData = buildUpdateData(exact, {
        id: reservation.id,
        listing_id: reservation.listingId,
        gite_id: mapped.gite_id,
        gite_nom: mapped.gite_nom,
        source_type: sourceType,
        status: "existing",
        check_in: reservation.checkIn,
        check_out: reservation.checkOut,
        nights: reservation.nights,
        hote_nom: normalizedHostName,
        prix_total: reservation.payout,
        commentaire: normalizedComment,
        existing_id: exact.id,
        conflict_id: null,
        update_fields: [],
      });

      const updateFields = Object.keys(updateData) as ReservationImportPreviewItem["update_fields"];
      preview.push({
        id: reservation.id,
        listing_id: reservation.listingId,
        gite_id: mapped.gite_id,
        gite_nom: mapped.gite_nom,
        source_type: sourceType,
        status: updateFields.length > 0 ? "existing_updatable" : "existing",
        check_in: reservation.checkIn,
        check_out: reservation.checkOut,
        nights: reservation.nights,
        hote_nom: normalizedHostName,
        prix_total: reservation.payout,
        commentaire: normalizedComment,
        existing_id: exact.id,
        conflict_id: null,
        update_fields: updateFields,
      });
      continue;
    }

    const conflict = await prisma.reservation.findFirst({
      where: {
        gite_id: mapped.gite_id,
        date_entree: { lt: dateSortie },
        date_sortie: { gt: dateEntree },
      },
      select: { id: true },
    });

    if (conflict) {
      preview.push({
        id: reservation.id,
        listing_id: reservation.listingId,
        gite_id: mapped.gite_id,
        gite_nom: mapped.gite_nom,
        source_type: sourceType,
        status: "conflict",
        check_in: reservation.checkIn,
        check_out: reservation.checkOut,
        nights: reservation.nights,
        hote_nom: normalizedHostName,
        prix_total: reservation.payout,
        commentaire: normalizedComment,
        existing_id: null,
        conflict_id: conflict.id,
        update_fields: [],
      });
      continue;
    }

    preview.push({
      id: reservation.id,
      listing_id: reservation.listingId,
      gite_id: mapped.gite_id,
      gite_nom: mapped.gite_nom,
      source_type: sourceType,
      status: "new",
      check_in: reservation.checkIn,
      check_out: reservation.checkOut,
      nights: reservation.nights,
      hote_nom: normalizedHostName,
      prix_total: reservation.payout,
      commentaire: normalizedComment,
      existing_id: null,
      conflict_id: null,
      update_fields: [],
    });
  }

  return {
    reservations: preview,
    counts: {
      new: preview.filter((item) => item.status === "new").length,
      existing: preview.filter((item) => item.status === "existing").length,
      existing_updatable: preview.filter((item) => item.status === "existing_updatable").length,
      conflict: preview.filter((item) => item.status === "conflict").length,
      unmapped_listing: preview.filter((item) => item.status === "unmapped_listing").length,
    },
  };
};

const buildPerGiteSummary = (
  preview: ReservationImportPreview,
  importable: ReservationImportPreviewItem[],
  createdIds: Set<string>,
  updatedIds: Set<string>
) => {
  const byGite: Record<string, { inserted: number; updated: number; skipped: number }> = {};
  const importableIds = new Set(importable.map((item) => item.id));

  for (const item of preview.reservations) {
    const key = item.gite_nom || item.listing_id || "Gîte inconnu";
    const current = byGite[key] ?? { inserted: 0, updated: 0, skipped: 0 };
    if (createdIds.has(item.id)) current.inserted += 1;
    else if (updatedIds.has(item.id)) current.updated += 1;
    else if (!importableIds.has(item.id) || item.status !== "existing") current.skipped += 1;
    byGite[key] = current;
  }

  return byGite;
};

export const importPreviewReservations = async (
  preview: ReservationImportPreview,
  selectedIds: string[] | undefined,
  importSource: string
): Promise<ReservationImportResult> => {
  const originSystem = resolveImportOriginSystem(importSource);
  const selectedSet = selectedIds ? new Set(selectedIds) : null;
  const importable = preview.reservations.filter((item) => {
    if (item.status !== "new" && item.status !== "existing_updatable") return false;
    if (!selectedSet) return true;
    return selectedSet.has(item.id);
  });
  const defaultAdultsByGiteId = await getDefaultAdultsByGiteIds(
    importable.filter((item) => item.status === "new").map((item) => item.gite_id ?? "")
  );

  let createdCount = 0;
  let updatedCount = 0;
  const createdIds = new Set<string>();
  const updatedIds = new Set<string>();
  const insertedItems: Array<{ giteName: string; giteId: string; checkIn: string; checkOut: string; source: string }> = [];
  const updatedItems: Array<{
    giteName: string;
    giteId: string;
    checkIn: string;
    checkOut: string;
    source: string;
    updatedFields: string[];
  }> = [];

  for (const item of importable) {
    if (item.status === "new" && item.gite_id) {
      const dateEntree = parseIsoDateToUtc(item.check_in);
      const dateSortie = parseIsoDateToUtc(item.check_out);
      if (!dateEntree || !dateSortie) continue;

      const nights = Math.max(1, Math.round((dateSortie.getTime() - dateEntree.getTime()) / DAY_MS));
      const prixTotal = item.prix_total && item.prix_total > 0 ? round2(item.prix_total) : 0;
      const prixParNuit = prixTotal > 0 ? round2(prixTotal / nights) : 0;

      await prisma.reservation.create({
        data: {
          gite_id: item.gite_id,
          placeholder_id: null,
          ...buildReservationOriginData({
            originSystem,
            originReference: item.id,
            exportToIcal: false,
          }),
          hote_nom: toImportedReservationHostName(item.hote_nom),
          date_entree: dateEntree,
          date_sortie: dateSortie,
          nb_nuits: nights,
          nb_adultes: item.gite_id ? (defaultAdultsByGiteId.get(item.gite_id) ?? 1) : 1,
          prix_par_nuit: prixParNuit,
          prix_total: prixTotal,
          source_paiement: item.source_type,
          commentaire: normalizeImportedComment(item.commentaire),
          frais_optionnels_montant: 0,
          frais_optionnels_libelle: null,
          frais_optionnels_declares: false,
          options: "{}",
        },
      });
      createdCount += 1;
      createdIds.add(item.id);
      insertedItems.push({
        giteName: item.gite_nom ?? item.listing_id,
        giteId: item.gite_id,
        checkIn: item.check_in,
        checkOut: item.check_out,
        source: item.source_type,
      });
    }

    if (item.status === "existing_updatable" && item.existing_id) {
      const existing = await prisma.reservation.findUnique({
        where: { id: item.existing_id },
        select: {
          id: true,
          hote_nom: true,
          source_paiement: true,
          commentaire: true,
          prix_total: true,
        },
      });
      if (!existing) continue;

      const updateData = buildUpdateData(existing, item);
      if (Object.keys(updateData).length === 0) continue;

      await prisma.reservation.update({
        where: { id: existing.id },
        data: updateData,
      });
      updatedCount += 1;
      updatedIds.add(item.id);
      updatedItems.push({
        giteName: item.gite_nom ?? item.listing_id,
        giteId: item.gite_id ?? "",
        checkIn: item.check_in,
        checkOut: item.check_out,
        source: item.source_type,
        updatedFields: item.update_fields,
      });
    }
  }

  const skippedCount =
    preview.reservations.length -
    importable.length +
    importable.filter((item) => item.status === "existing_updatable" && item.update_fields.length === 0).length;

  const response: ReservationImportResult = {
    ...preview,
    selected_count: importable.length,
    created_count: createdCount,
    updated_count: updatedCount,
    skipped_count: Math.max(0, skippedCount),
  };

  try {
    appendImportLog(
      buildImportLogEntry({
        source: importSource,
        selectionCount: importable.length,
        inserted: createdCount,
        updated: updatedCount,
        skipped: {
          unknown: Math.max(0, skippedCount),
        },
        perGite: buildPerGiteSummary(preview, importable, createdIds, updatedIds),
        insertedItems,
        updatedItems,
      })
    );
  } catch {
    // Ignore import-log write failures
  }

  return response;
};

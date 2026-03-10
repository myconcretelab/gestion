import ical from "node-ical";
import prisma from "../db/prisma.js";
import { appendImportLog, buildImportLogEntry } from "./importLog.js";
import {
  buildDefaultIcalCronConfig,
  mergeIcalCronConfig,
  readIcalCronConfig,
  writeIcalCronConfig,
  type IcalCronConfig,
} from "./icalCronSettings.js";
import { isUnknownHostName, normalizeImportedHostName } from "../utils/reservationText.js";
import {
  resolveIcalReservationSource,
  shouldPreferIcalReservation,
  shouldUpdateIcalReservationSource,
} from "../utils/icalReservationSource.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  [normalizeTextKey("A définir"), "A définir"],
  [normalizeTextKey("A Définir"), "A définir"],
  [normalizeTextKey("Gites de France"), "Gites de France"],
  [normalizeTextKey("Gite de France"), "Gites de France"],
]);

const DEFAULT_SOURCE = "A définir";
const ICAL_TO_VERIFY_MARKER = "[ICAL_TO_VERIFY]";

export type IcalSourceRow = {
  id: string;
  gite_id: string;
  type: string;
  url: string;
  include_summary: string | null;
  exclude_summary: string | null;
  is_active: boolean;
  ordre: number;
  createdAt: Date;
  updatedAt: Date;
  gite: {
    id: string;
    nom: string;
    prefixe_contrat: string;
    ordre: number;
    nb_adultes_habituel: number;
  };
};

type ParsedIcalReservation = {
  id: string;
  gite_id: string;
  gite_nom: string;
  source_id: string;
  source_url: string;
  source_type: string;
  uid: string;
  summary: string;
  description: string;
  date_entree: string;
  date_sortie: string;
  hote_nom: string | null;
  nb_adultes_habituel: number;
};

export type IcalSyncStatus = "new" | "existing" | "existing_updatable" | "conflict";

export type IcalPreviewItem = ParsedIcalReservation & {
  final_source: string;
  status: IcalSyncStatus;
  existing_id: string | null;
  conflict_id: string | null;
  update_fields: Array<"hote_nom" | "source_paiement">;
};

export type IcalSourceError = {
  source_id: string;
  gite_id: string;
  gite_nom: string;
  url: string;
  message: string;
};

export type IcalPreviewResult = {
  fetched_sources: number;
  parsed_events: number;
  errors: IcalSourceError[];
  reservations: IcalPreviewItem[];
  counts: {
    new: number;
    existing: number;
    existing_updatable: number;
    conflict: number;
  };
};

export type IcalSyncResult = IcalPreviewResult & {
  created_count: number;
  updated_count: number;
  skipped_count: number;
  to_verify_marked_count: number;
  to_verify_cleared_count: number;
  per_gite: Record<string, { inserted: number; updated: number; skipped: number }>;
  inserted_items: Array<{ giteName: string; giteId: string; checkIn: string; checkOut: string; source: string }>;
  updated_items: Array<{ giteName: string; giteId: string; checkIn: string; checkOut: string; source: string }>;
};

export type IcalCronState = {
  config: IcalCronConfig;
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: IcalSyncResult | null;
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

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

const splitSummaryFilter = (raw: string | null | undefined) => {
  if (!raw) return [] as string[];
  return raw
    .split(/\r?\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const summaryMatches = (summary: string, filter: string) => {
  const left = summary.toLowerCase();
  const right = filter.toLowerCase();
  return left.includes(right);
};

const shouldKeepBySummary = (summary: string, source: IcalSourceRow) => {
  const includes = splitSummaryFilter(source.include_summary);
  const excludes = splitSummaryFilter(source.exclude_summary);

  if (includes.length > 0 && !includes.some((entry) => summaryMatches(summary, entry))) {
    return false;
  }

  if (excludes.length > 0 && excludes.some((entry) => summaryMatches(summary, entry))) {
    return false;
  }

  return true;
};

const normalizeSource = (rawType: string) => {
  const normalized = SOURCE_BY_NORMALIZED_KEY.get(normalizeTextKey(rawType.trim()));
  return normalized ?? DEFAULT_SOURCE;
};

const hasIcalToVerifyMarker = (comment: string | null | undefined) => {
  if (typeof comment !== "string") return false;
  return comment
    .split(/\r?\n/)
    .some((line) => line.trim() === ICAL_TO_VERIFY_MARKER);
};

const stripIcalToVerifyMarker = (comment: string | null | undefined) => {
  if (typeof comment !== "string") return "";
  return comment
    .split(/\r?\n/)
    .filter((line) => line.trim() !== ICAL_TO_VERIFY_MARKER)
    .join("\n")
    .trim();
};

const mergeIcalToVerifyMarker = (comment: string | null | undefined, enabled: boolean) => {
  const cleaned = stripIcalToVerifyMarker(comment);
  if (!enabled) return cleaned || null;
  return cleaned.length > 0 ? `${ICAL_TO_VERIFY_MARKER}\n${cleaned}` : ICAL_TO_VERIFY_MARKER;
};

const getReservationPeriodKey = (params: { gite_id: string; date_entree: string; date_sortie: string }) =>
  `${params.gite_id}|${params.date_entree}|${params.date_sortie}`;

const extractHostName = (summary: string) => {
  const cleaned = summary
    .replace(/\b(airbnb|reserved|booked|not available|unavailable|blocked|indisponible|bloque)\b/gi, "")
    .replace(/[-_:()]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return null;

  const normalized = normalizeTextKey(cleaned);
  if (
    normalized === "reserved" ||
    normalized === "booked" ||
    normalized === "notavailable" ||
    normalized === "unavailable" ||
    normalized === "blocked"
  ) {
    return null;
  }

  return cleaned.slice(0, 120);
};

const formatIcalDate = (value: unknown) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;

  const utcHour = value.getUTCHours();
  if (utcHour === 22) {
    return toIsoDate(new Date(value.getTime() + 2 * 60 * 60 * 1000));
  }
  if (utcHour === 23) {
    return toIsoDate(new Date(value.getTime() + 60 * 60 * 1000));
  }

  return toIsoDate(value);
};

const resolveReservationSource = (reservation: Pick<ParsedIcalReservation, "source_type" | "hote_nom" | "summary">) =>
  resolveIcalReservationSource({
    normalizedSourceType: normalizeSource(reservation.source_type),
    hostName: reservation.hote_nom,
    summary: reservation.summary,
  });

const pickPreferredReservation = (left: ParsedIcalReservation, right: ParsedIcalReservation) =>
  shouldPreferIcalReservation(
    {
      normalizedSourceType: normalizeSource(left.source_type),
      hostName: left.hote_nom,
      summary: left.summary,
    },
    {
      normalizedSourceType: normalizeSource(right.source_type),
      hostName: right.hote_nom,
      summary: right.summary,
    }
  )
    ? left
    : right;

const dedupeParsedReservations = (items: ParsedIcalReservation[]) => {
  const byPeriod = new Map<string, ParsedIcalReservation>();

  for (const item of items) {
    const key = `${item.gite_id}|${item.date_entree}|${item.date_sortie}`;
    const previous = byPeriod.get(key);
    if (!previous) {
      byPeriod.set(key, item);
      continue;
    }

    byPeriod.set(key, pickPreferredReservation(previous, item));
  }

  return [...byPeriod.values()].sort((left, right) => {
    const byGite = left.gite_nom.localeCompare(right.gite_nom);
    if (byGite !== 0) return byGite;
    const byStart = left.date_entree.localeCompare(right.date_entree);
    if (byStart !== 0) return byStart;
    return left.date_sortie.localeCompare(right.date_sortie);
  });
};

const fetchSourceReservations = async (source: IcalSourceRow): Promise<ParsedIcalReservation[]> => {
  const response = await fetch(source.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const parsed = ical.parseICS(text) as Record<string, any>;
  const reservations: ParsedIcalReservation[] = [];

  let fallbackIndex = 0;
  for (const event of Object.values(parsed)) {
    if (!event || event.type !== "VEVENT") continue;

    const summary = String(event.summary ?? "").trim();
    if (!shouldKeepBySummary(summary, source)) continue;

    const date_entree = formatIcalDate(event.start);
    const date_sortie = formatIcalDate(event.end);
    if (!date_entree || !date_sortie) continue;

    const start = parseIsoDateToUtc(date_entree);
    const end = parseIsoDateToUtc(date_sortie);
    if (!start || !end || end.getTime() <= start.getTime()) continue;

    fallbackIndex += 1;
    const uid = String(event.uid ?? `event-${fallbackIndex}`);
    const description = String(event.description ?? "").trim();

    reservations.push({
      id: `${source.id}|${uid}|${date_entree}|${date_sortie}`,
      gite_id: source.gite.id,
      gite_nom: source.gite.nom,
      source_id: source.id,
      source_url: source.url,
      source_type: source.type,
      uid,
      summary,
      description,
      date_entree,
      date_sortie,
      hote_nom: normalizeImportedHostName(extractHostName(summary)),
      nb_adultes_habituel: source.gite.nb_adultes_habituel,
    });
  }

  return reservations;
};

const buildIcalSourceQuery = (onlyActive = true) => ({
  where: onlyActive ? { is_active: true } : undefined,
  orderBy: [
    { gite: { ordre: "asc" as const } },
    { gite: { nom: "asc" as const } },
    { ordre: "asc" as const },
    { createdAt: "asc" as const },
  ],
  include: {
    gite: {
      select: {
        id: true,
        nom: true,
        prefixe_contrat: true,
        ordre: true,
        nb_adultes_habituel: true,
      },
    },
  },
});

export const listIcalSources = async (onlyActive = false) => {
  const rows = (await prisma.icalSource.findMany(buildIcalSourceQuery(onlyActive))) as IcalSourceRow[];
  return rows;
};

const buildUpdateFields = (existing: any, reservation: ParsedIcalReservation) => {
  const fields: Array<"hote_nom" | "source_paiement"> = [];
  const resolvedSource = resolveReservationSource(reservation);

  if (isUnknownHostName(existing.hote_nom) && reservation.hote_nom) {
    fields.push("hote_nom");
  }

  if (
    shouldUpdateIcalReservationSource({
      currentSource: existing.source_paiement,
      currentHostName: existing.hote_nom,
      nextSource: resolvedSource,
    })
  ) {
    fields.push("source_paiement");
  }

  return fields;
};

const buildUpdateData = (existing: any, reservation: ParsedIcalReservation) => {
  const fields = buildUpdateFields(existing, reservation);
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === "hote_nom" && reservation.hote_nom) {
      data.hote_nom = reservation.hote_nom;
      continue;
    }
    if (field === "source_paiement") {
      data.source_paiement = resolveReservationSource(reservation);
      continue;
    }
  }

  return { fields, data };
};

const buildIcalPreviewItems = async (parsedReservations: ParsedIcalReservation[]) => {
  const preview: IcalPreviewItem[] = [];

  for (const reservation of parsedReservations) {
    const finalSource = resolveReservationSource(reservation);
    const dateEntree = parseIsoDateToUtc(reservation.date_entree);
    const dateSortie = parseIsoDateToUtc(reservation.date_sortie);
    if (!dateEntree || !dateSortie) continue;

    const exact = await prisma.reservation.findFirst({
      where: {
        gite_id: reservation.gite_id,
        date_entree: dateEntree,
        date_sortie: dateSortie,
      },
      select: {
        id: true,
        hote_nom: true,
        source_paiement: true,
        commentaire: true,
      },
    });

    if (exact) {
      const { fields } = buildUpdateData(exact, reservation);
      preview.push({
        ...reservation,
        final_source: finalSource,
        status: fields.length > 0 ? "existing_updatable" : "existing",
        existing_id: exact.id,
        conflict_id: null,
        update_fields: fields,
      });
      continue;
    }

    const conflict = await prisma.reservation.findFirst({
      where: {
        gite_id: reservation.gite_id,
        date_entree: { lt: dateSortie },
        date_sortie: { gt: dateEntree },
      },
      select: { id: true },
    });

    if (conflict) {
      preview.push({
        ...reservation,
        final_source: finalSource,
        status: "conflict",
        existing_id: null,
        conflict_id: conflict.id,
        update_fields: [],
      });
      continue;
    }

    preview.push({
      ...reservation,
      final_source: finalSource,
      status: "new",
      existing_id: null,
      conflict_id: null,
      update_fields: [],
    });
  }

  return preview;
};

const buildCounts = (preview: IcalPreviewItem[]) => {
  const counts = {
    new: 0,
    existing: 0,
    existing_updatable: 0,
    conflict: 0,
  };

  for (const item of preview) {
    counts[item.status] += 1;
  }

  return counts;
};

const loadParsedIcalReservations = async (onlyActive = true) => {
  const sources = (await prisma.icalSource.findMany(buildIcalSourceQuery(onlyActive))) as IcalSourceRow[];
  const errors: IcalSourceError[] = [];
  const parsed: ParsedIcalReservation[] = [];

  for (const source of sources) {
    try {
      const events = await fetchSourceReservations(source);
      parsed.push(...events);
    } catch (error) {
      errors.push({
        source_id: source.id,
        gite_id: source.gite.id,
        gite_nom: source.gite.nom,
        url: source.url,
        message: error instanceof Error ? error.message : "Erreur iCal inconnue",
      });
    }
  }

  return {
    sources,
    errors,
    parsed: dedupeParsedReservations(parsed),
  };
};

const buildIcalPreviewResult = async (loaded: Awaited<ReturnType<typeof loadParsedIcalReservations>>) => {
  const reservations = await buildIcalPreviewItems(loaded.parsed);
  return {
    fetched_sources: loaded.sources.length,
    parsed_events: loaded.parsed.length,
    errors: loaded.errors,
    reservations,
    counts: buildCounts(reservations),
  };
};

export const previewIcalReservations = async (): Promise<IcalPreviewResult> => {
  const loaded = await loadParsedIcalReservations(true);
  return buildIcalPreviewResult(loaded);
};

const toCreatePayload = (reservation: IcalPreviewItem) => {
  const dateEntree = parseIsoDateToUtc(reservation.date_entree);
  const dateSortie = parseIsoDateToUtc(reservation.date_sortie);
  if (!dateEntree || !dateSortie) {
    throw new Error(`Dates invalides pour ${reservation.id}`);
  }

  const nights = Math.max(1, Math.round((dateSortie.getTime() - dateEntree.getTime()) / DAY_MS));
  return {
    gite_id: reservation.gite_id,
    placeholder_id: null,
    hote_nom: normalizeImportedHostName(reservation.hote_nom) ?? "",
    date_entree: dateEntree,
    date_sortie: dateSortie,
    nb_nuits: nights,
    nb_adultes: Math.max(1, Number(reservation.nb_adultes_habituel) || 1),
    prix_par_nuit: 0,
    prix_total: 0,
    source_paiement: resolveReservationSource(reservation),
    commentaire: null,
    frais_optionnels_montant: 0,
    frais_optionnels_libelle: null,
    frais_optionnels_declares: false,
    options: "{}",
  };
};

type SyncOptions = {
  log_source?: "ical-manual" | "ical-cron" | "ical-startup";
};

let activeSyncPromise: Promise<IcalSyncResult> | null = null;
let cronTimer: NodeJS.Timeout | null = null;
let cronRunning = false;
let cronNextRunAt: Date | null = null;
let cronLastRunAt: Date | null = null;
let cronLastResult: IcalSyncResult | null = null;
let cronConfig: IcalCronConfig = readIcalCronConfig(buildDefaultIcalCronConfig());

const syncMissingReservationsToVerify = async (loaded: Awaited<ReturnType<typeof loadParsedIcalReservations>>) => {
  const giteIds = [...new Set(loaded.sources.map((source) => source.gite_id))];
  if (giteIds.length === 0) {
    return { marked_count: 0, cleared_count: 0 };
  }

  const parsedPeriodKeys = new Set(
    loaded.parsed.map((item) =>
      getReservationPeriodKey({
        gite_id: item.gite_id,
        date_entree: item.date_entree,
        date_sortie: item.date_sortie,
      })
    )
  );

  const sourceByGite = new Map<string, Set<string>>();
  for (const source of loaded.sources) {
    const current = sourceByGite.get(source.gite_id) ?? new Set<string>();
    current.add(normalizeSource(source.type));
    sourceByGite.set(source.gite_id, current);
  }

  const todayUtc = parseIsoDateToUtc(toIsoDate(new Date())) ?? new Date();
  const existingReservations = await prisma.reservation.findMany({
    where: {
      gite_id: { in: giteIds },
      date_sortie: { gte: todayUtc },
    },
    select: {
      id: true,
      gite_id: true,
      hote_nom: true,
      date_entree: true,
      date_sortie: true,
      source_paiement: true,
      commentaire: true,
    },
  });

  let marked_count = 0;
  let cleared_count = 0;

  for (const reservation of existingReservations) {
    const giteId = reservation.gite_id;
    if (!giteId) continue;

    const managedSources = sourceByGite.get(giteId);
    if (!managedSources || managedSources.size === 0) continue;

    const hasMarker = hasIcalToVerifyMarker(reservation.commentaire);
    const normalizedSource = normalizeSource(String(reservation.source_paiement ?? ""));
    const likelyManagedByIcal =
      hasMarker || managedSources.has(normalizedSource) || (normalizedSource === DEFAULT_SOURCE && isUnknownHostName(reservation.hote_nom));
    if (!likelyManagedByIcal) continue;

    const periodKey = getReservationPeriodKey({
      gite_id: giteId,
      date_entree: toIsoDate(reservation.date_entree),
      date_sortie: toIsoDate(reservation.date_sortie),
    });
    const shouldBeMarked = !parsedPeriodKeys.has(periodKey);
    const nextComment = mergeIcalToVerifyMarker(reservation.commentaire, shouldBeMarked);
    const currentComment = typeof reservation.commentaire === "string" ? reservation.commentaire.trim() : null;
    if (nextComment === currentComment) continue;

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { commentaire: nextComment },
    });

    if (shouldBeMarked) marked_count += 1;
    else cleared_count += 1;
  }

  return { marked_count, cleared_count };
};

const runSync = async (): Promise<IcalSyncResult> => {
  const loaded = await loadParsedIcalReservations(true);
  const preview = await buildIcalPreviewResult(loaded);
  let created_count = 0;
  let updated_count = 0;
  const inserted_items: IcalSyncResult["inserted_items"] = [];
  const updated_items: IcalSyncResult["updated_items"] = [];
  const per_gite: IcalSyncResult["per_gite"] = {};

  const markPerGite = (giteName: string, field: "inserted" | "updated" | "skipped") => {
    const key = giteName || "Gîte inconnu";
    const current = per_gite[key] ?? { inserted: 0, updated: 0, skipped: 0 };
    current[field] += 1;
    per_gite[key] = current;
  };

  for (const item of preview.reservations) {
    if (item.status === "new") {
      await prisma.reservation.create({ data: toCreatePayload(item) });
      created_count += 1;
      inserted_items.push({
        giteName: item.gite_nom,
        giteId: item.gite_id,
        checkIn: item.date_entree,
        checkOut: item.date_sortie,
        source: resolveReservationSource(item),
      });
      markPerGite(item.gite_nom, "inserted");
      continue;
    }

    if (item.status === "existing_updatable" && item.existing_id) {
      const existing = await prisma.reservation.findUnique({
        where: { id: item.existing_id },
        select: {
          id: true,
          hote_nom: true,
          source_paiement: true,
          commentaire: true,
        },
      });
      if (!existing) continue;

      const { data } = buildUpdateData(existing, item);
      if (Object.keys(data).length === 0) {
        markPerGite(item.gite_nom, "skipped");
        continue;
      }

      await prisma.reservation.update({ where: { id: existing.id }, data });
      updated_count += 1;
      markPerGite(item.gite_nom, "updated");
      updated_items.push({
        giteName: item.gite_nom,
        giteId: item.gite_id,
        checkIn: item.date_entree,
        checkOut: item.date_sortie,
        source: resolveReservationSource(item),
      });
      continue;
    }

    markPerGite(item.gite_nom, "skipped");
  }

  const toVerifySync = await syncMissingReservationsToVerify(loaded);

  const skipped_count = preview.counts.existing + preview.counts.conflict;
  return {
    ...preview,
    created_count,
    updated_count,
    skipped_count,
    per_gite,
    inserted_items,
    updated_items,
    to_verify_marked_count: toVerifySync.marked_count,
    to_verify_cleared_count: toVerifySync.cleared_count,
  };
};

export const syncIcalReservations = async (options?: SyncOptions): Promise<IcalSyncResult> => {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = (async () => {
    const result = await runSync();
    cronLastRunAt = new Date();
    cronLastResult = result;

    if (options?.log_source) {
      try {
        appendImportLog(
          buildImportLogEntry({
            source: options.log_source,
            selectionCount: result.counts.new + result.counts.existing_updatable,
            inserted: result.created_count,
            updated: result.updated_count,
            skipped: {
              unknown: result.skipped_count,
            },
            perGite: result.per_gite,
            insertedItems: result.inserted_items,
            updatedItems: result.updated_items,
          })
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[ical-sync] Failed to write import log:", error instanceof Error ? error.message : error);
      }
    }

    return result;
  })().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
};

const computeNextRunDate = (hour: number, minute: number) => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
};

const scheduleNextCronRun = (hour: number, minute: number) => {
  cronNextRunAt = computeNextRunDate(hour, minute);
  const waitMs = Math.max(5_000, cronNextRunAt.getTime() - Date.now());

  cronTimer = setTimeout(async () => {
    cronRunning = true;
    try {
      await syncIcalReservations({ log_source: "ical-cron" });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[ical-sync] Cron execution failed:", error instanceof Error ? error.message : error);
    } finally {
      cronRunning = false;
      scheduleNextCronRun(hour, minute);
    }
  }, waitMs);
};

const applyCronConfig = (config: IcalCronConfig) => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;

  if (config.enabled) {
    scheduleNextCronRun(config.hour, config.minute);
  }
};

export const stopIcalSyncCron = () => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;
};

export const startIcalSyncCron = () => {
  applyCronConfig(cronConfig);
  if (cronConfig.run_on_start) {
    void syncIcalReservations({ log_source: "ical-startup" }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[ical-sync] Startup sync failed:", error instanceof Error ? error.message : error);
    });
  }
};

export const updateIcalSyncCronConfig = async (patch: Partial<IcalCronConfig>) => {
  cronConfig = mergeIcalCronConfig(cronConfig, patch);
  writeIcalCronConfig(cronConfig);
  applyCronConfig(cronConfig);
  return cronConfig;
};

export const getIcalSyncCronConfig = () => cronConfig;

export const getIcalCronState = (): IcalCronState => ({
  config: cronConfig,
  running: cronRunning || Boolean(activeSyncPromise),
  next_run_at: cronNextRunAt ? cronNextRunAt.toISOString() : null,
  last_run_at: cronLastRunAt ? cronLastRunAt.toISOString() : null,
  last_result: cronLastResult,
});

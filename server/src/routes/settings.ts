import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { parseHarReservations } from "../services/harParser.js";
import { appendImportLog, buildImportLogEntry, readImportLog, IMPORT_LOG_LIMIT } from "../services/importLog.js";
import {
  getIcalSyncCronConfig,
  getIcalCronState,
  listIcalSources,
  previewIcalReservations,
  syncIcalReservations,
  updateIcalSyncCronConfig,
  type IcalSourceRow,
} from "../services/icalSync.js";
import type { IcalCronConfig } from "../services/icalCronSettings.js";

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SOURCE = "A définir";
const UNKNOWN_HOST = "Hôte inconnu";

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

const emptyStringToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const sourcePayloadSchema = z.object({
  gite_id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  url: z.string().trim().url("URL iCal invalide."),
  include_summary: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional().default(null),
  exclude_summary: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional().default(null),
  is_active: z.boolean().optional().default(true),
});

const harPayloadSchema = z.object({
  har: z.any(),
  selected_ids: z.array(z.string().trim().min(1)).optional(),
});

const cronConfigSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  run_on_start: z.boolean().optional(),
});

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

const isUnknownHost = (name: string | null | undefined) => {
  if (!name) return true;
  const normalized = normalizeTextKey(name);
  return normalized.length === 0 || normalized.includes("hoteinconnu") || normalized.includes("hostunknown");
};

const normalizeSource = (value: string) => SOURCE_BY_NORMALIZED_KEY.get(normalizeTextKey(value.trim())) ?? DEFAULT_SOURCE;

const extractAirbnbListingId = (url: string) => {
  const byIcal = url.match(/calendar\/ical\/(\d+)\.ics/i);
  if (byIcal?.[1]) return byIcal[1];
  const byMultiCalendar = url.match(/multicalendar\/(\d+)/i);
  if (byMultiCalendar?.[1]) return byMultiCalendar[1];
  return null;
};

type HarPreviewStatus = "new" | "existing" | "existing_updatable" | "conflict" | "unmapped_listing";

type HarPreviewItem = {
  id: string;
  listing_id: string;
  gite_id: string | null;
  gite_nom: string | null;
  source_type: string;
  status: HarPreviewStatus;
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

const getHarListingMap = async () => {
  const sources = (await listIcalSources(false)) as IcalSourceRow[];
  const listingMap = new Map<
    string,
    {
      gite_id: string;
      gite_nom: string;
      source_type: string;
      source_id: string;
    }
  >();

  for (const source of sources) {
    const listingId = extractAirbnbListingId(source.url);
    if (!listingId) continue;
    const sourceType = normalizeSource(source.type);

    if (!listingMap.has(listingId)) {
      listingMap.set(listingId, {
        gite_id: source.gite.id,
        gite_nom: source.gite.nom,
        source_type: sourceType,
        source_id: source.id,
      });
    }
  }

  return listingMap;
};

const buildHarUpdateData = (existing: any, item: HarPreviewItem) => {
  const data: Record<string, unknown> = {};

  if (item.hote_nom && isUnknownHost(existing.hote_nom)) {
    data.hote_nom = item.hote_nom;
  }

  const hasSource = typeof existing.source_paiement === "string" && existing.source_paiement.trim().length > 0;
  if ((!hasSource || existing.source_paiement === DEFAULT_SOURCE) && item.source_type !== DEFAULT_SOURCE) {
    data.source_paiement = item.source_type;
  }

  const hasComment = typeof existing.commentaire === "string" && existing.commentaire.trim().length > 0;
  if (!hasComment && item.commentaire) {
    data.commentaire = item.commentaire;
  }

  const existingTotal = Number(existing.prix_total ?? 0);
  if (item.prix_total && Number.isFinite(item.prix_total) && item.prix_total > 0 && (!Number.isFinite(existingTotal) || existingTotal <= 0)) {
    data.prix_total = round2(item.prix_total);
    data.prix_par_nuit = item.nights > 0 ? round2(item.prix_total / item.nights) : 0;
  }

  return data;
};

const buildHarPreview = async (har: unknown) => {
  const parsed = parseHarReservations(har);
  const listingMap = await getHarListingMap();
  const preview: HarPreviewItem[] = [];

  for (const reservation of parsed) {
    const mapped = listingMap.get(reservation.listingId);
    const sourceType = mapped?.source_type ?? (reservation.type === "airbnb" ? "Airbnb" : DEFAULT_SOURCE);

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
        hote_nom: reservation.name,
        prix_total: reservation.payout,
        commentaire: reservation.comment,
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
        hote_nom: reservation.name,
        prix_total: reservation.payout,
        commentaire: reservation.comment,
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
      const updateData = buildHarUpdateData(exact, {
        id: reservation.id,
        listing_id: reservation.listingId,
        gite_id: mapped.gite_id,
        gite_nom: mapped.gite_nom,
        source_type: sourceType,
        status: "existing",
        check_in: reservation.checkIn,
        check_out: reservation.checkOut,
        nights: reservation.nights,
        hote_nom: reservation.name,
        prix_total: reservation.payout,
        commentaire: reservation.comment,
        existing_id: exact.id,
        conflict_id: null,
        update_fields: [],
      });

      const updateFields = Object.keys(updateData) as HarPreviewItem["update_fields"];
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
        hote_nom: reservation.name,
        prix_total: reservation.payout,
        commentaire: reservation.comment,
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
        hote_nom: reservation.name,
        prix_total: reservation.payout,
        commentaire: reservation.comment,
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
      hote_nom: reservation.name,
      prix_total: reservation.payout,
      commentaire: reservation.comment,
      existing_id: null,
      conflict_id: null,
      update_fields: [],
    });
  }

  const counts = {
    new: preview.filter((item) => item.status === "new").length,
    existing: preview.filter((item) => item.status === "existing").length,
    existing_updatable: preview.filter((item) => item.status === "existing_updatable").length,
    conflict: preview.filter((item) => item.status === "conflict").length,
    unmapped_listing: preview.filter((item) => item.status === "unmapped_listing").length,
  };

  return {
    reservations: preview,
    counts,
  };
};

const buildHarPerGiteSummary = (
  preview: { reservations: HarPreviewItem[] },
  importable: HarPreviewItem[],
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

const buildImportLogResponse = (limitRaw: unknown) => {
  const rawLimit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : Number(limitRaw);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, IMPORT_LOG_LIMIT) : 5;
  const entries = readImportLog();
  return {
    entries: entries.slice(0, limit),
    total: entries.length,
    limit,
  };
};

router.get("/ical-sources", async (_req, res, next) => {
  try {
    const sources = await listIcalSources(false);
    res.json(sources);
  } catch (error) {
    next(error);
  }
});

router.post("/ical-sources", async (req, res, next) => {
  try {
    const payload = sourcePayloadSchema.parse(req.body);
    const gite = await prisma.gite.findUnique({ where: { id: payload.gite_id }, select: { id: true } });
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const duplicate = await prisma.icalSource.findFirst({
      where: {
        gite_id: payload.gite_id,
        url: payload.url,
      },
      select: { id: true },
    });

    if (duplicate) {
      return res.status(409).json({ error: "Cette URL iCal existe déjà pour ce gîte." });
    }

    const aggregate = await prisma.icalSource.aggregate({
      where: { gite_id: payload.gite_id },
      _max: { ordre: true },
    });

    const created = await prisma.icalSource.create({
      data: {
        ...payload,
        ordre: (aggregate._max.ordre ?? -1) + 1,
      },
      include: {
        gite: {
          select: {
            id: true,
            nom: true,
            prefixe_contrat: true,
            ordre: true,
          },
        },
      },
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.put("/ical-sources/:id", async (req, res, next) => {
  try {
    const payload = sourcePayloadSchema.parse(req.body);
    const existing = await prisma.icalSource.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: "Source iCal introuvable." });
    }

    const gite = await prisma.gite.findUnique({ where: { id: payload.gite_id }, select: { id: true } });
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const duplicate = await prisma.icalSource.findFirst({
      where: {
        id: { not: existing.id },
        gite_id: payload.gite_id,
        url: payload.url,
      },
      select: { id: true },
    });

    if (duplicate) {
      return res.status(409).json({ error: "Cette URL iCal existe déjà pour ce gîte." });
    }

    const updated = await prisma.icalSource.update({
      where: { id: existing.id },
      data: payload,
      include: {
        gite: {
          select: {
            id: true,
            nom: true,
            prefixe_contrat: true,
            ordre: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/ical-sources/:id", async (req, res, next) => {
  try {
    const existing = await prisma.icalSource.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: "Source iCal introuvable." });
    }

    await prisma.icalSource.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/ical/cron", (_req, res) => {
  res.json(getIcalCronState());
});

router.put("/ical/cron", async (req, res, next) => {
  try {
    const payload = cronConfigSchema.parse(req.body) as IcalCronConfig;
    const config = await updateIcalSyncCronConfig(payload);
    res.json({
      config,
      state: getIcalCronState(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/ical/cron/config", (_req, res) => {
  res.json(getIcalSyncCronConfig());
});

router.post("/ical/preview", async (_req, res, next) => {
  try {
    const preview = await previewIcalReservations();
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

router.post("/ical/sync", async (_req, res, next) => {
  try {
    const summary = await syncIcalReservations({ log_source: "ical-manual" });
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

router.get("/import-log", (req, res) => {
  res.json(buildImportLogResponse(req.query.limit));
});

router.post("/har/preview", async (req, res, next) => {
  try {
    const payload = harPayloadSchema.parse(req.body);
    const preview = await buildHarPreview(payload.har);
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

router.post("/har/import", async (req, res, next) => {
  try {
    const payload = harPayloadSchema.parse(req.body);
    const preview = await buildHarPreview(payload.har);

    const selectedIds = payload.selected_ids ? new Set(payload.selected_ids) : null;
    const importable = preview.reservations.filter((item) => {
      if (item.status !== "new" && item.status !== "existing_updatable") return false;
      if (!selectedIds) return true;
      return selectedIds.has(item.id);
    });

    let createdCount = 0;
    let updatedCount = 0;
    const createdIds = new Set<string>();
    const updatedIds = new Set<string>();
    const insertedItems: Array<{ giteName: string; giteId: string; checkIn: string; checkOut: string; source: string }> = [];
    const updatedItems: Array<{ giteName: string; giteId: string; checkIn: string; checkOut: string; source: string }> = [];

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
            hote_nom: item.hote_nom ?? UNKNOWN_HOST,
            date_entree: dateEntree,
            date_sortie: dateSortie,
            nb_nuits: nights,
            nb_adultes: 0,
            prix_par_nuit: prixParNuit,
            prix_total: prixTotal,
            source_paiement: item.source_type,
            commentaire: item.commentaire ?? null,
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

        const updateData = buildHarUpdateData(existing, item);
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
        });
      }
    }

    const skippedCount =
      preview.reservations.length -
      importable.length +
      importable.filter((item) => item.status === "existing_updatable" && item.update_fields.length === 0).length;

    const response = {
      ...preview,
      selected_count: importable.length,
      created_count: createdCount,
      updated_count: updatedCount,
      skipped_count: Math.max(0, skippedCount),
    };

    try {
      appendImportLog(
        buildImportLogEntry({
          source: "har",
          selectionCount: importable.length,
          inserted: createdCount,
          updated: updatedCount,
          skipped: {
            unknown: Math.max(0, skippedCount),
          },
          perGite: buildHarPerGiteSummary(preview, importable, createdIds, updatedIds),
          insertedItems,
          updatedItems,
        })
      );
    } catch {
      // Ignore import-log write failures
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;

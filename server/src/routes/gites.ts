import { Router } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import prisma from "../db/prisma.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";
import { toNumber } from "../utils/money.js";
import { getGitePhotoPaths, resolveStoredDataFilePath } from "../utils/paths.js";
import { getGiteIcalExport } from "../services/icalExport.js";
import { generateIcalExportToken } from "../utils/reservationOrigin.js";
import {
  assertNoSeasonRateOverlap,
  formatBookedDateInput,
  hydrateSeasonRate,
  parseBookedDateInput,
  BookedValidationError,
} from "../services/booked.js";
import {
  loadSeasonRateEditorData,
  saveSeasonRateEditorPayload,
  type SeasonRateEditorPayload,
} from "../services/seasonRateEditor.js";
import {
  getGitePhotosWordPressWebhookStatus,
  scheduleGitePhotosWordPressWebhook,
} from "../services/bookedWordPressWebhook.js";
import {
  hasGiteExpenseCategorySettings,
  normalizeGiteExpenseCategories,
  readGiteExpenseCategorySettings,
  writeGiteExpenseCategorySettings,
} from "../services/giteExpenseCategorySettings.js";

const router = Router();
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeStringSchema = z.string().regex(timePattern, "Format attendu HH:MM");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const colorPattern = /^#[0-9a-f]{6}$/i;
const GITE_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const GITE_PHOTO_ALLOWED_MIME_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
]);
const GITE_PHOTO_ALLOWED_EXTENSIONS = new Map(
  [...GITE_PHOTO_ALLOWED_MIME_TYPES.entries()].flatMap(([mimeType, extension]) => {
    const entries: Array<[string, string]> = [[extension, mimeType]];
    if (extension === ".jpg") entries.push([".jpeg", mimeType]);
    return entries;
  })
);
const emptyStringToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};
const publicJsonFieldSchema = z.preprocess(emptyStringToNull, z.unknown().nullable()).optional();
const publicWebInfoSchema = z
  .object({
    surface_m2: z.preprocess(emptyStringToNull, z.coerce.number().int().min(1).nullable()).optional(),
    max_people: z.preprocess(emptyStringToNull, z.coerce.number().int().min(1).nullable()).optional(),
    sleeping_capacity: z.preprocess(emptyStringToNull, z.coerce.number().int().min(1).nullable()).optional(),
    fireplace: z.boolean().default(false),
    private_garden: z.boolean().default(false),
    private_courtyard: z.boolean().default(false),
  })
  .optional()
  .default({});
const expenseCategorySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  color: z.string().trim().regex(colorPattern),
});
const expenseLineSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().default(""),
  category_id: z.string().trim().default(""),
  monthly_amount: z.coerce.number().min(0).default(0),
  annual_amount: z.coerce.number().min(0).default(0),
  notes: z.string().trim().default(""),
});
const expenseManagementSchema = z
  .object({
    version: z.coerce.number().int().min(1).default(1),
    categories: z.array(expenseCategorySchema).default([]),
    expenses: z.array(expenseLineSchema).default([]),
  })
  .default({ version: 1, categories: [], expenses: [] });
const expenseCategorySettingsSchema = z.object({
  categories: z.array(expenseCategorySchema).min(1),
});

const giteSchemaShape = {
  nom: z.string().trim().min(1),
  prefixe_contrat: z.string().trim().min(2),
  adresse_ligne1: z.string().trim().min(1),
  adresse_ligne2: z.preprocess(emptyStringToNull, z.string().nullable()).optional(),
  capacite_max: z.coerce.number().int().min(1),
  nb_adultes_max: z.coerce.number().int().min(1),
  nb_adultes_habituel: z.coerce.number().int().min(1),
  nb_enfants_max: z.coerce.number().int().min(0).optional(),
  proprietaires_noms: z.string().trim().min(1),
  proprietaires_adresse: z.string().trim().min(1),
  site_web: z.preprocess(emptyStringToNull, z.string().nullable()).optional(),
  public_slug: z.preprocess(
    emptyStringToNull,
    z.string().trim().toLowerCase().regex(slugPattern, "Slug public invalide.").nullable()
  ).optional(),
  public_title: z.preprocess(emptyStringToNull, z.string().trim().max(140).nullable()).optional(),
  public_summary: z.preprocess(emptyStringToNull, z.string().trim().max(500).nullable()).optional(),
  public_description: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  public_technical_description: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  public_seo_title: z.preprocess(emptyStringToNull, z.string().trim().max(70).nullable()).optional(),
  public_seo_description: z.preprocess(emptyStringToNull, z.string().trim().max(180).nullable()).optional(),
  public_is_published: z.boolean().default(false),
  public_structured_content: publicJsonFieldSchema,
  public_equipment: publicJsonFieldSchema,
  public_rooms: publicJsonFieldSchema,
  public_practical_info: publicJsonFieldSchema,
  public_location_info: publicJsonFieldSchema,
  public_web_info: publicWebInfoSchema,
  public_latitude: z.preprocess(emptyStringToNull, z.coerce.number().min(-90).max(90).nullable()).optional(),
  public_longitude: z.preprocess(emptyStringToNull, z.coerce.number().min(-180).max(180).nullable()).optional(),
  email: z.preprocess(emptyStringToNull, z.string().email().nullable()).optional(),
  caracteristiques: z.preprocess(emptyStringToNull, z.string().nullable()).optional(),
  airbnb_listing_id: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  telephones: z.array(z.string()).default([]),
  taxe_sejour_par_personne_par_nuit: z.coerce.number().min(0),
  iban: z.string().trim().min(1),
  bic: z.preprocess(emptyStringToNull, z.string().nullable()).optional(),
  titulaire: z.string().trim().min(1),
  regle_animaux_acceptes: z.boolean().default(false),
  regle_bois_premiere_flambee: z.boolean().default(false),
  regle_tiers_personnes_info: z.boolean().default(false),
  options_draps_par_lit: z.coerce.number().min(0).default(0),
  options_linge_toilette_par_personne: z.coerce.number().min(0).default(0),
  options_menage_forfait: z.coerce.number().min(0).default(0),
  options_depart_tardif_forfait: z.coerce.number().min(0).default(0),
  options_chiens_forfait: z.coerce.number().min(0).default(0),
  heure_arrivee_defaut: timeStringSchema.default("17:00"),
  heure_depart_defaut: timeStringSchema.default("12:00"),
  caution_montant_defaut: z.coerce.number().min(0).default(0),
  cheque_menage_montant_defaut: z.coerce.number().min(0).default(0),
  arrhes_taux_defaut: z.coerce.number().min(0).max(1).default(0.2),
  electricity_price_per_kwh: z.coerce.number().min(0).default(0),
  frais_gestion: expenseManagementSchema.optional().default({ version: 1, categories: [], expenses: [] }),
  prix_nuit_basse_saison: z.coerce.number().min(0).default(0),
  prix_nuit_haute_saison: z.coerce.number().min(0).default(0),
  min_nuits_toute_annee: z.coerce.number().int().min(1).default(1),
  min_nuits_vacances_scolaires: z.coerce.number().int().min(1).default(1),
  min_nuits_juillet_aout: z.coerce.number().int().min(1).default(1),
  prix_nuit_liste: z.array(z.coerce.number().min(0)).optional().default([]),
  gestionnaire_id: z.preprocess(emptyStringToNull, z.string().trim().min(1).nullable()).optional().default(null),
};

const resolveChildrenMax = (value: {
  nb_adultes_max: number;
  capacite_max: number;
  nb_enfants_max?: number | null;
}) => {
  const fallback = Math.max(0, value.capacite_max - value.nb_adultes_max);
  const normalized = Math.trunc(Number(value.nb_enfants_max ?? fallback));
  return Number.isFinite(normalized) ? Math.max(0, normalized) : fallback;
};

const normalizeMinNights = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(1, Math.trunc(numericValue)) : 1;
};

const normalizeMoney = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? Math.round(numericValue * 100) / 100 : 0;
};

const normalizeOptionalPositiveInt = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 1) return null;
  return Math.trunc(numericValue);
};

const normalizePublicWebInfo = (value: unknown) => {
  const parsed = publicWebInfoSchema.parse(value ?? {});
  return {
    surface_m2: normalizeOptionalPositiveInt(parsed.surface_m2),
    max_people: normalizeOptionalPositiveInt(parsed.max_people),
    sleeping_capacity: normalizeOptionalPositiveInt(parsed.sleeping_capacity),
    fireplace: Boolean(parsed.fireplace),
    private_garden: Boolean(parsed.private_garden),
    private_courtyard: Boolean(parsed.private_courtyard),
  };
};

const normalizeExpenseManagement = (value: unknown) => {
  const parsed = expenseManagementSchema.parse(value ?? { version: 1, categories: [], expenses: [] });
  const categories = readGiteExpenseCategorySettings({
    categories: normalizeGiteExpenseCategories(parsed.categories),
  }).categories;
  const categoryIds = new Set(categories.map((category) => category.id));
  const fallbackCategoryId = categories[0]?.id ?? "";
  const expenses = parsed.expenses
    .map((expense) => {
      const rawMonthlyAmount = normalizeMoney(expense.monthly_amount);
      const rawAnnualAmount = normalizeMoney(expense.annual_amount);
      const monthlyAmount = rawMonthlyAmount > 0 ? rawMonthlyAmount : normalizeMoney(rawAnnualAmount / 12);
      const annualAmount = rawAnnualAmount > 0 ? rawAnnualAmount : normalizeMoney(monthlyAmount * 12);
      return {
        ...expense,
        label: expense.label.trim(),
        category_id: categoryIds.has(expense.category_id) ? expense.category_id : fallbackCategoryId,
        monthly_amount: monthlyAmount,
        annual_amount: annualAmount,
        notes: expense.notes.trim(),
      };
    })
    .filter(
      (expense) =>
        expense.label.length > 0 || expense.notes.length > 0 || expense.monthly_amount > 0 || expense.annual_amount > 0
    );
  return {
    version: 1,
    categories,
    expenses,
  };
};

const validateGiteInput = (
  value: {
    nb_adultes_max: number;
    nb_adultes_habituel: number;
    capacite_max: number;
    nb_enfants_max?: number | null;
    public_is_published?: boolean;
    public_slug?: string | null;
  },
  ctx: z.RefinementCtx
) => {
  if (value.nb_adultes_max > value.capacite_max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nb_adultes_max"],
      message: "Le nombre d'adultes max ne peut pas dépasser la capacité max.",
    });
  }

  if (value.nb_adultes_habituel > value.nb_adultes_max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nb_adultes_habituel"],
      message: "Le nombre d'adultes habituel ne peut pas dépasser le nombre d'adultes max.",
    });
  }

  if (value.public_is_published && !value.public_slug) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["public_slug"],
      message: "Un slug public est requis pour publier un gîte.",
    });
  }
};

const giteSchema = z.object(giteSchemaShape).superRefine(validateGiteInput);
const giteReorderSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1),
});
const giteImportItemSchema = z.object({
  ...giteSchemaShape,
  nb_adultes_max: z.coerce.number().int().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  ordre: z.coerce.number().int().min(0).optional(),
}).superRefine((value, ctx) =>
  validateGiteInput(
    {
      ...value,
      nb_adultes_max: value.nb_adultes_max ?? value.capacite_max,
    },
    ctx
  )
);
const giteImportSchema = z.object({
  gites: z.array(giteImportItemSchema).min(1),
});
const seasonRateSchema = z.object({
  date_debut: z.string().trim().min(1),
  date_fin: z.string().trim().min(1),
  prix_par_nuit: z.coerce.number().min(0),
  min_nuits: z.coerce.number().int().min(1).default(1),
});
const seasonRateReorderSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1),
});
const seasonRateEditorQuerySchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  zone: z.string().trim().min(1).max(8).optional().default("B"),
});
const seasonRateEditorSegmentSchema = z.object({
  date_debut: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_fin: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  min_nuits: z.coerce.number().int().min(1),
  min_nuits_by_gite: z.record(z.string().trim().min(1), z.coerce.number().int().min(1)).optional(),
  prices_by_gite: z.record(z.string().trim().min(1), z.coerce.number().min(0)),
});
const seasonRateEditorPayloadSchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  zone: z.string().trim().min(1).max(8).optional().default("B"),
  segments: z.array(seasonRateEditorSegmentSchema).min(1),
});
const gitePhotoSchema = z.object({
  url: z.string().trim().min(1),
  title: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  alt: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  credit: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  is_primary: z.boolean().default(false),
  is_public: z.boolean().default(true),
});
const gitePhotoUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().optional(),
  data: z.string().trim().min(1),
  title: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  alt: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  credit: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  is_primary: z.boolean().default(false),
  is_public: z.boolean().default(true),
});
const gitePhotoReorderSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1),
});
type GiteInput = z.infer<typeof giteSchema>;
type GiteImportInput = z.infer<typeof giteImportItemSchema>;

const toGitePersistenceData = (payload: GiteInput) => ({
  ...payload,
  nb_enfants_max: resolveChildrenMax(payload),
  prefixe_contrat: payload.prefixe_contrat.trim().toUpperCase(),
  telephones: encodeJsonField(payload.telephones),
  prix_nuit_liste: encodeJsonField(payload.prix_nuit_liste),
  public_structured_content: encodeJsonField(payload.public_structured_content ?? null),
  public_equipment: encodeJsonField(payload.public_equipment ?? null),
  public_rooms: encodeJsonField(payload.public_rooms ?? null),
  public_practical_info: encodeJsonField(payload.public_practical_info ?? null),
  public_location_info: encodeJsonField(payload.public_location_info ?? null),
  public_web_info: encodeJsonField(normalizePublicWebInfo(payload.public_web_info)),
  frais_gestion: encodeJsonField(normalizeExpenseManagement(payload.frais_gestion)),
});

const toGiteInput = (payload: GiteImportInput): GiteInput => {
  const { id: _id, ordre: _ordre, ...data } = payload;
  const nb_adultes_max = payload.nb_adultes_max ?? payload.capacite_max;
  return {
    ...data,
    nb_adultes_max,
    nb_enfants_max: resolveChildrenMax({
      ...payload,
      nb_adultes_max,
    }),
  };
};

const getNextGiteOrder = async () => {
  const aggregate = await prisma.gite.aggregate({
    _max: { ordre: true },
  });
  return (aggregate._max.ordre ?? -1) + 1;
};

const gestionnaireExists = async (gestionnaireId?: string | null) => {
  if (!gestionnaireId) return true;
  const existing = await prisma.gestionnaire.findUnique({
    where: { id: gestionnaireId },
    select: { id: true },
  });
  return Boolean(existing);
};

const hydrateGite = (gite: any) => {
  const { _count, ...rest } = gite ?? {};
  const telephonesRaw = fromJsonString<unknown>(gite.telephones, []);
  const prixNuitListeRaw = fromJsonString<unknown>(gite.prix_nuit_liste, []);
  const photos = Array.isArray(gite.photos)
    ? gite.photos.map((photo: any) => ({
        ...photo,
        is_primary: Boolean(photo.is_primary),
        is_public: Boolean(photo.is_public),
      }))
    : [];
  const telephones = Array.isArray(telephonesRaw)
    ? telephonesRaw.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const prix_nuit_liste = Array.isArray(prixNuitListeRaw)
    ? prixNuitListeRaw
        .map((value) => toNumber(value as any))
        .filter((value) => Number.isFinite(value) && value >= 0)
    : [];

  return {
    ...rest,
    telephones,
    taxe_sejour_par_personne_par_nuit: toNumber(rest.taxe_sejour_par_personne_par_nuit),
    options_draps_par_lit: toNumber(rest.options_draps_par_lit),
    options_linge_toilette_par_personne: toNumber(rest.options_linge_toilette_par_personne),
    options_menage_forfait: toNumber(rest.options_menage_forfait),
    options_depart_tardif_forfait: toNumber(rest.options_depart_tardif_forfait),
    options_chiens_forfait: toNumber(rest.options_chiens_forfait),
    caution_montant_defaut: toNumber(rest.caution_montant_defaut),
    cheque_menage_montant_defaut: toNumber(rest.cheque_menage_montant_defaut),
    arrhes_taux_defaut: toNumber(rest.arrhes_taux_defaut),
    electricity_price_per_kwh: toNumber(rest.electricity_price_per_kwh),
    prix_nuit_basse_saison: toNumber(rest.prix_nuit_basse_saison),
    prix_nuit_haute_saison: toNumber(rest.prix_nuit_haute_saison),
    min_nuits_toute_annee: normalizeMinNights(rest.min_nuits_toute_annee),
    min_nuits_vacances_scolaires: normalizeMinNights(rest.min_nuits_vacances_scolaires),
    min_nuits_juillet_aout: normalizeMinNights(rest.min_nuits_juillet_aout),
    prix_nuit_liste,
    public_structured_content: fromJsonString<unknown>(rest.public_structured_content, null),
    public_equipment: fromJsonString<unknown>(rest.public_equipment, null),
    public_rooms: fromJsonString<unknown>(rest.public_rooms, null),
    public_practical_info: fromJsonString<unknown>(rest.public_practical_info, null),
    public_location_info: fromJsonString<unknown>(rest.public_location_info, null),
    public_web_info: normalizePublicWebInfo(fromJsonString<unknown>(rest.public_web_info, null)),
    frais_gestion: normalizeExpenseManagement(fromJsonString<unknown>(rest.frais_gestion, null)),
    public_latitude: rest.public_latitude === null || rest.public_latitude === undefined ? null : toNumber(rest.public_latitude),
    public_longitude: rest.public_longitude === null || rest.public_longitude === undefined ? null : toNumber(rest.public_longitude),
    photos,
    contrats_count: typeof _count?.contrats === "number" ? _count.contrats : gite.contrats_count,
    factures_count: typeof _count?.factures === "number" ? _count.factures : gite.factures_count,
    reservations_count:
      typeof _count?.reservations === "number" ? _count.reservations : gite.reservations_count,
  };
};

const mapBookedError = (error: unknown) => {
  if (error instanceof BookedValidationError) {
    return {
      status: error.statusCode,
      body: {
        error: error.message,
        code: error.code,
        details: error.details,
      },
    };
  }
  return null;
};

const resolveGitePhotoMimeType = (filename: string, mimeType?: string | null) => {
  const normalizedMimeType = String(mimeType ?? "").trim().toLowerCase();
  if (GITE_PHOTO_ALLOWED_MIME_TYPES.has(normalizedMimeType)) return normalizedMimeType;
  const extension = path.extname(filename).toLowerCase();
  return GITE_PHOTO_ALLOWED_EXTENSIONS.get(extension) ?? null;
};

const resolveGitePhotoExtension = (filename: string, mimeType: string) => {
  const extension = path.extname(filename).toLowerCase();
  if (GITE_PHOTO_ALLOWED_EXTENSIONS.has(extension)) return extension === ".jpeg" ? ".jpg" : extension;
  return GITE_PHOTO_ALLOWED_MIME_TYPES.get(mimeType) ?? ".bin";
};

const decodeBase64Payload = (value: string) => {
  const normalized = value.includes(",") ? value.slice(value.lastIndexOf(",") + 1) : value;
  const compact = normalized.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    throw new Error("Contenu de fichier invalide.");
  }
  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length) throw new Error("Fichier vide.");
  return buffer;
};

const resolvePhotoContentType = (url: string) => {
  const extension = path.extname(url).toLowerCase();
  return GITE_PHOTO_ALLOWED_EXTENSIONS.get(extension) ?? "application/octet-stream";
};

const sendPhotoFile = async (photo: { url: string }, res: any) => {
  if (!photo.url.startsWith("/api/")) {
    return res.redirect(photo.url);
  }
  const marker = "/file/";
  const markerIndex = photo.url.indexOf(marker);
  if (markerIndex < 0) {
    return res.status(404).json({ error: "Fichier photo introuvable" });
  }
  const relativePath = decodeURIComponent(photo.url.slice(markerIndex + marker.length));
  const absolutePath = resolveStoredDataFilePath(relativePath);
  if (!absolutePath) {
    return res.status(404).json({ error: "Fichier photo introuvable" });
  }
  res.setHeader("Content-Type", resolvePhotoContentType(relativePath));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.sendFile(absolutePath);
};

const buildInitialExpenseCategorySettings = async () => {
  if (hasGiteExpenseCategorySettings()) return readGiteExpenseCategorySettings();

  const gites = await prisma.gite.findMany({
    orderBy: [{ ordre: "asc" }, { nom: "asc" }],
    select: { frais_gestion: true },
  });
  const categories: unknown[] = [];
  const seenIds = new Set<string>();

  for (const gite of gites) {
    const value = fromJsonString<any>(gite.frais_gestion, null);
    const rows = Array.isArray(value?.categories) ? value.categories : [];
    for (const row of rows) {
      const id = String(row?.id ?? "").trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      categories.push(row);
    }
  }

  const settings = { categories: normalizeGiteExpenseCategories(categories) };
  writeGiteExpenseCategorySettings(settings);
  return settings;
};

router.get("/expense-categories", async (_req, res, next) => {
  try {
    res.json(await buildInitialExpenseCategorySettings());
  } catch (err) {
    next(err);
  }
});

router.put("/expense-categories", async (req, res, next) => {
  try {
    const payload = expenseCategorySettingsSchema.parse(req.body ?? {});
    const settings = { categories: normalizeGiteExpenseCategories(payload.categories) };
    writeGiteExpenseCategorySettings(settings);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const gites = await prisma.gite.findMany({
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      include: {
        gestionnaire: { select: { id: true, prenom: true, nom: true } },
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
        _count: { select: { contrats: true, factures: true, reservations: true } },
      },
    });
    res.json(gites.map(hydrateGite));
  } catch (err) {
    next(err);
  }
});

router.post("/reorder", async (req, res, next) => {
  try {
    const { ids } = giteReorderSchema.parse(req.body);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) {
      return res.status(400).json({ error: "La liste de réorganisation contient des doublons." });
    }

    const gites = await prisma.gite.findMany({ select: { id: true } });
    if (gites.length !== ids.length) {
      return res.status(400).json({ error: "La liste de réorganisation est incomplète." });
    }
    const existingIds = new Set(gites.map((gite) => gite.id));
    if (ids.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: "La liste de réorganisation contient des identifiants inconnus." });
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.gite.update({
          where: { id },
          data: { ordre: index },
        })
      )
    );

    const updated = await prisma.gite.findMany({
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      include: {
        gestionnaire: { select: { id: true, prenom: true, nom: true } },
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
        _count: { select: { contrats: true, factures: true, reservations: true } },
      },
    });
    res.json(updated.map(hydrateGite));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = giteSchema.parse(req.body);
    if (!(await gestionnaireExists(parsed.gestionnaire_id))) {
      return res.status(400).json({ error: "Gestionnaire introuvable." });
    }
    const ordre = await getNextGiteOrder();
    const gite = await prisma.gite.create({
      data: {
        ordre,
        ical_export_token: generateIcalExportToken(),
        ...toGitePersistenceData(parsed),
      },
      include: {
        gestionnaire: { select: { id: true, prenom: true, nom: true } },
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
      },
    });
    res.status(201).json(hydrateGite(gite));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const parsed = giteSchema.parse(req.body);
    if (!(await gestionnaireExists(parsed.gestionnaire_id))) {
      return res.status(400).json({ error: "Gestionnaire introuvable." });
    }
    const gite = await prisma.gite.update({
      where: { id: req.params.id },
      data: toGitePersistenceData(parsed),
      include: {
        gestionnaire: { select: { id: true, prenom: true, nom: true } },
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
      },
    });
    res.json(hydrateGite(gite));
  } catch (err) {
    next(err);
  }
});

router.get("/export", async (_req, res, next) => {
  try {
    const gites = await prisma.gite.findMany({
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      include: {
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
        _count: { select: { contrats: true, factures: true, reservations: true } },
      },
    });

    const exportRows = gites.map((gite) => {
      const hydrated = hydrateGite(gite);
      const {
        contrats_count: _contratsCount,
        factures_count: _facturesCount,
        reservations_count: _reservationsCount,
        ...data
      } = hydrated;
      return data;
    });

    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      gites: exportRows,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/season-rates", async (req, res, next) => {
  try {
    const rates = await prisma.giteSeasonRate.findMany({
      where: { gite_id: req.params.id },
      orderBy: [{ ordre: "asc" }, { date_debut: "asc" }, { createdAt: "asc" }],
    });
    res.json(rates.map(hydrateSeasonRate));
  } catch (error) {
    next(error);
  }
});

router.get("/season-rates/editor", async (req, res, next) => {
  try {
    const query = seasonRateEditorQuerySchema.parse({
      from: req.query.from,
      to: req.query.to,
      zone: req.query.zone,
    });
    res.json(await loadSeasonRateEditorData(query));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.put("/season-rates/editor", async (req, res, next) => {
  try {
    const payload = seasonRateEditorPayloadSchema.parse(req.body ?? {}) as SeasonRateEditorPayload;
    res.json(await saveSeasonRateEditorPayload(payload));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/:id/season-rates", async (req, res, next) => {
  try {
    const payload = seasonRateSchema.parse(req.body ?? {});
    const dateDebut = parseBookedDateInput(payload.date_debut, "date_debut");
    const dateFin = parseBookedDateInput(payload.date_fin, "date_fin");
    if (dateFin.getTime() <= dateDebut.getTime()) {
      return res.status(400).json({ error: "La date de fin doit être postérieure à la date de début." });
    }

    const aggregate = await prisma.giteSeasonRate.aggregate({
      where: { gite_id: req.params.id },
      _max: { ordre: true },
    });
    await assertNoSeasonRateOverlap({
      giteId: req.params.id,
      dateDebut,
      dateFin,
    });

    const created = await prisma.giteSeasonRate.create({
      data: {
        gite_id: req.params.id,
        date_debut: dateDebut,
        date_fin: dateFin,
        prix_par_nuit: payload.prix_par_nuit,
        min_nuits: payload.min_nuits,
        ordre: (aggregate._max.ordre ?? -1) + 1,
      },
    });

    res.status(201).json(hydrateSeasonRate(created as any));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.put("/:id/season-rates/:rateId", async (req, res, next) => {
  try {
    const payload = seasonRateSchema.parse(req.body ?? {});
    const dateDebut = parseBookedDateInput(payload.date_debut, "date_debut");
    const dateFin = parseBookedDateInput(payload.date_fin, "date_fin");
    if (dateFin.getTime() <= dateDebut.getTime()) {
      return res.status(400).json({ error: "La date de fin doit être postérieure à la date de début." });
    }

    await assertNoSeasonRateOverlap({
      giteId: req.params.id,
      dateDebut,
      dateFin,
      excludeId: req.params.rateId,
    });

    const updated = await prisma.giteSeasonRate.update({
      where: { id: req.params.rateId },
      data: {
        date_debut: dateDebut,
        date_fin: dateFin,
        prix_par_nuit: payload.prix_par_nuit,
        min_nuits: payload.min_nuits,
      },
    });

    res.json(hydrateSeasonRate(updated as any));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/:id/season-rates/reorder", async (req, res, next) => {
  try {
    const { ids } = seasonRateReorderSchema.parse(req.body ?? {});
    const existing = await prisma.giteSeasonRate.findMany({
      where: { gite_id: req.params.id },
      select: { id: true },
      orderBy: [{ ordre: "asc" }, { date_debut: "asc" }],
    });
    if (existing.length !== ids.length) {
      return res.status(400).json({ error: "La liste de réorganisation est incomplète." });
    }

    const existingIds = new Set(existing.map((item) => item.id));
    if (ids.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: "La liste de réorganisation contient des identifiants inconnus." });
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.giteSeasonRate.update({
          where: { id },
          data: { ordre: index },
        })
      )
    );

    const updated = await prisma.giteSeasonRate.findMany({
      where: { gite_id: req.params.id },
      orderBy: [{ ordre: "asc" }, { date_debut: "asc" }],
    });
    res.json(updated.map(hydrateSeasonRate as any));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/season-rates/:rateId", async (req, res, next) => {
  try {
    await prisma.giteSeasonRate.delete({
      where: { id: req.params.rateId },
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/:id/calendar.ics", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!token) {
      return res.status(404).json({ error: "Calendrier introuvable." });
    }

    const exportFeed = await getGiteIcalExport({
      giteId: req.params.id,
      token,
    });
    if (!exportFeed) {
      return res.status(404).json({ error: "Calendrier introuvable." });
    }

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${exportFeed.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(exportFeed.body);
  } catch (err) {
    next(err);
  }
});

router.post("/import", async (req, res, next) => {
  try {
    const payload = giteImportSchema.parse(req.body);
    const normalized = payload.gites.map((item) => ({
      ...item,
      prefixe_contrat: item.prefixe_contrat.trim().toUpperCase(),
    }));

    const seenIds = new Set<string>();
    const seenPrefixes = new Set<string>();
    for (const row of normalized) {
      if (row.id) {
        if (seenIds.has(row.id)) {
          return res.status(400).json({ error: `Identifiant dupliqué dans l'import: ${row.id}` });
        }
        seenIds.add(row.id);
      }
      if (seenPrefixes.has(row.prefixe_contrat)) {
        return res
          .status(400)
          .json({ error: `Préfixe contrat dupliqué dans l'import: ${row.prefixe_contrat}` });
      }
      seenPrefixes.add(row.prefixe_contrat);
    }

    const gestionnaireIds = [...new Set(normalized.map((row) => row.gestionnaire_id).filter(Boolean))] as string[];
    if (gestionnaireIds.length > 0) {
      const existingManagers = await prisma.gestionnaire.findMany({
        where: { id: { in: gestionnaireIds } },
        select: { id: true },
      });
      if (existingManagers.length !== gestionnaireIds.length) {
        return res.status(400).json({ error: "L'import contient un gestionnaire introuvable." });
      }
    }

    const existing = await prisma.gite.findMany({
      select: { id: true, ordre: true },
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
    });
    const existingIds = new Set(existing.map((item) => item.id));

    let createdCount = 0;
    let updatedCount = 0;

    await prisma.$transaction(async (tx) => {
      const importedIds: string[] = [];
      const importedIdSet = new Set<string>();

      for (const row of normalized) {
        const data = toGitePersistenceData(toGiteInput(row));
        if (row.id && existingIds.has(row.id)) {
          await tx.gite.update({
            where: { id: row.id },
            data,
          });
          updatedCount += 1;
          importedIds.push(row.id);
          importedIdSet.add(row.id);
          continue;
        }

        const created = await tx.gite.create({
          data: {
            ...(row.id ? { id: row.id } : {}),
            ...data,
            ical_export_token: generateIcalExportToken(),
            ordre: 0,
          },
        });
        createdCount += 1;
        importedIds.push(created.id);
        importedIdSet.add(created.id);
      }

      const remainingIds = existing
        .map((item) => item.id)
        .filter((id) => !importedIdSet.has(id));
      const finalOrder = [...importedIds, ...remainingIds];

      await Promise.all(
        finalOrder.map((id, index) =>
          tx.gite.update({
            where: { id },
            data: { ordre: index },
          })
        )
      );
    });

    const gites = await prisma.gite.findMany({
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      include: {
        gestionnaire: { select: { id: true, prenom: true, nom: true } },
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
        _count: { select: { contrats: true, factures: true, reservations: true } },
      },
    });

    res.json({
      created_count: createdCount,
      updated_count: updatedCount,
      gites: gites.map(hydrateGite),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/photos", async (req, res, next) => {
  try {
    const payload = gitePhotoSchema.parse(req.body ?? {});
    const gite = await prisma.gite.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!gite) return res.status(404).json({ error: "Gite introuvable" });

    const aggregate = await prisma.gitePhoto.aggregate({
      where: { gite_id: req.params.id },
      _max: { ordre: true },
    });
    const ordre = (aggregate._max.ordre ?? -1) + 1;
    const created = await prisma.$transaction(async (tx) => {
      if (payload.is_primary) {
        await tx.gitePhoto.updateMany({
          where: { gite_id: req.params.id },
          data: { is_primary: false },
        });
      }
      return tx.gitePhoto.create({
        data: {
          ...payload,
          gite_id: req.params.id,
          ordre,
        },
      });
    });

    void scheduleGitePhotosWordPressWebhook(req.params.id).catch((error) => {
      console.warn(`WordPress photo sync scheduling failed for gite ${req.params.id}:`, error);
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.get("/:id/photos/wordpress-sync", async (req, res, next) => {
  try {
    const gite = await prisma.gite.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!gite) return res.status(404).json({ error: "Gite introuvable" });
    res.json(await getGitePhotosWordPressWebhookStatus(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/photos/upload", async (req, res, next) => {
  try {
    const payload = gitePhotoUploadSchema.parse(req.body ?? {});
    const gite = await prisma.gite.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!gite) return res.status(404).json({ error: "Gite introuvable" });

    const mimeType = resolveGitePhotoMimeType(payload.filename, payload.mimeType ?? null);
    if (!mimeType) {
      return res.status(400).json({ error: "Format non pris en charge. Utilisez JPG, PNG, WEBP ou AVIF." });
    }

    const buffer = decodeBase64Payload(payload.data);
    if (buffer.length > GITE_PHOTO_MAX_BYTES) {
      return res.status(400).json({
        error: `La photo dépasse la taille maximale autorisée (${Math.round(GITE_PHOTO_MAX_BYTES / (1024 * 1024))} Mo).`,
      });
    }

    const id = `photo_${crypto.randomUUID().replace(/-/g, "")}`;
    const extension = resolveGitePhotoExtension(payload.filename, mimeType);
    const { absolutePath, relativePath } = getGitePhotoPaths(req.params.id, id, extension);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    const aggregate = await prisma.gitePhoto.aggregate({
      where: { gite_id: req.params.id },
      _max: { ordre: true },
    });
    const ordre = (aggregate._max.ordre ?? -1) + 1;
    const localUrl = `/api/gites/${req.params.id}/photos/${id}/file/${encodeURIComponent(relativePath)}`;

    const created = await prisma.$transaction(async (tx) => {
      if (payload.is_primary) {
        await tx.gitePhoto.updateMany({
          where: { gite_id: req.params.id },
          data: { is_primary: false },
        });
      }
      return tx.gitePhoto.create({
        data: {
          id,
          gite_id: req.params.id,
          url: localUrl,
          title: payload.title,
          alt: payload.alt,
          credit: payload.credit,
          is_primary: payload.is_primary,
          is_public: payload.is_public,
          ordre,
        },
      });
    });

    void scheduleGitePhotosWordPressWebhook(req.params.id).catch((error) => {
      console.warn(`WordPress photo sync scheduling failed for gite ${req.params.id}:`, error);
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/photos/:photoId", async (req, res, next) => {
  try {
    const payload = gitePhotoSchema.parse(req.body ?? {});
    const existing = await prisma.gitePhoto.findFirst({
      where: { id: req.params.photoId, gite_id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Photo introuvable" });

    const updated = await prisma.$transaction(async (tx) => {
      if (payload.is_primary) {
        await tx.gitePhoto.updateMany({
          where: { gite_id: req.params.id, id: { not: req.params.photoId } },
          data: { is_primary: false },
        });
      }
      return tx.gitePhoto.update({
        where: { id: req.params.photoId },
        data: payload,
      });
    });

    void scheduleGitePhotosWordPressWebhook(req.params.id).catch((error) => {
      console.warn(`WordPress photo sync scheduling failed for gite ${req.params.id}:`, error);
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/photos/reorder", async (req, res, next) => {
  try {
    const { ids } = gitePhotoReorderSchema.parse(req.body ?? {});
    const existing = await prisma.gitePhoto.findMany({
      where: { gite_id: req.params.id },
      select: { id: true },
      orderBy: [{ ordre: "asc" }, { createdAt: "asc" }],
    });
    if (existing.length !== ids.length) {
      return res.status(400).json({ error: "La liste de réorganisation est incomplète." });
    }

    const existingIds = new Set(existing.map((item) => item.id));
    if (ids.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: "La liste de réorganisation contient des identifiants inconnus." });
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.gitePhoto.update({
          where: { id },
          data: { ordre: index },
        })
      )
    );

    const updated = await prisma.gitePhoto.findMany({
      where: { gite_id: req.params.id },
      orderBy: [{ ordre: "asc" }, { createdAt: "asc" }],
    });
    void scheduleGitePhotosWordPressWebhook(req.params.id).catch((error) => {
      console.warn(`WordPress photo sync scheduling failed for gite ${req.params.id}:`, error);
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/photos/:photoId", async (req, res, next) => {
  try {
    const existing = await prisma.gitePhoto.findFirst({
      where: { id: req.params.photoId, gite_id: req.params.id },
      select: { id: true, url: true },
    });
    if (!existing) return res.status(404).json({ error: "Photo introuvable" });
    await prisma.gitePhoto.delete({ where: { id: req.params.photoId } });
    if (existing.url.startsWith("/api/")) {
      const marker = "/file/";
      const markerIndex = existing.url.indexOf(marker);
      if (markerIndex >= 0) {
        const relativePath = decodeURIComponent(existing.url.slice(markerIndex + marker.length));
        await fs.unlink(path.join(process.cwd(), relativePath)).catch(() => undefined);
      }
    }
    void scheduleGitePhotosWordPressWebhook(req.params.id).catch((error) => {
      console.warn(`WordPress photo sync scheduling failed for gite ${req.params.id}:`, error);
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/photos/:photoId/file/:encodedPath", async (req, res, next) => {
  try {
    const photo = await prisma.gitePhoto.findFirst({
      where: { id: req.params.photoId, gite_id: req.params.id },
      select: { url: true },
    });
    if (!photo) return res.status(404).json({ error: "Photo introuvable" });
    return sendPhotoFile(photo, res);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const gite = await prisma.gite.findUnique({
      where: { id: req.params.id },
      include: {
        gestionnaire: { select: { id: true, prenom: true, nom: true } },
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!gite) return res.status(404).json({ error: "Gite introuvable" });
    res.json(hydrateGite(gite));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/duplicate", async (req, res, next) => {
  try {
    const existing = await prisma.gite.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Gite introuvable" });

    const prefixes = (await prisma.gite.findMany({
      select: { prefixe_contrat: true },
    })) as Array<{ prefixe_contrat: string }>;
    const prefixSet = new Set(prefixes.map((p) => p.prefixe_contrat));
    const basePrefix = existing.prefixe_contrat;
    let suffix = 2;
    let nextPrefix = `${basePrefix}${suffix}`;
    while (prefixSet.has(nextPrefix)) {
      suffix += 1;
      nextPrefix = `${basePrefix}${suffix}`;
    }
    const ordre = await getNextGiteOrder();

    const duplicated = await prisma.gite.create({
      data: {
        ordre,
        ical_export_token: generateIcalExportToken(),
        nom: `${existing.nom} (copie)`,
        prefixe_contrat: nextPrefix,
        adresse_ligne1: existing.adresse_ligne1,
        adresse_ligne2: existing.adresse_ligne2,
        capacite_max: existing.capacite_max,
        nb_adultes_max: existing.nb_adultes_max,
        nb_adultes_habituel: existing.nb_adultes_habituel,
        nb_enfants_max: existing.nb_enfants_max,
        proprietaires_noms: existing.proprietaires_noms,
        proprietaires_adresse: existing.proprietaires_adresse,
        site_web: existing.site_web,
        public_slug: null,
        public_title: existing.public_title,
        public_summary: existing.public_summary,
        public_description: existing.public_description,
        public_technical_description: existing.public_technical_description,
        public_seo_title: existing.public_seo_title,
        public_seo_description: existing.public_seo_description,
        public_is_published: false,
        public_structured_content: encodeJsonField(existing.public_structured_content),
        public_equipment: encodeJsonField(existing.public_equipment),
        public_rooms: encodeJsonField(existing.public_rooms),
        public_practical_info: encodeJsonField(existing.public_practical_info),
        public_location_info: encodeJsonField(existing.public_location_info),
        public_web_info: encodeJsonField(existing.public_web_info),
        public_latitude: existing.public_latitude,
        public_longitude: existing.public_longitude,
        email: existing.email,
        caracteristiques: existing.caracteristiques,
        airbnb_listing_id: existing.airbnb_listing_id,
        telephones: encodeJsonField(fromJsonString<string[]>(existing.telephones, [])),
        taxe_sejour_par_personne_par_nuit: existing.taxe_sejour_par_personne_par_nuit,
        iban: existing.iban,
        bic: existing.bic,
        titulaire: existing.titulaire,
        regle_animaux_acceptes: existing.regle_animaux_acceptes,
        regle_bois_premiere_flambee: existing.regle_bois_premiere_flambee,
        regle_tiers_personnes_info: existing.regle_tiers_personnes_info,
        options_draps_par_lit: existing.options_draps_par_lit,
        options_linge_toilette_par_personne: existing.options_linge_toilette_par_personne,
        options_menage_forfait: existing.options_menage_forfait,
        options_depart_tardif_forfait: existing.options_depart_tardif_forfait,
        options_chiens_forfait: existing.options_chiens_forfait,
        heure_arrivee_defaut: existing.heure_arrivee_defaut,
        heure_depart_defaut: existing.heure_depart_defaut,
        caution_montant_defaut: existing.caution_montant_defaut,
        cheque_menage_montant_defaut: existing.cheque_menage_montant_defaut,
        arrhes_taux_defaut: existing.arrhes_taux_defaut,
        electricity_price_per_kwh: existing.electricity_price_per_kwh,
        frais_gestion: encodeJsonField(fromJsonString<unknown>(existing.frais_gestion, { version: 1, categories: [], expenses: [] })),
        prix_nuit_liste: encodeJsonField(fromJsonString<number[]>(existing.prix_nuit_liste, [])),
        gestionnaire_id: existing.gestionnaire_id,
      },
      include: {
        gestionnaire: { select: { id: true, prenom: true, nom: true } },
        photos: { orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] },
      },
    });

    res.status(201).json(hydrateGite(duplicated));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const giteId = req.params.id;
    const existing = await prisma.gite.findUnique({ where: { id: giteId } });
    if (!existing) return res.status(404).json({ error: "Gite introuvable" });

    const contrats = (await prisma.contrat.findMany({
      where: { gite_id: giteId },
      select: { id: true, pdf_path: true },
    })) as Array<{ id: string; pdf_path: string }>;
    const factures = (await prisma.facture.findMany({
      where: { gite_id: giteId },
      select: { id: true, pdf_path: true },
    })) as Array<{ id: string; pdf_path: string }>;

    await prisma.$transaction([
      prisma.reservation.deleteMany({ where: { gite_id: giteId } }),
      prisma.contrat.deleteMany({ where: { gite_id: giteId } }),
      prisma.facture.deleteMany({ where: { gite_id: giteId } }),
      prisma.contratCounter.deleteMany({ where: { giteId } }),
      prisma.factureCounter.deleteMany({ where: { giteId } }),
      prisma.gite.delete({ where: { id: giteId } }),
    ]);

    await Promise.all(
      [...contrats, ...factures].map((doc) => fs.unlink(path.join(process.cwd(), doc.pdf_path)).catch(() => undefined))
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

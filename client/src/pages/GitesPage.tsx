import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, isApiError } from "../utils/api";
import type { Gestionnaire, Gite, GitePhoto, ReservationPlaceholder } from "../utils/types";
import { getGiteColor } from "../utils/giteColors";
import {
  getEntryGrossCA,
  parseStatisticsPayload,
  type ParsedStatisticsPayload,
  type StatisticsPayload,
} from "./statistics/statisticsUtils";

const emptyForm = {
  nom: "",
  prefixe_contrat: "",
  adresse_ligne1: "",
  adresse_ligne2: "",
  capacite_max: 1,
  nb_adultes_max: 1,
  nb_adultes_habituel: 1,
  nb_enfants_max: 0,
  proprietaires_noms: "",
  proprietaires_adresse: "",
  site_web: "",
  public_slug: "",
  public_title: "",
  public_summary: "",
  public_description: "",
  public_technical_description: "",
  public_seo_title: "",
  public_seo_description: "",
  public_is_published: false,
  public_structured_content: "",
  public_equipment: "",
  public_rooms: "",
  public_practical_info: "",
  public_location_info: "",
  public_latitude: "",
  public_longitude: "",
  email: "",
  caracteristiques: "",
  airbnb_listing_id: "",
  telephones: "",
  taxe_sejour_par_personne_par_nuit: 0,
  iban: "",
  bic: "",
  titulaire: "",
  regle_animaux_acceptes: false,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
  options_draps_par_lit: 0,
  options_linge_toilette_par_personne: 0,
  options_menage_forfait: 0,
  options_depart_tardif_forfait: 0,
  options_chiens_forfait: 0,
  heure_arrivee_defaut: "17:00",
  heure_depart_defaut: "12:00",
  caution_montant_defaut: 0,
  cheque_menage_montant_defaut: 0,
  arrhes_taux_defaut: 0.2,
  electricity_price_per_kwh: 0,
  frais_gestion: {
    version: 1,
    categories: [
      { id: "energie", name: "Énergie", color: "#2d8cff" },
      { id: "entretien", name: "Entretien", color: "#43b77d" },
      { id: "taxes", name: "Taxes", color: "#f5a623" },
      { id: "assurance", name: "Assurance", color: "#7e5bef" },
    ],
    expenses: [],
  } as {
    version: number;
    categories: Array<{ id: string; name: string; color: string }>;
    expenses: Array<{
      id: string;
      label: string;
      category_id: string;
      monthly_amount: number;
      annual_amount: number;
      notes: string;
    }>;
  },
  prix_nuit_basse_saison: 0,
  prix_nuit_haute_saison: 0,
  min_nuits_toute_annee: 1,
  min_nuits_vacances_scolaires: 1,
  min_nuits_juillet_aout: 1,
  prix_nuit_liste: "",
  gestionnaire_id: "",
};

type BaseFormState = typeof emptyForm;
type NumberInputValue = number | "";
type NumberInputKey = {
  [Key in keyof BaseFormState]: BaseFormState[Key] extends number ? Key : never;
}[keyof BaseFormState];
type FormState = Omit<BaseFormState, NumberInputKey> & Record<NumberInputKey, NumberInputValue>;
type GitesExportPayload = {
  version?: number;
  exported_at?: string;
  gites: unknown[];
};
type GitesImportResult = {
  created_count: number;
  updated_count: number;
};
type GiteEquipmentInfoExportPayload = {
  version: number;
  type: "gite-equipment-info";
  exported_at: string;
  gite?: Pick<Gite, "id" | "nom" | "prefixe_contrat"> | null;
  sections: StructuredContentData;
};
type PhotoDraft = {
  title: string;
  alt: string;
  credit: string;
};
type WordPressPhotoSyncStatus = {
  enabled: boolean;
  state: "disabled" | "queued" | "sending" | "succeeded" | "failed";
  message: string;
  debounce_ms: number;
  completed_at?: string;
  response_status?: number;
  response_body?: unknown;
  error?: string;
};
type ExpenseCategory = {
  id: string;
  name: string;
  color: string;
};
type ExpenseLine = {
  id: string;
  label: string;
  category_id: string;
  monthly_amount: number;
  annual_amount: number;
  notes: string;
};
type ExpenseManagementData = {
  version: 1;
  categories: ExpenseCategory[];
  expenses: ExpenseLine[];
};
type ExpenseCategorySettings = {
  categories: ExpenseCategory[];
};
type ExpenseAmountField = "monthly_amount" | "annual_amount";
const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "energie", name: "Énergie", color: "#2d8cff" },
  { id: "entretien", name: "Entretien", color: "#43b77d" },
  { id: "taxes", name: "Taxes", color: "#f5a623" },
  { id: "assurance", name: "Assurance", color: "#7e5bef" },
];
const DEFAULT_EXPENSE_MANAGEMENT: ExpenseManagementData = {
  version: 1,
  categories: DEFAULT_EXPENSE_CATEGORIES,
  expenses: [],
};
const EXPENSE_CATEGORY_COLORS = ["#2d8cff", "#43b77d", "#f5a623", "#7e5bef", "#fe5c73", "#14b8a6", "#ef4444", "#64748b"];
const StarIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3.5l2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84-5.4 2.84 1.03-6-4.36-4.25 6.03-.88L12 3.5z" />
  </svg>
);
const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.28 2.22 2.22 3.28l18.5 18.5 1.06-1.06-4.06-4.06c1.66-1.08 3.05-2.66 4.1-4.66-2.3-4.35-5.6-6.52-9.82-6.52-1.58 0-3.04.3-4.38.9L3.28 2.22zM12 7.1c3.24 0 5.84 1.62 7.83 4.9-.88 1.44-1.95 2.56-3.2 3.36l-2.08-2.08c.3-.56.45-1.19.45-1.86A3.42 3.42 0 0 0 11.58 8c-.67 0-1.3.15-1.86.45L8.84 7.57c.98-.31 2.03-.47 3.16-.47z" />
    <path d="M2.18 12C3.44 9.62 5 7.88 6.87 6.78l1.1 1.1c-1.45.76-2.72 2.14-3.8 4.12 1.98 3.28 4.59 4.92 7.83 4.92.74 0 1.45-.08 2.12-.24l1.22 1.22c-1.04.36-2.15.54-3.34.54-4.22 0-7.52-2.15-9.82-6.44z" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-.8 11.2A2 2 0 0 1 15.2 22H8.8a2 2 0 0 1-2-1.8L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z" />
  </svg>
);
const PLACEHOLDER_FADE_OUT_MS = 320;
const GITE_PHOTO_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const GITE_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const GITE_EDITOR_SECTIONS = [
  { id: "base-fiche", label: "Fiche gîte" },
  { id: "web-presentation", label: "Présentation" },
  { id: "web-donnees", label: "Pièces et équipement" },
  { id: "web-chambres", label: "Infos complémentaires" },
  { id: "web-photos", label: "Photos" },
  { id: "gestion-finance", label: "Fiscalité & banque" },
  { id: "gestion-frais", label: "Gestion des frais" },
  { id: "gestion-contact", label: "Propriétaires & contact" },
  { id: "sejour-services", label: "Services & horaires" },
  { id: "sejour-tarifs", label: "Tarifs & garanties" },
  { id: "sejour-regles", label: "Règles & descriptif" },
] as const;
const GITE_EDITOR_SECTION_GROUPS = [
  {
    title: "Base",
    items: ["base-fiche"],
  },
  {
    title: "Web",
    items: ["web-presentation", "web-donnees", "web-chambres", "web-photos"],
  },
  {
    title: "Gestion",
    items: ["gestion-finance", "gestion-frais", "gestion-contact"],
  },
  {
    title: "Séjour",
    items: ["sejour-services", "sejour-tarifs", "sejour-regles"],
  },
] as const;
const GITE_EDITOR_SECTION_BY_ID = new Map(GITE_EDITOR_SECTIONS.map((section) => [section.id, section]));
type GiteEditorSectionId = (typeof GITE_EDITOR_SECTIONS)[number]["id"];

const isGiteEditorSectionId = (value: string | null): value is GiteEditorSectionId =>
  Boolean(value && GITE_EDITOR_SECTION_BY_ID.has(value as GiteEditorSectionId));

const formatManagerLabel = (gite: Gite) =>
  gite.gestionnaire ? `${gite.gestionnaire.prenom} ${gite.gestionnaire.nom}` : "Gestion directe";

const formatAddressLabel = (gite: Gite) =>
  [gite.adresse_ligne1, gite.adresse_ligne2].map((part) => part?.trim()).filter(Boolean).join(", ");

const formatJsonField = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
};

const parseJsonTextarea = (label: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${label}: le JSON n'est pas valide.`);
  }
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });

const wait = (durationMs: number) => new Promise((resolve) => window.setTimeout(resolve, durationMs));

const parseStoredJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const toDisplayText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const readNumberInput = (value: string): NumberInputValue => (value === "" ? "" : Number(value));

const toNumberOrDefault = (value: NumberInputValue, fallback = 0) => {
  if (value === "") return fallback;
  return Number.isFinite(value) ? value : fallback;
};

const createLocalId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeMoney = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? Math.round(numericValue * 100) / 100 : 0;
};

const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

const cloneDefaultExpenseManagement = (): ExpenseManagementData => ({
  version: 1,
  categories: DEFAULT_EXPENSE_MANAGEMENT.categories.map((category) => ({ ...category })),
  expenses: [],
});

const normalizeExpenseManagement = (value: unknown, sharedCategories?: ExpenseCategory[]): ExpenseManagementData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ...cloneDefaultExpenseManagement(),
      categories: sharedCategories?.length ? sharedCategories.map((category) => ({ ...category })) : cloneDefaultExpenseManagement().categories,
    };
  }
  const row = value as Partial<ExpenseManagementData>;
  const categories = sharedCategories?.length
    ? sharedCategories.map((category) => ({ ...category }))
    : Array.isArray(row.categories)
    ? row.categories
        .map((category, index): ExpenseCategory | null => {
          if (!category || typeof category !== "object" || Array.isArray(category)) return null;
          const categoryRow = category as Partial<ExpenseCategory>;
          const name = String(categoryRow.name ?? "");
          if (!name.trim()) return null;
          return {
            id: String(categoryRow.id || createLocalId("cat")).trim() || createLocalId("cat"),
            name,
            color: isHexColor(String(categoryRow.color ?? "")) ? String(categoryRow.color) : EXPENSE_CATEGORY_COLORS[index % EXPENSE_CATEGORY_COLORS.length],
          };
        })
        .filter((category): category is ExpenseCategory => Boolean(category))
    : [];
  const normalizedCategories = categories.length > 0 ? categories : cloneDefaultExpenseManagement().categories;
  const categoryIds = new Set(normalizedCategories.map((category) => category.id));
  const fallbackCategoryId = normalizedCategories[0]?.id ?? "";
  const expenses = Array.isArray(row.expenses)
    ? row.expenses
        .map((expense): ExpenseLine | null => {
          if (!expense || typeof expense !== "object" || Array.isArray(expense)) return null;
          const expenseRow = expense as Partial<ExpenseLine>;
          const label = String(expenseRow.label ?? "");
          const notes = String(expenseRow.notes ?? "");
          const categoryId = String(expenseRow.category_id ?? "");
          const rawMonthlyAmount = normalizeMoney(expenseRow.monthly_amount);
          const rawAnnualAmount = normalizeMoney(expenseRow.annual_amount);
          const monthlyAmount = rawMonthlyAmount > 0 ? rawMonthlyAmount : normalizeMoney(rawAnnualAmount / 12);
          const annualAmount = rawAnnualAmount > 0 ? rawAnnualAmount : normalizeMoney(monthlyAmount * 12);
          return {
            id: String(expenseRow.id || createLocalId("fee")).trim() || createLocalId("fee"),
            label,
            category_id: categoryIds.has(categoryId) ? categoryId : fallbackCategoryId,
            monthly_amount: monthlyAmount,
            annual_amount: annualAmount,
            notes,
          };
        })
        .filter((expense): expense is ExpenseLine => Boolean(expense))
    : [];
  return {
    version: 1,
    categories: normalizedCategories,
    expenses,
  };
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);

const normalizeExpenseRevenueLabel = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const getExpenseTotals = (data: ExpenseManagementData) => {
  const monthly = data.expenses.reduce((sum, expense) => sum + normalizeMoney(expense.monthly_amount), 0);
  const annual = data.expenses.reduce((sum, expense) => sum + normalizeMoney(expense.annual_amount), 0);
  return {
    monthly,
    annual,
  };
};

const getRevenueAveragePeriod = (now = new Date()) => {
  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;
  const currentMonth = now.getMonth() + 1;
  const completedCurrentYearMonths = Math.max(0, currentMonth - 1);
  return {
    previousYear,
    currentYear,
    completedCurrentYearMonths,
    monthCount: 12 + completedCurrentYearMonths,
  };
};

const getNetAverageMonthlyRevenue = (
  dataset: ParsedStatisticsPayload | null,
  giteId: string | null,
  monthlyExpenses: number
) => {
  const period = getRevenueAveragePeriod();
  if (!dataset || !giteId || period.monthCount <= 0) {
    return {
      ...period,
      grossRevenue: 0,
      expenses: 0,
      netAverage: 0,
    };
  }

  const grossRevenue = (dataset.entriesByGite[giteId] ?? [])
    .filter((entry) => {
      const year = entry.debutDate.getUTCFullYear();
      const month = entry.debutDate.getUTCMonth() + 1;
      if (normalizeExpenseRevenueLabel(entry.paiement) === "homeexchange") return false;
      return year === period.previousYear || (year === period.currentYear && month <= period.completedCurrentYearMonths);
    })
    .reduce((sum, entry) => sum + getEntryGrossCA(entry), 0);
  const expenses = normalizeMoney(monthlyExpenses * period.monthCount);

  return {
    ...period,
    grossRevenue,
    expenses,
    netAverage: period.monthCount > 0 ? (grossRevenue - expenses) / period.monthCount : 0,
  };
};

const getWordPressPhotoSyncDetail = (status: WordPressPhotoSyncStatus | null) => {
  const body = status?.response_body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const row = result as Record<string, unknown>;
  const parts = [
    ["créée(s)", row.created],
    ["mise(s) à jour", row.updated],
    ["remplacée(s)", row.replaced],
    ["masquée(s)", row.orphaned],
    ["échouée(s)", row.failed],
  ]
    .map(([label, value]) => {
      const count = Number(value);
      return Number.isFinite(count) && count > 0 ? `${count} ${label}` : "";
    })
    .filter(Boolean);
  return parts.join(", ");
};

const formatWordPressPhotoSyncIssue = (issue: unknown, index: number) => {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
    return String(issue || `Erreur ${index + 1}`);
  }

  const row = issue as Record<string, unknown>;
  const title = toDisplayText(row.title).trim();
  const photoId = toDisplayText(row.photo_id).trim();
  const label = [title, photoId].filter(Boolean).join(" / ") || `Photo ${index + 1}`;
  const message = toDisplayText(row.error_message).trim() || toDisplayText(row.error).trim() || "Erreur WordPress sans message.";
  const code = toDisplayText(row.error_code).trim();
  const url = toDisplayText(row.url).trim();
  const suffix = [code, url].filter(Boolean).join(" · ");

  return `${label}: ${message}${suffix ? ` (${suffix})` : ""}`;
};

const getWordPressPhotoSyncErrors = (status: WordPressPhotoSyncStatus | null) => {
  if (!status) return [];
  const body = status.response_body;
  const result =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { result?: unknown }).result
      : null;
  const errors =
    result && typeof result === "object" && !Array.isArray(result) && Array.isArray((result as { errors?: unknown }).errors)
      ? ((result as { errors: unknown[] }).errors ?? [])
      : [];
  const details = errors.map(formatWordPressPhotoSyncIssue).filter(Boolean);

  if (details.length > 0) {
    return details;
  }

  return status.error ? [status.error] : [];
};

const serializeStructuredValue = (value: unknown) => JSON.stringify(value, null, 2);

type EquipmentData = Record<string, string[]>;
type RoomData = Array<{ nom: string; couchages: string[]; notes?: string }>;
type InfoData = Array<{ titre: string; contenu: string }>;
type LocationData = { points: Array<{ lieu: string; distance: string }>; notes: string[] };
const BED_TYPE_OPTIONS = [
  { type: "single", label: "Lit 90", size: "90 x 190", icon: "single" },
  { type: "double", label: "Lit 140", size: "140 x 190", icon: "double" },
  { type: "queen", label: "Lit 160", size: "160 x 200", icon: "queen" },
  { type: "king", label: "Lit 180", size: "180 x 200", icon: "king" },
  { type: "bunk", label: "Lits superposés", size: "2 couchages", icon: "bunk" },
  { type: "sofa_bed", label: "Canapé-lit", size: "Convertible", icon: "sofa" },
  { type: "baby", label: "Lit bébé", size: "Bébé", icon: "baby" },
] as const;

type BedType = (typeof BED_TYPE_OPTIONS)[number]["type"];
type BedItem = { kind: "bed"; type: BedType; count: number };
type StructuredContentItem = string | BedItem;
type StructuredContentGroupType = "rubrique" | "chambre";
type StructuredContentGroup = { id: string; titre: string; type?: StructuredContentGroupType; items: StructuredContentItem[]; note?: string };
type StructuredContentSection = { id: string; titre: string; groupes: StructuredContentGroup[] };
type StructuredContentData = StructuredContentSection[];

const createStructuredId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_BED_ITEM: BedItem = { kind: "bed", type: "queen", count: 1 };
const BED_TYPE_BY_ID = new Map(BED_TYPE_OPTIONS.map((option) => [option.type, option]));
const GROUP_TYPE_OPTIONS: Array<{ value: StructuredContentGroupType; label: string }> = [
  { value: "rubrique", label: "Rubrique" },
  { value: "chambre", label: "Chambre" },
];
const isBedType = (value: unknown): value is BedType => typeof value === "string" && BED_TYPE_BY_ID.has(value as BedType);
const isBedItem = (value: StructuredContentItem): value is BedItem =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) && value.kind === "bed");
const containsBedItems = (items: unknown) =>
  Array.isArray(items) && items.some((item) => Boolean(item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).kind === "bed"));
const isGroupType = (value: unknown): value is StructuredContentGroupType =>
  value === "rubrique" || value === "chambre";
const getGroupType = (group: StructuredContentGroup, sectionId: string): StructuredContentGroupType =>
  group.type ?? "rubrique";
const getEditorGroupType = (
  group: StructuredContentGroup,
  sectionId: string,
  defaultGroupType: StructuredContentGroupType,
  showGroupTypeSelect: boolean
) => (showGroupTypeSelect ? getGroupType(group, sectionId) : defaultGroupType);
const normalizeBedItem = (value: unknown): BedItem => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_BED_ITEM;
  const row = value as Record<string, unknown>;
  const count = typeof row.count === "number" && Number.isFinite(row.count) ? Math.max(1, Math.round(row.count)) : 1;
  return {
    kind: "bed",
    type: isBedType(row.type) ? row.type : DEFAULT_BED_ITEM.type,
    count,
  };
};
const toStructuredContentItemText = (value: unknown) => {
  if (isBedItem(value as StructuredContentItem)) {
    const option = BED_TYPE_BY_ID.get((value as BedItem).type);
    const label = option?.label ?? "Couchage";
    return (value as BedItem).count > 1 ? `${(value as BedItem).count} x ${label}` : label;
  }
  return toDisplayText(value);
};
const splitPastedStructuredItems = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[•●◦▪▫‣⁃]\s*/g, "\n")
    .split(/\n+/)
    .map((item) => item.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "").trim())
    .filter(Boolean);
const normalizeStructuredItems = (items: unknown, groupType: StructuredContentGroupType): StructuredContentItem[] => {
  if (!Array.isArray(items)) return [];
  if (groupType === "chambre") return items.map(normalizeBedItem);
  return items.map(toStructuredContentItemText);
};

const buildStructuredContentDefaults = (): StructuredContentData => [
  { id: "equipements", titre: "Pièces et équipement", groupes: [{ id: "equipements-general", titre: "Général", type: "rubrique", items: [] }] },
  { id: "pieces-couchages", titre: "Infos complémentaires", groupes: [{ id: "pieces-info-1", titre: "Général", type: "rubrique", items: [], note: "" }] },
  { id: "infos-pratiques", titre: "Infos pratiques", groupes: [{ id: "infos-general", titre: "Général", type: "rubrique", items: [] }] },
  { id: "localisation", titre: "Localisation", groupes: [{ id: "localisation-general", titre: "Général", type: "rubrique", items: [] }] },
];
const BED_SECTION_ID = "pieces-couchages";
const REQUIRED_STRUCTURED_SECTIONS = buildStructuredContentDefaults();
const ensureStructuredSections = (sections: StructuredContentData, sectionIds?: string[]) => {
  if (!sectionIds || sectionIds.length === 0) return sections;
  const existingIds = new Set(sections.map((section) => section.id));
  const missingSections = REQUIRED_STRUCTURED_SECTIONS.filter((section) => sectionIds.includes(section.id) && !existingIds.has(section.id));
  return missingSections.length > 0 ? [...sections, ...missingSections] : sections;
};

const normalizeEquipmentData = (value: string): EquipmentData => {
  const parsed = parseStoredJson(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([category, items]) => [
        category,
        Array.isArray(items)
          ? items.map(toDisplayText)
          : toDisplayText(items)
              .split(/[,;\n]+/)
              .map((item) => item.trim())
              .filter(Boolean),
      ])
    );
  }
  if (Array.isArray(parsed)) return { Équipements: parsed.map(toDisplayText) };
  const text = toDisplayText(parsed);
  return text ? { Équipements: [text] } : {};
};

const normalizeRoomsData = (value: string): RoomData => {
  const parsed = parseStoredJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const couchagesRaw = row.couchages ?? row.lits ?? row.beds ?? [];
        return {
          nom: toDisplayText(row.nom ?? row.name ?? row.titre ?? row.title),
          couchages: Array.isArray(couchagesRaw)
            ? couchagesRaw.map(toDisplayText)
            : toDisplayText(couchagesRaw)
                .split(/[,;\n]+/)
                .map((entry) => entry.trim())
                .filter(Boolean),
          notes: toDisplayText(row.notes ?? row.description),
        };
      }
      return { nom: toDisplayText(item), couchages: [], notes: "" };
    });
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as Record<string, unknown>).map(([nom, couchages]) => ({
      nom,
      couchages: Array.isArray(couchages)
        ? couchages.map(toDisplayText)
        : toDisplayText(couchages)
            .split(/[,;\n]+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
      notes: "",
    }));
  }
  const text = toDisplayText(parsed);
  return text ? [{ nom: text, couchages: [], notes: "" }] : [];
};

const normalizeInfoData = (value: string): InfoData => {
  const parsed = parseStoredJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        return {
          titre: toDisplayText(row.titre ?? row.title ?? row.label ?? row.nom),
          contenu: toDisplayText(row.contenu ?? row.content ?? row.value ?? row.description),
        };
      }
      return { titre: "Info", contenu: toDisplayText(item) };
    });
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as Record<string, unknown>).map(([titre, contenu]) => ({
      titre,
      contenu: Array.isArray(contenu) ? contenu.map(toDisplayText).filter(Boolean).join(", ") : toDisplayText(contenu),
    }));
  }
  const text = toDisplayText(parsed);
  return text ? [{ titre: "Info", contenu: text }] : [];
};

const normalizeLocationData = (value: string): LocationData => {
  const parsed = parseStoredJson(value);
  const empty: LocationData = { points: [], notes: [] };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const row = parsed as Record<string, unknown>;
    const rawPoints = row.points ?? row.distances ?? row.nearby ?? [];
    const points = Array.isArray(rawPoints)
      ? rawPoints.map((item) => {
          if (item && typeof item === "object") {
            const point = item as Record<string, unknown>;
            return {
              lieu: toDisplayText(point.lieu ?? point.nom ?? point.label ?? point.place),
              distance: toDisplayText(point.distance ?? point.value ?? point.temps),
            };
          }
          return { lieu: toDisplayText(item), distance: "" };
        })
      : [];
    const notesRaw = row.notes ?? row.description ?? row.info;
    const notes = Array.isArray(notesRaw) ? notesRaw.map(toDisplayText).filter(Boolean) : toDisplayText(notesRaw) ? [toDisplayText(notesRaw)] : [];
    return { points, notes };
  }
  if (Array.isArray(parsed)) return { points: parsed.map((item) => ({ lieu: toDisplayText(item), distance: "" })), notes: [] };
  const text = toDisplayText(parsed);
  return text ? { ...empty, notes: [text] } : empty;
};

const normalizeStructuredContentData = (value: string): StructuredContentData => {
  const parsed = parseStoredJson(value);
  if (!Array.isArray(parsed)) return buildStructuredContentDefaults();

  const sections = parsed
    .map((section, sectionIndex): StructuredContentSection | null => {
      if (!section || typeof section !== "object") return null;
      const row = section as Record<string, unknown>;
      const rawGroups = row.groupes ?? row.groups ?? row.items ?? [];
      const sectionId = toDisplayText(row.id) || `section-${sectionIndex}`;
      const groupes = Array.isArray(rawGroups)
        ? rawGroups
            .map((group, groupIndex): StructuredContentGroup | null => {
              if (group && typeof group === "object") {
                const groupRow = group as Record<string, unknown>;
                const rawItems = groupRow.items ?? groupRow.lignes ?? groupRow.values ?? [];
                const type = isGroupType(groupRow.type) ? groupRow.type : containsBedItems(rawItems) ? "chambre" : "rubrique";
                return {
                  id: toDisplayText(groupRow.id) || `section-${sectionIndex}-group-${groupIndex}`,
                  titre: toDisplayText(groupRow.titre ?? groupRow.title ?? groupRow.nom) || `Groupe ${groupIndex + 1}`,
                  type,
                  items: normalizeStructuredItems(rawItems, type),
                  note: toDisplayText(groupRow.note ?? groupRow.notes),
                };
              }
              return {
                id: `section-${sectionIndex}-group-${groupIndex}`,
                titre: `Groupe ${groupIndex + 1}`,
                type: "rubrique",
                items: [toDisplayText(group)],
                note: "",
              };
            })
            .filter((group): group is StructuredContentGroup => Boolean(group))
        : [];

      const title = toDisplayText(row.titre ?? row.title ?? row.nom);
      return {
        id: sectionId,
        titre: title || (sectionId === BED_SECTION_ID ? "Infos complémentaires" : `Section ${sectionIndex + 1}`),
        groupes,
      };
    })
    .filter((section): section is StructuredContentSection => Boolean(section));

  return sections.length > 0 ? sections : buildStructuredContentDefaults();
};

const isSectionInFamily = (section: StructuredContentSection, familyId: string) =>
  section.id === familyId || section.id.startsWith(`${familyId}-`);

const getEquipmentInfoSections = (value: string) =>
  normalizeStructuredContentData(value).filter((section) => !isSectionInFamily(section, BED_SECTION_ID));

const mergeEquipmentInfoSections = (currentValue: string, importedSections: StructuredContentData) => {
  const currentSections = normalizeStructuredContentData(currentValue);
  const bedSections = currentSections.filter((section) => isSectionInFamily(section, BED_SECTION_ID));
  const visibleSections = importedSections.filter((section) => !isSectionInFamily(section, BED_SECTION_ID));
  return serializeStructuredValue([...visibleSections, ...bedSections]);
};

const normalizeImportedEquipmentInfoSections = (value: unknown): StructuredContentData => {
  if (Array.isArray(value)) return getEquipmentInfoSections(serializeStructuredValue(value));
  if (!value || typeof value !== "object") {
    throw new Error("Format invalide: utilisez un export Pièces et équipement.");
  }

  const payload = value as {
    sections?: unknown;
    public_structured_content?: unknown;
    equipment_info?: { sections?: unknown };
  };
  if (Array.isArray(payload.sections)) return getEquipmentInfoSections(serializeStructuredValue(payload.sections));
  if (Array.isArray(payload.equipment_info?.sections)) {
    return getEquipmentInfoSections(serializeStructuredValue(payload.equipment_info.sections));
  }
  if (payload.public_structured_content !== undefined) {
    return getEquipmentInfoSections(formatJsonField(payload.public_structured_content));
  }

  throw new Error("Format invalide: utilisez un export Pièces et équipement.");
};

const buildExportFilenamePart = (value: string) => {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "gite";
};

const hasStructuredContent = (value: unknown) => {
  const parsed = typeof value === "string" ? parseStoredJson(value) : value;
  return Array.isArray(parsed) && parsed.length > 0;
};

const buildStructuredContentFromLegacy = (gite: Gite): StructuredContentData => {
  if (hasStructuredContent(gite.public_structured_content)) {
    return normalizeStructuredContentData(formatJsonField(gite.public_structured_content));
  }

  const equipment = normalizeEquipmentData(formatJsonField(gite.public_equipment));
  const rooms = normalizeRoomsData(formatJsonField(gite.public_rooms));
  const practicalInfo = normalizeInfoData(formatJsonField(gite.public_practical_info));
  const location = normalizeLocationData(formatJsonField(gite.public_location_info));
  const sections = buildStructuredContentDefaults();

  sections[0] = {
    ...sections[0],
    groupes: [
      ...Object.entries(equipment).map(([titre, items], index) => ({
        id: `equipements-${index}`,
        titre,
        type: "rubrique" as const,
        items,
      })),
      ...rooms.map((room, index) => ({
        id: `piece-${index}`,
        titre: room.nom || `Pièce ${index + 1}`,
        type: "chambre" as const,
        items: room.couchages.length > 0 ? room.couchages.map(() => DEFAULT_BED_ITEM) : [],
        note: room.notes ?? "",
      })),
    ],
  };
  sections[1] = {
    ...sections[1],
    groupes: [],
  };
  sections[2] = {
    ...sections[2],
    groupes: practicalInfo.map((info, index) => ({
      id: `info-${index}`,
      titre: info.titre || `Info ${index + 1}`,
      type: "rubrique",
      items: info.contenu ? [info.contenu] : [],
    })),
  };
  sections[3] = {
    ...sections[3],
    groupes: [
      ...(location.points.length > 0
        ? [
            {
              id: "localisation-points",
              titre: "Lieux proches",
              type: "rubrique" as const,
              items: location.points.map((point) => [point.lieu, point.distance].filter(Boolean).join(" - ")),
            },
          ]
        : []),
      ...(location.notes.length > 0
        ? [{ id: "localisation-notes", titre: "Notes", type: "rubrique" as const, items: location.notes }]
        : []),
    ],
  };

  return sections.map((section) => (section.groupes.length > 0 ? section : { ...section, groupes: [] }));
};

type StructuredEditorProps = {
  value: string;
  onChange: (value: string) => void;
  sectionIds?: string[];
  sectionFamilyId?: string;
  excludeSectionIds?: string[];
  excludeSectionFamilyIds?: string[];
  allowedGroupTypes?: StructuredContentGroupType[];
  defaultGroupType?: StructuredContentGroupType;
  showGroupTypeSelect?: boolean;
  showToolbar?: boolean;
};

const BedPictogram = ({ type }: { type: BedType }) => {
  const option = BED_TYPE_BY_ID.get(type) ?? BED_TYPE_BY_ID.get(DEFAULT_BED_ITEM.type);
  return (
    <span className={`bed-picto bed-picto--${option?.icon ?? "queen"}`} aria-hidden="true">
      <svg viewBox="0 0 48 32" focusable="false">
        <rect className="bed-picto__frame" x="5" y="13" width="38" height="12" rx="3" />
        <rect className="bed-picto__pillow" x="8" y="9" width="11" height="8" rx="2" />
        <path className="bed-picto__base" d="M5 25h38M9 25v4M39 25v4" />
        {type === "bunk" ? <path className="bed-picto__detail" d="M8 7h32M8 7v19M40 7v19M8 16h32" /> : null}
        {type === "sofa_bed" ? <path className="bed-picto__detail" d="M10 12v-2h28v2M12 22h24" /> : null}
        {type === "baby" ? <path className="bed-picto__detail" d="M12 9h24M12 9v16M36 9v16M18 9v16M24 9v16M30 9v16" /> : null}
      </svg>
    </span>
  );
};

const StructuredContentEditor = ({
  value,
  onChange,
  sectionIds,
  sectionFamilyId,
  excludeSectionIds,
  excludeSectionFamilyIds,
  allowedGroupTypes = ["rubrique", "chambre"],
  defaultGroupType = "rubrique",
  showGroupTypeSelect = true,
  showToolbar = true,
}: StructuredEditorProps) => {
  const sections = ensureStructuredSections(normalizeStructuredContentData(value), sectionIds);
  const visibleSectionIds = sectionIds ? new Set(sectionIds) : null;
  const excludedSectionIds = excludeSectionIds ? new Set(excludeSectionIds) : null;
  const excludedSectionFamilyIds = excludeSectionFamilyIds ?? [];
  const locksVisibleSections = Boolean(visibleSectionIds);
  const [draggedSectionIndex, setDraggedSectionIndex] = useState<number | null>(null);
  const [dragOverSectionIndex, setDragOverSectionIndex] = useState<number | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const commit = (next: StructuredContentData) => onChange(serializeStructuredValue(next));
  const updateSection = (sectionIndex: number, updater: (section: StructuredContentSection) => StructuredContentSection) => {
    const next = [...sections];
    next[sectionIndex] = updater(next[sectionIndex]);
    commit(next);
  };
  const updateGroup = (
    sectionIndex: number,
    groupIndex: number,
    updater: (group: StructuredContentGroup) => StructuredContentGroup
  ) => {
    updateSection(sectionIndex, (section) => {
      const groupes = [...section.groupes];
      groupes[groupIndex] = updater(groupes[groupIndex]);
      return { ...section, groupes };
    });
  };
  const toggleSection = (sectionId: string) => {
    setCollapsedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  };
  const isSectionVisible = (section: StructuredContentSection) => {
    if (visibleSectionIds && !visibleSectionIds.has(section.id)) return false;
    if (sectionFamilyId && section.id !== sectionFamilyId && !section.id.startsWith(`${sectionFamilyId}-`)) return false;
    if (excludedSectionIds && excludedSectionIds.has(section.id)) return false;
    if (excludedSectionFamilyIds.some((familyId) => section.id === familyId || section.id.startsWith(`${familyId}-`))) return false;
    return true;
  };

  return (
    <div className="structured-editor structured-editor--content">
      {showToolbar ? (
        <div className="structured-editor__toolbar">
        <button
          type="button"
          className="table-action table-action--primary"
          onClick={() =>
            commit([
              ...sections,
              {
                id: createStructuredId(sectionFamilyId ?? "section"),
                titre: "Nouvelle section",
                groupes: [{ id: createStructuredId("groupe"), titre: "Général", type: defaultGroupType, items: [] }],
              },
            ])
          }
        >
          Ajouter un bloc
        </button>
        </div>
      ) : null}
      <div className="structured-grid structured-grid--sections">
        {sections.map((section, sectionIndex) => {
          if (!isSectionVisible(section)) return null;
          const isCollapsed = collapsedSections[section.id] ?? false;
          return (
            <article
              key={section.id}
              className={`structured-card structured-card--section${locksVisibleSections ? " structured-card--locked-root" : ""}${
                dragOverSectionIndex === sectionIndex ? " structured-card--drag-over" : ""
              }`}
              onDragOver={(event) => {
                if (draggedSectionIndex === null || draggedSectionIndex === sectionIndex) return;
                event.preventDefault();
                setDragOverSectionIndex(sectionIndex);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedSectionIndex === null || draggedSectionIndex === sectionIndex) {
                  setDraggedSectionIndex(null);
                  setDragOverSectionIndex(null);
                  return;
                }
                const next = [...sections];
                const [moved] = next.splice(draggedSectionIndex, 1);
                next.splice(sectionIndex, 0, moved);
                commit(next);
                setDraggedSectionIndex(null);
                setDragOverSectionIndex(null);
              }}
            >
              <div className={`structured-section-header${locksVisibleSections ? " structured-section-header--locked" : ""}`}>
                <button
                  type="button"
                  className="structured-toggle"
                  aria-label={isCollapsed ? `Ouvrir ${section.titre}` : `Fermer ${section.titre}`}
                  onClick={() => toggleSection(section.id)}
                >
                  {isCollapsed ? "›" : "⌄"}
                </button>
                {!locksVisibleSections ? (
                  <button
                    type="button"
                    className="structured-drag-handle"
                    draggable
                    aria-label={`Déplacer ${section.titre || "ce bloc"}`}
                    onDragStart={(event) => {
                      setDraggedSectionIndex(sectionIndex);
                      setDragOverSectionIndex(sectionIndex);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(sectionIndex));
                    }}
                    onDragEnd={() => {
                      setDraggedSectionIndex(null);
                      setDragOverSectionIndex(null);
                    }}
                  >
                    ⋮⋮
                  </button>
                ) : null}
                <input
                  className="structured-card__title-input structured-card__title-input--section"
                  value={section.titre}
                  onChange={(event) => updateSection(sectionIndex, (current) => ({ ...current, titre: event.target.value }))}
                  aria-label="Titre du bloc"
                />
                {!locksVisibleSections ? (
                  <button
                    type="button"
                    className="structured-icon-button structured-icon-button--danger"
                    onClick={() => commit(sections.filter((_, index) => index !== sectionIndex))}
                    aria-label={`Supprimer ${section.titre || "ce bloc"}`}
                    title="Supprimer le bloc"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {!isCollapsed ? (
                <div className={`structured-section-body${locksVisibleSections ? " structured-section-body--locked" : ""}`}>
                  {section.groupes.length === 0 ? <div className="structured-empty">Aucune rubrique dans ce bloc.</div> : null}
                  <div className="structured-group-list">
                    {section.groupes.map((group, groupIndex) => (
                      <div key={group.id} className="structured-group">
                        <div className={`structured-group__header${showGroupTypeSelect ? "" : " structured-group__header--without-type"}`}>
                          {showGroupTypeSelect ? (
                            <select
                              className="structured-group__type"
                              value={getGroupType(group, section.id)}
                              onChange={(event) =>
                                updateGroup(sectionIndex, groupIndex, (current) => {
                                  const type = event.target.value as StructuredContentGroupType;
                                  return {
                                    ...current,
                                    type,
                                    items: type === "chambre" ? current.items.map(normalizeBedItem) : current.items.map(toStructuredContentItemText),
                                  };
                                })
                              }
                              aria-label="Type de rubrique"
                            >
                              {GROUP_TYPE_OPTIONS.filter((option) => allowedGroupTypes.includes(option.value)).map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <input
                            className="structured-card__title-input structured-card__title-input--group"
                            value={group.titre}
                            onChange={(event) =>
                              updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, titre: event.target.value }))
                            }
                            aria-label="Titre de la rubrique"
                          />
                          <button
                            type="button"
                            className="structured-icon-button"
                            onClick={() =>
                              updateSection(sectionIndex, (current) => ({
                                ...current,
                                groupes: current.groupes.filter((_, index) => index !== groupIndex),
                              }))
                            }
                            aria-label={`Supprimer ${group.titre || "cette rubrique"}`}
                            title="Supprimer la rubrique"
                          >
                            ×
                          </button>
                        </div>
                        {getEditorGroupType(group, section.id, defaultGroupType, showGroupTypeSelect) === "chambre" ? (
                          <div className="bed-list">
                            {group.items.map((item, itemIndex) => {
                              const bed = isBedItem(item) ? item : DEFAULT_BED_ITEM;
                              const bedOption = BED_TYPE_BY_ID.get(bed.type) ?? BED_TYPE_BY_ID.get(DEFAULT_BED_ITEM.type);
                              return (
                                <div key={`${group.id}-${itemIndex}`} className="bed-row">
                                  <BedPictogram type={bed.type} />
                                  <label className="bed-row__type">
                                    <span>Type</span>
                                    <select
                                      value={bed.type}
                                      onChange={(event) =>
                                        updateGroup(sectionIndex, groupIndex, (current) => {
                                          const items = [...current.items];
                                          items[itemIndex] = { ...bed, type: event.target.value as BedType };
                                          return { ...current, items };
                                        })
                                      }
                                    >
                                      {BED_TYPE_OPTIONS.map((option) => (
                                        <option key={option.type} value={option.type}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className="bed-row__meta">{bedOption?.size}</div>
                                  <label className="bed-row__count">
                                    <span>Qté</span>
                                    <input
                                      type="number"
                                      min="1"
                                      value={bed.count}
                                      onChange={(event) =>
                                        updateGroup(sectionIndex, groupIndex, (current) => {
                                          const items = [...current.items];
                                          const count = Math.max(1, Number.parseInt(event.target.value, 10) || 1);
                                          items[itemIndex] = { ...bed, count };
                                          return { ...current, items };
                                        })
                                      }
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="structured-icon-button"
                                    onClick={() =>
                                      updateGroup(sectionIndex, groupIndex, (current) => ({
                                        ...current,
                                        items: current.items.filter((_, index) => index !== itemIndex),
                                      }))
                                    }
                                    aria-label={`Supprimer ${bedOption?.label ?? "ce couchage"}`}
                                    title="Supprimer le couchage"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                            <button
                              type="button"
                              className="structured-add-chip structured-add-chip--bed"
                              onClick={() =>
                                updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, items: [...current.items, DEFAULT_BED_ITEM] }))
                              }
                            >
                              + Ajouter un couchage
                            </button>
                          </div>
                        ) : (
                          <div className="structured-chips">
                            {group.items.map((item, itemIndex) => {
                              const textItem = toStructuredContentItemText(item);
                              return (
                                <span key={`${group.id}-${itemIndex}`} className="structured-chip">
                                  <input
                                    value={textItem}
                                    placeholder="Nouvel élément"
                                    size={Math.min(Math.max(textItem.length || 14, 14), 34)}
                                    onChange={(event) =>
                                      updateGroup(sectionIndex, groupIndex, (current) => {
                                        const items = [...current.items];
                                        items[itemIndex] = event.target.value;
                                        return { ...current, items };
                                      })
                                    }
                                    onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
                                      const pastedText = event.clipboardData.getData("text");
                                      const input = event.currentTarget;
                                      const selectionStart = input.selectionStart ?? textItem.length;
                                      const selectionEnd = input.selectionEnd ?? selectionStart;
                                      const mergedText = `${textItem.slice(0, selectionStart)}${pastedText}${textItem.slice(selectionEnd)}`;
                                      const pastedItems = splitPastedStructuredItems(mergedText);
                                      if (pastedItems.length < 2) {
                                        if (pastedItems.length === 1 && pastedItems[0] !== mergedText.trim()) {
                                          event.preventDefault();
                                          updateGroup(sectionIndex, groupIndex, (current) => {
                                            const items = [...current.items];
                                            items[itemIndex] = pastedItems[0];
                                            return { ...current, items };
                                          });
                                        }
                                        return;
                                      }
                                      event.preventDefault();
                                      updateGroup(sectionIndex, groupIndex, (current) => {
                                        const items = [...current.items];
                                        items.splice(itemIndex, 1, ...pastedItems);
                                        return { ...current, items };
                                      });
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateGroup(sectionIndex, groupIndex, (current) => ({
                                        ...current,
                                        items: current.items.filter((_, index) => index !== itemIndex),
                                      }))
                                    }
                                    aria-label={`Supprimer ${textItem || "cet élément"}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                            <button
                              type="button"
                              className="structured-add-chip"
                              onClick={() => updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, items: [...current.items, ""] }))}
                            >
                              + Ajouter
                            </button>
                          </div>
                        )}
                        <label className="field structured-note-field">
                          Note
                          <input
                            value={group.note ?? ""}
                            onChange={(event) => updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, note: event.target.value }))}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="structured-add-rubric"
                    onClick={() =>
                      updateSection(sectionIndex, (current) => ({
                        ...current,
                        groupes: [
                          ...current.groupes,
                          {
                            id: createStructuredId("groupe"),
                            titre: defaultGroupType === "chambre" ? `Chambre ${current.groupes.length + 1}` : "Nouvelle rubrique",
                            type: defaultGroupType,
                            items: defaultGroupType === "chambre" ? [DEFAULT_BED_ITEM] : [],
                          },
                        ],
                      }))
                    }
                  >
                    {defaultGroupType === "chambre" ? "+ Ajouter une chambre" : "+ Ajouter une rubrique"}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
};

const EquipmentStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const data = normalizeEquipmentData(value);
  const entries = Object.entries(data);
  const commit = (next: EquipmentData) => onChange(serializeStructuredValue(next));
  const addCategory = () => {
    const base = "Nouvelle catégorie";
    let name = base;
    let index = 2;
    while (Object.prototype.hasOwnProperty.call(data, name)) {
      name = `${base} ${index}`;
      index += 1;
    }
    commit({ ...data, [name]: [] });
  };

  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={addCategory}>
          Ajouter une catégorie
        </button>
      </div>
      {entries.length === 0 ? <div className="structured-empty">Aucune catégorie d'équipement.</div> : null}
      <div className="structured-grid">
        {entries.map(([category, items], categoryIndex) => (
          <article key={categoryIndex} className="structured-card">
            <div className="structured-card__header">
              <input
                className="structured-card__title-input"
                value={category}
                onChange={(event) => {
                  const next = { ...data };
                  delete next[category];
                  next[event.target.value || "Sans titre"] = items;
                  commit(next);
                }}
              />
              <button
                type="button"
                className="table-action table-action--neutral"
                onClick={() => {
                  const next = { ...data };
                  delete next[category];
                  commit(next);
                }}
              >
                Retirer
              </button>
            </div>
            <div className="structured-chips">
              {items.map((item, itemIndex) => (
                <span key={`${category}-${itemIndex}`} className="structured-chip">
                  <input
                    value={item}
                    size={Math.min(Math.max(item.length || 14, 14), 34)}
                    onChange={(event) => {
                      const nextItems = [...items];
                      nextItems[itemIndex] = event.target.value;
                      commit({ ...data, [category]: nextItems });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => commit({ ...data, [category]: items.filter((_, index) => index !== itemIndex) })}
                    aria-label={`Supprimer ${item || "cet équipement"}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, [category]: [...items, ""] })}>
              Ajouter un équipement
            </button>
          </article>
        ))}
      </div>
    </div>
  );
};

const RoomsStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const rooms = normalizeRoomsData(value);
  const commit = (next: RoomData) => onChange(serializeStructuredValue(next));
  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={() => commit([...rooms, { nom: "", couchages: [""], notes: "" }])}>
          Ajouter une pièce
        </button>
      </div>
      {rooms.length === 0 ? <div className="structured-empty">Aucune pièce ou couchage renseigné.</div> : null}
      <div className="structured-grid">
        {rooms.map((room, index) => (
          <article key={index} className="structured-card">
            <div className="structured-card__header">
              <input
                className="structured-card__title-input"
                value={room.nom}
                placeholder="Chambre 1"
                onChange={(event) => {
                  const next = [...rooms];
                  next[index] = { ...room, nom: event.target.value };
                  commit(next);
                }}
              />
              <button type="button" className="table-action table-action--neutral" onClick={() => commit(rooms.filter((_, roomIndex) => roomIndex !== index))}>
                Retirer
              </button>
            </div>
            <div className="structured-chips">
              {room.couchages.map((bed, bedIndex) => (
                <span key={`${index}-${bedIndex}`} className="structured-chip">
                  <input
                    value={bed}
                    placeholder="Lit 160"
                    size={Math.min(Math.max(bed.length || 14, 14), 34)}
                    onChange={(event) => {
                      const next = [...rooms];
                      const couchages = [...room.couchages];
                      couchages[bedIndex] = event.target.value;
                      next[index] = { ...room, couchages };
                      commit(next);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...rooms];
                      next[index] = { ...room, couchages: room.couchages.filter((_, itemIndex) => itemIndex !== bedIndex) };
                      commit(next);
                    }}
                    aria-label="Supprimer ce couchage"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              className="table-action table-action--neutral"
              onClick={() => {
                const next = [...rooms];
                next[index] = { ...room, couchages: [...room.couchages, ""] };
                commit(next);
              }}
            >
              Ajouter un couchage
            </button>
            <label className="field">
              Note
              <input
                value={room.notes ?? ""}
                onChange={(event) => {
                  const next = [...rooms];
                  next[index] = { ...room, notes: event.target.value };
                  commit(next);
                }}
              />
            </label>
          </article>
        ))}
      </div>
    </div>
  );
};

const InfoStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const rows = normalizeInfoData(value);
  const commit = (next: InfoData) => onChange(serializeStructuredValue(next));
  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={() => commit([...rows, { titre: "", contenu: "" }])}>
          Ajouter une info
        </button>
      </div>
      {rows.length === 0 ? <div className="structured-empty">Aucune information pratique.</div> : null}
      <div className="structured-list">
        {rows.map((row, index) => (
          <div key={index} className="structured-row">
            <input
              value={row.titre}
              placeholder="Arrivée"
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, titre: event.target.value };
                commit(next);
              }}
            />
            <input
              value={row.contenu}
              placeholder="Boîte à clés, parking..."
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, contenu: event.target.value };
                commit(next);
              }}
            />
            <button type="button" className="table-action table-action--neutral" onClick={() => commit(rows.filter((_, rowIndex) => rowIndex !== index))}>
              Retirer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const LocationStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const data = normalizeLocationData(value);
  const commit = (next: LocationData) => onChange(serializeStructuredValue(next));
  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={() => commit({ ...data, points: [...data.points, { lieu: "", distance: "" }] })}>
          Ajouter un lieu proche
        </button>
        <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, notes: [...data.notes, ""] })}>
          Ajouter une note
        </button>
      </div>
      <div className="structured-list">
        {data.points.map((point, index) => (
          <div key={`point-${index}`} className="structured-row structured-row--location">
            <input
              value={point.lieu}
              placeholder="Forêt de Brocéliande"
              onChange={(event) => {
                const points = [...data.points];
                points[index] = { ...point, lieu: event.target.value };
                commit({ ...data, points });
              }}
            />
            <input
              value={point.distance}
              placeholder="5 min / 3 km"
              onChange={(event) => {
                const points = [...data.points];
                points[index] = { ...point, distance: event.target.value };
                commit({ ...data, points });
              }}
            />
            <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, points: data.points.filter((_, rowIndex) => rowIndex !== index) })}>
              Retirer
            </button>
          </div>
        ))}
        {data.notes.map((note, index) => (
          <div key={`note-${index}`} className="structured-row">
            <input
              value={note}
              placeholder="À deux pas du bourg..."
              onChange={(event) => {
                const notes = [...data.notes];
                notes[index] = event.target.value;
                commit({ ...data, notes });
              }}
            />
            <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, notes: data.notes.filter((_, rowIndex) => rowIndex !== index) })}>
              Retirer
            </button>
          </div>
        ))}
      </div>
      {data.points.length === 0 && data.notes.length === 0 ? <div className="structured-empty">Aucune information de localisation.</div> : null}
    </div>
  );
};

const GitesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [gites, setGites] = useState<Gite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("gite") || null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingGites, setImportingGites] = useState(false);
  const [exportingGites, setExportingGites] = useState(false);
  const [importingEquipmentInfo, setImportingEquipmentInfo] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [placeholders, setPlaceholders] = useState<ReservationPlaceholder[]>([]);
  const [gestionnaires, setGestionnaires] = useState<Gestionnaire[]>([]);
  const [statisticsDataset, setStatisticsDataset] = useState<ParsedStatisticsPayload | null>(null);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>(DEFAULT_EXPENSE_CATEGORIES);
  const [placeholderTargets, setPlaceholderTargets] = useState<Record<string, string>>({});
  const [photoDrafts, setPhotoDrafts] = useState<Record<string, PhotoDraft>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingPhotoId, setSavingPhotoId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [editingPhotoTitleId, setEditingPhotoTitleId] = useState<string | null>(null);
  const [photoDropActive, setPhotoDropActive] = useState(false);
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);
  const [wordpressPhotoSyncStatus, setWordpressPhotoSyncStatus] = useState<WordPressPhotoSyncStatus | null>(null);
  const [activeEditorSection, setActiveEditorSection] = useState<GiteEditorSectionId>(() => {
    const section = searchParams.get("section");
    return isGiteEditorSectionId(section) ? section : "base-fiche";
  });
  const [attachingPlaceholderId, setAttachingPlaceholderId] = useState<string | null>(null);
  const [fadingPlaceholderIds, setFadingPlaceholderIds] = useState<string[]>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const equipmentInfoImportInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const formCardRef = useRef<HTMLDivElement | null>(null);
  const suppressPhotoClickRef = useRef(false);
  const wordpressPhotoSyncWatchRef = useRef(0);

  const selected = useMemo(() => gites.find((g) => g.id === selectedId) ?? null, [gites, selectedId]);
  const selectedPhoto = useMemo(
    () => (selected?.photos ?? []).find((photo) => photo.id === selectedPhotoId) ?? null,
    [selected?.photos, selectedPhotoId]
  );
  const activeEditorSectionLabel = GITE_EDITOR_SECTION_BY_ID.get(activeEditorSection)?.label ?? "Section";

  useEffect(() => {
    const queryGiteId = searchParams.get("gite") || null;
    const querySection = searchParams.get("section");
    const nextSection = isGiteEditorSectionId(querySection) ? querySection : "base-fiche";

    setSelectedId((current) => (current === queryGiteId ? current : queryGiteId));
    setActiveEditorSection((current) => (current === nextSection ? current : nextSection));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    if (selectedId) {
      next.set("gite", selectedId);
    } else {
      next.delete("gite");
    }
    next.set("section", activeEditorSection);

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeEditorSection, searchParams, selectedId, setSearchParams]);

  const load = async () => {
    const [gitesData, placeholdersData, gestionnairesData, statisticsData, expenseCategoryData] = await Promise.all([
      apiFetch<Gite[]>("/gites"),
      apiFetch<ReservationPlaceholder[]>("/reservations/placeholders"),
      apiFetch<Gestionnaire[]>("/managers"),
      apiFetch<StatisticsPayload>("/statistics"),
      apiFetch<ExpenseCategorySettings>("/gites/expense-categories"),
    ]);
    setGites(gitesData);
    setPlaceholders(placeholdersData);
    setGestionnaires(gestionnairesData);
    setStatisticsDataset(parseStatisticsPayload(statisticsData));
    setExpenseCategories(normalizeExpenseManagement({ categories: expenseCategoryData.categories, expenses: [] }).categories);
    setPlaceholderTargets((prev) => {
      const next = { ...prev };
      for (const placeholder of placeholdersData) {
        if (!next[placeholder.id] && gitesData[0]?.id) {
          next[placeholder.id] = gitesData[0].id;
        }
      }
      return next;
    });
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selected) {
      setForm(emptyForm);
      setPhotoDrafts({});
      setSelectedPhotoId(null);
      setWordpressPhotoSyncStatus(null);
      return;
    }
    setForm({
      nom: selected.nom,
      prefixe_contrat: selected.prefixe_contrat,
      adresse_ligne1: selected.adresse_ligne1,
      adresse_ligne2: selected.adresse_ligne2 ?? "",
      capacite_max: selected.capacite_max,
      nb_adultes_max: selected.nb_adultes_max,
      nb_adultes_habituel: selected.nb_adultes_habituel,
      nb_enfants_max: selected.nb_enfants_max,
      proprietaires_noms: selected.proprietaires_noms,
      proprietaires_adresse: selected.proprietaires_adresse,
      site_web: selected.site_web ?? "",
      public_slug: selected.public_slug ?? "",
      public_title: selected.public_title ?? "",
      public_summary: selected.public_summary ?? "",
      public_description: selected.public_description ?? "",
      public_technical_description: selected.public_technical_description ?? "",
      public_seo_title: selected.public_seo_title ?? "",
      public_seo_description: selected.public_seo_description ?? "",
      public_is_published: selected.public_is_published ?? false,
      public_structured_content: serializeStructuredValue(buildStructuredContentFromLegacy(selected)),
      public_equipment: formatJsonField(selected.public_equipment),
      public_rooms: formatJsonField(selected.public_rooms),
      public_practical_info: formatJsonField(selected.public_practical_info),
      public_location_info: formatJsonField(selected.public_location_info),
      public_latitude: selected.public_latitude ?? "",
      public_longitude: selected.public_longitude ?? "",
      email: selected.email ?? "",
      caracteristiques: selected.caracteristiques ?? "",
      airbnb_listing_id: selected.airbnb_listing_id ?? "",
      telephones: Array.isArray(selected.telephones) ? selected.telephones.join(", ") : "",
      taxe_sejour_par_personne_par_nuit: selected.taxe_sejour_par_personne_par_nuit,
      iban: selected.iban,
      bic: selected.bic ?? "",
      titulaire: selected.titulaire,
      regle_animaux_acceptes: selected.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selected.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selected.regle_tiers_personnes_info,
      options_draps_par_lit: selected.options_draps_par_lit,
      options_linge_toilette_par_personne: selected.options_linge_toilette_par_personne,
      options_menage_forfait: selected.options_menage_forfait,
      options_depart_tardif_forfait: selected.options_depart_tardif_forfait,
      options_chiens_forfait: selected.options_chiens_forfait,
      heure_arrivee_defaut: selected.heure_arrivee_defaut ?? "17:00",
      heure_depart_defaut: selected.heure_depart_defaut ?? "12:00",
      caution_montant_defaut: selected.caution_montant_defaut ?? 0,
      cheque_menage_montant_defaut: selected.cheque_menage_montant_defaut ?? 0,
      arrhes_taux_defaut: selected.arrhes_taux_defaut ?? 0.2,
      electricity_price_per_kwh: selected.electricity_price_per_kwh ?? 0,
      frais_gestion: normalizeExpenseManagement(selected.frais_gestion),
      prix_nuit_basse_saison: selected.prix_nuit_basse_saison ?? 0,
      prix_nuit_haute_saison: selected.prix_nuit_haute_saison ?? 0,
      min_nuits_toute_annee: selected.min_nuits_toute_annee ?? 1,
      min_nuits_vacances_scolaires: selected.min_nuits_vacances_scolaires ?? 1,
      min_nuits_juillet_aout: selected.min_nuits_juillet_aout ?? 1,
      prix_nuit_liste: Array.isArray(selected.prix_nuit_liste) ? selected.prix_nuit_liste.join(", ") : "",
      gestionnaire_id: selected.gestionnaire_id ?? "",
    });
    setPhotoDrafts(
      Object.fromEntries(
        (selected.photos ?? []).map((photo) => [
          photo.id,
          {
            title: photo.title ?? "",
            alt: photo.alt ?? "",
            credit: photo.credit ?? "",
          },
        ])
      )
    );
    void fetchWordPressPhotoSyncStatus(selected.id)
      .then(setWordpressPhotoSyncStatus)
      .catch(() => setWordpressPhotoSyncStatus(null));
  }, [selected]);

  useEffect(() => {
    if (!selectedPhotoId) return;
    if (!(selected?.photos ?? []).some((photo) => photo.id === selectedPhotoId)) {
      setSelectedPhotoId(null);
    }
  }, [selected?.photos, selectedPhotoId]);

  const handleChange = (key: keyof FormState, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const expenseManagement = useMemo(
    () => normalizeExpenseManagement(form.frais_gestion, expenseCategories),
    [expenseCategories, form.frais_gestion]
  );
  const expenseTotals = useMemo(() => getExpenseTotals(expenseManagement), [expenseManagement]);
  const netAverageMonthlyRevenue = useMemo(
    () => getNetAverageMonthlyRevenue(statisticsDataset, selectedId, expenseTotals.monthly),
    [expenseTotals.monthly, selectedId, statisticsDataset]
  );
  const expenseTotalsByCategory = useMemo(() => {
    const totals = new Map<string, { monthly: number; annual: number }>();
    for (const category of expenseManagement.categories) {
      totals.set(category.id, { monthly: 0, annual: 0 });
    }
    for (const expense of expenseManagement.expenses) {
      const current = totals.get(expense.category_id) ?? { monthly: 0, annual: 0 };
      current.monthly += normalizeMoney(expense.monthly_amount);
      current.annual += normalizeMoney(expense.annual_amount);
      totals.set(expense.category_id, current);
    }
    return totals;
  }, [expenseManagement]);

  const updateExpenseManagement = (updater: (current: ExpenseManagementData) => ExpenseManagementData) => {
    setForm((current) => ({
      ...current,
      frais_gestion: updater(normalizeExpenseManagement(current.frais_gestion, expenseCategories)),
    }));
  };

  const addExpenseCategory = () => {
    setExpenseCategories((current) => [
      ...current,
      {
        id: createLocalId("cat"),
        name: "Nouvelle catégorie",
        color: EXPENSE_CATEGORY_COLORS[current.length % EXPENSE_CATEGORY_COLORS.length],
      },
    ]);
  };

  const updateExpenseCategory = (categoryId: string, patch: Partial<ExpenseCategory>) => {
    setExpenseCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              ...patch,
              name: patch.name !== undefined ? patch.name : category.name,
              color: patch.color && isHexColor(patch.color) ? patch.color : category.color,
            }
          : category
      )
    );
  };

  const deleteExpenseCategory = (categoryId: string) => {
    setExpenseCategories((current) => {
      if (current.length <= 1) return current;
      const categories = current.filter((category) => category.id !== categoryId);
      const fallbackCategoryId = categories[0]?.id ?? "";
      setForm((formState) => ({
        ...formState,
        frais_gestion: (() => {
          const normalized = normalizeExpenseManagement(formState.frais_gestion, current);
          return {
            ...normalized,
          categories,
            expenses: normalized.expenses.map((expense) =>
              expense.category_id === categoryId ? { ...expense, category_id: fallbackCategoryId } : expense
            ),
          };
        })(),
      }));
      return categories;
    });
  };

  const addExpenseLine = () => {
    updateExpenseManagement((current) => ({
      ...current,
      expenses: [
        ...current.expenses,
        {
          id: createLocalId("fee"),
          label: "",
          category_id: current.categories[0]?.id ?? "",
          monthly_amount: 0,
          annual_amount: 0,
          notes: "",
        },
      ],
    }));
  };

  const updateExpenseLine = (expenseId: string, patch: Partial<ExpenseLine>) => {
    updateExpenseManagement((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => (expense.id === expenseId ? { ...expense, ...patch } : expense)),
    }));
  };

  const updateExpenseAmount = (expenseId: string, field: ExpenseAmountField, rawValue: string) => {
    const amount = rawValue === "" ? 0 : normalizeMoney(rawValue);
    updateExpenseLine(
      expenseId,
      field === "monthly_amount"
        ? { monthly_amount: amount, annual_amount: normalizeMoney(amount * 12) }
        : { annual_amount: amount, monthly_amount: normalizeMoney(amount / 12) }
    );
  };

  const deleteExpenseLine = (expenseId: string) => {
    updateExpenseManagement((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== expenseId),
    }));
  };

  const jumpToEditorSection = (sectionId: (typeof GITE_EDITOR_SECTIONS)[number]["id"]) => {
    setActiveEditorSection(sectionId);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, id: string) => {
    if (reordering) return;
    setDraggedId(id);
    setDragOverId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (reordering) return;
    const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverId !== targetId) setDragOverId(targetId);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (reordering) return;
    const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
    setDraggedId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const fromIndex = gites.findIndex((gite) => gite.id === sourceId);
    const targetIndex = gites.findIndex((gite) => gite.id === targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;

    const reordered = [...gites];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setGites(reordered);

    setReordering(true);
    setError(null);
    try {
      const updated = await apiFetch<Gite[]>("/gites/reorder", {
        method: "POST",
        json: { ids: reordered.map((gite) => gite.id) },
      });
      setGites(updated);
    } catch (err: any) {
      setError(err.message);
      await load();
    } finally {
      setReordering(false);
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const save = async (options: { keepOpen?: boolean } = {}) => {
    const keepOpen = options.keepOpen ?? false;
    const savedSelectedId = selectedId;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const prixNuitListe = form.prix_nuit_liste
        .split(/[,;\n]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const payload = {
        ...form,
        public_slug: form.public_slug || null,
        public_title: form.public_title || null,
        public_summary: form.public_summary || null,
        public_description: form.public_description || null,
        public_technical_description: form.public_technical_description || null,
        public_seo_title: form.public_seo_title || null,
        public_seo_description: form.public_seo_description || null,
        public_structured_content: parseJsonTextarea(
          "Contenu structuré site",
          form.public_structured_content || serializeStructuredValue(buildStructuredContentDefaults())
        ),
        public_equipment: null,
        public_rooms: null,
        public_practical_info: null,
        public_location_info: null,
        public_latitude: null,
        public_longitude: null,
        heure_arrivee_defaut: form.heure_arrivee_defaut || "17:00",
        heure_depart_defaut: form.heure_depart_defaut || "12:00",
        gestionnaire_id: form.gestionnaire_id || null,
        capacite_max: Math.max(1, Math.trunc(toNumberOrDefault(form.capacite_max, 1))),
        nb_adultes_max: Math.max(1, Math.trunc(toNumberOrDefault(form.nb_adultes_max, 1))),
        nb_adultes_habituel: Math.max(1, Math.trunc(toNumberOrDefault(form.nb_adultes_habituel, 1))),
        nb_enfants_max: Math.max(0, Math.trunc(toNumberOrDefault(form.nb_enfants_max, 0))),
        taxe_sejour_par_personne_par_nuit: toNumberOrDefault(form.taxe_sejour_par_personne_par_nuit),
        options_draps_par_lit: toNumberOrDefault(form.options_draps_par_lit),
        options_linge_toilette_par_personne: toNumberOrDefault(form.options_linge_toilette_par_personne),
        options_menage_forfait: toNumberOrDefault(form.options_menage_forfait),
        options_depart_tardif_forfait: toNumberOrDefault(form.options_depart_tardif_forfait),
        options_chiens_forfait: toNumberOrDefault(form.options_chiens_forfait),
        caution_montant_defaut: toNumberOrDefault(form.caution_montant_defaut),
        cheque_menage_montant_defaut: toNumberOrDefault(form.cheque_menage_montant_defaut),
        arrhes_taux_defaut: toNumberOrDefault(form.arrhes_taux_defaut, 0.2),
        electricity_price_per_kwh: toNumberOrDefault(form.electricity_price_per_kwh),
        frais_gestion: normalizeExpenseManagement(form.frais_gestion, expenseCategories),
        prix_nuit_basse_saison: toNumberOrDefault(form.prix_nuit_basse_saison),
        prix_nuit_haute_saison: toNumberOrDefault(form.prix_nuit_haute_saison),
        min_nuits_toute_annee: Math.max(1, Math.trunc(toNumberOrDefault(form.min_nuits_toute_annee, 1))),
        min_nuits_vacances_scolaires: Math.max(1, Math.trunc(toNumberOrDefault(form.min_nuits_vacances_scolaires, 1))),
        min_nuits_juillet_aout: Math.max(1, Math.trunc(toNumberOrDefault(form.min_nuits_juillet_aout, 1))),
        prix_nuit_liste: prixNuitListe,
        telephones: form.telephones
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const savedExpenseCategorySettings = await apiFetch<ExpenseCategorySettings>("/gites/expense-categories", {
        method: "PUT",
        json: { categories: expenseCategories },
      });
      setExpenseCategories(
        normalizeExpenseManagement({ categories: savedExpenseCategorySettings.categories, expenses: [] }).categories
      );
      let created: Gite | null = null;
      if (savedSelectedId) {
        await apiFetch(`/gites/${savedSelectedId}`, { method: "PUT", json: payload });
      } else {
        created = await apiFetch<Gite>(`/gites`, { method: "POST", json: payload });
      }
      await load();
      if (created) {
        setSelectedId(created.id);
        const matchingPlaceholder = placeholders.find(
          (placeholder) => placeholder.abbreviation === created.prefixe_contrat.toUpperCase()
        );
        if (
          matchingPlaceholder &&
          confirm(
            `Associer le nouveau gîte ${created.nom} au placeholder ${matchingPlaceholder.abbreviation} (${matchingPlaceholder.reservations_count} réservations) ?`
          )
        ) {
          await apiFetch(`/reservations/placeholders/${matchingPlaceholder.id}/assign`, {
            method: "POST",
            json: { gite_id: created.id },
          });
          await load();
        }
      } else if (keepOpen && savedSelectedId) {
        setSelectedId(savedSelectedId);
        setNotice(`${activeEditorSectionLabel} enregistrée.`);
      } else {
        setSelectedId(null);
        setForm(emptyForm);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const duplicate = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<Gite>(`/gites/${id}/duplicate`, { method: "POST" });
      await load();
      setSelectedId(created.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (gite: Gite) => {
    const contratsCount = gite.contrats_count ?? 0;
    const message =
      contratsCount > 0
        ? `Supprimer ce gîte et ses ${contratsCount} contrats ?`
        : "Supprimer ce gîte ?";
    if (!confirm(message)) return;
    setNotice(null);
    try {
      await apiFetch(`/gites/${gite.id}`, { method: "DELETE" });
      await load();
      if (selectedId === gite.id) setSelectedId(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const attachPlaceholder = async (placeholder: ReservationPlaceholder) => {
    const targetGiteId = placeholderTargets[placeholder.id] ?? selectedId ?? "";
    if (!targetGiteId) {
      setError("Choisissez un gîte cible avant de rattacher un placeholder.");
      return;
    }
    setError(null);
    setNotice(null);
    setAttachingPlaceholderId(placeholder.id);
    try {
      await apiFetch(`/reservations/placeholders/${placeholder.id}/assign`, {
        method: "POST",
        json: { gite_id: targetGiteId },
      });
      const targetGite = gites.find((gite) => gite.id === targetGiteId);
      setNotice(
        `Placeholder ${placeholder.abbreviation} rattaché à ${targetGite?.nom ?? "ce gîte"} (${placeholder.reservations_count} réservation(s)).`
      );
      setFadingPlaceholderIds((prev) => (prev.includes(placeholder.id) ? prev : [...prev, placeholder.id]));
      await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_FADE_OUT_MS));
      setPlaceholders((prev) => prev.filter((item) => item.id !== placeholder.id));
      setPlaceholderTargets((prev) => {
        const { [placeholder.id]: _removed, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (err: any) {
      if (isApiError(err) && err.status === 409) {
        const conflicts = Array.isArray((err.payload as any).conflicts) ? (err.payload as any).conflicts : [];
        const deduplicated = Number((err.payload as any).skipped_duplicates_count ?? 0);
        const suffixParts: string[] = [];
        if (conflicts.length > 0) suffixParts.push(`${conflicts.length} conflit(s)`);
        if (deduplicated > 0) suffixParts.push(`${deduplicated} doublon(s) ignoré(s)`);
        const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";
        setError(`${err.message}${suffix}`);
      } else {
        setError(err.message);
      }
    } finally {
      setFadingPlaceholderIds((prev) => prev.filter((id) => id !== placeholder.id));
      setAttachingPlaceholderId(null);
    }
  };

  const triggerImport = () => {
    importInputRef.current?.click();
  };

  const triggerEquipmentInfoImport = () => {
    equipmentInfoImportInputRef.current?.click();
  };

  const triggerPhotoUpload = () => {
    photoInputRef.current?.click();
  };

  const setSelectedPhotos = (photos: GitePhoto[]) => {
    if (!selected) return;
    setGites((current) =>
      current.map((gite) => (gite.id === selected.id ? { ...gite, photos } : gite))
    );
  };

  const fetchWordPressPhotoSyncStatus = async (giteId: string) =>
    apiFetch<WordPressPhotoSyncStatus>(`/gites/${giteId}/photos/wordpress-sync`);

  const watchWordPressPhotoSync = async (giteId: string) => {
    const watchId = wordpressPhotoSyncWatchRef.current + 1;
    wordpressPhotoSyncWatchRef.current = watchId;
    setWordpressPhotoSyncStatus({
      enabled: true,
      state: "queued",
      message: "Mise à jour WordPress programmée.",
      debounce_ms: 0,
    });

    for (let attempt = 0; attempt < 35; attempt += 1) {
      await wait(attempt === 0 ? 900 : 1500);
      if (wordpressPhotoSyncWatchRef.current !== watchId) return;
      try {
        const status = await fetchWordPressPhotoSyncStatus(giteId);
        if (wordpressPhotoSyncWatchRef.current !== watchId) return;
        setWordpressPhotoSyncStatus(status);
        if (status.state !== "queued" && status.state !== "sending") return;
      } catch (err: any) {
        if (wordpressPhotoSyncWatchRef.current !== watchId) return;
        setWordpressPhotoSyncStatus({
          enabled: true,
          state: "failed",
          message: err.message || "Statut WordPress indisponible.",
          debounce_ms: 0,
        });
        return;
      }
    }
  };

  const startCreate = () => {
    setSelectedId(null);
    setForm(emptyForm);
    requestAnimationFrame(() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const selectGite = (id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const exportGites = async () => {
    setExportingGites(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiFetch<GitesExportPayload>("/gites/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `gites-export-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`${payload.gites.length} fiche(s) exportée(s).`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExportingGites(false);
    }
  };

  const importGitesFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingGites(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      let payload: { gites: unknown[] };

      if (Array.isArray(parsed)) {
        payload = { gites: parsed };
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { gites?: unknown[] }).gites)
      ) {
        payload = { gites: (parsed as { gites: unknown[] }).gites };
      } else {
        throw new Error("Format invalide: utilisez un JSON exporté depuis l'application.");
      }

      const result = await apiFetch<GitesImportResult>("/gites/import", {
        method: "POST",
        json: payload,
      });
      await load();
      setNotice(`Import terminé: ${result.created_count} créé(s), ${result.updated_count} mis à jour.`);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setError("Le fichier n'est pas un JSON valide.");
      } else {
        setError(err.message);
      }
    } finally {
      input.value = "";
      setImportingGites(false);
    }
  };

  const exportEquipmentInfo = () => {
    setError(null);
    setNotice(null);
    try {
      const payload: GiteEquipmentInfoExportPayload = {
        version: 1,
        type: "gite-equipment-info",
        exported_at: new Date().toISOString(),
        gite: selected
          ? {
              id: selected.id,
              nom: selected.nom,
              prefixe_contrat: selected.prefixe_contrat,
            }
          : null,
        sections: getEquipmentInfoSections(form.public_structured_content),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const namePart = buildExportFilenamePart(selected?.nom ?? form.nom);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${namePart}-equipement-infos-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("Pièces et équipement exportés.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const importEquipmentInfoFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingEquipmentInfo(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const importedSections = normalizeImportedEquipmentInfoSections(parsed);
      if (importedSections.length === 0) {
        throw new Error("Aucune section Pièces et équipement détectée dans ce fichier.");
      }
      setForm((current) => ({
        ...current,
        public_structured_content: mergeEquipmentInfoSections(current.public_structured_content, importedSections),
      }));
      setNotice("Pièces et équipement importés. Enregistrez cette section pour appliquer les changements.");
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setError("Le fichier n'est pas un JSON valide.");
      } else {
        setError(err.message);
      }
    } finally {
      input.value = "";
      setImportingEquipmentInfo(false);
    }
  };

  const uploadPhotoFiles = async (files: FileList | File[]) => {
    if (!selected) return;
    const photoFiles = Array.from(files);
    if (photoFiles.length === 0) return;

    setUploadingPhoto(true);
    setError(null);
    setNotice(null);
    try {
      for (const file of photoFiles) {
        if (!GITE_PHOTO_ALLOWED_MIME_TYPES.has(file.type)) {
          throw new Error(`${file.name}: format non pris en charge. Utilisez JPG, PNG, WEBP ou AVIF.`);
        }
        if (file.size > GITE_PHOTO_MAX_BYTES) {
          throw new Error(`${file.name}: la photo dépasse ${Math.round(GITE_PHOTO_MAX_BYTES / (1024 * 1024))} Mo.`);
        }
      }
      const existingCount = selected.photos?.length ?? 0;
      for (const [index, file] of photoFiles.entries()) {
        const data = await readFileAsDataUrl(file);
        await apiFetch<GitePhoto>(`/gites/${selected.id}/photos/upload`, {
          method: "POST",
          json: {
            filename: file.name,
            mimeType: file.type,
            data,
            title: file.name.replace(/\.[^.]+$/, ""),
            alt: selected.public_title || selected.nom,
            is_primary: existingCount === 0 && index === 0,
            is_public: true,
          },
        });
      }
      await load();
      setNotice(`${photoFiles.length} photo${photoFiles.length > 1 ? "s" : ""} ajoutée${photoFiles.length > 1 ? "s" : ""}.`);
      void watchWordPressPhotoSync(selected.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingPhoto(false);
      setPhotoDropActive(false);
    }
  };

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (input.files) {
      await uploadPhotoFiles(input.files);
    }
    input.value = "";
  };

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");

  const handlePhotoPageDrag = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = selected && !uploadingPhoto ? "copy" : "none";
    if (!selected || uploadingPhoto) return;
    setPhotoDropActive(true);
  };

  const handlePhotoPageLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setPhotoDropActive(false);
  };

  const handlePhotoPageDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (!selected || uploadingPhoto) {
      setPhotoDropActive(false);
      return;
    }
    void uploadPhotoFiles(event.dataTransfer.files);
  };

  const updatePhotoDraft = (photoId: string, key: keyof PhotoDraft, value: string) => {
    setPhotoDrafts((prev) => ({
      ...prev,
      [photoId]: {
        title: prev[photoId]?.title ?? "",
        alt: prev[photoId]?.alt ?? "",
        credit: prev[photoId]?.credit ?? "",
        [key]: value,
      },
    }));
  };

  const savePhoto = async (
    photo: GitePhoto,
    patch: Partial<Pick<GitePhoto, "is_primary" | "is_public">> = {},
    draftOverride: Partial<PhotoDraft> = {}
  ) => {
    if (!selected) return;
    setSavingPhotoId(photo.id);
    setError(null);
    setNotice(null);
    try {
      const draft = {
        ...(photoDrafts[photo.id] ?? { title: photo.title ?? "", alt: photo.alt ?? "", credit: photo.credit ?? "" }),
        ...draftOverride,
      };
      await apiFetch<GitePhoto>(`/gites/${selected.id}/photos/${photo.id}`, {
        method: "PUT",
        json: {
          url: photo.url,
          title: draft.title || null,
          alt: draft.alt || null,
          credit: draft.credit || null,
          is_primary: patch.is_primary ?? photo.is_primary,
          is_public: patch.is_public ?? photo.is_public,
        },
      });
      await load();
      void watchWordPressPhotoSync(selected.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingPhotoId(null);
    }
  };

  const savePhotoTitle = async (photo: GitePhoto) => {
    const title = (photoDrafts[photo.id]?.title ?? photo.title ?? "").trim();
    const currentTitle = (photo.title ?? "").trim();
    setEditingPhotoTitleId(null);

    if (title === currentTitle) {
      updatePhotoDraft(photo.id, "title", photo.title ?? "");
      return;
    }

    updatePhotoDraft(photo.id, "title", title);
    await savePhoto(photo, {}, { title });
  };

  const deletePhoto = async (photo: GitePhoto) => {
    if (!selected || !confirm("Supprimer cette photo ?")) return;
    setSavingPhotoId(photo.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/gites/${selected.id}/photos/${photo.id}`, { method: "DELETE" });
      await load();
      void watchWordPressPhotoSync(selected.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingPhotoId(null);
    }
  };

  const persistPhotoOrder = async (photos: GitePhoto[], movedPhotoId: string) => {
    if (!selected) return;
    setSelectedPhotos(photos.map((photo, index) => ({ ...photo, ordre: index })));
    setSavingPhotoId(movedPhotoId);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<GitePhoto[]>(`/gites/${selected.id}/photos/reorder`, {
        method: "POST",
        json: { ids: photos.map((photo) => photo.id) },
      });
      setSelectedPhotos(updated);
      void watchWordPressPhotoSync(selected.id);
    } catch (err: any) {
      setError(err.message);
      await load();
    } finally {
      setSavingPhotoId(null);
    }
  };

  const movePhoto = async (photoId: string, direction: -1 | 1) => {
    if (!selected) return;
    const photos = [...(selected.photos ?? [])];
    const index = photos.findIndex((photo) => photo.id === photoId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= photos.length) return;
    const [moved] = photos.splice(index, 1);
    photos.splice(targetIndex, 0, moved);
    await persistPhotoOrder(photos, photoId);
  };

  const handlePhotoDragStart = (event: DragEvent<HTMLElement>, photoId: string) => {
    if (savingPhotoId || uploadingPhoto) return;
    suppressPhotoClickRef.current = true;
    setDraggedPhotoId(photoId);
    setDragOverPhotoId(photoId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-gite-photo-id", photoId);
    event.dataTransfer.setData("text/plain", photoId);
  };

  const handlePhotoDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (savingPhotoId || uploadingPhoto || hasDraggedFiles(event)) return;
    const sourceId = draggedPhotoId ?? event.dataTransfer.getData("application/x-gite-photo-id");
    if (!sourceId || sourceId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverPhotoId !== targetId) setDragOverPhotoId(targetId);
  };

  const handlePhotoDrop = async (event: DragEvent<HTMLElement>, targetId: string) => {
    if (savingPhotoId || uploadingPhoto || hasDraggedFiles(event)) return;
    event.preventDefault();
    const sourceId =
      draggedPhotoId || event.dataTransfer.getData("application/x-gite-photo-id") || event.dataTransfer.getData("text/plain");
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
    if (!selected || !sourceId || sourceId === targetId) return;
    const photos = [...(selected.photos ?? [])];
    const fromIndex = photos.findIndex((photo) => photo.id === sourceId);
    const targetIndex = photos.findIndex((photo) => photo.id === targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;
    const [moved] = photos.splice(fromIndex, 1);
    photos.splice(targetIndex, 0, moved);
    await persistPhotoOrder(photos, sourceId);
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
    window.setTimeout(() => {
      suppressPhotoClickRef.current = false;
    }, 0);
  };

  const openPhotoDrawer = (photoId: string) => {
    if (suppressPhotoClickRef.current) return;
    setSelectedPhotoId(photoId);
  };

  return (
    <div>
      <div className="gites-listing-shell">
        <div className="gites-header gites-header--listing">
          <div className="gites-tools">
            <button type="button" className="gites-primary-action" onClick={startCreate} disabled={loading}>
              Nouveau gîte
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(event) => void importGitesFromFile(event)}
              style={{ display: "none" }}
            />
            <button
              type="button"
              className="table-action table-action--neutral gites-tool-button"
              onClick={() => void exportGites()}
              disabled={exportingGites || importingGites}
            >
              {exportingGites ? "Export..." : "Exporter"}
            </button>
            <button
              type="button"
              className="table-action table-action--neutral gites-tool-button"
              onClick={triggerImport}
              disabled={importingGites || exportingGites}
            >
              {importingGites ? "Import..." : "Importer"}
            </button>
          </div>
          {reordering && <div className="gites-header__status">Enregistrement de l'ordre...</div>}
        </div>
        {notice && <div className="note note--success">{notice}</div>}
        {error && <div className="note">{error}</div>}
        {gites.length > 0 ? (
          <div className="gites-listing-grid">
            {gites.map((gite, index) => {
              const accent = getGiteColor(gite, index);
              const accentStyle = { "--gite-card-accent": accent } as CSSProperties;
              const managerLabel = formatManagerLabel(gite);
              const addressLabel = formatAddressLabel(gite);
              const primaryPhoto =
                (gite.photos ?? []).find((photo) => photo.is_primary) ?? (gite.photos ?? [])[0] ?? null;
              const tags = [
                `${gite.capacite_max} voyageurs`,
                `${gite.nb_adultes_max} adultes max`,
                gite.public_is_published ? "Publié site" : null,
              ].filter((tag): tag is string => Boolean(tag));

              return (
                <article
                  key={gite.id}
                  className={[
                    "gite-listing-card",
                    primaryPhoto ? "gite-listing-card--with-photo" : "",
                    selectedId === gite.id ? "gite-listing-card--selected" : "",
                    draggedId === gite.id ? "gite-listing-card--dragging" : "",
                    dragOverId === gite.id && draggedId !== gite.id ? "gite-listing-card--drag-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={accentStyle}
                  onDragOver={(event) => handleDragOver(event, gite.id)}
                  onDrop={(event) => void handleDrop(event, gite.id)}
                >
                  <div className="gite-listing-card__visual">
                    {primaryPhoto ? (
                      <img
                        className="gite-listing-card__photo"
                        src={primaryPhoto.url}
                        alt={primaryPhoto.alt || primaryPhoto.title || gite.nom}
                      />
                    ) : null}
                    <div className="gite-listing-card__visual-top">
                      <span className="gite-listing-card__pill">{gite.prefixe_contrat}</span>
                      <button
                        type="button"
                        className="drag-handle gite-listing-card__drag"
                        draggable={!reordering}
                        onDragStart={(event) => handleDragStart(event, gite.id)}
                        onDragEnd={handleDragEnd}
                        aria-label={`Réorganiser ${gite.nom}`}
                        title="Glisser pour réorganiser"
                        disabled={reordering}
                      >
                        ≡
                      </button>
                    </div>
                    <div className="gite-listing-card__visual-content">
                      <div className="gite-listing-card__visual-title">{gite.nom}</div>
                      <div className="gite-listing-card__visual-meta">{managerLabel}</div>
                    </div>
                  </div>

                  <div className="gite-listing-card__body">
                    <div className="gite-listing-card__heading">
                      <p>{addressLabel || "Adresse à compléter"}</p>
                    </div>

                    <div className="gite-listing-card__tags">
                      {tags.map((tag) => (
                        <span key={tag} className="gite-listing-card__tag">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="gite-listing-card__stats">
                      <div>
                        <strong>{gite.reservations_count ?? 0}</strong>
                        <span>Rés.</span>
                      </div>
                      <div>
                        <strong>{gite.contrats_count ?? 0}</strong>
                        <span>Contrats</span>
                      </div>
                      <div>
                        <strong>{gite.factures_count ?? 0}</strong>
                        <span>Factures</span>
                      </div>
                    </div>

                    <div className="gite-listing-card__actions">
                      <button type="button" className="table-action table-action--primary" onClick={() => selectGite(gite.id)}>
                        Éditer
                      </button>
                      <button type="button" className="table-action table-action--neutral" onClick={() => duplicate(gite.id)}>
                        Dupliquer
                      </button>
                      <button
                        type="button"
                        className="table-action table-action--icon gite-listing-card__delete"
                        onClick={() => remove(gite)}
                        aria-label={`Supprimer ${gite.nom}`}
                        title={`Supprimer ${gite.nom}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path
                            d="M9 3h6m-9 3h12m-9 3v7m3-7v7m3-7v7M8 6l.7 11.2a2 2 0 0 0 2 1.8h2.6a2 2 0 0 0 2-1.8L16 6"
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.5"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="gites-empty-state">
            <div className="gites-empty-state__title">Aucun gîte pour le moment</div>
            <div className="field-hint">Créez votre premier gîte pour commencer à générer contrats et factures.</div>
          </div>
        )}
      </div>

      {placeholders.length > 0 && (
        <div className="card gites-placeholders-card">
          <div className="gites-placeholders-card__header">
            <div>
              <div className="section-title">Réservations non attribuées</div>
              <div className="field-hint gites-reorder-hint">
                Lorsqu'un gîte importé n'est pas reconnu, un placeholder est créé. Rattachez-le ici.
              </div>
            </div>
            <div className="gites-placeholders-card__count">{placeholders.length} en attente</div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Abréviation</th>
                <th>Libellé</th>
                <th>Réservations</th>
                <th>Gîte cible</th>
                <th className="table-actions-cell">Action</th>
              </tr>
            </thead>
            <tbody>
              {placeholders.map((placeholder) => (
                <tr
                  key={placeholder.id}
                  className={`placeholder-row ${fadingPlaceholderIds.includes(placeholder.id) ? "placeholder-row--fading" : ""}`}
                >
                  <td>{placeholder.abbreviation}</td>
                  <td>{placeholder.label ?? ""}</td>
                  <td>
                    <span className="badge">{placeholder.reservations_count}</span>
                  </td>
                  <td>
                    <select
                      className="placeholder-target-select"
                      value={placeholderTargets[placeholder.id] ?? selectedId ?? ""}
                      onChange={(event) =>
                        setPlaceholderTargets((prev) => ({
                          ...prev,
                          [placeholder.id]: event.target.value,
                        }))
                      }
                      disabled={attachingPlaceholderId === placeholder.id || fadingPlaceholderIds.includes(placeholder.id)}
                    >
                      <option value="">Choisir un gîte</option>
                      {gites.map((gite) => (
                        <option key={gite.id} value={gite.id}>
                          {gite.nom} ({gite.prefixe_contrat})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="table-actions-cell">
                    <button
                      type="button"
                      className="table-action table-action--primary"
                      onClick={() => attachPlaceholder(placeholder)}
                      disabled={attachingPlaceholderId === placeholder.id || fadingPlaceholderIds.includes(placeholder.id)}
                    >
                      {attachingPlaceholderId === placeholder.id ? "Rattachement..." : "Rattacher"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div ref={formCardRef} className="gites-editor-layout">
        <aside className="gites-editor-sidebar">
          <div className="gites-editor-sidebar__panel">
            <div className="gites-editor-sidebar__title">{selected ? selected.nom : "Nouveau gîte"}</div>
            <nav className="gites-editor-sidebar__nav" aria-label="Rubriques du formulaire gîte">
              {GITE_EDITOR_SECTION_GROUPS.map((group) => (
                <div key={group.title} className="gites-editor-sidebar__group">
                  <div className="gites-editor-sidebar__group-title">{group.title}</div>
                  <div className="gites-editor-sidebar__group-links">
                    {group.items.map((sectionId) => {
                      const section = GITE_EDITOR_SECTION_BY_ID.get(sectionId);
                      if (!section) return null;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          className={`gites-editor-sidebar__link${
                            activeEditorSection === section.id ? " gites-editor-sidebar__link--active" : ""
                          }`}
                          onClick={() => jumpToEditorSection(section.id)}
                        >
                          {section.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <div className="gites-editor-content">
          <div className="card gites-editor-card">
            <div className="gites-editor-header">
              <div>
                <div className="gites-editor-header__eyebrow">{selected ? "Édition en cours" : "Nouveau gîte"}</div>
                <div className="section-title">{selected ? `Edition de ${selected.nom}` : "Créer un gîte"}</div>
              </div>
              {gites.length > 0 ? (
                <div className="gites-editor-tabs" role="tablist" aria-label="Changer de gîte">
                  {gites.map((gite) => (
                    <button
                      key={gite.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedId === gite.id}
                      className={`gites-editor-tabs__item${selectedId === gite.id ? " gites-editor-tabs__item--active" : ""}`}
                      onClick={() => setSelectedId(gite.id)}
                    >
                      {gite.nom}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="gites-editor-header__actions">
                <button
                  type="button"
                  className="table-action table-action--primary"
                  onClick={() => void save({ keepOpen: true })}
                  disabled={loading}
                >
                  {loading ? "Enregistrement..." : "Enregistrer cette section"}
                </button>
              </div>
            </div>
          </div>

        <div id="gite-editor-identite" className="form-section gites-editor-section" hidden={activeEditorSection !== "base-fiche"}>
          <div className="section-subtitle">Identité</div>
          <div className="grid-2">
            <label className="field">
              Nom
              <input value={form.nom} onChange={(e) => handleChange("nom", e.target.value)} />
            </label>
            <label className="field">
              Préfixe contrat
              <input
                value={form.prefixe_contrat}
                onChange={(e) => handleChange("prefixe_contrat", e.target.value.toUpperCase())}
              />
            </label>
            <label className="field">
              Gestionnaire
              <select
                value={form.gestionnaire_id}
                onChange={(e) => handleChange("gestionnaire_id", e.target.value)}
              >
                <option value="">Aucun</option>
                {gestionnaires.map((gestionnaire) => (
                  <option key={gestionnaire.id} value={gestionnaire.id}>
                    {gestionnaire.prenom} {gestionnaire.nom}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              ID Airbnb
              <input
                value={form.airbnb_listing_id}
                onChange={(e) => handleChange("airbnb_listing_id", e.target.value)}
                placeholder="48504640"
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-capacite" className="form-section gites-editor-section" hidden={activeEditorSection !== "base-fiche"}>
          <div className="section-subtitle">Capacité</div>
          <div className="grid-2">
            <label className="field">
              Capacité max
              <input
                type="number"
                value={form.capacite_max}
                onChange={(e) => handleChange("capacite_max", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Nombre d'adultes max
              <input
                type="number"
                value={form.nb_adultes_max}
                onChange={(e) => handleChange("nb_adultes_max", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Nombre d'adultes habituel
              <input
                type="number"
                value={form.nb_adultes_habituel}
                onChange={(e) => handleChange("nb_adultes_habituel", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Nombre d'enfants max
              <input
                type="number"
                min={0}
                value={form.nb_enfants_max}
                onChange={(e) => handleChange("nb_enfants_max", readNumberInput(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-adresse" className="form-section gites-editor-section" hidden={activeEditorSection !== "base-fiche"}>
          <div className="section-subtitle">Adresse</div>
          <div className="grid-2">
            <label className="field">
              Adresse ligne 1
              <input
                value={form.adresse_ligne1}
                onChange={(e) => handleChange("adresse_ligne1", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse ligne 2
              <input
                value={form.adresse_ligne2}
                onChange={(e) => handleChange("adresse_ligne2", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-site-identite" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-presentation"}>
          <div className="section-subtitle">Identité & publication</div>
          <div className="grid-2">
            <label className="field">
              Slug public
              <input
                value={form.public_slug}
                onChange={(e) => handleChange("public_slug", e.target.value.toLowerCase())}
                placeholder="gite-le-liberte"
              />
            </label>
            <label className="field">
              Titre public
              <input value={form.public_title} onChange={(e) => handleChange("public_title", e.target.value)} />
            </label>
          </div>
          <div className="rules-grid" style={{ marginTop: 12 }}>
            <div className="rule-card">
              <div>
                <div className="rule-title">Publication site</div>
                <div className="rule-sub">Rendre ce gîte disponible dans l'API publique.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.public_is_published}
                  onChange={(e) => handleChange("public_is_published", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        </div>

        <div id="gite-editor-site-textes" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-presentation"}>
          <div className="section-subtitle">Textes</div>
          <div className="grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Accroche courte
              <textarea
                value={form.public_summary}
                onChange={(e) => handleChange("public_summary", e.target.value)}
                rows={2}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Description longue
              <textarea
                value={form.public_description}
                onChange={(e) => handleChange("public_description", e.target.value)}
                rows={6}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Description technique
              <textarea
                value={form.public_technical_description}
                onChange={(e) => handleChange("public_technical_description", e.target.value)}
                rows={4}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-site-seo" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-presentation"}>
          <div className="section-subtitle">SEO</div>
          <div className="grid-2">
            <label className="field">
              Titre SEO
              <input value={form.public_seo_title} onChange={(e) => handleChange("public_seo_title", e.target.value)} />
            </label>
            <label className="field">
              Description SEO
              <input
                value={form.public_seo_description}
                onChange={(e) => handleChange("public_seo_description", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-site-structure" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-donnees"}>
          <div className="section-subtitle">Pièces et équipement</div>
          <div className="grid-2">
            <div className="structured-panel">
              <div className="structured-panel__header">
                <div className="structured-panel__title">Contenu du site</div>
                <div className="structured-panel__actions">
                  <input
                    ref={equipmentInfoImportInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) => void importEquipmentInfoFromFile(event)}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    className="table-action table-action--neutral"
                    onClick={exportEquipmentInfo}
                    disabled={importingEquipmentInfo}
                  >
                    Exporter
                  </button>
                  <button
                    type="button"
                    className="table-action table-action--neutral"
                    onClick={triggerEquipmentInfoImport}
                    disabled={importingEquipmentInfo}
                  >
                    {importingEquipmentInfo ? "Import..." : "Importer"}
                  </button>
                </div>
              </div>
              <StructuredContentEditor
                value={form.public_structured_content}
                onChange={(nextValue) => handleChange("public_structured_content", nextValue)}
                excludeSectionFamilyIds={[BED_SECTION_ID]}
              />
            </div>
          </div>
        </div>

        <div id="gite-editor-site-chambres" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-chambres"}>
          <div className="grid-2">
            <div className="structured-panel structured-panel--bare">
              <StructuredContentEditor
                value={form.public_structured_content}
                onChange={(nextValue) => handleChange("public_structured_content", nextValue)}
                sectionFamilyId={BED_SECTION_ID}
                allowedGroupTypes={["rubrique"]}
                defaultGroupType="rubrique"
                showGroupTypeSelect={false}
              />
            </div>
          </div>
        </div>

        <div
          id="gite-editor-photos"
          className={`form-section gites-editor-section gite-photo-page-dropzone${
            photoDropActive ? " gite-photo-page-dropzone--active" : ""
          }`}
          hidden={activeEditorSection !== "web-photos"}
          onDragEnter={handlePhotoPageDrag}
          onDragOver={handlePhotoPageDrag}
          onDragLeave={handlePhotoPageLeave}
          onDrop={handlePhotoPageDrop}
        >
          <div className="section-subtitle">Photos</div>
          {!selected ? (
            <div className="field-hint">Enregistrez le gîte avant d'ajouter des photos.</div>
          ) : (
            <>
              <div className={`gite-photo-dropzone${photoDropActive ? " gite-photo-dropzone--active" : ""}`}>
                <input
                  ref={photoInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={(event) => void uploadPhoto(event)}
                  style={{ display: "none" }}
                />
                <div className="gite-photo-dropzone__copy">
                  <strong>{uploadingPhoto ? "Ajout en cours..." : "Ajouter des photos"}</strong>
                  <span>JPG, PNG, WEBP ou AVIF. 12 Mo max par fichier.</span>
                </div>
                <div className="gite-photo-toolbar">
                  <button
                    type="button"
                    className="table-action table-action--primary"
                    onClick={triggerPhotoUpload}
                    disabled={uploadingPhoto}
                  >
                    {uploadingPhoto ? "Upload..." : "Choisir des fichiers"}
                  </button>
                </div>
              </div>
              {wordpressPhotoSyncStatus ? (
                <div className={`gite-photo-wordpress-status gite-photo-wordpress-status--${wordpressPhotoSyncStatus.state}`}>
                  <div>
                    <strong>WordPress</strong>
                    <span>{wordpressPhotoSyncStatus.message}</span>
                    {getWordPressPhotoSyncDetail(wordpressPhotoSyncStatus) ? (
                      <small>{getWordPressPhotoSyncDetail(wordpressPhotoSyncStatus)}</small>
                    ) : null}
                    {(() => {
                      const errors = getWordPressPhotoSyncErrors(wordpressPhotoSyncStatus);
                      return errors.length > 0 ? (
                        <ul className="gite-photo-wordpress-status__errors">
                          {errors.map((error, index) => (
                            <li key={`${index}-${error}`}>{error}</li>
                          ))}
                        </ul>
                      ) : null;
                    })()}
                  </div>
                  {wordpressPhotoSyncStatus.state === "queued" || wordpressPhotoSyncStatus.state === "sending" ? (
                    <span className="gite-photo-wordpress-status__pulse" aria-hidden="true" />
                  ) : null}
                </div>
              ) : null}
              {(selected.photos ?? []).length > 0 ? (
                <div className="gite-photo-grid">
                  {(selected.photos ?? []).map((photo, index) => {
                    const draft = photoDrafts[photo.id] ?? {
                      title: photo.title ?? "",
                      alt: photo.alt ?? "",
                      credit: photo.credit ?? "",
                    };
                    const busy = savingPhotoId === photo.id;
                    return (
                      <article
                        key={photo.id}
                        className={`gite-photo-card${dragOverPhotoId === photo.id ? " gite-photo-card--drop-target" : ""}${
                          draggedPhotoId === photo.id ? " gite-photo-card--dragging" : ""
                        }`}
                        draggable={!savingPhotoId && !uploadingPhoto}
                        onDragStart={(event) => handlePhotoDragStart(event, photo.id)}
                        onDragOver={(event) => handlePhotoDragOver(event, photo.id)}
                        onDrop={(event) => void handlePhotoDrop(event, photo.id)}
                        onDragEnd={handlePhotoDragEnd}
                      >
                        <div className={`gite-photo-card__image-shell${photo.is_public ? "" : " gite-photo-card__image-shell--hidden"}`}>
                          <button
                            type="button"
                            className="gite-photo-card__image-button"
                            onClick={() => openPhotoDrawer(photo.id)}
                            disabled={busy}
                            draggable={!savingPhotoId && !uploadingPhoto}
                            title="Cliquer pour modifier, glisser pour réorganiser"
                          >
                            <span className="gite-photo-card__position">{index + 1}</span>
                            <img
                              className="gite-photo-card__image"
                              src={photo.url}
                              alt={draft.alt || photo.alt || selected.nom}
                              draggable={false}
                            />
                          </button>
                          <div className="gite-photo-card__image-actions">
                            <button
                              type="button"
                              className={`gite-photo-card__overlay-action gite-photo-card__overlay-action--star${
                                photo.is_primary ? " gite-photo-card__overlay-action--active" : ""
                              }`}
                              onClick={() => void savePhoto(photo, { is_primary: true })}
                              disabled={busy || photo.is_primary}
                              aria-pressed={photo.is_primary}
                              aria-label={photo.is_primary ? "Photo principale" : "Définir comme photo principale"}
                              title={photo.is_primary ? "Photo principale" : "Définir comme principale"}
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                            >
                              <StarIcon />
                            </button>
                            <button
                              type="button"
                              className={`gite-photo-card__overlay-action${photo.is_public ? "" : " gite-photo-card__overlay-action--active"}`}
                              onClick={() => void savePhoto(photo, { is_public: !photo.is_public })}
                              disabled={busy}
                              aria-pressed={!photo.is_public}
                              aria-label={photo.is_public ? "Masquer la photo" : "Publier la photo"}
                              title={photo.is_public ? "Masquer" : "Publier"}
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                            >
                              <EyeOffIcon />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="gite-photo-card__delete-overlay"
                            onClick={() => void deletePhoto(photo)}
                            disabled={busy}
                            aria-label="Supprimer la photo"
                            title="Supprimer"
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                        <div className="gite-photo-card__meta">
                          {editingPhotoTitleId === photo.id ? (
                            <input
                              className="gite-photo-card__title-input"
                              value={draft.title}
                              aria-label="Titre de la photo"
                              autoFocus
                              disabled={busy}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => updatePhotoDraft(photo.id, "title", event.target.value)}
                              onBlur={() => void savePhotoTitle(photo)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="gite-photo-card__title-button"
                              onClick={() => setEditingPhotoTitleId(photo.id)}
                              disabled={busy}
                              title="Modifier le titre"
                            >
                              {draft.title || photo.title || `Photo ${index + 1}`}
                            </button>
                          )}
                          {draft.credit || photo.credit ? <span>{draft.credit || photo.credit}</span> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="gites-empty-state gites-empty-state--compact">
                  <div className="gites-empty-state__title">Aucune photo</div>
                  <div className="field-hint">Ajoutez la première image pour alimenter la galerie du site.</div>
                </div>
              )}
            </>
          )}
        </div>

        {selected && selectedPhoto ? (
          <div className="gite-photo-drawer-backdrop" onMouseDown={() => setSelectedPhotoId(null)}>
            <aside
              className="gite-photo-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gite-photo-drawer-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="gite-photo-drawer__header">
                <div>
                  <div className="gite-photo-drawer__eyebrow">Photo du gîte</div>
                  <h2 id="gite-photo-drawer-title">
                    <input
                      className="gite-photo-drawer__title-input"
                      value={photoDrafts[selectedPhoto.id]?.title ?? selectedPhoto.title ?? ""}
                      aria-label="Titre de la photo"
                      placeholder="Modifier la photo"
                      disabled={savingPhotoId === selectedPhoto.id}
                      onChange={(event) => updatePhotoDraft(selectedPhoto.id, "title", event.target.value)}
                      onBlur={() => void savePhotoTitle(selectedPhoto)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </h2>
                </div>
                <button
                  type="button"
                  className="contract-return-drawer__close"
                  onClick={() => setSelectedPhotoId(null)}
                  aria-label="Fermer"
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="gite-photo-drawer__body">
                <div className="gite-photo-drawer__preview">
                  <img
                    src={selectedPhoto.url}
                    alt={photoDrafts[selectedPhoto.id]?.alt || selectedPhoto.alt || selected.nom}
                  />
                  <div className="gite-photo-card__badges">
                    {selectedPhoto.is_primary ? <span>Principale</span> : null}
                    {selectedPhoto.is_public ? <span>Publique</span> : <span>Masquée</span>}
                  </div>
                </div>
                <div className="gite-photo-drawer__fields">
                  <label className="field">
                    Texte alternatif
                    <input
                      value={photoDrafts[selectedPhoto.id]?.alt ?? selectedPhoto.alt ?? ""}
                      onChange={(event) => updatePhotoDraft(selectedPhoto.id, "alt", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    Crédit
                    <input
                      value={photoDrafts[selectedPhoto.id]?.credit ?? selectedPhoto.credit ?? ""}
                      onChange={(event) => updatePhotoDraft(selectedPhoto.id, "credit", event.target.value)}
                    />
                  </label>
                  <div className="gite-photo-drawer__switches">
                    <label className="switch-group">
                      <span className="switch">
                        <input
                          type="checkbox"
                          checked={selectedPhoto.is_public}
                          onChange={() => void savePhoto(selectedPhoto, { is_public: !selectedPhoto.is_public })}
                          disabled={savingPhotoId === selectedPhoto.id}
                        />
                        <span className="slider" />
                      </span>
                      Publique
                    </label>
                    <button
                      type="button"
                      className="table-action table-action--neutral"
                      onClick={() => void savePhoto(selectedPhoto, { is_primary: true })}
                      disabled={savingPhotoId === selectedPhoto.id || selectedPhoto.is_primary}
                    >
                      Définir principale
                    </button>
                  </div>
                </div>
              </div>
              <div className="gite-photo-drawer__footer">
                <button
                  type="button"
                  className="table-action table-action--neutral"
                  onClick={() => void deletePhoto(selectedPhoto)}
                  disabled={savingPhotoId === selectedPhoto.id}
                >
                  Supprimer
                </button>
                <button
                  type="button"
                  className="table-action table-action--primary"
                  onClick={() => void savePhoto(selectedPhoto)}
                  disabled={savingPhotoId === selectedPhoto.id}
                >
                  {savingPhotoId === selectedPhoto.id ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </aside>
          </div>
        ) : null}

        <div id="gite-editor-proprietaires" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-contact"}>
          <div className="section-subtitle">Propriétaires</div>
          <div className="grid-2">
            <label className="field">
              Propriétaires
              <input
                value={form.proprietaires_noms}
                onChange={(e) => handleChange("proprietaires_noms", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse propriétaires
              <input
                value={form.proprietaires_adresse}
                onChange={(e) => handleChange("proprietaires_adresse", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-contact" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-contact"}>
          <div className="section-subtitle">Contact</div>
          <div className="grid-2">
            <label className="field">
              Site web
              <input value={form.site_web} onChange={(e) => handleChange("site_web", e.target.value)} />
            </label>
            <label className="field">
              Email
              <input value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
            </label>
            <label className="field">
              Téléphones (séparés par des virgules)
              <input value={form.telephones} onChange={(e) => handleChange("telephones", e.target.value)} />
            </label>
          </div>
        </div>

        <div id="gite-editor-fiscalite" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-finance"}>
          <div className="section-subtitle">Fiscalité</div>
          <div className="grid-2">
            <label className="field">
              Taxe de séjour / personne / nuit
              <input
                type="number"
                step="0.01"
                value={form.taxe_sejour_par_personne_par_nuit}
                onChange={(e) => handleChange("taxe_sejour_par_personne_par_nuit", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Prix électricité / kWh
              <input
                type="number"
                step="0.0001"
                min={0}
                value={form.electricity_price_per_kwh}
                onChange={(e) =>
                  handleChange("electricity_price_per_kwh", readNumberInput(e.target.value))
                }
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-banque" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-finance"}>
          <div className="section-subtitle">Banque</div>
          <div className="grid-2">
            <label className="field">
              IBAN
              <input value={form.iban} onChange={(e) => handleChange("iban", e.target.value)} />
            </label>
            <label className="field">
              BIC
              <input value={form.bic} onChange={(e) => handleChange("bic", e.target.value)} />
            </label>
            <label className="field">
              Titulaire
              <input value={form.titulaire} onChange={(e) => handleChange("titulaire", e.target.value)} />
            </label>
          </div>
        </div>

        <div id="gite-editor-frais" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-frais"}>
          <div className="section-subtitle">Gestion des frais</div>
          <div className="expense-summary">
            <div className="expense-summary__item">
              <span>Total mensuel</span>
              <strong>{formatCurrency(expenseTotals.monthly)}</strong>
            </div>
            <div className="expense-summary__item">
              <span>Total annuel</span>
              <strong>{formatCurrency(expenseTotals.annual)}</strong>
            </div>
            <div className="expense-summary__item">
              <span>Revenu moyen mensuel</span>
              <strong>{formatCurrency(netAverageMonthlyRevenue.netAverage)}</strong>
              <small>
                {formatCurrency(netAverageMonthlyRevenue.grossRevenue)} revenus - {formatCurrency(netAverageMonthlyRevenue.expenses)} frais sur{" "}
                {netAverageMonthlyRevenue.monthCount} mois
              </small>
            </div>
          </div>

          <div className="expense-panel">
            <div className="expense-panel__header">
              <div>
                <div className="expense-panel__title">Catégories</div>
                <div className="field-hint">Les couleurs servent à regrouper les frais dans les totaux.</div>
              </div>
              <button type="button" className="table-action table-action--neutral" onClick={addExpenseCategory}>
                Ajouter
              </button>
            </div>
            <div className="expense-category-grid">
              {expenseManagement.categories.map((category) => {
                const totals = expenseTotalsByCategory.get(category.id) ?? { monthly: 0, annual: 0 };
                return (
                  <div
                    key={category.id}
                    className="expense-category-card"
                    style={{ "--expense-color": category.color } as CSSProperties}
                  >
                    <label className="expense-color-input" title="Couleur de catégorie">
                      <input
                        type="color"
                        value={category.color}
                        onChange={(event) => updateExpenseCategory(category.id, { color: event.target.value })}
                      />
                      <span aria-hidden="true" />
                    </label>
                    <label className="expense-category-card__name">
                      <input
                        aria-label="Nom de la catégorie"
                        value={category.name}
                        onChange={(event) => updateExpenseCategory(category.id, { name: event.target.value })}
                      />
                    </label>
                    <div className="expense-category-card__total">
                      <span>{formatCurrency(totals.monthly)} / mois</span>
                      <span>{formatCurrency(totals.annual)} / an</span>
                    </div>
                    <button
                      type="button"
                      className="expense-icon-button"
                      onClick={() => deleteExpenseCategory(category.id)}
                      disabled={expenseManagement.categories.length <= 1}
                      aria-label={`Supprimer la catégorie ${category.name}`}
                      title="Supprimer"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="expense-panel">
            <div className="expense-panel__header">
              <div>
                <div className="expense-panel__title">Frais</div>
                <div className="field-hint">Saisissez un montant mensuel ou annuel, l'autre valeur est calculée.</div>
              </div>
            </div>

            {expenseManagement.expenses.length > 0 ? (
              <div className="expense-lines">
                <div className="expense-lines__head" aria-hidden="true">
                  <span>Libellé</span>
                  <span>Catégorie</span>
                  <span>€/mois</span>
                  <span>€/an</span>
                  <span>Notes</span>
                  <span />
                </div>
                {expenseManagement.expenses.map((expense) => {
                  const category = expenseManagement.categories.find((item) => item.id === expense.category_id);
                  return (
                    <div
                      key={expense.id}
                      className="expense-line"
                      style={{ "--expense-color": category?.color ?? "var(--primary)" } as CSSProperties}
                    >
                      <div className="expense-line__field">
                        <input
                          aria-label="Libellé"
                          value={expense.label}
                          onChange={(event) => updateExpenseLine(expense.id, { label: event.target.value })}
                          placeholder="Assurance, taxe foncière..."
                        />
                      </div>
                      <div className="expense-line__field">
                        <select
                          aria-label="Catégorie"
                          value={expense.category_id}
                          onChange={(event) => updateExpenseLine(expense.id, { category_id: event.target.value })}
                        >
                          {expenseManagement.categories.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="expense-line__field">
                        <input
                          aria-label="€/mois"
                          type="number"
                          min={0}
                          step="0.01"
                          value={expense.monthly_amount}
                          onChange={(event) => updateExpenseAmount(expense.id, "monthly_amount", event.target.value)}
                        />
                      </div>
                      <div className="expense-line__field">
                        <input
                          aria-label="€/an"
                          type="number"
                          min={0}
                          step="0.01"
                          value={expense.annual_amount}
                          onChange={(event) => updateExpenseAmount(expense.id, "annual_amount", event.target.value)}
                        />
                      </div>
                      <div className="expense-line__field">
                        <input
                          aria-label="Notes"
                          value={expense.notes}
                          onChange={(event) => updateExpenseLine(expense.id, { notes: event.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        className="expense-line__delete expense-icon-button"
                        onClick={() => deleteExpenseLine(expense.id)}
                        aria-label={`Supprimer le frais ${expense.label || "sans libellé"}`}
                        title="Supprimer"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="gites-empty-state gites-empty-state--compact">
                <div className="gites-empty-state__title">Aucun frais recensé</div>
                <div className="field-hint">Ajoutez une ligne pour suivre les charges mensuelles et annuelles du gîte.</div>
              </div>
            )}
            <div className="expense-lines__footer">
              <button type="button" className="table-action table-action--primary" onClick={addExpenseLine}>
                Ajouter un frais
              </button>
            </div>
          </div>
        </div>

        <div id="gite-editor-services" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-services"}>
          <div className="section-subtitle">Services</div>
          <div className="grid-2">
            <label className="field">
              Draps / lit (par séjour)
              <input
                type="number"
                step={1}
                value={form.options_draps_par_lit}
                onChange={(e) => handleChange("options_draps_par_lit", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Linge toilette / personne (par séjour)
              <input
                type="number"
                step={1}
                value={form.options_linge_toilette_par_personne}
                onChange={(e) => handleChange("options_linge_toilette_par_personne", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Ménage forfait
              <input
                type="number"
                step={1}
                value={form.options_menage_forfait}
                onChange={(e) => handleChange("options_menage_forfait", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Départ tardif forfait
              <input
                type="number"
                step={1}
                value={form.options_depart_tardif_forfait}
                onChange={(e) => handleChange("options_depart_tardif_forfait", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Chiens / nuit
              <input
                type="number"
                step={1}
                value={form.options_chiens_forfait}
                onChange={(e) => handleChange("options_chiens_forfait", readNumberInput(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-horaires" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-services"}>
          <div className="section-subtitle">Horaires</div>
          <div className="grid-2">
            <label className="field">
              Heure d'arrivée par défaut
              <input
                type="time"
                value={form.heure_arrivee_defaut}
                onChange={(e) => handleChange("heure_arrivee_defaut", e.target.value)}
              />
            </label>
            <label className="field">
              Heure de départ par défaut
              <input
                type="time"
                value={form.heure_depart_defaut}
                onChange={(e) => handleChange("heure_depart_defaut", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-garanties" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-tarifs"}>
          <div className="section-subtitle">Garanties & arrhes</div>
          <div className="grid-2">
            <label className="field">
              Caution par défaut
              <input
                type="number"
                step={1}
                value={form.caution_montant_defaut}
                onChange={(e) => handleChange("caution_montant_defaut", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Chèque ménage par défaut
              <input
                type="number"
                step={1}
                value={form.cheque_menage_montant_defaut}
                onChange={(e) => handleChange("cheque_menage_montant_defaut", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Arrhes par défaut (%)
              <input
                type="number"
                step="0.1"
                value={form.arrhes_taux_defaut === "" ? "" : Math.round((form.arrhes_taux_defaut ?? 0) * 1000) / 10}
                onChange={(e) =>
                  handleChange("arrhes_taux_defaut", e.target.value === "" ? "" : Number(e.target.value) / 100)
                }
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-caracteristiques" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-regles"}>
          <div className="section-subtitle">Caractéristiques</div>
          <div className="grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Caractéristiques (1 ligne = 1 bullet PDF)
              <textarea
                value={form.caracteristiques}
                onChange={(e) => handleChange("caracteristiques", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-tarifs" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-tarifs"}>
          <div className="section-subtitle">Tarifs de nuit</div>
          <div className="grid-2">
            <label className="field">
              Prix/nuit basse saison
              <input
                type="number"
                min={0}
                step={1}
                value={form.prix_nuit_basse_saison}
                onChange={(e) => handleChange("prix_nuit_basse_saison", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Prix/nuit haute saison (vacances scolaires)
              <input
                type="number"
                min={0}
                step={1}
                value={form.prix_nuit_haute_saison}
                onChange={(e) => handleChange("prix_nuit_haute_saison", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Autres prix/nuit proposés (liste séparée par virgules ou retours ligne)
              <textarea
                value={form.prix_nuit_liste}
                onChange={(e) => handleChange("prix_nuit_liste", e.target.value)}
                rows={3}
              />
            </label>
          </div>
          <div className="section-subtitle">Nombre de nuits minimum</div>
          <div className="grid-2">
            <label className="field">
              Toute l'année
              <input
                type="number"
                min={1}
                step={1}
                value={form.min_nuits_toute_annee}
                onChange={(e) => handleChange("min_nuits_toute_annee", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Vacances scolaires
              <input
                type="number"
                min={1}
                step={1}
                value={form.min_nuits_vacances_scolaires}
                onChange={(e) => handleChange("min_nuits_vacances_scolaires", readNumberInput(e.target.value))}
              />
            </label>
            <label className="field">
              Juillet / août
              <input
                type="number"
                min={1}
                step={1}
                value={form.min_nuits_juillet_aout}
                onChange={(e) => handleChange("min_nuits_juillet_aout", readNumberInput(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-regles" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-regles"}>
          <div className="section-subtitle">Règles du gîte</div>
          <div className="rules-grid">
            <div className="rule-card">
              <div>
                <div className="rule-title">Animaux acceptés</div>
                <div className="rule-sub">Autoriser la présence d'animaux dans le gîte.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_animaux_acceptes}
                  onChange={(e) => handleChange("regle_animaux_acceptes", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Bois première flambée</div>
                <div className="rule-sub">Inclure du bois pour l'arrivée des locataires.</div>
              </div>
              <label className="switch switch--pink">
                <input
                  type="checkbox"
                  checked={form.regle_bois_premiere_flambee}
                  onChange={(e) => handleChange("regle_bois_premiere_flambee", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Info tiers personnes</div>
                <div className="rule-sub">Informer des passages éventuels de tiers.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_tiers_personnes_info}
                  onChange={(e) => handleChange("regle_tiers_personnes_info", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" onClick={save} disabled={loading}>
            {loading ? "Enregistrement..." : "Enregistrer"}
          </button>
          {selected && (
            <button type="button" className="secondary" onClick={startCreate}>
              Annuler
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default GitesPage;

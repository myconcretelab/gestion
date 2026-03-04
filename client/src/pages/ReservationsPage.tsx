import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { mergeOptions } from "./shared/rentalForm";
import {
  computeUrssafByManager,
  parseStatisticsPayload,
  type ParsedStatisticsPayload,
  type StatisticsPayload,
} from "./statistics/statisticsUtils";
import { apiFetch, isApiError } from "../utils/api";
import { formatDate, formatEuro } from "../utils/format";
import type { ContratOptions, Gite, Reservation, ReservationPlaceholder } from "../utils/types";

type SaveState = "idle" | "saving" | "saved" | "error";

type ReservationDraft = {
  id?: string;
  gite_id: string | null;
  placeholder_id: string | null;
  hote_nom: string;
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  nb_adultes: number;
  prix_par_nuit: number;
  prix_total: number;
  source_paiement: string;
  commentaire: string;
  frais_optionnels_montant: number;
  frais_optionnels_libelle: string;
  frais_optionnels_declares: boolean;
  price_driver: "nightly" | "total";
};

type ImportPreview = {
  rows_count: number;
  rows_without_gite: number;
  issues: Array<{ row: number; message: string }>;
  unknown_abbreviations: string[];
  detected_columns: Array<{ key: string; label: string }>;
  applied_column_map: Partial<Record<ImportColumnField, string>>;
  missing_required_fields: ImportColumnField[];
  abbreviations: Array<{
    abbreviation: string;
    count: number;
    matched_gite_id: string | null;
    matched_gite_nom: string | null;
    matched_gite_prefixe: string | null;
  }>;
};

type ReservationCreateResponse = Reservation & {
  created_reservations?: Reservation[];
};

type ImportColumnField =
  | "hote_nom"
  | "date_entree"
  | "date_sortie"
  | "nb_adultes"
  | "prix_par_nuit"
  | "prix_total"
  | "source_paiement"
  | "commentaire"
  | "gite_abbreviation"
  | "frais_optionnels_montant"
  | "frais_optionnels_libelle"
  | "frais_optionnels_declares";

type GridContext = {
  monthIndex: number;
  rowIndex: number;
  colIndex: number;
  rowType: "existing" | "new";
  monthRows: Reservation[];
  hasNewRow: boolean;
  reservationId?: string;
};

type InlineEditableField =
  | "hote_nom"
  | "date_entree"
  | "date_sortie"
  | "nb_adultes"
  | "prix_par_nuit"
  | "prix_total"
  | "source_paiement"
  | "commentaire";

type InlineCell = {
  rowId: string;
  field: InlineEditableField;
};

type ReservationServiceOptionKey = "draps" | "linge_toilette" | "menage" | "depart_tardif" | "chiens";

type ReservationOptionsPreview = {
  total: number;
  label: string;
  byKey: Record<ReservationServiceOptionKey, number>;
};

type ReservationFeesBreakdown = {
  declared: number;
  undeclared: number;
};

type UrssafDeclarationRow = {
  year: number;
  month: number;
  manager_id: string;
  amount: number;
  declared_at: string;
};
type UrssafDeclarationsByKey = Record<string, UrssafDeclarationRow>;
type UrssafUndeclaredMonthItem = {
  month: number;
  amount: number;
  managers: Array<{
    managerId: string;
    amount: number;
  }>;
};

const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

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

const DEFAULT_RESERVATION_SOURCE = "A définir";
const ALL_GITES_TAB = "all-gites";
const UNASSIGNED_TAB = "unassigned";
const SERVICE_OPTION_KEYS: ReservationServiceOptionKey[] = ["draps", "linge_toilette", "menage", "depart_tardif", "chiens"];
const INLINE_EDITABLE_FIELDS: InlineEditableField[] = [
  "hote_nom",
  "date_entree",
  "date_sortie",
  "nb_adultes",
  "prix_par_nuit",
  "prix_total",
  "source_paiement",
  "commentaire",
];
const INLINE_PICKER_FIELDS: InlineEditableField[] = ["date_entree", "date_sortie", "source_paiement"];
const DETAILS_CLOSE_ANIMATION_MS = 280;
const ROW_SAVED_FADE_MS = 900;

const IMPORT_COLUMN_FIELDS: Array<{ key: ImportColumnField; label: string; required?: boolean }> = [
  { key: "hote_nom", label: "Nom de l'hôte", required: true },
  { key: "date_entree", label: "Date d'entrée", required: true },
  { key: "date_sortie", label: "Date de sortie", required: true },
  { key: "nb_adultes", label: "Nb adultes" },
  { key: "prix_par_nuit", label: "Prix par nuit" },
  { key: "prix_total", label: "Prix total" },
  { key: "source_paiement", label: "Source paiement" },
  { key: "commentaire", label: "Commentaire" },
  { key: "gite_abbreviation", label: "Abréviation gîte" },
  { key: "frais_optionnels_montant", label: "Montant frais optionnels" },
  { key: "frais_optionnels_libelle", label: "Libellé frais optionnels" },
  { key: "frais_optionnels_declares", label: "Frais optionnels déclarés" },
];

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const SOURCE_BY_NORMALIZED_KEY: Record<string, string> = {
  [normalizeTextKey("Abritel")]: "Abritel",
  [normalizeTextKey("Airbnb")]: "Airbnb",
  [normalizeTextKey("Chèque")]: "Chèque",
  [normalizeTextKey("Cheques")]: "Chèque",
  [normalizeTextKey("Espèces")]: "Espèces",
  [normalizeTextKey("HomeExchange")]: "HomeExchange",
  [normalizeTextKey("Virement")]: "Virement",
  [normalizeTextKey("A définir")]: "A définir",
  [normalizeTextKey("A Définir")]: "A définir",
  [normalizeTextKey("Gites de France")]: "Gites de France",
  [normalizeTextKey("Gite de France")]: "Gites de France",
};

const normalizeReservationSource = (value: string | null | undefined) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return DEFAULT_RESERVATION_SOURCE;
  return SOURCE_BY_NORMALIZED_KEY[normalizeTextKey(trimmed)] ?? DEFAULT_RESERVATION_SOURCE;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const buildUrssafDeclarationCheckKey = (year: number, month: number, managerId: string) =>
  `${year}-${pad2(month)}-${managerId}`;

const toInputDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

const getUtcStartOfToday = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

const isReservationInProgress = (reservation: Reservation) => {
  const start = new Date(reservation.date_entree);
  const end = new Date(reservation.date_sortie);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const todayUtcStart = getUtcStartOfToday();
  return start.getTime() <= todayUtcStart && todayUtcStart < end.getTime();
};

const parseInputDate = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const toNonNegativeInt = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric));
};

const buildDefaultReservationOptions = (draft: ReservationDraft): ContratOptions =>
  mergeOptions({
    draps: { enabled: false, nb_lits: Math.max(1, draft.nb_adultes || 1), offert: false, declared: false },
    linge_toilette: { enabled: false, nb_personnes: Math.max(1, draft.nb_adultes || 1), offert: false, declared: false },
    menage: { enabled: false, offert: false, declared: false },
    depart_tardif: { enabled: false, offert: false, declared: false },
    chiens: { enabled: false, nb: 1, offert: false, declared: false },
  });

const computeReservationOptionsPreview = (
  optionValue: ContratOptions,
  draft: ReservationDraft,
  gite: Gite | null
): ReservationOptionsPreview => {
  const options = mergeOptions(optionValue);
  const nights = Math.max(0, draft.nb_nuits);
  const drapsQty = toNonNegativeInt(options.draps.nb_lits, 0);
  const lingeQty = toNonNegativeInt(options.linge_toilette.nb_personnes, 0);
  const chiensQty = toNonNegativeInt(options.chiens.nb, 0);

  const draps = options.draps.enabled
    ? options.draps.offert
      ? 0
      : round2(Number(gite?.options_draps_par_lit ?? 0) * drapsQty)
    : 0;
  const linge = options.linge_toilette.enabled
    ? options.linge_toilette.offert
      ? 0
      : round2(Number(gite?.options_linge_toilette_par_personne ?? 0) * lingeQty)
    : 0;
  const menage = options.menage.enabled
    ? options.menage.offert
      ? 0
      : round2(Number(gite?.options_menage_forfait ?? 0))
    : 0;
  const departTardif = options.depart_tardif.enabled
    ? options.depart_tardif.offert
      ? 0
      : round2(Number(gite?.options_depart_tardif_forfait ?? 0))
    : 0;
  const chiens = options.chiens.enabled
    ? options.chiens.offert
      ? 0
      : round2(Number(gite?.options_chiens_forfait ?? 0) * chiensQty * nights)
    : 0;

  const labels: string[] = [];
  if (options.draps.enabled) labels.push(`Draps x${drapsQty}${options.draps.offert ? " offerts" : ""}`);
  if (options.linge_toilette.enabled) labels.push(`Linge x${lingeQty}${options.linge_toilette.offert ? " offert" : ""}`);
  if (options.menage.enabled) labels.push(`Ménage${options.menage.offert ? " offert" : ""}`);
  if (options.depart_tardif.enabled) labels.push(`Départ tardif${options.depart_tardif.offert ? " offert" : ""}`);
  if (options.chiens.enabled) labels.push(`Chiens x${chiensQty}${options.chiens.offert ? " offerts" : ""}`);

  const byKey: Record<ReservationServiceOptionKey, number> = {
    draps,
    linge_toilette: linge,
    menage,
    depart_tardif: departTardif,
    chiens,
  };

  return {
    total: round2(draps + linge + menage + departTardif + chiens),
    label: labels.join(" · "),
    byKey,
  };
};

const computeReservationFeesBreakdown = (params: {
  reservation: Reservation;
  draft: ReservationDraft;
  optionDraft: ContratOptions;
  optionPreview: ReservationOptionsPreview;
}): ReservationFeesBreakdown => {
  const options = mergeOptions(params.optionDraft);
  let declared = 0;
  let undeclared = 0;
  let hasEnabledOption = false;

  for (const key of SERVICE_OPTION_KEYS) {
    const service = options[key];
    if (!service?.enabled) continue;
    hasEnabledOption = true;
    const amount = round2(Number(params.optionPreview.byKey[key] ?? 0));
    if (amount <= 0) continue;
    if (service.declared) {
      declared += amount;
    } else {
      undeclared += amount;
    }
  }

  if (!hasEnabledOption) {
    const rawAmount = round2(Math.max(0, Number(params.draft.frais_optionnels_montant ?? params.reservation.frais_optionnels_montant ?? 0)));
    if (params.draft.frais_optionnels_declares) {
      declared = rawAmount;
    } else {
      undeclared = rawAmount;
    }
  }

  return {
    declared: round2(declared),
    undeclared: round2(undeclared),
  };
};

const computeNights = (entry: string, exit: string) => {
  const start = parseInputDate(entry);
  const end = parseInputDate(exit);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
};

const recalcDraft = (draft: ReservationDraft, changed?: "nightly" | "total") => {
  const nights = computeNights(draft.date_entree, draft.date_sortie);
  const next: ReservationDraft = {
    ...draft,
    nb_nuits: nights,
  };

  if (changed === "nightly") {
    next.price_driver = "nightly";
    next.prix_total = nights > 0 ? round2(next.prix_par_nuit * nights) : 0;
    return next;
  }

  if (changed === "total") {
    next.price_driver = "total";
    next.prix_par_nuit = nights > 0 ? round2(next.prix_total / nights) : 0;
    return next;
  }

  if (next.price_driver === "total") {
    next.prix_par_nuit = nights > 0 ? round2(next.prix_total / nights) : 0;
  } else {
    next.prix_total = nights > 0 ? round2(next.prix_par_nuit * nights) : 0;
  }

  return next;
};

const toDraft = (reservation: Reservation): ReservationDraft => {
  const draft: ReservationDraft = {
    id: reservation.id,
    gite_id: reservation.gite_id ?? null,
    placeholder_id: reservation.placeholder_id ?? null,
    hote_nom: reservation.hote_nom,
    date_entree: toInputDate(reservation.date_entree),
    date_sortie: toInputDate(reservation.date_sortie),
    nb_nuits: reservation.nb_nuits,
    nb_adultes: reservation.nb_adultes,
    prix_par_nuit: Number(reservation.prix_par_nuit ?? 0),
    prix_total: Number(reservation.prix_total ?? 0),
    source_paiement: normalizeReservationSource(reservation.source_paiement),
    commentaire: reservation.commentaire ?? "",
    frais_optionnels_montant: Number(reservation.frais_optionnels_montant ?? 0),
    frais_optionnels_libelle: reservation.frais_optionnels_libelle ?? "",
    frais_optionnels_declares: Boolean(reservation.frais_optionnels_declares),
    price_driver: "nightly",
  };
  return recalcDraft(draft);
};

const buildEmptyDraft = (year: number, month: number, giteId: string): ReservationDraft => {
  const entry = `${year}-${pad2(month)}-01`;
  const exit = `${year}-${pad2(month)}-02`;
  return recalcDraft({
    gite_id: giteId,
    placeholder_id: null,
    hote_nom: "",
    date_entree: entry,
    date_sortie: exit,
    nb_nuits: 1,
    nb_adultes: 0,
    prix_par_nuit: 0,
    prix_total: 0,
    source_paiement: DEFAULT_RESERVATION_SOURCE,
    commentaire: "",
    frais_optionnels_montant: 0,
    frais_optionnels_libelle: "",
    frais_optionnels_declares: false,
    price_driver: "nightly",
  });
};

const toPayload = (draft: ReservationDraft, options?: ContratOptions) => {
  const payload = {
    gite_id: draft.gite_id,
    placeholder_id: draft.placeholder_id,
    hote_nom: draft.hote_nom.trim(),
    date_entree: draft.date_entree,
    date_sortie: draft.date_sortie,
    nb_adultes: draft.nb_adultes,
    nb_nuits: draft.nb_nuits,
    prix_par_nuit: draft.prix_par_nuit,
    prix_total: draft.prix_total,
    source_paiement: normalizeReservationSource(draft.source_paiement),
    commentaire: draft.commentaire.trim() || null,
    frais_optionnels_montant: draft.frais_optionnels_montant,
    frais_optionnels_libelle: draft.frais_optionnels_libelle.trim() || null,
    frais_optionnels_declares: draft.frais_optionnels_declares,
    price_driver: draft.price_driver,
  };

  return {
    ...payload,
    options: mergeOptions(options),
  };
};

const statusLabel = (state: SaveState) => {
  if (state === "saving") return "En cours";
  if (state === "error") return "Erreur";
  return "";
};

const needsMonthSplit = (entryValue: string, exitValue: string) => {
  const entry = new Date(entryValue);
  const exit = new Date(exitValue);
  if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime())) return false;
  if (exit.getTime() <= entry.getTime()) return false;

  let segmentCount = 0;
  let cursor = entry;
  while (cursor.getTime() < exit.getTime()) {
    const monthStartNext = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const segmentEndTs = Math.min(monthStartNext.getTime(), exit.getTime());
    if (segmentEndTs <= cursor.getTime()) break;
    segmentCount += 1;
    if (segmentCount > 1) return true;
    cursor = new Date(segmentEndTs);
  }

  return false;
};

const formatNightsLabel = (nights: number) => `${nights} nuit${nights > 1 ? "s" : ""}`;
const formatPluralLabel = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;
const csvEscape = (value: unknown) => {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
};
const csvAmount = (value: number) => round2(Number(value ?? 0)).toFixed(2).replace(".", ",");
const copyRoundedAmount = (value: number) => {
  const text = String(Math.round(Math.max(0, Number(value ?? 0))));
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

const ReservationsPage = () => {
  const currentYear = new Date().getUTCFullYear();
  const [gites, setGites] = useState<Gite[]>([]);
  const [placeholders, setPlaceholders] = useState<ReservationPlaceholder[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [year, setYear] = useState<number>(currentYear);
  const [availableYears, setAvailableYears] = useState<number[]>([currentYear]);
  const [month, setMonth] = useState<number | 0>(0);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draggedGiteId, setDraggedGiteId] = useState<string | null>(null);
  const [dragOverGiteId, setDragOverGiteId] = useState<string | null>(null);
  const [reorderingTabs, setReorderingTabs] = useState(false);
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ReservationDraft>>({});
  const [rowState, setRowState] = useState<Record<string, SaveState>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [closingDetails, setClosingDetails] = useState<Record<string, boolean>>({});
  const [savedRowFade, setSavedRowFade] = useState<Record<string, boolean>>({});
  const [inlineCell, setInlineCell] = useState<InlineCell | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [newRows, setNewRows] = useState<Record<number, ReservationDraft>>({});
  const [insertRowIndexByMonth, setInsertRowIndexByMonth] = useState<Record<number, number | null>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importContent, setImportContent] = useState("");
  const [importFallbackGiteId, setImportFallbackGiteId] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMap, setImportMap] = useState<Record<string, string>>({});
  const [importColumnMap, setImportColumnMap] = useState<Partial<Record<ImportColumnField, string>>>({});
  const [importing, setImporting] = useState(false);
  const [reservationOptions, setReservationOptions] = useState<Record<string, ContratOptions>>({});
  const [statisticsDataset, setStatisticsDataset] = useState<ParsedStatisticsPayload | null>(null);
  const [urssafDeclarationsByKey, setUrssafDeclarationsByKey] = useState<UrssafDeclarationsByKey>({});
  const [savingUrssafDeclarationByMonth, setSavingUrssafDeclarationByMonth] = useState<Record<number, boolean>>({});
  const [stuckMonthHeaders, setStuckMonthHeaders] = useState<Record<number, boolean>>({});
  const [monthExpandedByIndex, setMonthExpandedByIndex] = useState<Record<number, boolean>>({});

  const draftsRef = useRef<Record<string, ReservationDraft>>({});
  const reservationOptionsRef = useRef<Record<string, ContratOptions>>({});
  const saveTimers = useRef<Record<string, number>>({});
  const detailsCloseTimers = useRef<Record<string, number>>({});
  const savedRowFadeTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    reservationOptionsRef.current = reservationOptions;
  }, [reservationOptions]);

  const loadStatistics = useCallback(async () => {
    try {
      const payload = await apiFetch<StatisticsPayload>("/statistics");
      setStatisticsDataset(parseStatisticsPayload(payload));
    } catch {
      setStatisticsDataset(null);
    }
  }, []);

  useEffect(() => {
    void loadStatistics();
  }, [loadStatistics]);

  useEffect(() => {
    return () => {
      Object.values(detailsCloseTimers.current).forEach((timer) => window.clearTimeout(timer));
      Object.values(savedRowFadeTimers.current).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (inlineCell && !reservations.some((reservation) => reservation.id === inlineCell.rowId)) {
      setInlineCell(null);
    }
  }, [inlineCell, reservations]);

  useEffect(() => {
    const reservationIds = new Set(reservations.map((reservation) => reservation.id));
    setReservationOptions((previous) => {
      let changed = false;
      const next: Record<string, ContratOptions> = {};
      for (const reservation of reservations) {
        if (!reservationIds.has(reservation.id)) {
          continue;
        }
        if (previous[reservation.id]) {
          next[reservation.id] = previous[reservation.id];
          continue;
        }
        changed = true;
        const draft = toDraft(reservation);
        next[reservation.id] = mergeOptions(reservation.options ?? buildDefaultReservationOptions(draft));
      }
      for (const reservationId of Object.keys(previous)) {
        if (!reservationIds.has(reservationId)) {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [reservations]);

  const load = async () => {
    const params = new URLSearchParams();
    params.set("year", String(year));
    if (month) params.set("month", String(month));
    if (q.trim()) params.set("q", q.trim());

    const [gitesData, placeholdersData, reservationsData, yearsData] = await Promise.all([
      apiFetch<Gite[]>("/gites"),
      apiFetch<ReservationPlaceholder[]>("/reservations/placeholders"),
      apiFetch<Reservation[]>(`/reservations?${params.toString()}`),
      apiFetch<number[]>("/reservations/years"),
    ]);

    setGites(gitesData);
    setPlaceholders(placeholdersData);
    setReservations(reservationsData);
    setAvailableYears([...new Set([currentYear, ...yearsData])].sort((a, b) => b - a));

    if (!activeTab) {
      if (gitesData[0]?.id) {
        setActiveTab(gitesData[0].id);
      } else if (reservationsData.some((item) => !item.gite_id)) {
        setActiveTab(UNASSIGNED_TAB);
      }
    }
  };

  useEffect(() => {
    load().catch((err) => setError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, q]);

  useEffect(() => {
    // Any display filter change should discard pending inline insertion state.
    setInsertRowIndexByMonth({});
    setNewRows({});
  }, [year, month, q, activeTab]);

  useEffect(() => {
    if (!gites.length) {
      if (reservations.some((item) => !item.gite_id)) {
        setActiveTab(UNASSIGNED_TAB);
      }
      return;
    }

    if (activeTab === UNASSIGNED_TAB || activeTab === ALL_GITES_TAB) return;
    if (activeTab && gites.some((gite) => gite.id === activeTab)) return;
    setActiveTab(gites[0].id);
  }, [activeTab, gites, reservations]);

  const handleTabDragStart = (event: DragEvent<HTMLButtonElement>, id: string) => {
    if (reorderingTabs) return;
    setDraggedGiteId(id);
    setDragOverGiteId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleTabDragOver = (event: DragEvent<HTMLButtonElement>, targetId: string) => {
    if (reorderingTabs) return;
    const sourceId = draggedGiteId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverGiteId !== targetId) setDragOverGiteId(targetId);
  };

  const handleTabDrop = async (event: DragEvent<HTMLButtonElement>, targetId: string) => {
    event.preventDefault();
    if (reorderingTabs) return;
    const sourceId = draggedGiteId ?? event.dataTransfer.getData("text/plain");
    setDraggedGiteId(null);
    setDragOverGiteId(null);
    if (!sourceId || sourceId === targetId) return;

    const fromIndex = gites.findIndex((gite) => gite.id === sourceId);
    const targetIndex = gites.findIndex((gite) => gite.id === targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;

    const reordered = [...gites];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setGites(reordered);

    setReorderingTabs(true);
    setError(null);
    try {
      const updated = await apiFetch<Gite[]>("/gites/reorder", {
        method: "POST",
        json: { ids: reordered.map((gite) => gite.id) },
      });
      setGites(updated);
    } catch (err) {
      setError((err as Error).message);
      try {
        await load();
      } catch (reloadError) {
        setError((reloadError as Error).message);
      }
    } finally {
      setReorderingTabs(false);
    }
  };

  const handleTabDragEnd = () => {
    setDraggedGiteId(null);
    setDragOverGiteId(null);
  };

  const visibleReservations = useMemo(() => {
    if (activeTab === ALL_GITES_TAB) {
      return reservations;
    }
    if (activeTab === UNASSIGNED_TAB) {
      return reservations.filter((reservation) => !reservation.gite_id);
    }
    if (!activeTab) return [];
    return reservations.filter((reservation) => reservation.gite_id === activeTab);
  }, [activeTab, reservations]);

  const giteOrderById = useMemo(() => {
    const map = new Map<string, number>();
    gites.forEach((gite, index) => {
      map.set(gite.id, typeof gite.ordre === "number" ? gite.ordre : index + 1);
    });
    return map;
  }, [gites]);

  const reservationsByMonth = useMemo(() => {
    const map = new Map<number, Reservation[]>();
    for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
      map.set(monthIndex, []);
    }

    for (const reservation of visibleReservations) {
      const date = new Date(reservation.date_entree);
      const monthIndex = date.getUTCMonth() + 1;
      const group = map.get(monthIndex);
      if (!group) continue;
      group.push(reservation);
    }

    for (const list of map.values()) {
      list.sort((a, b) => {
        if (activeTab === ALL_GITES_TAB) {
          const orderA = a.gite_id ? giteOrderById.get(a.gite_id) ?? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
          const orderB = b.gite_id ? giteOrderById.get(b.gite_id) ?? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) return orderA - orderB;

          const nameA = a.gite?.nom ?? "";
          const nameB = b.gite?.nom ?? "";
          const byName = nameA.localeCompare(nameB, "fr", { sensitivity: "base" });
          if (byName !== 0) return byName;
        }

        return new Date(a.date_entree).getTime() - new Date(b.date_entree).getTime();
      });
    }

    return map;
  }, [activeTab, giteOrderById, visibleReservations]);

  const monthsToRender = useMemo(() => {
    if (month) return [month];
    return Array.from({ length: 12 }, (_, idx) => idx + 1);
  }, [month]);

  useEffect(() => {
    setMonthExpandedByIndex({});
  }, [activeTab, month, year]);

  useEffect(() => {
    if (!activeTab) {
      setStuckMonthHeaders((previous) => (Object.keys(previous).length > 0 ? {} : previous));
      return;
    }

    let rafId = 0;
    const updateStickyMonthHeaders = () => {
      const headers = Array.from(
        document.querySelectorAll<HTMLElement>(".reservations-month__head--sticky[data-month-index]")
      );
      if (!headers.length) {
        setStuckMonthHeaders((previous) => (Object.keys(previous).length > 0 ? {} : previous));
        return;
      }

      const next: Record<number, boolean> = {};
      for (const header of headers) {
        const monthIndex = Number(header.dataset.monthIndex);
        if (!Number.isFinite(monthIndex)) continue;
        const section = header.closest<HTMLElement>(".reservations-month");
        if (!section) continue;

        const stickyTop = Number.parseFloat(window.getComputedStyle(header).top) || 0;
        const headerRect = header.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const isPinnedToTop = headerRect.top <= stickyTop + 0.5 && sectionRect.top < stickyTop;
        const hasRoomInSection = sectionRect.bottom > stickyTop + headerRect.height + 2;
        next[monthIndex] = isPinnedToTop && hasRoomInSection;
      }

      setStuckMonthHeaders((previous) => {
        const previousKeys = Object.keys(previous);
        const nextKeys = Object.keys(next);
        if (
          previousKeys.length === nextKeys.length &&
          nextKeys.every((key) => previous[Number(key)] === next[Number(key)])
        ) {
          return previous;
        }
        return next;
      });
    };

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateStickyMonthHeaders();
      });
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [activeTab, monthExpandedByIndex, monthsToRender, reservationsByMonth, year]);

  const getRowDraft = (reservation: Reservation) => drafts[reservation.id] ?? toDraft(reservation);

  const setDraft = (rowId: string, updater: (previous: ReservationDraft) => ReservationDraft) => {
    setDrafts((previous) => {
      const source = reservations.find((item) => item.id === rowId);
      if (!source && !previous[rowId]) return previous;
      const base = previous[rowId] ?? toDraft(source!);
      return {
        ...previous,
        [rowId]: updater(base),
      };
    });
  };

  const clearRowFeedback = (rowId: string) => {
    setRowState((previous) => {
      if ((previous[rowId] ?? "idle") === "idle") return previous;
      return { ...previous, [rowId]: "idle" };
    });
    setRowError((previous) => {
      if (!previous[rowId]) return previous;
      return { ...previous, [rowId]: "" };
    });
  };

  const persistExistingRow = async (
    rowId: string,
    draft: ReservationDraft,
    optionsOverride?: ContratOptions
  ): Promise<boolean> => {
    if (!draft.hote_nom.trim()) {
      setRowState((previous) => ({ ...previous, [rowId]: "error" }));
      setRowError((previous) => ({ ...previous, [rowId]: "Le nom de l'hôte est requis." }));
      return false;
    }

    if (draft.nb_nuits <= 0) {
      setRowState((previous) => ({ ...previous, [rowId]: "error" }));
      setRowError((previous) => ({
        ...previous,
        [rowId]: "La date de sortie doit être postérieure à la date d'entrée.",
      }));
      return false;
    }

    setRowState((previous) => ({ ...previous, [rowId]: "saving" }));
    setRowError((previous) => ({ ...previous, [rowId]: "" }));

    try {
      const optionDraft = optionsOverride ?? reservationOptionsRef.current[rowId];
      const updated = await apiFetch<Reservation>(`/reservations/${rowId}`, {
        method: "PUT",
        json: toPayload(draft, optionDraft),
      });

      setReservations((previous) => previous.map((item) => (item.id === rowId ? updated : item)));
      void loadStatistics();
      setRowState((previous) => ({ ...previous, [rowId]: "saved" }));
      window.setTimeout(() => {
        setRowState((previous) => (previous[rowId] === "saved" ? { ...previous, [rowId]: "idle" } : previous));
      }, 1200);
      return true;
    } catch (err) {
      let message = (err as Error).message;
      if (isApiError(err) && Array.isArray((err.payload as any)?.conflicts)) {
        const conflicts = (err.payload as any).conflicts as Array<{ label: string }>;
        message = `${err.message} ${conflicts.map((conflict) => conflict.label).join(" · ")}`;
      }
      setRowState((previous) => ({ ...previous, [rowId]: "error" }));
      setRowError((previous) => ({ ...previous, [rowId]: message }));
      return false;
    }
  };

  const saveExistingRow = async (rowId: string): Promise<boolean> => {
    const draft = draftsRef.current[rowId];
    if (!draft) return false;
    return persistExistingRow(rowId, draft);
  };

  const closeEditMode = (rowId: string) => {
    setEditingRows((previous) => ({ ...previous, [rowId]: false }));
    setExpandedDetails((previous) => ({ ...previous, [rowId]: false }));
    setClosingDetails((previous) => ({ ...previous, [rowId]: false }));
  };

  const startSavedRowFade = (rowId: string) => {
    setSavedRowFade((previous) => ({ ...previous, [rowId]: true }));
    if (savedRowFadeTimers.current[rowId]) {
      window.clearTimeout(savedRowFadeTimers.current[rowId]);
    }
    savedRowFadeTimers.current[rowId] = window.setTimeout(() => {
      setSavedRowFade((previous) => ({ ...previous, [rowId]: false }));
      delete savedRowFadeTimers.current[rowId];
    }, ROW_SAVED_FADE_MS);
  };

  const closeEditModeWithAnimation = (rowId: string, options: { highlightSaved?: boolean } = {}) => {
    const shouldHighlightSaved = options.highlightSaved === true;
    const hasOpenDetails = Boolean(expandedDetails[rowId]);

    if (!hasOpenDetails) {
      closeEditMode(rowId);
      if (shouldHighlightSaved) {
        startSavedRowFade(rowId);
      }
      return;
    }

    setExpandedDetails((previous) => ({ ...previous, [rowId]: false }));
    setClosingDetails((previous) => ({ ...previous, [rowId]: true }));

    if (detailsCloseTimers.current[rowId]) {
      window.clearTimeout(detailsCloseTimers.current[rowId]);
    }
    detailsCloseTimers.current[rowId] = window.setTimeout(() => {
      closeEditMode(rowId);
      if (shouldHighlightSaved) {
        startSavedRowFade(rowId);
      }
      delete detailsCloseTimers.current[rowId];
    }, DETAILS_CLOSE_ANIMATION_MS);
  };

  const saveAndCloseExistingRow = async (rowId: string) => {
    const saved = await saveExistingRow(rowId);
    if (!saved) return;
    if (saveTimers.current[rowId]) {
      window.clearTimeout(saveTimers.current[rowId]);
      delete saveTimers.current[rowId];
    }
    closeEditModeWithAnimation(rowId, { highlightSaved: true });
  };

  const scheduleSave = (rowId: string) => {
    if (saveTimers.current[rowId]) {
      window.clearTimeout(saveTimers.current[rowId]);
    }
    saveTimers.current[rowId] = window.setTimeout(() => {
      saveExistingRow(rowId).catch((err) => setError((err as Error).message));
    }, 500);
  };

  const updateExistingField = (
    reservation: Reservation,
    updater: (draft: ReservationDraft) => ReservationDraft,
    options: { autosave?: boolean } = { autosave: true }
  ) => {
    const rowId = reservation.id;
    clearRowFeedback(rowId);
    setEditingRows((previous) => ({ ...previous, [rowId]: true }));
    setDraft(rowId, updater);
    if (options.autosave !== false) scheduleSave(rowId);
  };

  const updateInlineField = (reservation: Reservation, updater: (draft: ReservationDraft) => ReservationDraft) => {
    const rowId = reservation.id;
    clearRowFeedback(rowId);
    setDrafts((previous) => ({
      ...previous,
      [rowId]: updater(previous[rowId] ?? toDraft(reservation)),
    }));
  };

  const clearDraft = (rowId: string) => {
    setDrafts((previous) => {
      if (!previous[rowId]) return previous;
      const next = { ...previous };
      delete next[rowId];
      return next;
    });
  };

  const isInlineFieldActive = (rowId: string, field: InlineEditableField) => inlineCell?.rowId === rowId && inlineCell.field === field;

  const openNativePicker = (element: HTMLInputElement | HTMLSelectElement) => {
    const picker = element as (HTMLInputElement | HTMLSelectElement) & { showPicker?: () => void };
    try {
      if (typeof picker.showPicker === "function") {
        picker.showPicker();
      } else {
        element.click();
      }
    } catch {
      element.click();
    }
  };

  const focusInlineField = (rowId: string, field: InlineEditableField, options: { openPicker?: boolean } = {}) => {
    const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-inline-row-id="${rowId}"][data-inline-field="${field}"]`
    );
    if (!element) return;
    element.focus();

    const canSelectText = "select" in element && typeof element.select === "function";
    if (canSelectText && element instanceof HTMLInputElement) {
      element.select();
    }

    if (!options.openPicker) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      openNativePicker(element);
    }
  };

  const openInlineField = (reservation: Reservation, field: InlineEditableField) => {
    if (editingRows[reservation.id]) return;
    flushSync(() => {
      setInlineCell({ rowId: reservation.id, field });
      setDrafts((previous) => ({
        ...previous,
        [reservation.id]: previous[reservation.id] ?? toDraft(reservation),
      }));
    });
    focusInlineField(reservation.id, field, { openPicker: INLINE_PICKER_FIELDS.includes(field) });
  };

  const closeInlineField = (reservation: Reservation, field: InlineEditableField) => {
    setInlineCell((previous) => (previous?.rowId === reservation.id && previous.field === field ? null : previous));
    clearDraft(reservation.id);
    clearRowFeedback(reservation.id);
  };

  const hasReservationChanges = (reservation: Reservation, draft: ReservationDraft, optionValue?: ContratOptions) =>
    JSON.stringify(toPayload(draft, optionValue)) !== JSON.stringify(toPayload(toDraft(reservation), reservation.options));

  const hasInlineChanges = (reservation: Reservation, draft: ReservationDraft) => {
    const currentOptions = reservationOptionsRef.current[reservation.id];
    return hasReservationChanges(reservation, draft, currentOptions);
  };

  const saveInlineField = async (reservation: Reservation, field: InlineEditableField, draftOverride?: ReservationDraft) => {
    const rowId = reservation.id;
    const draft = draftOverride ?? draftsRef.current[rowId] ?? toDraft(reservation);
    if (!hasInlineChanges(reservation, draft)) {
      clearRowFeedback(rowId);
      setInlineCell((previous) => (previous?.rowId === rowId && previous.field === field ? null : previous));
      clearDraft(rowId);
      return;
    }
    setInlineCell((previous) => (previous?.rowId === rowId && previous.field === field ? null : previous));
    if (saveTimers.current[rowId]) {
      window.clearTimeout(saveTimers.current[rowId]);
      delete saveTimers.current[rowId];
    }
    const saved = await persistExistingRow(rowId, draft);
    if (saved) {
      clearDraft(rowId);
      return;
    }
    setInlineCell({ rowId, field });
    focusInlineField(rowId, field, { openPicker: INLINE_PICKER_FIELDS.includes(field) });
  };

  const handleInlineKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    reservation: Reservation,
    field: InlineEditableField
  ) => {
    if (event.key === "Tab") {
      const currentIndex = INLINE_EDITABLE_FIELDS.indexOf(field);
      if (currentIndex >= 0) {
        const targetIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
        const nextField = INLINE_EDITABLE_FIELDS[targetIndex] ?? null;
        if (nextField) {
          event.preventDefault();
          flushSync(() => {
            setInlineCell({ rowId: reservation.id, field: nextField });
            setDrafts((previous) => ({
              ...previous,
              [reservation.id]: previous[reservation.id] ?? toDraft(reservation),
            }));
          });
          focusInlineField(reservation.id, nextField, { openPicker: nextField === "source_paiement" });
        }
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      saveInlineField(reservation, field).catch((err) => setError((err as Error).message));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeInlineField(reservation, field);
    }
  };

  const handleInlineBlur = (reservation: Reservation, field: InlineEditableField) => {
    if (!isInlineFieldActive(reservation.id, field)) return;
    saveInlineField(reservation, field).catch((err) => setError((err as Error).message));
  };

  const removeReservation = async (reservation: Reservation) => {
    const confirmed = window.confirm(`Supprimer la réservation de ${reservation.hote_nom} ?`);
    if (!confirmed) return;

    setDeletingId(reservation.id);
    try {
      await apiFetch(`/reservations/${reservation.id}`, { method: "DELETE" });
      setReservations((previous) => previous.filter((item) => item.id !== reservation.id));
      void loadStatistics();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const splitReservationByMonth = async (reservation: Reservation) => {
    if (splittingId) return;
    if (!needsMonthSplit(reservation.date_entree, reservation.date_sortie)) return;

    const confirmed = window.confirm(`Scinder la réservation de ${reservation.hote_nom} par mois ?`);
    if (!confirmed) return;

    setSplittingId(reservation.id);
    clearRowFeedback(reservation.id);
    if (saveTimers.current[reservation.id]) {
      window.clearTimeout(saveTimers.current[reservation.id]);
      delete saveTimers.current[reservation.id];
    }
    setRowState((previous) => ({ ...previous, [reservation.id]: "saving" }));

    try {
      const splitResult = await apiFetch<ReservationCreateResponse>(`/reservations/${reservation.id}/split`, {
        method: "POST",
      });
      const createdReservations =
        Array.isArray(splitResult.created_reservations) && splitResult.created_reservations.length > 0
          ? splitResult.created_reservations
          : [splitResult];
      setReservations((previous) => {
        const next = previous.filter((item) => item.id !== reservation.id);
        const ids = new Set(next.map((item) => item.id));
        for (const item of createdReservations) {
          if (ids.has(item.id)) continue;
          ids.add(item.id);
          next.push(item);
        }
        return next;
      });
      clearDraft(reservation.id);
      setError(null);
      void loadStatistics();
    } catch (err) {
      let message = (err as Error).message;
      if (isApiError(err) && Array.isArray((err.payload as any)?.conflicts)) {
        const conflicts = (err.payload as any).conflicts as Array<{ label: string }>;
        message = `${err.message} ${conflicts.map((conflict) => conflict.label).join(" · ")}`;
      }
      setRowState((previous) => ({ ...previous, [reservation.id]: "error" }));
      setRowError((previous) => ({ ...previous, [reservation.id]: message }));
      setError(message);
    } finally {
      setSplittingId((previous) => (previous === reservation.id ? null : previous));
    }
  };

  const ensureNewRow = (monthIndex: number): ReservationDraft => {
    const giteId = activeTab && activeTab !== UNASSIGNED_TAB && activeTab !== ALL_GITES_TAB ? activeTab : "";
    const existing = newRows[monthIndex];
    if (existing) return existing;
    const created = buildEmptyDraft(year, monthIndex, giteId);
    setNewRows((previous) => ({ ...previous, [monthIndex]: created }));
    return created;
  };

  const updateNewRow = (monthIndex: number, updater: (draft: ReservationDraft) => ReservationDraft) => {
    setNewRows((previous) => {
      const base =
        previous[monthIndex] ??
        buildEmptyDraft(year, monthIndex, activeTab && activeTab !== UNASSIGNED_TAB && activeTab !== ALL_GITES_TAB ? activeTab : "");
      return {
        ...previous,
        [monthIndex]: updater(base),
      };
    });
  };

  const addReservation = async (monthIndex: number) => {
    const draft = newRows[monthIndex] ?? ensureNewRow(monthIndex);

    if (!draft.hote_nom.trim()) {
      setError("Le nom de l'hôte est requis pour créer une réservation.");
      return;
    }

    if (draft.nb_nuits <= 0) {
      setError("La date de sortie doit être postérieure à la date d'entrée.");
      return;
    }

    try {
      const created = await apiFetch<ReservationCreateResponse>("/reservations", {
        method: "POST",
        json: toPayload(draft),
      });
      const createdReservations =
        Array.isArray(created.created_reservations) && created.created_reservations.length > 0
          ? created.created_reservations
          : [created];
      setReservations((previous) => {
        const existingIds = new Set(previous.map((item) => item.id));
        const next = [...previous];
        for (const reservation of createdReservations) {
          if (existingIds.has(reservation.id)) continue;
          existingIds.add(reservation.id);
          next.push(reservation);
        }
        return next;
      });
      void loadStatistics();
      if (activeTab !== UNASSIGNED_TAB && activeTab !== ALL_GITES_TAB) {
        setNewRows((previous) => ({
          ...previous,
          [monthIndex]: buildEmptyDraft(year, monthIndex, activeTab),
        }));
      }
      setInsertRowIndexByMonth((previous) => ({ ...previous, [monthIndex]: null }));
      setError(null);
    } catch (err) {
      const nextError = isApiError(err) && Array.isArray((err.payload as any)?.conflicts)
        ? `${err.message} ${((err.payload as any).conflicts as Array<{ label: string }>).map((item) => item.label).join(" · ")}`
        : (err as Error).message;
      setError(nextError);
    }
  };

  const duplicateIntoNewRow = (reservation: Reservation, monthIndex: number, rowIndex: number) => {
    const source = toDraft(reservation);
    const shifted = recalcDraft({
      ...source,
      id: undefined,
      date_entree: source.date_entree,
      date_sortie: source.date_sortie,
      hote_nom: `${source.hote_nom}`,
    });
    setNewRows((previous) => ({ ...previous, [monthIndex]: shifted }));
    setInsertRowIndexByMonth((previous) => ({ ...previous, [monthIndex]: rowIndex + 1 }));
  };

  const activeGite = gites.find((gite) => gite.id === activeTab) ?? null;
  const giteById = useMemo(() => {
    const map = new Map<string, Gite>();
    gites.forEach((gite) => map.set(gite.id, gite));
    return map;
  }, [gites]);

  const getOptionsDraft = (reservation: Reservation, draft: ReservationDraft) =>
    mergeOptions(reservationOptions[reservation.id] ?? buildDefaultReservationOptions(draft));

  const resolveReservationGite = (reservation: Reservation, draft: ReservationDraft) => {
    const giteId = draft.gite_id ?? reservation.gite_id ?? null;
    if (!giteId) return null;
    return giteById.get(giteId) ?? null;
  };

  const updateReservationOptionsSelection = (
    reservation: Reservation,
    draft: ReservationDraft,
    updater: (previous: ContratOptions) => ContratOptions
  ) => {
    setReservationOptions((previous) => {
      const base = mergeOptions(previous[reservation.id] ?? buildDefaultReservationOptions(draft));
      return {
        ...previous,
        [reservation.id]: mergeOptions(updater(base)),
      };
    });
  };

  const toggleServiceOption = (
    reservation: Reservation,
    draft: ReservationDraft,
    key: ReservationServiceOptionKey,
    enabled: boolean
  ) => {
    updateReservationOptionsSelection(reservation, draft, (previous) => {
      if (key === "draps") {
        const fallback = Math.max(1, draft.nb_adultes || 1);
        return {
          ...previous,
          draps: {
            ...previous.draps,
            enabled,
            offert: enabled ? previous.draps.offert : false,
            declared: enabled ? previous.draps.declared : false,
            nb_lits: enabled ? Math.max(1, toNonNegativeInt(previous.draps.nb_lits, fallback)) : previous.draps.nb_lits,
          },
        };
      }
      if (key === "linge_toilette") {
        const fallback = Math.max(1, draft.nb_adultes || 1);
        return {
          ...previous,
          linge_toilette: {
            ...previous.linge_toilette,
            enabled,
            offert: enabled ? previous.linge_toilette.offert : false,
            declared: enabled ? previous.linge_toilette.declared : false,
            nb_personnes: enabled
              ? Math.max(1, toNonNegativeInt(previous.linge_toilette.nb_personnes, fallback))
              : previous.linge_toilette.nb_personnes,
          },
        };
      }
      if (key === "chiens") {
        return {
          ...previous,
          chiens: {
            ...previous.chiens,
            enabled,
            offert: enabled ? previous.chiens.offert : false,
            declared: enabled ? previous.chiens.declared : false,
            nb: enabled ? Math.max(1, toNonNegativeInt(previous.chiens.nb, 1)) : previous.chiens.nb,
          },
        };
      }
      if (key === "menage") {
        return {
          ...previous,
          menage: {
            ...previous.menage,
            enabled,
            offert: enabled ? previous.menage.offert : false,
            declared: enabled ? previous.menage.declared : false,
          },
        };
      }
      return {
        ...previous,
        depart_tardif: {
          ...previous.depart_tardif,
          enabled,
          offert: enabled ? previous.depart_tardif.offert : false,
          declared: enabled ? previous.depart_tardif.declared : false,
        },
      };
    });
  };

  const setCountServiceOption = (
    reservation: Reservation,
    draft: ReservationDraft,
    key: "draps" | "linge_toilette" | "chiens",
    value: number
  ) => {
    const count = toNonNegativeInt(value, 0);
    updateReservationOptionsSelection(reservation, draft, (previous) => {
      if (key === "draps") {
        return {
          ...previous,
          draps: {
            ...previous.draps,
            nb_lits: count,
          },
        };
      }
      if (key === "linge_toilette") {
        return {
          ...previous,
          linge_toilette: {
            ...previous.linge_toilette,
            nb_personnes: count,
          },
        };
      }
      return {
        ...previous,
        chiens: {
          ...previous.chiens,
          nb: count,
        },
      };
    });
  };

  const setDeclaredServiceOption = (
    reservation: Reservation,
    draft: ReservationDraft,
    key: ReservationServiceOptionKey,
    declared: boolean
  ) => {
    updateReservationOptionsSelection(reservation, draft, (previous) => {
      if (key === "draps") return { ...previous, draps: { ...previous.draps, declared } };
      if (key === "linge_toilette") return { ...previous, linge_toilette: { ...previous.linge_toilette, declared } };
      if (key === "chiens") return { ...previous, chiens: { ...previous.chiens, declared } };
      if (key === "menage") return { ...previous, menage: { ...previous.menage, declared } };
      return { ...previous, depart_tardif: { ...previous.depart_tardif, declared } };
    });
  };

  const applyOptionsToReservationFees = async (reservation: Reservation, draft: ReservationDraft) => {
    const gite = resolveReservationGite(reservation, draft);
    if (!gite) {
      setError("Impossible de calculer les options: réservez un gîte pour cette ligne.");
      return;
    }
    const optionDraft = getOptionsDraft(reservation, draft);
    const preview = computeReservationOptionsPreview(optionDraft, draft, gite);
    const enabledDeclarationFlags = [
      optionDraft.draps?.enabled ? Boolean(optionDraft.draps.declared) : null,
      optionDraft.linge_toilette?.enabled ? Boolean(optionDraft.linge_toilette.declared) : null,
      optionDraft.menage?.enabled ? Boolean(optionDraft.menage.declared) : null,
      optionDraft.depart_tardif?.enabled ? Boolean(optionDraft.depart_tardif.declared) : null,
      optionDraft.chiens?.enabled ? Boolean(optionDraft.chiens.declared) : null,
    ].filter((value): value is boolean => value !== null);
    const allDeclared = enabledDeclarationFlags.length > 0 && enabledDeclarationFlags.every(Boolean);

    const nextDraft: ReservationDraft = {
      ...draft,
      frais_optionnels_montant: preview.total,
      frais_optionnels_libelle: preview.label,
      frais_optionnels_declares: allDeclared,
    };

    setDrafts((previous) => ({
      ...previous,
      [reservation.id]: nextDraft,
    }));

    if (saveTimers.current[reservation.id]) {
      window.clearTimeout(saveTimers.current[reservation.id]);
      delete saveTimers.current[reservation.id];
    }

    const saved = await persistExistingRow(reservation.id, nextDraft, optionDraft);
    if (!saved) return;
    closeEditModeWithAnimation(reservation.id, { highlightSaved: true });
  };

  const resetOptionsForReservation = (reservation: Reservation, draft: ReservationDraft) => {
    setReservationOptions((previous) => ({
      ...previous,
      [reservation.id]: buildDefaultReservationOptions(draft),
    }));
  };

  const toggleDetails = (reservation: Reservation) => {
    setEditingRows((previous) => ({ ...previous, [reservation.id]: true }));
    setExpandedDetails((previous) => {
      const willOpen = !previous[reservation.id];
      if (willOpen) {
        setClosingDetails((closingState) => ({ ...closingState, [reservation.id]: false }));
        const draft = draftsRef.current[reservation.id] ?? toDraft(reservation);
        setReservationOptions((optionState) =>
          optionState[reservation.id]
            ? optionState
            : {
                ...optionState,
                [reservation.id]: mergeOptions(reservation.options ?? buildDefaultReservationOptions(draft)),
              }
        );
      }
      return { ...previous, [reservation.id]: willOpen };
    });
  };

  const handleFeesTriggerClick = async (params: {
    reservation: Reservation;
    draft: ReservationDraft;
    optionDraft: ContratOptions;
    isDetailsExpanded: boolean;
    isDetailsClosing: boolean;
  }) => {
    const { reservation, draft, optionDraft, isDetailsExpanded, isDetailsClosing } = params;

    if (isDetailsClosing) return;
    if (!isDetailsExpanded) {
      toggleDetails(reservation);
      return;
    }

    if (saveTimers.current[reservation.id]) {
      window.clearTimeout(saveTimers.current[reservation.id]);
      delete saveTimers.current[reservation.id];
    }

    if (!hasReservationChanges(reservation, draft, optionDraft)) {
      closeEditModeWithAnimation(reservation.id);
      return;
    }

    const saved = await persistExistingRow(reservation.id, draft, optionDraft);
    if (!saved) return;
    closeEditModeWithAnimation(reservation.id, { highlightSaved: true });
  };

  const isAllGitesTab = activeTab === ALL_GITES_TAB;
  const showUnassignedTab = reservations.some((reservation) => !reservation.gite_id);
  const currentPeriod = useMemo(() => {
    const now = new Date();
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<UrssafDeclarationRow[]>(`/urssaf-declarations?year=${year}`)
      .then((rows) => {
        if (cancelled) return;
        const loadedDeclarations: UrssafDeclarationsByKey = {};
        rows.forEach((item) => {
          const key = buildUrssafDeclarationCheckKey(item.year, item.month, item.manager_id);
          loadedDeclarations[key] = {
            ...item,
            amount: round2(Math.max(0, Number(item.amount ?? 0))),
          };
        });
        setUrssafDeclarationsByKey((previous) => ({ ...previous, ...loadedDeclarations }));
      })
      .catch(() => {
        if (cancelled) return;
      });

    return () => {
      cancelled = true;
    };
  }, [year]);

  const activeManagerIds = useMemo(() => {
    if (activeTab === UNASSIGNED_TAB || !activeTab) return [] as string[];
    if (activeTab === ALL_GITES_TAB) {
      return [...new Set(gites.map((gite) => gite.gestionnaire?.id).filter((managerId): managerId is string => Boolean(managerId)))];
    }
    const managerId = giteById.get(activeTab)?.gestionnaire?.id ?? null;
    return managerId ? [managerId] : [];
  }, [activeTab, giteById, gites]);

  const declaredUrssafByMonthForActiveTab = useMemo(() => {
    if (activeManagerIds.length === 0) return new Map<number, { amount: number; count: number }>();
    const activeManagerIdSet = new Set(activeManagerIds);
    const byMonth = new Map<number, { amount: number; count: number }>();
    Object.values(urssafDeclarationsByKey).forEach((item) => {
      if (item.year !== year) return;
      if (!activeManagerIdSet.has(item.manager_id)) return;
      const current = byMonth.get(item.month) ?? { amount: 0, count: 0 };
      current.amount = round2(current.amount + Math.max(0, Number(item.amount ?? 0)));
      current.count += 1;
      byMonth.set(item.month, current);
    });
    return byMonth;
  }, [activeManagerIds, urssafDeclarationsByKey, year]);

  const undeclaredUrssafItemsForActiveTab = useMemo<UrssafUndeclaredMonthItem[]>(() => {
    const items: UrssafUndeclaredMonthItem[] = [];
    if (!statisticsDataset) return items;
    if (activeManagerIds.length === 0) return items;
    if (year !== currentPeriod.year) return items;

    const activeManagerIdSet = new Set(activeManagerIds);
    for (let monthIndex = 1; monthIndex < currentPeriod.month; monthIndex += 1) {
      const monthlyTotalsByManager = computeUrssafByManager(
        statisticsDataset.entriesByGite,
        statisticsDataset.gites,
        year,
        monthIndex
      );
      const undeclaredManagers = monthlyTotalsByManager
        .filter((manager) => {
          if (!activeManagerIdSet.has(manager.managerId)) return false;
          const key = buildUrssafDeclarationCheckKey(year, monthIndex, manager.managerId);
          return !urssafDeclarationsByKey[key];
        })
        .map((manager) => ({
          managerId: manager.managerId,
          amount: round2(Math.max(0, Number(manager.amount ?? 0))),
        }))
        .filter((manager) => manager.amount > 0);

      if (undeclaredManagers.length === 0) continue;

      const amount = round2(undeclaredManagers.reduce((sum, manager) => sum + manager.amount, 0));
      if (amount <= 0) continue;

      items.push({
        month: monthIndex,
        amount,
        managers: undeclaredManagers,
      });
    }

    return items.sort((left, right) => left.month - right.month);
  }, [activeManagerIds, currentPeriod.month, currentPeriod.year, statisticsDataset, urssafDeclarationsByKey, year]);

  const undeclaredUrssafByMonthForActiveTab = useMemo(() => {
    const byMonth = new Map<number, number>();
    undeclaredUrssafItemsForActiveTab.forEach((item) => {
      byMonth.set(item.month, item.amount);
    });
    return byMonth;
  }, [undeclaredUrssafItemsForActiveTab]);

  const showUrssafReminder = undeclaredUrssafItemsForActiveTab.length > 0;
  const urssafReminderPeriodLabel = String(year);
  const currentMonthStartUtc = useMemo(() => {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  }, []);

  const isMonthExpandedByDefault = useCallback(
    (monthIndex: number) => {
      if (month) return true;
      const monthStartUtc = Date.UTC(year, monthIndex - 1, 1);
      return monthStartUtc >= currentMonthStartUtc;
    },
    [currentMonthStartUtc, month, year]
  );

  const setMonthExpanded = useCallback((monthIndex: number, expanded: boolean) => {
    setMonthExpandedByIndex((previous) => {
      if (previous[monthIndex] === expanded) return previous;
      return { ...previous, [monthIndex]: expanded };
    });
  }, []);

  const handleMonthHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>, monthIndex: number, isExpanded: boolean) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setMonthExpanded(monthIndex, !isExpanded);
  };

  const markUrssafMonthDeclarationDone = async (item: UrssafUndeclaredMonthItem) => {
    if (savingUrssafDeclarationByMonth[item.month]) return;
    setSavingUrssafDeclarationByMonth((previous) => ({
      ...previous,
      [item.month]: true,
    }));

    try {
      const savedRows = await Promise.all(
        item.managers.map((manager) =>
          apiFetch<UrssafDeclarationRow>("/urssaf-declarations", {
            method: "POST",
            json: {
              year,
              month: item.month,
              manager_id: manager.managerId,
              amount: manager.amount,
            },
          })
        )
      );

      setUrssafDeclarationsByKey((previous) => {
        const next = { ...previous };
        savedRows.forEach((saved) => {
          const key = buildUrssafDeclarationCheckKey(saved.year, saved.month, saved.manager_id);
          next[key] = {
            ...saved,
            amount: round2(Math.max(0, Number(saved.amount ?? 0))),
          };
        });
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingUrssafDeclarationByMonth((previous) => ({
        ...previous,
        [item.month]: false,
      }));
    }
  };

  const unresolvedImportRequiredFields =
    importPreview?.missing_required_fields.filter((field) => !(importColumnMap[field] ?? "").trim()) ?? [];
  const exportRows = useMemo(() => {
    const rows: Reservation[] = [];
    monthsToRender.forEach((monthIndex) => {
      rows.push(...(reservationsByMonth.get(monthIndex) ?? []));
    });
    return rows;
  }, [monthsToRender, reservationsByMonth]);

  const handleImportAnalyze = async () => {
    setImportPreview(null);
    const preview = await apiFetch<ImportPreview>("/reservations/import/preview", {
      method: "POST",
      json: {
        format: importFormat,
        content: importContent,
      },
    });
    setImportPreview(preview);
    const initialMap: Record<string, string> = {};
    preview.abbreviations.forEach((item) => {
      if (item.matched_gite_id) {
        initialMap[item.abbreviation] = item.matched_gite_id;
      }
    });
    setImportMap(initialMap);
    setImportColumnMap(preview.applied_column_map ?? {});
  };

  const handleImportRun = async () => {
    if (unresolvedImportRequiredFields.length > 0) {
      const labels = IMPORT_COLUMN_FIELDS.filter((field) => unresolvedImportRequiredFields.includes(field.key)).map(
        (field) => field.label
      );
      setError(`Colonnes obligatoires non mappées: ${labels.join(", ")}`);
      return;
    }

    setImporting(true);
    try {
      await apiFetch("/reservations/import", {
        method: "POST",
        json: {
          format: importFormat,
          content: importContent,
          gite_id: importFallbackGiteId || null,
          abbreviation_map: importMap,
          column_map: importColumnMap,
        },
      });
      setImportOpen(false);
      setImportContent("");
      setImportPreview(null);
      setImportMap({});
      setImportColumnMap({});
      await load();
    } catch (err) {
      if (isApiError(err) && Array.isArray((err.payload as any)?.issues)) {
        const issues = (err.payload as any).issues as Array<{ row: number; message: string }>;
        setError(issues.slice(0, 4).map((issue) => `Ligne ${issue.row}: ${issue.message}`).join(" | "));
      } else {
        setError((err as Error).message);
      }
    } finally {
      setImporting(false);
    }
  };

  const onImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".json")) setImportFormat("json");
    else setImportFormat("csv");
    setImportContent(text);
    setImportPreview(null);
    setImportMap({});
    setImportColumnMap({});
  };

  const exportCurrentViewCsv = () => {
    if (exportRows.length === 0) {
      setError("Aucune réservation à exporter pour la vue en cours.");
      return;
    }

    setError(null);
    const headers = [
      "Gîte",
      "Placeholder",
      "Hôte",
      "Entrée",
      "Sortie",
      "Nuits",
      "Adultes",
      "Prix/nuit (€)",
      "Total (€)",
      "Frais optionnels (€)",
      "Frais déclarés (€)",
      "Frais non déclarés (€)",
      "Source paiement",
      "Commentaire",
    ];

    const rows = exportRows.map((reservation) => {
      const giteName =
        (reservation.gite_id ? giteById.get(reservation.gite_id)?.nom : null) ??
        reservation.gite?.nom ??
        "";
      const placeholderLabel = reservation.placeholder
        ? reservation.placeholder.label || reservation.placeholder.abbreviation
        : "";
      const feesAmount = round2(Number(reservation.frais_optionnels_montant ?? 0));
      const feesDeclared = reservation.frais_optionnels_declares ? feesAmount : 0;
      const feesUndeclared = reservation.frais_optionnels_declares ? 0 : feesAmount;
      return [
        giteName,
        placeholderLabel,
        reservation.hote_nom,
        formatDate(reservation.date_entree),
        formatDate(reservation.date_sortie),
        String(reservation.nb_nuits),
        String(reservation.nb_adultes),
        csvAmount(Number(reservation.prix_par_nuit ?? 0)),
        csvAmount(Number(reservation.prix_total ?? 0)),
        csvAmount(feesAmount),
        csvAmount(feesDeclared),
        csvAmount(feesUndeclared),
        reservation.source_paiement ?? "",
        reservation.commentaire ?? "",
      ];
    });

    const csvContent = [headers, ...rows].map((line) => line.map(csvEscape).join(";")).join("\r\n");
    const blob = new Blob([`\ufeff${csvContent}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const giteTabLabel =
      activeTab === ALL_GITES_TAB
        ? "tous-gites"
        : activeTab === UNASSIGNED_TAB
          ? "non-attribuees"
          : normalizeTextKey(gites.find((gite) => gite.id === activeTab)?.nom ?? "gite");
    const monthLabel = month ? pad2(month) : "tous-mois";
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `reservations-${year}-${monthLabel}-${giteTabLabel}-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const monthSummary = (list: Reservation[]) => {
    return {
      count: list.length,
      nights: list.reduce((acc, item) => acc + item.nb_nuits, 0),
      revenue: list.reduce((acc, item) => acc + item.prix_total, 0),
      fees: list.reduce((acc, item) => acc + (item.frais_optionnels_montant ?? 0), 0),
      adults: list.reduce((acc, item) => acc + item.nb_adultes, 0),
    };
  };

  const focusGridCell = (monthIndex: number, rowIndex: number, colIndex: number) => {
    window.setTimeout(() => {
      const selector = `[data-grid-month="${monthIndex}"][data-grid-row="${rowIndex}"][data-grid-col="${colIndex}"]`;
      const element = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
      if (!element) return;
      element.focus();
      if ("select" in element && typeof element.select === "function") {
        element.select();
      }
    }, 0);
  };

  const focusAndOpenGridDateSortiePicker = (monthIndex: number, rowIndex: number) => {
    window.setTimeout(() => {
      const selector = `[data-grid-month="${monthIndex}"][data-grid-row="${rowIndex}"][data-grid-col="2"]`;
      const element = document.querySelector<HTMLInputElement>(selector);
      if (!element) return;
      element.focus();
      openNativePicker(element);
    }, 0);
  };

  const ensureEditableExistingRow = (reservation: Reservation) => {
    setEditingRows((previous) => ({ ...previous, [reservation.id]: true }));
    setDrafts((previous) => ({
      ...previous,
      [reservation.id]: previous[reservation.id] ?? toDraft(reservation),
    }));
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, context: GridContext) => {
    const key = event.key;
    const supported = key === "Enter" || key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
    if (!supported) return;

    event.preventDefault();

    if (context.rowType === "new" && key === "Enter" && !event.shiftKey) {
      addReservation(context.monthIndex).catch((err) => setError((err as Error).message));
      return;
    }

    if (context.rowType === "existing" && key === "Enter" && context.reservationId) {
      saveExistingRow(context.reservationId).catch((err) => setError((err as Error).message));
    }

    let targetRow = context.rowIndex;
    let targetCol = context.colIndex;

    if (key === "Enter") {
      targetRow += event.shiftKey ? -1 : 1;
    } else if (key === "ArrowUp") {
      targetRow -= 1;
    } else if (key === "ArrowDown") {
      targetRow += 1;
    } else if (key === "ArrowLeft") {
      targetCol -= 1;
    } else if (key === "ArrowRight") {
      targetCol += 1;
    }

    if (targetCol < 0) targetCol = 0;
    if (targetCol > 8) targetCol = 8;

    const rawInsertIndex = insertRowIndexByMonth[context.monthIndex];
    const insertIndex =
      context.hasNewRow && typeof rawInsertIndex === "number" && rawInsertIndex >= 0 && rawInsertIndex <= context.monthRows.length
        ? rawInsertIndex
        : null;
    const maxRow = context.monthRows.length + (context.hasNewRow ? 1 : 0) - 1;
    if (targetRow < 0 || targetRow > maxRow) return;

    if (insertIndex !== null && targetRow === insertIndex) {
      focusGridCell(context.monthIndex, targetRow, targetCol);
      return;
    }

    const monthRowIndex = insertIndex !== null && targetRow > insertIndex ? targetRow - 1 : targetRow;
    if (monthRowIndex < context.monthRows.length) {
      const targetReservation = context.monthRows[monthRowIndex];
      if (targetReservation) {
        ensureEditableExistingRow(targetReservation);
      }
    }

    focusGridCell(context.monthIndex, targetRow, targetCol);
  };

  const openInlineInsertRow = (monthIndex: number, rowIndex: number) => {
    ensureNewRow(monthIndex);
    setInsertRowIndexByMonth((previous) => ({ ...previous, [monthIndex]: rowIndex }));
    focusGridCell(monthIndex, rowIndex, 0);
  };

  const closeInlineInsertRow = (monthIndex: number) => {
    setInsertRowIndexByMonth((previous) => ({ ...previous, [monthIndex]: null }));
  };

  const renderNewRow = (
    monthIndex: number,
    newRowIndex: number,
    list: Reservation[],
    addAllowed: boolean,
    newRow: ReservationDraft,
    options: { inline?: boolean } = {}
  ) => {
    const newRowFeesAmount = round2(Math.max(0, newRow.frais_optionnels_montant ?? 0));
    const newRowDeclaredFees = newRow.frais_optionnels_declares ? newRowFeesAmount : 0;
    const newRowUndeclaredFees = newRow.frais_optionnels_declares ? 0 : newRowFeesAmount;

    return (
      <tr className={`reservations-new-row ${options.inline ? "reservations-new-row--inline" : ""}`}>
        <td className="reservations-insert-cell reservations-insert-cell--new">
          {options.inline && (
            <button
              className="reservations-insert-btn reservations-insert-btn--close"
              onClick={() => closeInlineInsertRow(monthIndex)}
              title="Annuler l'insertion"
            >
              ×
            </button>
          )}
        </td>
        <td>
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={0}
            value={newRow.hote_nom}
            placeholder="Nouvel hôte"
            onChange={(event) => updateNewRow(monthIndex, (prev) => ({ ...prev, hote_nom: event.target.value }))}
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 0,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          />
        </td>
        <td className="reservations-col-date">
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={1}
            className="reservations-date-input"
            type="date"
            value={newRow.date_entree}
            onChange={(event) => {
              const nextValue = event.target.value;
              updateNewRow(monthIndex, (prev) => recalcDraft({ ...prev, date_entree: nextValue }));
              if (nextValue) {
                focusAndOpenGridDateSortiePicker(monthIndex, newRowIndex);
              }
            }}
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 1,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          />
        </td>
        <td className="reservations-col-date reservations-col-sortie">
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={2}
            className="reservations-date-input"
            type="date"
            value={newRow.date_sortie}
            onChange={(event) => {
              const nextValue = event.target.value;
              updateNewRow(monthIndex, (prev) => recalcDraft({ ...prev, date_sortie: nextValue }));
              if (nextValue) {
                focusGridCell(monthIndex, newRowIndex, 5);
              }
            }}
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 2,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          />
        </td>
        <td className="reservations-col-nights">
          <span className={`nights-chip ${newRow.nb_nuits <= 0 ? "nights-chip--muted" : ""}`}>
            {newRow.nb_nuits > 0 ? formatNightsLabel(newRow.nb_nuits) : "Dates invalides"}
          </span>
        </td>
        <td className="reservations-col-adults">
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={4}
            type="number"
            min={0}
            value={newRow.nb_adultes}
            onChange={(event) =>
              updateNewRow(monthIndex, (prev) => ({
                ...prev,
                nb_adultes: Math.max(0, Number(event.target.value)),
              }))
            }
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 4,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          />
        </td>
        <td>
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={5}
            type="number"
            min={0}
            step="0.01"
            value={newRow.prix_par_nuit}
            onChange={(event) =>
              updateNewRow(monthIndex, (prev) =>
                recalcDraft(
                  {
                    ...prev,
                    prix_par_nuit: round2(Math.max(0, Number(event.target.value))),
                  },
                  "nightly"
                )
              )
            }
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 5,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          />
        </td>
        <td>
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={6}
            type="number"
            min={0}
            step="0.01"
            value={newRow.prix_total}
            onChange={(event) =>
              updateNewRow(monthIndex, (prev) =>
                recalcDraft(
                  {
                    ...prev,
                    prix_total: round2(Math.max(0, Number(event.target.value))),
                  },
                  "total"
                )
              )
            }
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 6,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          />
        </td>
        <td className="reservations-col-fees">
          <div className="reservations-fees-cell">
            <span className="reservations-fee-pill reservations-fee-pill--declared">{formatEuro(newRowDeclaredFees)}</span>
            <span className="reservations-fees-separator">/</span>
            <span className="reservations-fee-pill reservations-fee-pill--undeclared">{formatEuro(newRowUndeclaredFees)}</span>
          </div>
        </td>
        <td>
          <select
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={7}
            value={newRow.source_paiement}
            onChange={(event) =>
              updateNewRow(monthIndex, (prev) => ({
                ...prev,
                source_paiement: normalizeReservationSource(event.target.value),
              }))
            }
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 7,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          >
            {RESERVATION_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={8}
            value={newRow.commentaire}
            onChange={(event) => updateNewRow(monthIndex, (prev) => ({ ...prev, commentaire: event.target.value }))}
            onKeyDown={(event) =>
              handleGridKeyDown(event, {
                monthIndex,
                rowIndex: newRowIndex,
                colIndex: 8,
                rowType: "new",
                monthRows: list,
                hasNewRow: addAllowed,
              })
            }
          />
        </td>
        <td className="table-actions-cell">
          <button className="table-action table-action--primary" onClick={() => addReservation(monthIndex).catch((err) => setError((err as Error).message))}>
            Ajouter
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="card">
        <div className="section-title">Filtres & import</div>
        {error && <div className="note">{error}</div>}
        <div className="grid-2 reservations-filters-grid">
          <label className="field field--small">
            Année
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {availableYears.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--small">
            Mois
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              <option value={0}>Tous</option>
              {MONTHS.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Recherche (hôte, dates, source)
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="ex: Martin, 12/07/2026, Airbnb" />
          </label>

          <div className="field reservations-import-actions">
            <div className="reservations-import-actions__buttons">
              <button
                type="button"
                className="reservations-import-toggle reservations-export-toggle"
                onClick={exportCurrentViewCsv}
                title="Exporter la vue en cours (CSV)"
                aria-label="Exporter la vue en cours (CSV)"
                disabled={exportRows.length === 0}
              >
                CSV
              </button>
              <button
                type="button"
                className={`reservations-import-toggle ${importOpen ? "reservations-import-toggle--active" : ""}`}
                onClick={() => setImportOpen((value) => !value)}
                aria-label={importOpen ? "Fermer le panneau d'import" : "Ouvrir le panneau d'import"}
                title={importOpen ? "Fermer l'import" : "Importer (CSV/JSON)"}
              >
                {importOpen ? "×" : "⤓"}
              </button>
            </div>
          </div>
        </div>

        {importOpen && (
          <div className="reservations-import-panel">
            <div className="grid-2">
              <label className="field field--small">
                Format
                <select value={importFormat} onChange={(event) => setImportFormat(event.target.value as "csv" | "json")}>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </label>

              <label className="field field--small">
                Gîte par défaut (si absent dans le fichier)
                <select value={importFallbackGiteId} onChange={(event) => setImportFallbackGiteId(event.target.value)}>
                  <option value="">Aucun</option>
                  {gites.map((gite) => (
                    <option key={gite.id} value={gite.id}>
                      {gite.nom} ({gite.prefixe_contrat})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field">
              Fichier import
              <input type="file" accept=".csv,.json,text/csv,application/json" onChange={onImportFileChange} />
            </div>

            <label className="field">
              Contenu
              <textarea
                rows={7}
                value={importContent}
                onChange={(event) => setImportContent(event.target.value)}
                placeholder="Collez ici le contenu CSV/JSON si besoin"
              />
            </label>

            {importPreview && (
              <div className="reservations-import-preview">
                <div className="field-hint">
                  {importPreview.rows_count} lignes détectées, {importPreview.rows_without_gite} sans gîte, {importPreview.unknown_abbreviations.length} abréviations inconnues.
                </div>
                {importPreview.issues.length > 0 && (
                  <div className="note">
                    {importPreview.issues.slice(0, 4).map((issue) => `Ligne ${issue.row}: ${issue.message}`).join(" | ")}
                  </div>
                )}

                {importPreview.detected_columns.length > 0 && (
                  <table className="table reservations-import-table">
                    <thead>
                      <tr>
                        <th>Champ cible</th>
                        <th>Colonne source</th>
                        <th>Requis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {IMPORT_COLUMN_FIELDS.map((field) => {
                        const mappedValue = importColumnMap[field.key] ?? "";
                        const isRequiredMissing =
                          Boolean(field.required) && unresolvedImportRequiredFields.includes(field.key);
                        return (
                          <tr key={field.key} className={isRequiredMissing ? "reservations-import-row--error" : ""}>
                            <td>{field.label}</td>
                            <td>
                              <select
                                value={mappedValue}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setImportColumnMap((previous) => {
                                    if (!value) {
                                      const next = { ...previous };
                                      delete next[field.key];
                                      return next;
                                    }
                                    return {
                                      ...previous,
                                      [field.key]: value,
                                    };
                                  });
                                }}
                              >
                                <option value="">Automatique</option>
                                {importPreview.detected_columns.map((column) => (
                                  <option key={column.key} value={column.key}>
                                    {column.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>{field.required ? "Oui" : "Non"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {importPreview.abbreviations.length > 0 && (
                  <table className="table reservations-import-table">
                    <thead>
                      <tr>
                        <th>Abréviation</th>
                        <th>Lignes</th>
                        <th>Association</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.abbreviations.map((item) => (
                        <tr key={item.abbreviation}>
                          <td>{item.abbreviation}</td>
                          <td>{item.count}</td>
                          <td>
                            <select
                              value={importMap[item.abbreviation] ?? ""}
                              onChange={(event) =>
                                setImportMap((previous) => ({
                                  ...previous,
                                  [item.abbreviation]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Créer placeholder</option>
                              {gites.map((gite) => (
                                <option key={gite.id} value={gite.id}>
                                  {gite.nom} ({gite.prefixe_contrat})
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div className="actions reservations-import-actions-bar">
              <button className="secondary" onClick={() => handleImportAnalyze().catch((err) => setError((err as Error).message))}>
                Analyser
              </button>
              <button
                onClick={() => handleImportRun().catch((err) => setError((err as Error).message))}
                disabled={importing || unresolvedImportRequiredFields.length > 0}
              >
                {importing ? "Import en cours..." : "Lancer l'import"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Réservations</div>

        <div className="reservations-tabs">
          {gites.map((gite) => (
            <button
              type="button"
              key={gite.id}
              className={`reservations-tab ${activeTab === gite.id ? "reservations-tab--active" : ""} ${
                draggedGiteId === gite.id ? "reservations-tab--dragging" : ""
              } ${dragOverGiteId === gite.id && draggedGiteId !== gite.id ? "reservations-tab--drag-over" : ""}`}
              draggable={!reorderingTabs}
              onDragStart={(event) => handleTabDragStart(event, gite.id)}
              onDragOver={(event) => handleTabDragOver(event, gite.id)}
              onDrop={(event) => void handleTabDrop(event, gite.id)}
              onDragEnd={handleTabDragEnd}
              onClick={() => setActiveTab(gite.id)}
              disabled={reorderingTabs}
              title={reorderingTabs ? "Réorganisation en cours..." : "Glisser-déposer pour réorganiser"}
            >
              {gite.nom}
            </button>
          ))}
          {showUnassignedTab && (
            <button
              type="button"
              className={`reservations-tab ${activeTab === UNASSIGNED_TAB ? "reservations-tab--active" : ""}`}
              onClick={() => setActiveTab(UNASSIGNED_TAB)}
            >
              Non attribuées
            </button>
          )}
          <button
            type="button"
            className={`reservations-tab reservations-tab--all ${activeTab === ALL_GITES_TAB ? "reservations-tab--active" : ""}`}
            onClick={() => setActiveTab(ALL_GITES_TAB)}
          >
            Tous les gîtes
          </button>
        </div>

        {activeTab === UNASSIGNED_TAB && placeholders.length > 0 && (
          <div className="field-hint reservations-unassigned-hint">
            {placeholders.length} placeholder(s) détecté(s). Attribuez-les depuis la page Gîtes.
          </div>
        )}

        {!activeTab && <div className="field-hint">Créez un gîte pour commencer à saisir des réservations.</div>}

        {activeTab && showUrssafReminder && (
          <div className="reservations-urssaf-reminder">
            <div className="reservations-urssaf-reminder__head">
              <strong>Déclaration URSSAF: {urssafReminderPeriodLabel}</strong>
              <span>{formatPluralLabel(undeclaredUrssafItemsForActiveTab.length, "mois", "mois")} non déclaré(s)</span>
            </div>
            <div className="reservations-urssaf-reminder__list">
              {undeclaredUrssafItemsForActiveTab.map((item) => (
                <div key={item.month} className="reservations-urssaf-reminder__item">
                  <div>
                    <div className="reservations-urssaf-reminder__manager">
                      {MONTHS[item.month - 1]} {year}
                    </div>
                    <div className="reservations-urssaf-reminder__amount">{formatEuro(item.amount)}</div>
                  </div>
                  <div className="reservations-urssaf-reminder__actions">
                    <button
                      type="button"
                      className="table-action table-action--neutral reservations-urssaf-reminder__copy"
                      onClick={() => {
                        copyRoundedAmount(item.amount);
                      }}
                      title={`Copier le montant URSSAF arrondi pour ${MONTHS[item.month - 1]} ${year}`}
                    >
                      Copier
                    </button>
                    <button
                      type="button"
                      className="table-action table-action--primary reservations-urssaf-reminder__check"
                      onClick={() => {
                        void markUrssafMonthDeclarationDone(item);
                      }}
                      title={`Valider la déclaration URSSAF de ${MONTHS[item.month - 1]} ${year}`}
                      disabled={Boolean(savingUrssafDeclarationByMonth[item.month])}
                    >
                      Déclaré
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab &&
          monthsToRender.map((monthIndex) => {
            const list = reservationsByMonth.get(monthIndex) ?? [];
            const summary = monthSummary(list);
            const addAllowed = activeTab !== UNASSIGNED_TAB && activeTab !== ALL_GITES_TAB && Boolean(activeGite?.id);
            const newRow = newRows[monthIndex] ?? (addAllowed && activeGite ? buildEmptyDraft(year, monthIndex, activeGite.id) : null);
            const rawInsertIndex = insertRowIndexByMonth[monthIndex];
            const inlineInsertIndex =
              addAllowed && typeof rawInsertIndex === "number" && rawInsertIndex >= 0 && rawInsertIndex <= list.length
                ? rawInsertIndex
                : null;
            const newRowIndex = inlineInsertIndex ?? list.length;
            const hasInlineNewRow = inlineInsertIndex !== null;
            const groupedSummaries = new Map<string, ReturnType<typeof monthSummary>>();
            if (isAllGitesTab) {
              const grouped = new Map<string, Reservation[]>();
              list.forEach((reservation) => {
                const key = reservation.gite_id ?? UNASSIGNED_TAB;
                const group = grouped.get(key);
                if (group) {
                  group.push(reservation);
                } else {
                  grouped.set(key, [reservation]);
                }
              });
              grouped.forEach((group, key) => {
                groupedSummaries.set(key, monthSummary(group));
              });
            }
            const declaredUrssafForMonth = declaredUrssafByMonthForActiveTab.get(monthIndex);
            const undeclaredUrssafForMonth = undeclaredUrssafByMonthForActiveTab.get(monthIndex) ?? 0;
            const monthHasPendingUrssafReminder = undeclaredUrssafForMonth > 0;
            const isMonthExpandedDefault = isMonthExpandedByDefault(monthIndex);
            const isMonthExpanded = monthExpandedByIndex[monthIndex] ?? isMonthExpandedDefault;
            const monthPanelId = `reservations-month-panel-${year}-${monthIndex}`;

            return (
              <section
                className={`reservations-month ${isAllGitesTab ? "reservations-month--all-gites" : ""} ${
                  monthHasPendingUrssafReminder ? "reservations-month--urssaf-pending" : ""
                } ${!isMonthExpanded ? "reservations-month--collapsed" : ""}`}
                key={monthIndex}
              >
                <div
                  className={`reservations-month__head ${isMonthExpanded ? "reservations-month__head--sticky" : ""} ${
                    isMonthExpanded && stuckMonthHeaders[monthIndex] ? "reservations-month__head--stuck" : ""
                  }`}
                  data-month-index={monthIndex}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isMonthExpanded}
                  aria-controls={monthPanelId}
                  onClick={() => setMonthExpanded(monthIndex, !isMonthExpanded)}
                  onKeyDown={(event) => handleMonthHeaderKeyDown(event, monthIndex, isMonthExpanded)}
                >
                  <div>
                    <div className="section-subtitle">{MONTHS[monthIndex - 1]}</div>
                    <div className="reservations-month__meta">
                      <span className="reservations-summary-pill">{formatPluralLabel(summary.count, "réservation", "réservations")}</span>
                      <span className="reservations-summary-pill">{formatPluralLabel(summary.nights, "nuit", "nuits")}</span>
                      <span className="reservations-summary-pill reservations-summary-pill--revenue">{formatEuro(summary.revenue)} revenus</span>
                      <span className="reservations-summary-pill reservations-summary-pill--fees">{formatEuro(summary.fees)} frais</span>
                      {declaredUrssafForMonth ? (
                        <span
                          className="reservations-summary-pill reservations-summary-pill--urssaf"
                          title={`URSSAF déclaré pour ${formatPluralLabel(
                            declaredUrssafForMonth.count,
                            "gestionnaire",
                            "gestionnaires"
                          )}`}
                        >
                          {formatEuro(declaredUrssafForMonth.amount)} URSSAF déclaré
                        </span>
                      ) : null}
                      {undeclaredUrssafForMonth > 0 ? (
                        <span className="reservations-summary-pill reservations-summary-pill--urssaf-undeclared">
                          {formatEuro(undeclaredUrssafForMonth)} URSSAF non déclaré
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {isMonthExpanded && addAllowed && list.length === 0 && inlineInsertIndex === null && (
                    <button
                      type="button"
                      className="table-action table-action--neutral"
                      onClick={(event) => {
                        event.stopPropagation();
                        openInlineInsertRow(monthIndex, 0);
                      }}
                    >
                      + Ajouter
                    </button>
                  )}
                </div>

                {isMonthExpanded && (
                  <div id={monthPanelId}>
                    <table className="table reservations-table">
                  <colgroup>
                    <col className="reservations-col reservations-col--insert" />
                    <col className="reservations-col reservations-col--host" />
                    <col className="reservations-col reservations-col--entry" />
                    <col className="reservations-col reservations-col--exit" />
                    <col className="reservations-col reservations-col--nights" />
                    <col className="reservations-col reservations-col--adults" />
                    <col className="reservations-col reservations-col--nightly" />
                    <col className="reservations-col reservations-col--total" />
                    <col className="reservations-col reservations-col--fees" />
                    <col className="reservations-col reservations-col--source" />
                    <col className="reservations-col reservations-col--comment" />
                    <col className="reservations-col reservations-col--actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="reservations-insert-col" aria-label="Insertion"></th>
                      <th>Hôte</th>
                      <th className="reservations-col-date">Entrée</th>
                      <th className="reservations-col-date reservations-col-sortie">Sortie</th>
                      <th className="reservations-col-nights">Nuits</th>
                      <th className="reservations-col-adults">Adultes</th>
                      <th>Prix/nuit</th>
                      <th>Total</th>
                      <th className="reservations-col-fees">Frais</th>
                      <th>Source</th>
                      <th>Commentaire</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addAllowed && newRow && inlineInsertIndex === 0 && renderNewRow(monthIndex, newRowIndex, list, addAllowed, newRow, { inline: true })}

                    {list.map((reservation, rowIndex) => {
                      const groupKey = reservation.gite_id ?? UNASSIGNED_TAB;
                      const previousGroupKey = rowIndex > 0 ? list[rowIndex - 1]?.gite_id ?? UNASSIGNED_TAB : null;
                      const showGroupHeader = isAllGitesTab && groupKey !== previousGroupKey;
                      const groupSummary = groupedSummaries.get(groupKey);
                      const groupLabel =
                        groupKey === UNASSIGNED_TAB
                          ? "Non attribuées"
                          : (giteById.get(groupKey)?.nom ?? reservation.gite?.nom ?? "Gîte");
                      const isEditing = Boolean(editingRows[reservation.id]);
                      const draft = getRowDraft(reservation);
                      const rowSaveState = rowState[reservation.id] ?? "idle";
                      const optionDraft = getOptionsDraft(reservation, draft);
                      const optionGite = resolveReservationGite(reservation, draft);
                      const optionPreview = computeReservationOptionsPreview(optionDraft, draft, optionGite);
                      const feeBreakdown = computeReservationFeesBreakdown({
                        reservation,
                        draft,
                        optionDraft,
                        optionPreview,
                      });
                      const hasFees = feeBreakdown.declared > 0 || feeBreakdown.undeclared > 0;
                      const isDetailsExpanded = Boolean(expandedDetails[reservation.id]);
                      const isDetailsClosing = Boolean(closingDetails[reservation.id]);
                      const isRowSavedFading = Boolean(savedRowFade[reservation.id]);
                      const isCurrentReservation = isReservationInProgress(reservation);
                      const canSplitByMonth = needsMonthSplit(reservation.date_entree, reservation.date_sortie);
                      const rowStatusLabel = statusLabel(rowSaveState);
                      const gridRowIndex = inlineInsertIndex !== null && rowIndex >= inlineInsertIndex ? rowIndex + 1 : rowIndex;

                      return (
                        <Fragment key={reservation.id}>
                          {showGroupHeader && (
                            <tr className="reservations-gite-group-row">
                              <td colSpan={12}>
                                <div className="reservations-gite-group-row__label">{groupLabel}</div>
                                {groupSummary && (
                                  <div className="reservations-gite-group-row__meta">
                                    <span className="reservations-summary-pill">
                                      {formatPluralLabel(groupSummary.count, "réservation", "réservations")}
                                    </span>
                                    <span className="reservations-summary-pill">
                                      {formatPluralLabel(groupSummary.nights, "nuit", "nuits")}
                                    </span>
                                    <span className="reservations-summary-pill reservations-summary-pill--revenue">
                                      {formatEuro(groupSummary.revenue)}
                                    </span>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                          <tr
                            className={`reservations-row ${isEditing ? "reservations-row--editing" : ""} ${
                              isRowSavedFading ? "reservations-row--saved-fade" : ""
                            } ${isCurrentReservation ? "reservations-row--current" : ""}`}
                          >
                            <td className="reservations-insert-cell">
                              {addAllowed && (
                                <button
                                  className="reservations-insert-btn"
                                  onClick={() => openInlineInsertRow(monthIndex, rowIndex + 1)}
                                  title="Insérer une ligne"
                                >
                                  +
                                </button>
                              )}
                              {isCurrentReservation ? <span className="reservations-current-pill reservations-current-pill--row-start">En cours</span> : null}
                            </td>
                            <td className="reservations-host-cell">
                              {isEditing || isInlineFieldActive(reservation.id, "hote_nom") ? (
                                <input
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={0}
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "hote_nom" : undefined}
                                  value={draft.hote_nom}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    if (!isEditing) {
                                      updateInlineField(reservation, (prev) => ({ ...prev, hote_nom: event.target.value }));
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) => ({ ...prev, hote_nom: event.target.value }));
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "hote_nom");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 0,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) handleInlineBlur(reservation, "hote_nom");
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger"
                                  onClick={() => openInlineField(reservation, "hote_nom")}
                                  title="Modifier l'hôte"
                                >
                                  {reservation.hote_nom}
                                </button>
                              )}
                            </td>
                            <td className="reservations-col-date">
                              {isEditing || isInlineFieldActive(reservation.id, "date_entree") ? (
                                <input
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={1}
                                  className="reservations-date-input"
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "date_entree" : undefined}
                                  type="date"
                                  value={draft.date_entree}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    if (!isEditing) {
                                      updateInlineField(reservation, (prev) => recalcDraft({ ...prev, date_entree: nextValue }));
                                      if (nextValue) {
                                        openInlineField(reservation, "date_sortie");
                                      }
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) => recalcDraft({ ...prev, date_entree: nextValue }));
                                    if (nextValue) {
                                      focusAndOpenGridDateSortiePicker(monthIndex, gridRowIndex);
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "date_entree");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 1,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) handleInlineBlur(reservation, "date_entree");
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger"
                                  onClick={() => openInlineField(reservation, "date_entree")}
                                  title="Modifier la date d'entrée"
                                >
                                  {formatDate(reservation.date_entree)}
                                </button>
                              )}
                            </td>
                            <td className="reservations-col-date reservations-col-sortie">
                              {isEditing || isInlineFieldActive(reservation.id, "date_sortie") ? (
                                <input
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={2}
                                  className="reservations-date-input"
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "date_sortie" : undefined}
                                  type="date"
                                  value={draft.date_sortie}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    if (!isEditing) {
                                      updateInlineField(reservation, (prev) => recalcDraft({ ...prev, date_sortie: nextValue }));
                                      if (nextValue) {
                                        openInlineField(reservation, "prix_par_nuit");
                                      }
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) => recalcDraft({ ...prev, date_sortie: nextValue }));
                                    if (nextValue) {
                                      focusGridCell(monthIndex, gridRowIndex, 5);
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "date_sortie");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 2,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) handleInlineBlur(reservation, "date_sortie");
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger"
                                  onClick={() => openInlineField(reservation, "date_sortie")}
                                  title="Modifier la date de sortie"
                                >
                                  {formatDate(reservation.date_sortie)}
                                </button>
                              )}
                            </td>
                            <td className="reservations-col-nights">
                              <div className="reservations-nights-cell">
                                <span className={`nights-chip ${draft.nb_nuits <= 0 ? "nights-chip--muted" : ""}`}>
                                  {draft.nb_nuits > 0 ? formatNightsLabel(draft.nb_nuits) : "Dates invalides"}
                                </span>
                              </div>
                            </td>
                            <td className="reservations-col-adults">
                              {isEditing || isInlineFieldActive(reservation.id, "nb_adultes") ? (
                                <input
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={4}
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "nb_adultes" : undefined}
                                  type="number"
                                  min={0}
                                  value={draft.nb_adultes}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    if (!isEditing) {
                                      updateInlineField(reservation, (prev) => ({
                                        ...prev,
                                        nb_adultes: Math.max(0, Number(event.target.value)),
                                      }));
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) => ({
                                      ...prev,
                                      nb_adultes: Math.max(0, Number(event.target.value)),
                                    }));
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "nb_adultes");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 4,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) handleInlineBlur(reservation, "nb_adultes");
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger"
                                  onClick={() => openInlineField(reservation, "nb_adultes")}
                                  title="Modifier le nombre d'adultes"
                                >
                                  {reservation.nb_adultes}
                                </button>
                              )}
                            </td>
                            <td>
                              {isEditing || isInlineFieldActive(reservation.id, "prix_par_nuit") ? (
                                <input
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={5}
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "prix_par_nuit" : undefined}
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={draft.prix_par_nuit}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    if (!isEditing) {
                                      updateInlineField(reservation, (prev) =>
                                        recalcDraft(
                                          {
                                            ...prev,
                                            prix_par_nuit: round2(Math.max(0, Number(event.target.value))),
                                          },
                                          "nightly"
                                        )
                                      );
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) =>
                                      recalcDraft(
                                        {
                                          ...prev,
                                          prix_par_nuit: round2(Math.max(0, Number(event.target.value))),
                                        },
                                        "nightly"
                                      )
                                    );
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "prix_par_nuit");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 5,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) handleInlineBlur(reservation, "prix_par_nuit");
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger"
                                  onClick={() => openInlineField(reservation, "prix_par_nuit")}
                                  title="Modifier le prix par nuit"
                                >
                                  {formatEuro(reservation.prix_par_nuit)}
                                </button>
                              )}
                            </td>
                            <td>
                              {isEditing || isInlineFieldActive(reservation.id, "prix_total") ? (
                                <input
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={6}
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "prix_total" : undefined}
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={draft.prix_total}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    if (!isEditing) {
                                      updateInlineField(reservation, (prev) =>
                                        recalcDraft(
                                          {
                                            ...prev,
                                            prix_total: round2(Math.max(0, Number(event.target.value))),
                                          },
                                          "total"
                                        )
                                      );
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) =>
                                      recalcDraft(
                                        {
                                          ...prev,
                                          prix_total: round2(Math.max(0, Number(event.target.value))),
                                        },
                                        "total"
                                      )
                                    );
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "prix_total");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 6,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) handleInlineBlur(reservation, "prix_total");
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger reservations-total-value"
                                  onClick={() => openInlineField(reservation, "prix_total")}
                                  title="Modifier le total"
                                >
                                  {formatEuro(reservation.prix_total)}
                                </button>
                              )}
                            </td>
                            <td className="reservations-col-fees">
                              <button
                                type="button"
                                className={`reservations-fees-trigger ${expandedDetails[reservation.id] ? "reservations-fees-trigger--active" : ""}`}
                                onClick={() =>
                                  handleFeesTriggerClick({
                                    reservation,
                                    draft,
                                    optionDraft,
                                    isDetailsExpanded,
                                    isDetailsClosing,
                                  }).catch((err) => setError((err as Error).message))
                                }
                                title={isDetailsExpanded ? "Fermer les options de frais" : "Ouvrir les options de frais"}
                              >
                                <span className="reservations-fees-cell">
                                  <span className="reservations-fee-pill reservations-fee-pill--declared" title="Frais déclarés">
                                    {formatEuro(feeBreakdown.declared)}
                                  </span>
                                  <span className="reservations-fees-separator">/</span>
                                  <span className="reservations-fee-pill reservations-fee-pill--undeclared" title="Frais non déclarés">
                                    {formatEuro(feeBreakdown.undeclared)}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td>
                              {isEditing || isInlineFieldActive(reservation.id, "source_paiement") ? (
                                <select
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={7}
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "source_paiement" : undefined}
                                  value={draft.source_paiement}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    if (!isEditing) {
                                      const nextDraft = {
                                        ...(draftsRef.current[reservation.id] ?? toDraft(reservation)),
                                        source_paiement: normalizeReservationSource(event.target.value),
                                      };
                                      setDrafts((previous) => ({ ...previous, [reservation.id]: nextDraft }));
                                      saveInlineField(reservation, "source_paiement", nextDraft).catch((err) =>
                                        setError((err as Error).message)
                                      );
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) => ({
                                      ...prev,
                                      source_paiement: normalizeReservationSource(event.target.value),
                                    }));
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) {
                                      handleInlineBlur(reservation, "source_paiement");
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "source_paiement");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 7,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                >
                                  {RESERVATION_SOURCES.map((source) => (
                                    <option key={source} value={source}>
                                      {source}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger"
                                  onClick={() => openInlineField(reservation, "source_paiement")}
                                  title="Modifier la source"
                                >
                                  {normalizeReservationSource(reservation.source_paiement)}
                                </button>
                              )}
                            </td>
                            <td className="reservations-comment-cell">
                              {isEditing || isInlineFieldActive(reservation.id, "commentaire") ? (
                                <input
                                  data-grid-month={monthIndex}
                                  data-grid-row={gridRowIndex}
                                  data-grid-col={8}
                                  data-inline-row-id={!isEditing ? reservation.id : undefined}
                                  data-inline-field={!isEditing ? "commentaire" : undefined}
                                  value={draft.commentaire}
                                  autoFocus={!isEditing}
                                  onChange={(event) => {
                                    if (!isEditing) {
                                      updateInlineField(reservation, (prev) => ({
                                        ...prev,
                                        commentaire: event.target.value,
                                      }));
                                      return;
                                    }
                                    updateExistingField(reservation, (prev) => ({
                                      ...prev,
                                      commentaire: event.target.value,
                                    }));
                                  }}
                                  onKeyDown={(event) => {
                                    if (!isEditing) {
                                      handleInlineKeyDown(event, reservation, "commentaire");
                                      return;
                                    }
                                    handleGridKeyDown(event, {
                                      monthIndex,
                                      rowIndex: gridRowIndex,
                                      colIndex: 8,
                                      rowType: "existing",
                                      monthRows: list,
                                      hasNewRow: hasInlineNewRow,
                                      reservationId: reservation.id,
                                    });
                                  }}
                                  onBlur={() => {
                                    if (!isEditing) handleInlineBlur(reservation, "commentaire");
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="reservations-source-inline-trigger reservations-comment-trigger"
                                  data-full-comment={reservation.commentaire ?? ""}
                                  onClick={() => openInlineField(reservation, "commentaire")}
                                  title="Modifier le commentaire"
                                >
                                  {reservation.commentaire ?? ""}
                                </button>
                              )}
                            </td>
                            <td className="table-actions-cell">
                              <div className="reservations-actions-menu">
                                <button className="table-action table-action--neutral reservations-actions-trigger" title="Actions">
                                  ⋯
                                </button>
                                <div className="reservations-row-actions">
                                  <button
                                    className="table-action table-action--neutral"
                                    onClick={() => {
                                      if (isEditing) {
                                        if (isDetailsExpanded) {
                                          saveExistingRow(reservation.id).catch((err) => setError((err as Error).message));
                                        } else {
                                          saveAndCloseExistingRow(reservation.id).catch((err) => setError((err as Error).message));
                                        }
                                        return;
                                      }
                                      setEditingRows((previous) => ({
                                        ...previous,
                                        [reservation.id]: true,
                                      }));
                                      setDrafts((previous) => ({
                                        ...previous,
                                        [reservation.id]: previous[reservation.id] ?? toDraft(reservation),
                                      }));
                                    }}
                                    title={isEditing ? "Enregistrer" : "Éditer"}
                                  >
                                    {isEditing ? "✓" : "✎"}
                                  </button>
                                  <button
                                    className="table-action table-action--neutral"
                                    onClick={() => duplicateIntoNewRow(reservation, monthIndex, rowIndex)}
                                    title="Dupliquer"
                                  >
                                    ⧉
                                  </button>
                                  {canSplitByMonth && (
                                    <button
                                      className="table-action table-action--neutral"
                                      onClick={() => splitReservationByMonth(reservation).catch((err) => setError((err as Error).message))}
                                      title={
                                        isEditing
                                          ? "Enregistrez la ligne avant de scinder"
                                          : "Scinder la réservation par mois"
                                      }
                                      disabled={isEditing || splittingId === reservation.id}
                                    >
                                      {splittingId === reservation.id ? "Scission..." : "Scinder"}
                                    </button>
                                  )}
                                  <button
                                    className={`table-action table-action--neutral ${hasFees ? "reservations-fee-btn--active" : ""}`}
                                    onClick={() => toggleDetails(reservation)}
                                    title="Frais optionnels"
                                  >
                                    €
                                  </button>
                                  {reservation.gite_id && (
                                    <Link
                                      className="table-action table-action--neutral"
                                      to={`/contrats/nouveau?fromReservationId=${encodeURIComponent(reservation.id)}`}
                                      title="Créer un contrat prérempli"
                                    >
                                      C
                                    </Link>
                                  )}
                                  {reservation.gite_id && (
                                    <Link
                                      className="table-action table-action--neutral"
                                      to={`/factures/nouvelle?fromReservationId=${encodeURIComponent(reservation.id)}`}
                                      title="Créer une facture préremplie"
                                    >
                                      F
                                    </Link>
                                  )}
                                  <button
                                    className="table-action table-action--danger"
                                    onClick={() => removeReservation(reservation)}
                                    disabled={deletingId === reservation.id}
                                    title="Supprimer"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                              {rowStatusLabel && (
                                <div
                                  className={`reservations-save-state reservations-save-state--${rowSaveState}`}
                                  title={rowError[reservation.id] ?? ""}
                                >
                                  {rowStatusLabel}
                                </div>
                              )}
                            </td>
                          </tr>
                          {(isDetailsExpanded || isDetailsClosing) && (
                            <tr className={`reservations-row-details ${isDetailsClosing ? "reservations-row-details--closing" : ""}`}>
                              <td colSpan={12}>
                                <div className="reservations-row-details-content">
                                  <div className="reservations-details-grid">
                                    <div className="reservations-options-builder">
                                    <div className="reservations-options-builder__head">
                                      <div>
                                        <strong>Options contrat/devis</strong>
                                        <div className="field-hint">
                                          {optionGite ? `Tarifs ${optionGite.nom}` : "Associez un gîte pour utiliser les options."}
                                        </div>
                                      </div>
                                      {optionGite && (
                                        <div className="reservations-options-builder__total">{formatEuro(optionPreview.total)}</div>
                                      )}
                                    </div>
                                    {optionGite && (
                                      <>
                                        <div className="reservations-options-list">
                                          <div className="reservations-option-line">
                                            <div className="reservations-option-main">
                                              <span className="reservations-option-title">Draps</span>
                                              <span className="field-hint">
                                                {formatEuro(optionGite.options_draps_par_lit)} / lit / séjour
                                              </span>
                                              <div className="reservations-option-switches">
                                                <div className="switch-group switch-group--table">
                                                  <span>Activer</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.draps?.enabled ?? false}
                                                      onChange={(event) =>
                                                        toggleServiceOption(reservation, draft, "draps", event.target.checked)
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                                <div className="switch-group switch-group--table">
                                                  <span>Déclaré</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.draps?.declared ?? false}
                                                      disabled={!optionDraft.draps?.enabled}
                                                      onChange={(event) =>
                                                        setDeclaredServiceOption(
                                                          reservation,
                                                          draft,
                                                          "draps",
                                                          event.target.checked
                                                        )
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="reservations-option-controls">
                                              <label className="reservations-option-count">
                                                Lits
                                                <input
                                                  type="number"
                                                  min={0}
                                                  value={optionDraft.draps?.nb_lits ?? 0}
                                                  disabled={!optionDraft.draps?.enabled}
                                                  onChange={(event) =>
                                                    setCountServiceOption(
                                                      reservation,
                                                      draft,
                                                      "draps",
                                                      Number(event.target.value)
                                                    )
                                                  }
                                                />
                                              </label>
                                              <span className="reservations-option-amount">
                                                {formatEuro(optionPreview.byKey.draps)}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="reservations-option-line">
                                            <div className="reservations-option-main">
                                              <span className="reservations-option-title">Linge de toilette</span>
                                              <span className="field-hint">
                                                {formatEuro(optionGite.options_linge_toilette_par_personne)} / personne / séjour
                                              </span>
                                              <div className="reservations-option-switches">
                                                <div className="switch-group switch-group--table">
                                                  <span>Activer</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.linge_toilette?.enabled ?? false}
                                                      onChange={(event) =>
                                                        toggleServiceOption(
                                                          reservation,
                                                          draft,
                                                          "linge_toilette",
                                                          event.target.checked
                                                        )
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                                <div className="switch-group switch-group--table">
                                                  <span>Déclaré</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.linge_toilette?.declared ?? false}
                                                      disabled={!optionDraft.linge_toilette?.enabled}
                                                      onChange={(event) =>
                                                        setDeclaredServiceOption(
                                                          reservation,
                                                          draft,
                                                          "linge_toilette",
                                                          event.target.checked
                                                        )
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="reservations-option-controls">
                                              <label className="reservations-option-count">
                                                Personnes
                                                <input
                                                  type="number"
                                                  min={0}
                                                  value={optionDraft.linge_toilette?.nb_personnes ?? 0}
                                                  disabled={!optionDraft.linge_toilette?.enabled}
                                                  onChange={(event) =>
                                                    setCountServiceOption(
                                                      reservation,
                                                      draft,
                                                      "linge_toilette",
                                                      Number(event.target.value)
                                                    )
                                                  }
                                                />
                                              </label>
                                              <span className="reservations-option-amount">
                                                {formatEuro(optionPreview.byKey.linge_toilette)}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="reservations-option-line">
                                            <div className="reservations-option-main">
                                              <span className="reservations-option-title">Ménage fin de séjour</span>
                                              <span className="field-hint">
                                                Forfait {formatEuro(optionGite.options_menage_forfait)}
                                              </span>
                                              <div className="reservations-option-switches">
                                                <div className="switch-group switch-group--table">
                                                  <span>Activer</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.menage?.enabled ?? false}
                                                      onChange={(event) =>
                                                        toggleServiceOption(reservation, draft, "menage", event.target.checked)
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                                <div className="switch-group switch-group--table">
                                                  <span>Déclaré</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.menage?.declared ?? false}
                                                      disabled={!optionDraft.menage?.enabled}
                                                      onChange={(event) =>
                                                        setDeclaredServiceOption(
                                                          reservation,
                                                          draft,
                                                          "menage",
                                                          event.target.checked
                                                        )
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="reservations-option-controls">
                                              <span className="reservations-option-amount">
                                                {formatEuro(optionPreview.byKey.menage)}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="reservations-option-line">
                                            <div className="reservations-option-main">
                                              <span className="reservations-option-title">Départ tardif</span>
                                              <span className="field-hint">
                                                Forfait {formatEuro(optionGite.options_depart_tardif_forfait)}
                                              </span>
                                              <div className="reservations-option-switches">
                                                <div className="switch-group switch-group--table">
                                                  <span>Activer</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.depart_tardif?.enabled ?? false}
                                                      onChange={(event) =>
                                                        toggleServiceOption(
                                                          reservation,
                                                          draft,
                                                          "depart_tardif",
                                                          event.target.checked
                                                        )
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                                <div className="switch-group switch-group--table">
                                                  <span>Déclaré</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.depart_tardif?.declared ?? false}
                                                      disabled={!optionDraft.depart_tardif?.enabled}
                                                      onChange={(event) =>
                                                        setDeclaredServiceOption(
                                                          reservation,
                                                          draft,
                                                          "depart_tardif",
                                                          event.target.checked
                                                        )
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="reservations-option-controls">
                                              <span className="reservations-option-amount">
                                                {formatEuro(optionPreview.byKey.depart_tardif)}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="reservations-option-line">
                                            <div className="reservations-option-main">
                                              <span className="reservations-option-title">Chiens</span>
                                              <span className="field-hint">
                                                {formatEuro(optionGite.options_chiens_forfait)} / nuit / chien
                                              </span>
                                              <div className="reservations-option-switches">
                                                <div className="switch-group switch-group--table">
                                                  <span>Activer</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.chiens?.enabled ?? false}
                                                      onChange={(event) =>
                                                        toggleServiceOption(reservation, draft, "chiens", event.target.checked)
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                                <div className="switch-group switch-group--table">
                                                  <span>Déclaré</span>
                                                  <label className="switch switch--compact">
                                                    <input
                                                      type="checkbox"
                                                      checked={optionDraft.chiens?.declared ?? false}
                                                      disabled={!optionDraft.chiens?.enabled}
                                                      onChange={(event) =>
                                                        setDeclaredServiceOption(
                                                          reservation,
                                                          draft,
                                                          "chiens",
                                                          event.target.checked
                                                        )
                                                      }
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="reservations-option-controls">
                                              <label className="reservations-option-count">
                                                Nb chiens
                                                <input
                                                  type="number"
                                                  min={0}
                                                  value={optionDraft.chiens?.nb ?? 0}
                                                  disabled={!optionDraft.chiens?.enabled}
                                                  onChange={(event) =>
                                                    setCountServiceOption(
                                                      reservation,
                                                      draft,
                                                      "chiens",
                                                      Number(event.target.value)
                                                    )
                                                  }
                                                />
                                              </label>
                                              <span className="reservations-option-amount">
                                                {formatEuro(optionPreview.byKey.chiens)}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="reservations-options-builder__foot">
                                          <div className="field-hint">
                                            Libellé généré: {optionPreview.label || "Aucune option sélectionnée"}
                                          </div>
                                          <div className="reservations-options-builder__actions">
                                            <button
                                              type="button"
                                              className="table-action table-action--neutral"
                                              onClick={() => resetOptionsForReservation(reservation, draft)}
                                            >
                                              Réinitialiser
                                            </button>
                                            <button
                                              type="button"
                                              className="table-action table-action--primary"
                                              onClick={() => applyOptionsToReservationFees(reservation, draft).catch((err) => setError((err as Error).message))}
                                            >
                                              Sauvegarder
                                            </button>
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              </td>
                            </tr>
                          )}
                          {addAllowed && newRow && inlineInsertIndex === rowIndex + 1 && renderNewRow(monthIndex, newRowIndex, list, addAllowed, newRow, { inline: true })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </div>
  );
};

export default ReservationsPage;

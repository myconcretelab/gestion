import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { OccupationGaugeDial } from "./statistics/components/OccupationGauge";
import ReservationOptionsEditor from "./shared/ReservationOptionsEditor";
import { mergeOptions } from "./shared/rentalForm";
import {
  computeUrssafByManager,
  parseStatisticsPayload,
  type ParsedStatisticsPayload,
  type StatisticsPayload,
} from "./statistics/statisticsUtils";
import { apiFetch, isApiError } from "../utils/api";
import {
  buildAirbnbCalendarRefreshAppNotice,
  handleAirbnbCalendarRefreshFailure,
  waitForAirbnbCalendarRefreshJob,
  type AirbnbCalendarRefreshCreateStatus,
} from "../utils/airbnbCalendarRefresh";
import { dispatchAppNotice } from "../utils/appNotices";
import { isRecentImportedReservation } from "../utils/recentImportsBadge";
import { formatDate, formatEuro } from "../utils/format";
import {
  computeReservationBaseStayTotalFromAdjustedStay,
  computeReservationPricingPreview,
  normalizeReservationCommissionMode,
  sanitizeReservationAmount,
  sanitizeReservationCommissionValue,
  type ReservationCommissionMode,
} from "../utils/reservationPricing";
import {
  buildSchoolHolidayDateSet,
  computeReservationHolidayNightCount,
  getReservationDateRange,
  getSchoolHolidaySegmentsForMonth,
  type SchoolHoliday,
} from "../utils/schoolHolidays";
import type {
  ContratOptions,
  Gite,
  Reservation,
  ReservationMonthlyEnergySummary,
  ReservationPlaceholder,
} from "../utils/types";

const MOBILE_INLINE_INSERT_BREAKPOINT = 760;

type SaveState = "idle" | "saving" | "saved" | "error";

type ReservationDraft = {
  id?: string;
  gite_id: string | null;
  placeholder_id: string | null;
  hote_nom: string;
  telephone: string;
  email: string;
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  nb_adultes: number;
  prix_par_nuit: number;
  prix_total: number;
  source_paiement: string;
  commentaire: string;
  remise_montant: number;
  commission_channel_mode: ReservationCommissionMode;
  commission_channel_value: number;
  frais_optionnels_montant: number;
  frais_optionnels_libelle: string;
  frais_optionnels_declares: boolean;
  price_driver: "nightly" | "total";
  pricing_options_total_basis: number;
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
  airbnb_calendar_refresh?: AirbnbCalendarRefreshCreateStatus;
};

type ReservationEnergyStartResponse = {
  updated_reservations: Reservation[];
  messages: string[];
  errors: string[];
};

type MonthlyEnergyStartResponse = {
  year: number;
  month: number;
  started_count: number;
  already_started_count: number;
  error_count: number;
  messages: string[];
  errors: string[];
};

type ImportColumnField =
  | "hote_nom"
  | "telephone"
  | "email"
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
  zeroTotalReservationsCount: number;
  managers: Array<{
    managerId: string;
    amount: number;
  }>;
};

type ReservationsViewSnapshot = {
  monthExpandedByIndex: Record<number, boolean>;
  scrollAnchor:
    | {
        monthIndex: number;
        sectionTopInViewport: number;
      }
    | null;
};

type DeclarationNightsSettings = {
  excluded_sources: string[];
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
const ICAL_TO_VERIFY_MARKER = "[ICAL_TO_VERIFY]";
const UNKNOWN_HOST_NAME = "Hôte inconnu";
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
  { key: "telephone", label: "N° téléphone" },
  { key: "email", label: "Email" },
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
  [normalizeTextKey("Airbnb (Not available)")]: "A définir",
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

const getEditableHostName = (value: string | null | undefined) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || UNKNOWN_HOST_NAME;
};

const buildTelephoneHref = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim().replace(/[^+\d]/g, "");
  return normalized ? `tel:${normalized}` : null;
};

const ReservationPhoneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M6.9 3.2c.4-.4 1-.5 1.5-.3l2.4 1c.7.3 1 .9.9 1.6l-.4 2.5c0 .3.1.6.3.8l3 3c.2.2.5.3.8.3l2.5-.4c.7-.1 1.4.2 1.6.9l1 2.4c.2.5.1 1.1-.3 1.5l-1.7 1.7c-.6.6-1.5.9-2.3.7-2.7-.6-5.3-2.1-7.6-4.3-2.2-2.2-3.7-4.8-4.3-7.6-.2-.8.1-1.7.7-2.3Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ReservationEmailIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="m5.5 7 6.5 5 6.5-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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

const buildCommentWithIcalToVerifyMarker = (comment: string, keepMarker: boolean) => {
  const cleaned = stripIcalToVerifyMarker(comment).trim();
  if (!keepMarker) return cleaned || null;
  return cleaned.length > 0 ? `${ICAL_TO_VERIFY_MARKER}\n${cleaned}` : ICAL_TO_VERIFY_MARKER;
};

const resizeCommentTextarea = (element: HTMLTextAreaElement | null) => {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = `${element.scrollHeight}px`;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatKwh = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: value >= 10 ? 2 : 3,
    maximumFractionDigits: 3,
  }).format(value);

const getMonthlyEnergySummaryKey = (giteId: string, year: number, month: number) =>
  `${giteId}:${year}-${pad2(month)}`;

const getMonthlyEnergyTrackingControlKey = (giteId: string, year: number, month: number) =>
  `${giteId}:${year}-${pad2(month)}:start`;

const buildUrssafDeclarationCheckKey = (year: number, month: number, managerId: string) =>
  `${year}-${pad2(month)}-${managerId}`;

const isUrssafConcernedMonth = (
  targetYear: number,
  targetMonth: number,
  currentPeriod: { year: number; month: number }
) => {
  if (targetYear < currentPeriod.year) return true;
  if (targetYear > currentPeriod.year) return false;
  return targetMonth < currentPeriod.month;
};

const toInputDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

const getUtcStartOfToday = (now = new Date()) => {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ARRIVAL_TODAY_SWITCH_HOUR = 17;
const DEPARTURE_TODAY_SWITCH_HOUR = 12;
const getDaysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const toUtcDateOnly = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const getReservationBoundsUtc = (reservation: Reservation): { start: number; end: number } | null => {
  const start = new Date(reservation.date_entree).getTime();
  const end = new Date(reservation.date_sortie).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
};

const isReservationInProgress = (reservation: Reservation, now = new Date()) => {
  const bounds = getReservationBoundsUtc(reservation);
  if (!bounds) return false;
  const todayUtcStart = getUtcStartOfToday(now);
  if (bounds.start === todayUtcStart && now.getHours() < ARRIVAL_TODAY_SWITCH_HOUR) {
    return false;
  }
  if (bounds.end === todayUtcStart && now.getHours() >= DEPARTURE_TODAY_SWITCH_HOUR) {
    return false;
  }
  return bounds.start <= todayUtcStart && todayUtcStart <= bounds.end;
};

const isReservationArrivalToday = (reservation: Reservation, now = new Date()) => {
  const bounds = getReservationBoundsUtc(reservation);
  if (!bounds) return false;
  const todayUtcStart = getUtcStartOfToday(now);
  return bounds.start === todayUtcStart;
};

const shouldShowArrivalTodayPill = (reservation: Reservation, now = new Date()) => {
  if (!isReservationArrivalToday(reservation, now)) return false;
  return now.getHours() < ARRIVAL_TODAY_SWITCH_HOUR;
};

const isReservationDepartureToday = (reservation: Reservation, now = new Date()) => {
  const bounds = getReservationBoundsUtc(reservation);
  if (!bounds) return false;
  const todayUtcStart = getUtcStartOfToday(now);
  return bounds.end === todayUtcStart;
};

const getDepartureTodayPillLabel = (reservation: Reservation, now = new Date()) => {
  if (!isReservationDepartureToday(reservation, now)) return null;
  return now.getHours() < DEPARTURE_TODAY_SWITCH_HOUR ? "Part aujourd'hui" : "Parti ce matin";
};

const isReservationArrivalTomorrow = (reservation: Reservation, now = new Date()) => {
  const bounds = getReservationBoundsUtc(reservation);
  if (!bounds) return false;
  const tomorrowUtcStart = getUtcStartOfToday(now) + DAY_MS;
  return bounds.start === tomorrowUtcStart;
};

const isReservationDepartureTomorrow = (reservation: Reservation, now = new Date()) => {
  const bounds = getReservationBoundsUtc(reservation);
  if (!bounds) return false;
  const tomorrowUtcStart = getUtcStartOfToday(now) + DAY_MS;
  return bounds.end === tomorrowUtcStart;
};

const getReservationNightsInMonth = (reservation: Reservation, year: number, month: number) => {
  if (normalizeTextKey(reservation.source_paiement ?? "") === "homeexchange") return 0;

  const start = toUtcDateOnly(reservation.date_entree);
  const end = toUtcDateOnly(reservation.date_sortie);
  if (!start || !end || end.getTime() <= start.getTime()) return 0;

  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 1);
  const overlapStart = Math.max(start.getTime(), monthStart);
  const overlapEnd = Math.min(end.getTime(), monthEnd);

  if (overlapEnd <= overlapStart) return 0;
  return Math.round((overlapEnd - overlapStart) / DAY_MS);
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

const formatInputDate = (date: Date) => `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

const addDaysToInputDate = (value: string, days: number) => {
  const date = parseInputDate(value);
  if (!date) return "";
  return formatInputDate(new Date(date.getTime() + days * DAY_MS));
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const getGiteNightlyPriceSuggestions = (gite: Gite | null) => {
  const seen = new Set<number>();
  const suggestions: number[] = [];
  const rawList = Array.isArray(gite?.prix_nuit_liste) ? gite.prix_nuit_liste : [];

  rawList.forEach((item) => {
    const value = round2(Math.max(0, Number(item)));
    if (!Number.isFinite(value) || seen.has(value)) return;
    seen.add(value);
    suggestions.push(value);
  });

  return suggestions;
};

const computeReservationGuestNights = (reservation: Pick<Reservation, "nb_nuits" | "nb_adultes">) =>
  Math.max(0, Number(reservation.nb_nuits ?? 0)) * Math.max(0, Number(reservation.nb_adultes ?? 0));

const toNonNegativeInt = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric));
};

const buildDefaultReservationOptions = (draft: ReservationDraft): ContratOptions =>
  mergeOptions({
    draps: {
      enabled: false,
      nb_lits: Math.max(1, draft.nb_adultes || 1),
      offert: false,
      declared: false,
    },
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

  const drapsTarif =
    options.draps.prix_unitaire !== undefined
      ? round2(Math.max(0, Number(options.draps.prix_unitaire ?? 0)))
      : round2(Number(gite?.options_draps_par_lit ?? 0));
  const departTardifTarif =
    options.depart_tardif.prix_forfait !== undefined
      ? round2(Math.max(0, Number(options.depart_tardif.prix_forfait ?? 0)))
      : round2(Number(gite?.options_depart_tardif_forfait ?? 0));
  const chiensTarif =
    options.chiens.prix_unitaire !== undefined
      ? round2(Math.max(0, Number(options.chiens.prix_unitaire ?? 0)))
      : round2(Number(gite?.options_chiens_forfait ?? 0));

  const draps = options.draps.enabled
    ? options.draps.offert
      ? 0
      : round2(drapsTarif * drapsQty)
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
      : departTardifTarif
    : 0;
  const chiens = options.chiens.enabled
    ? options.chiens.offert
      ? 0
      : round2(chiensTarif * chiensQty * nights)
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

const computeReservationPricingDetails = (draft: ReservationDraft, previewOptionsTotal: number) =>
  computeReservationPricingPreview({
    baseStayTotal: computeReservationBaseStayTotalFromAdjustedStay({
      adjustedStayTotal: draft.prix_total,
      previewOptionsTotal: draft.pricing_options_total_basis,
      commissionMode: draft.commission_channel_mode,
      commissionValue: draft.commission_channel_value,
      remiseMontant: draft.remise_montant,
    }),
    nights: draft.nb_nuits,
    previewOptionsTotal,
    commissionMode: draft.commission_channel_mode,
    commissionValue: draft.commission_channel_value,
    remiseMontant: draft.remise_montant,
  });

const applyReservationPricingHelpers = (params: {
  draft: ReservationDraft;
  previewOptionsTotal: number;
  commissionMode?: ReservationCommissionMode;
  commissionValue?: number;
  remiseMontant?: number;
}) => {
  const { draft, previewOptionsTotal } = params;
  const commissionMode = normalizeReservationCommissionMode(params.commissionMode ?? draft.commission_channel_mode);
  const commissionValue = sanitizeReservationCommissionValue(
    params.commissionValue ?? draft.commission_channel_value,
    commissionMode
  );
  const remiseMontant = sanitizeReservationAmount(params.remiseMontant ?? draft.remise_montant);
  const sanitizedPreviewOptionsTotal = sanitizeReservationAmount(previewOptionsTotal);
  const baseStayTotal = computeReservationBaseStayTotalFromAdjustedStay({
    adjustedStayTotal: draft.prix_total,
    previewOptionsTotal: draft.pricing_options_total_basis,
    commissionMode: draft.commission_channel_mode,
    commissionValue: draft.commission_channel_value,
    remiseMontant: draft.remise_montant,
  });
  const pricing = computeReservationPricingPreview({
    baseStayTotal,
    nights: draft.nb_nuits,
    previewOptionsTotal: sanitizedPreviewOptionsTotal,
    commissionMode,
    commissionValue,
    remiseMontant,
  });

  return {
    ...draft,
    prix_total: pricing.adjustedStayTotal,
    prix_par_nuit: pricing.adjustedNightlyPrice,
    remise_montant: remiseMontant,
    commission_channel_mode: commissionMode,
    commission_channel_value: commissionValue,
    pricing_options_total_basis: sanitizedPreviewOptionsTotal,
  };
};

const buildReservationPricingAdjustedDraft = (params: {
  draft: ReservationDraft;
  optionPreview: ReservationOptionsPreview;
}) => {
  const { draft, optionPreview } = params;
  const nextDraft = applyReservationPricingHelpers({
    draft,
    previewOptionsTotal: optionPreview.total,
  });

  return {
    ...nextDraft,
    frais_optionnels_montant: optionPreview.total,
    frais_optionnels_libelle: optionPreview.label,
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
    hote_nom: getEditableHostName(reservation.hote_nom),
    telephone: reservation.telephone ?? "",
    email: reservation.email ?? "",
    date_entree: toInputDate(reservation.date_entree),
    date_sortie: toInputDate(reservation.date_sortie),
    nb_nuits: reservation.nb_nuits,
    nb_adultes: reservation.nb_adultes,
    prix_par_nuit: Number(reservation.prix_par_nuit ?? 0),
    prix_total: Number(reservation.prix_total ?? 0),
    source_paiement: normalizeReservationSource(reservation.source_paiement),
    commentaire: stripIcalToVerifyMarker(reservation.commentaire),
    remise_montant: sanitizeReservationAmount(reservation.remise_montant ?? 0),
    commission_channel_mode: normalizeReservationCommissionMode(reservation.commission_channel_mode),
    commission_channel_value: sanitizeReservationCommissionValue(
      reservation.commission_channel_value ?? 0,
      normalizeReservationCommissionMode(reservation.commission_channel_mode)
    ),
    frais_optionnels_montant: Number(reservation.frais_optionnels_montant ?? 0),
    frais_optionnels_libelle: reservation.frais_optionnels_libelle ?? "",
    frais_optionnels_declares: Boolean(reservation.frais_optionnels_declares),
    price_driver: "nightly",
    pricing_options_total_basis: Number(reservation.frais_optionnels_montant ?? 0),
  };
  return recalcDraft(draft);
};

const buildEmptyDraft = (
  year: number,
  month: number,
  gite: Gite | null,
  overrides: Partial<ReservationDraft> = {}
): ReservationDraft => {
  const entry = overrides.date_entree ?? `${year}-${pad2(month)}-01`;
  const exit = overrides.date_sortie ?? `${year}-${pad2(month)}-02`;
  const nightlyPrice = overrides.prix_par_nuit ?? getGiteNightlyPriceSuggestions(gite)[0] ?? 0;
  const defaultAdults = overrides.nb_adultes ?? Math.max(0, Number(gite?.nb_adultes_habituel ?? 0));
  return recalcDraft({
    gite_id: overrides.gite_id ?? gite?.id ?? "",
    placeholder_id: overrides.placeholder_id ?? null,
    hote_nom: overrides.hote_nom ?? "",
    telephone: overrides.telephone ?? "",
    email: overrides.email ?? "",
    date_entree: entry,
    date_sortie: exit,
    nb_nuits: 1,
    nb_adultes: defaultAdults,
    prix_par_nuit: nightlyPrice,
    prix_total: overrides.prix_total ?? 0,
    source_paiement: overrides.source_paiement ?? DEFAULT_RESERVATION_SOURCE,
    commentaire: overrides.commentaire ?? "",
    remise_montant: overrides.remise_montant ?? 0,
    commission_channel_mode: overrides.commission_channel_mode ?? "euro",
    commission_channel_value: overrides.commission_channel_value ?? 0,
    frais_optionnels_montant: overrides.frais_optionnels_montant ?? 0,
    frais_optionnels_libelle: overrides.frais_optionnels_libelle ?? "",
    frais_optionnels_declares: overrides.frais_optionnels_declares ?? false,
    price_driver: overrides.price_driver ?? "nightly",
    pricing_options_total_basis: overrides.pricing_options_total_basis ?? 0,
  });
};

const toPayload = (draft: ReservationDraft, options?: ContratOptions, keepIcalToVerifyMarker = false) => {
  const payload = {
    gite_id: draft.gite_id,
    placeholder_id: draft.placeholder_id,
    hote_nom: draft.hote_nom.trim(),
    telephone: draft.telephone.trim() || null,
    email: draft.email.trim() || null,
    date_entree: draft.date_entree,
    date_sortie: draft.date_sortie,
    nb_adultes: draft.nb_adultes,
    nb_nuits: draft.nb_nuits,
    prix_par_nuit: draft.prix_par_nuit,
    prix_total: draft.prix_total,
    source_paiement: normalizeReservationSource(draft.source_paiement),
    commentaire: buildCommentWithIcalToVerifyMarker(draft.commentaire, keepIcalToVerifyMarker),
    remise_montant: sanitizeReservationAmount(draft.remise_montant),
    commission_channel_mode: normalizeReservationCommissionMode(draft.commission_channel_mode),
    commission_channel_value: sanitizeReservationCommissionValue(
      draft.commission_channel_value,
      normalizeReservationCommissionMode(draft.commission_channel_mode)
    ),
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

const scheduleLazyTask = (callback: () => void) => {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(() => callback(), { timeout: 1200 });
    return () => window.cancelIdleCallback(id);
  }

  const timeoutId = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeoutId);
};

const ReservationsPage = () => {
  const currentYear = new Date().getUTCFullYear();
  const location = useLocation();
  const [gites, setGites] = useState<Gite[]>([]);
  const [placeholders, setPlaceholders] = useState<ReservationPlaceholder[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [monthlyEnergySummaries, setMonthlyEnergySummaries] = useState<
    ReservationMonthlyEnergySummary[]
  >([]);
  const [monthlyEnergyEligibleGiteIds, setMonthlyEnergyEligibleGiteIds] = useState<string[]>([]);
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
  const [startingEnergyById, setStartingEnergyById] = useState<Record<string, boolean>>({});
  const [startingMonthlyEnergyByKey, setStartingMonthlyEnergyByKey] = useState<Record<string, boolean>>({});
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
  const [declarationExcludedSources, setDeclarationExcludedSources] = useState<string[]>(["Airbnb"]);
  const [urssafDeclarationsByKey, setUrssafDeclarationsByKey] = useState<UrssafDeclarationsByKey>({});
  const [savingUrssafDeclarationByMonth, setSavingUrssafDeclarationByMonth] = useState<Record<number, boolean>>({});
  const [stuckMonthHeaders, setStuckMonthHeaders] = useState<Record<number, boolean>>({});
  const [monthExpandedByIndex, setMonthExpandedByIndex] = useState<Record<number, boolean>>({});
  const [schoolHolidays, setSchoolHolidays] = useState<SchoolHoliday[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [linkedFocusReservationId, setLinkedFocusReservationId] = useState<string | null>(null);

  const reservationsRef = useRef<Reservation[]>([]);
  const draftsRef = useRef<Record<string, ReservationDraft>>({});
  const reservationOptionsRef = useRef<Record<string, ContratOptions>>({});
  const saveTimers = useRef<Record<string, number>>({});
  const detailsCloseTimers = useRef<Record<string, number>>({});
  const savedRowFadeTimers = useRef<Record<string, number>>({});
  const pendingViewSnapshotRef = useRef<ReservationsViewSnapshot | null>(null);
  const restoreViewRafRef = useRef<number | null>(null);
  const linkedFocusTimerRef = useRef<number | null>(null);
  const airbnbCalendarRefreshControllersRef = useRef<AbortController[]>([]);
  const handledLinkedFocusRef = useRef<string | null>(null);
  const handledCalendarInsertRef = useRef<string | null>(null);
  const appliedLocationYearMonthKeyRef = useRef<string | null>(null);
  const appliedLocationTabKeyRef = useRef<string | null>(null);

  const locationParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedFocusReservationId = locationParams.get("focus");
  const requestedTab = locationParams.get("tab");
  const requestedYear = locationParams.get("year");
  const requestedMonth = locationParams.get("month");
  const requestedCreateEntry = locationParams.get("entry");
  const requestedCreateExit = locationParams.get("exit");
  const requestedCreateMode = locationParams.get("create");

  useEffect(() => {
    reservationsRef.current = reservations;
  }, [reservations]);

  useEffect(() => {
    return () => {
      if (linkedFocusTimerRef.current) {
        window.clearTimeout(linkedFocusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    reservationOptionsRef.current = reservationOptions;
  }, [reservationOptions]);

  useEffect(() => {
    let timeoutId: number | null = null;

    const scheduleNextTick = () => {
      const now = new Date();
      const delay = Math.max(250, (60 - now.getSeconds()) * 1000 - now.getMilliseconds());
      timeoutId = window.setTimeout(() => {
        setCurrentTimeMs(Date.now());
        scheduleNextTick();
      }, delay);
    };

    scheduleNextTick();

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

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
    let cancelled = false;

    apiFetch<DeclarationNightsSettings>("/settings/declaration-nights")
      .then((data) => {
        if (cancelled) return;
        setDeclarationExcludedSources(
          Array.isArray(data.excluded_sources)
            ? [...new Set(data.excluded_sources.map((item) => String(item ?? "").trim()).filter(Boolean))]
            : []
        );
      })
      .catch(() => {
        if (cancelled) return;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(detailsCloseTimers.current).forEach((timer) => window.clearTimeout(timer));
      Object.values(savedRowFadeTimers.current).forEach((timer) => window.clearTimeout(timer));
      airbnbCalendarRefreshControllersRef.current.forEach((controller) => controller.abort());
      if (restoreViewRafRef.current) {
        window.cancelAnimationFrame(restoreViewRafRef.current);
      }
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
    const energyParams = new URLSearchParams();
    energyParams.set("year", String(year));
    if (month) energyParams.set("month", String(month));

    const [gitesData, placeholdersData, reservationsData, monthlyEnergyData, monthlyEnergyEligibleGitesData, yearsData] = await Promise.all([
      apiFetch<Gite[]>("/gites"),
      apiFetch<ReservationPlaceholder[]>("/reservations/placeholders"),
      apiFetch<Reservation[]>(`/reservations?${params.toString()}`),
      apiFetch<ReservationMonthlyEnergySummary[]>(
        `/reservations/monthly-energy?${energyParams.toString()}`,
      ),
      apiFetch<string[]>("/reservations/monthly-energy/eligible-gites"),
      apiFetch<number[]>("/reservations/years"),
    ]);

    setGites(gitesData);
    setPlaceholders(placeholdersData);
    setReservations(reservationsData);
    setMonthlyEnergySummaries(monthlyEnergyData);
    setMonthlyEnergyEligibleGiteIds(monthlyEnergyEligibleGitesData);
    setAvailableYears([...new Set([currentYear, ...yearsData])].sort((a, b) => b - a));

    setActiveTab((current) => {
      if (current) return current;

      if (requestedTab === UNASSIGNED_TAB && reservationsData.some((item) => !item.gite_id)) {
        return UNASSIGNED_TAB;
      }

      if (requestedTab === ALL_GITES_TAB) {
        return ALL_GITES_TAB;
      }

      if (requestedTab && gitesData.some((gite) => gite.id === requestedTab)) {
        return requestedTab;
      }

      if (gitesData[0]?.id) {
        return gitesData[0].id;
      }

      if (reservationsData.some((item) => !item.gite_id)) {
        return UNASSIGNED_TAB;
      }

      return current;
    });
  };

  useEffect(() => {
    load().catch((err) => setError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, q]);

  useEffect(() => {
    if (appliedLocationYearMonthKeyRef.current === location.key) return;
    appliedLocationYearMonthKeyRef.current = location.key;

    const nextYear = requestedYear ? Number.parseInt(requestedYear, 10) : NaN;
    if (Number.isFinite(nextYear) && nextYear > 0) {
      setYear(nextYear);
    }

    const nextMonth = requestedMonth ? Number.parseInt(requestedMonth, 10) : NaN;
    if (Number.isFinite(nextMonth) && nextMonth >= 0 && nextMonth <= 12) {
      setMonth(nextMonth as number | 0);
    }
  }, [location.key, requestedMonth, requestedYear]);

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

  useEffect(() => {
    if (appliedLocationTabKeyRef.current === location.key) return;
    if (!requestedTab) {
      appliedLocationTabKeyRef.current = location.key;
      return;
    }

    if (requestedTab === UNASSIGNED_TAB || requestedTab === ALL_GITES_TAB) {
      setActiveTab(requestedTab);
      appliedLocationTabKeyRef.current = location.key;
      return;
    }

    if (!gites.some((gite) => gite.id === requestedTab)) return;

    setActiveTab(requestedTab);
    appliedLocationTabKeyRef.current = location.key;
  }, [gites, location.key, requestedTab]);

  const startAirbnbCalendarRefreshPolling = useCallback((refresh: AirbnbCalendarRefreshCreateStatus | undefined) => {
    if (!refresh) return;

    dispatchAppNotice(buildAirbnbCalendarRefreshAppNotice(refresh));
    if (refresh.status !== "queued" || !refresh.job_id) return;

    const controller = new AbortController();
    airbnbCalendarRefreshControllersRef.current.push(controller);

    void waitForAirbnbCalendarRefreshJob(refresh.job_id, {
      signal: controller.signal,
      onUpdate: (status) => {
        dispatchAppNotice(buildAirbnbCalendarRefreshAppNotice(status));
      },
    })
      .catch((error) => {
        handleAirbnbCalendarRefreshFailure(error, (message) =>
          dispatchAppNotice({
            label: "Airbnb",
            tone: "error",
            message,
            timeoutMs: 5_200,
            role: "alert",
          })
        );
      })
      .finally(() => {
        airbnbCalendarRefreshControllersRef.current = airbnbCalendarRefreshControllersRef.current.filter(
          (current) => current !== controller
        );
      });
  }, []);

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

  const recentImportedReservationIds = useMemo(() => {
    const ids = new Set<string>();
    reservations.forEach((reservation) => {
      if (isRecentImportedReservation(reservation, currentTimeMs)) {
        ids.add(reservation.id);
      }
    });
    return ids;
  }, [currentTimeMs, reservations]);

  const recentImportedCountByTab = useMemo(() => {
    const counts = new Map<string, number>();
    reservations.forEach((reservation) => {
      if (!isRecentImportedReservation(reservation, currentTimeMs)) return;
      const tabKey = reservation.gite_id ?? UNASSIGNED_TAB;
      counts.set(tabKey, (counts.get(tabKey) ?? 0) + 1);
    });
    return counts;
  }, [currentTimeMs, reservations]);

  const schoolHolidayRange = useMemo(() => getReservationDateRange(reservations), [reservations]);
  const schoolHolidayRangeFrom = schoolHolidayRange?.from ?? "";
  const schoolHolidayRangeTo = schoolHolidayRange?.to ?? "";

  useEffect(() => {
    if (!schoolHolidayRangeFrom || !schoolHolidayRangeTo) {
      setSchoolHolidays((previous) => (previous.length > 0 ? [] : previous));
      return;
    }

    let cancelled = false;
    const cancelScheduledFetch = scheduleLazyTask(() => {
      apiFetch<SchoolHoliday[]>(
        `/school-holidays?from=${encodeURIComponent(schoolHolidayRangeFrom)}&to=${encodeURIComponent(schoolHolidayRangeTo)}&zone=B`
      )
        .then((rows) => {
          if (cancelled) return;
          setSchoolHolidays(rows);
        })
        .catch(() => {
          if (cancelled) return;
          setSchoolHolidays([]);
        });
    });

    return () => {
      cancelled = true;
      cancelScheduledFetch();
    };
  }, [schoolHolidayRangeFrom, schoolHolidayRangeTo]);

  const schoolHolidayDates = useMemo(() => buildSchoolHolidayDateSet(schoolHolidays), [schoolHolidays]);

  const holidayNightsByReservationId = useMemo(() => {
    const byReservationId = new Map<string, number>();
    if (schoolHolidayDates.size === 0) return byReservationId;

    visibleReservations.forEach((reservation) => {
      const holidayNightCount = computeReservationHolidayNightCount(reservation, schoolHolidayDates);
      if (holidayNightCount > 0) {
        byReservationId.set(reservation.id, holidayNightCount);
      }
    });

    return byReservationId;
  }, [schoolHolidayDates, visibleReservations]);

  const holidaySegmentsByMonth = useMemo(() => {
    const byMonth = new Map<number, ReturnType<typeof getSchoolHolidaySegmentsForMonth>>();
    for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
      byMonth.set(monthIndex, getSchoolHolidaySegmentsForMonth(schoolHolidays, year, monthIndex));
    }
    return byMonth;
  }, [schoolHolidays, year]);

  const monthlyEnergySummaryByKey = useMemo(() => {
    const map = new Map<string, ReservationMonthlyEnergySummary>();
    monthlyEnergySummaries.forEach((summary) => {
      map.set(
        getMonthlyEnergySummaryKey(summary.gite_id, summary.year, summary.month),
        summary,
      );
    });
    return map;
  }, [monthlyEnergySummaries]);

  const monthlyEnergyEligibleGiteIdSet = useMemo(
    () => new Set(monthlyEnergyEligibleGiteIds),
    [monthlyEnergyEligibleGiteIds],
  );

  const giteOrderById = useMemo(() => {
    const map = new Map<string, number>();
    gites.forEach((gite, index) => {
      map.set(gite.id, typeof gite.ordre === "number" ? gite.ordre : index + 1);
    });
    return map;
  }, [gites]);

  const renderMonthlyEnergyIndicator = (options: {
    giteId: string | null | undefined;
    monthIndex: number;
    summary: ReservationMonthlyEnergySummary | null;
    showGiteName?: boolean;
  }) => {
    const giteId = String(options.giteId ?? "").trim();
    if (!giteId) return null;

    const giteName = giteById.get(giteId)?.nom ?? "Gîte";
    const showGiteName = options.showGiteName === true;
    const isCurrentMonthPeriod =
      year === currentPeriod.year && options.monthIndex === currentPeriod.month;
    const hasEligibleMonthlyEnergyMeter = monthlyEnergyEligibleGiteIdSet.has(giteId);
    const controlKey = getMonthlyEnergyTrackingControlKey(giteId, year, options.monthIndex);
    const isStartingMonthlyEnergy = Boolean(startingMonthlyEnergyByKey[controlKey]);
    const energySummary = options.summary;

    if (energySummary) {
      if (
        energySummary.status === "complete" &&
        energySummary.total_kwh !== null &&
        energySummary.total_cost_eur !== null
      ) {
        const titleParts = [
          `${giteName}: ${formatKwh(energySummary.total_kwh)} kWh relevés sur ${energySummary.device_count} compteur(s)`,
        ];
        if (energySummary.is_partial_month) {
          titleParts.push("Mois partiel: comptage démarré après le 1er.");
        }

        return (
          <span
            className={`reservations-summary-pill reservations-summary-pill--energy ${
              showGiteName ? "reservations-summary-pill--energy-gite" : ""
            }`}
            title={titleParts.join(" · ")}
          >
            {showGiteName ? (
              <span className="reservations-summary-pill__gite-name">{giteName}</span>
            ) : null}
            <span>Élec {formatEuro(energySummary.total_cost_eur)}</span>
          </span>
        );
      }

      const detailParts: string[] = [];
      if (
        energySummary.live_total_cost_eur !== null &&
        energySummary.live_total_kwh !== null
      ) {
        detailParts.push(
          `Live ${formatKwh(energySummary.live_total_kwh)} kWh · ${formatEuro(energySummary.live_total_cost_eur)} sur ${energySummary.live_device_count}/${energySummary.device_count} compteur(s)`,
        );
      }
      if (energySummary.complete_device_count > 0) {
        detailParts.push(
          `${energySummary.complete_device_count}/${energySummary.device_count} compteur(s) complets`,
        );
      }
      if (energySummary.missing_opening_count > 0) {
        detailParts.push(
          `${energySummary.missing_opening_count} sans relevé de départ`,
        );
      }
      if (energySummary.missing_closing_count > 0) {
        detailParts.push(
          `${energySummary.missing_closing_count} sans relevé de fin`,
        );
      }
      if (energySummary.invalid_device_count > 0) {
        detailParts.push(`${energySummary.invalid_device_count} relevé(s) invalide(s)`);
      }
      if (energySummary.is_partial_month) {
        detailParts.push("Comptage démarré en cours de mois.");
      }

      return (
        <span
          className={`reservations-summary-pill reservations-summary-pill--energy reservations-summary-pill--energy-incomplete ${
            showGiteName ? "reservations-summary-pill--energy-gite" : ""
          }`}
          title={`${giteName}: mois incomplet.${detailParts.length > 0 ? ` ${detailParts.join(" · ")}` : ""}`}
        >
          {showGiteName ? (
            <span className="reservations-summary-pill__gite-name">{giteName}</span>
          ) : null}
          <span>
            {energySummary.live_total_cost_eur !== null
              ? `Élec ${formatEuro(energySummary.live_total_cost_eur)}`
              : "Mois incomplet"}
          </span>
        </span>
      );
    }

    if (!isCurrentMonthPeriod || !hasEligibleMonthlyEnergyMeter) return null;

    return (
      <button
        type="button"
        className={`reservations-summary-pill reservations-summary-pill--energy reservations-summary-pill--energy-action ${
          showGiteName ? "reservations-summary-pill--energy-gite" : ""
        }`}
        title="Démarrer le comptage du mois en cours à partir du relevé actuel. Le premier mois sera partiel."
        onClick={(event) => {
          event.stopPropagation();
          void startMonthlyEnergyTracking(giteId, options.monthIndex);
        }}
        disabled={isStartingMonthlyEnergy}
      >
        {showGiteName ? (
          <span className="reservations-summary-pill__gite-name">{giteName}</span>
        ) : null}
        <span>{isStartingMonthlyEnergy ? "Démarrage..." : "Démarrer élec"}</span>
      </button>
    );
  };

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

  const occupationByMonthByGite = useMemo(() => {
    const byGite = new Map<string, Map<number, number>>();
    gites.forEach((gite) => {
      const byMonth = new Map<number, number>();
      for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
        byMonth.set(monthIndex, 0);
      }
      byGite.set(gite.id, byMonth);
    });

    reservations.forEach((reservation) => {
      if (!reservation.gite_id) return;
      const byMonth = byGite.get(reservation.gite_id);
      if (!byMonth) return;

      for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
        const current = byMonth.get(monthIndex) ?? 0;
        byMonth.set(monthIndex, current + getReservationNightsInMonth(reservation, year, monthIndex));
      }
    });

    byGite.forEach((byMonth) => {
      for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
        const totalNights = byMonth.get(monthIndex) ?? 0;
        const capacity = getDaysInMonth(year, monthIndex);
        byMonth.set(monthIndex, capacity > 0 ? totalNights / capacity : 0);
      }
    });

    return byGite;
  }, [gites, reservations, year]);

  const occupationByMonth = useMemo(() => {
    if (!activeTab || activeTab === UNASSIGNED_TAB) {
      return new Map<number, number>();
    }

    if (activeTab === ALL_GITES_TAB) {
      const byMonth = new Map<number, number>();
      const occupiableGiteCount = gites.length;
      if (occupiableGiteCount <= 0) return byMonth;

      const occupiableReservations = visibleReservations.filter((reservation) => Boolean(reservation.gite_id));
      for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
        const totalNights = occupiableReservations.reduce(
          (sum, reservation) => sum + getReservationNightsInMonth(reservation, year, monthIndex),
          0
        );
        const capacity = getDaysInMonth(year, monthIndex) * occupiableGiteCount;
        byMonth.set(monthIndex, capacity > 0 ? totalNights / capacity : 0);
      }

      return byMonth;
    }

    return occupationByMonthByGite.get(activeTab) ?? new Map<number, number>();
  }, [activeTab, gites.length, occupationByMonthByGite, visibleReservations, year]);
  const topOccupationGiteIdByMonth = useMemo(() => {
    const leadersByMonth = new Map<number, string | null>();

    for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
      let bestOccupation = -1;
      let leaderId: string | null = null;

      for (const gite of gites) {
        const occupation = occupationByMonthByGite.get(gite.id)?.get(monthIndex) ?? 0;

        if (occupation > bestOccupation + 1e-6) {
          bestOccupation = occupation;
          leaderId = gite.id;
          continue;
        }

        if (Math.abs(occupation - bestOccupation) <= 1e-6 && leaderId) {
          const currentLeaderOrder = giteOrderById.get(leaderId) ?? Number.MAX_SAFE_INTEGER;
          const challengerOrder = giteOrderById.get(gite.id) ?? Number.MAX_SAFE_INTEGER;
          if (challengerOrder < currentLeaderOrder) {
            leaderId = gite.id;
          }
        }
      }

      leadersByMonth.set(monthIndex, bestOccupation > 0 ? leaderId : null);
    }

    return leadersByMonth;
  }, [giteOrderById, gites, occupationByMonthByGite]);

  const monthsToRender = useMemo(() => {
    if (month) return [month];
    return Array.from({ length: 12 }, (_, idx) => idx + 1);
  }, [month]);

  const getRecentImportedTabLabel = (count: number) =>
    `${count} nouvelle${count > 1 ? "s" : ""} réservation${count > 1 ? "s" : ""} importée${count > 1 ? "s" : ""} récemment`;

  useEffect(() => {
    setMonthExpandedByIndex({});
  }, [month]);

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
    options?: {
      optionsOverride?: ContratOptions;
      keepIcalToVerifyMarker?: boolean;
    }
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
      const existingReservation = reservationsRef.current.find((item) => item.id === rowId);
      const optionDraft = options?.optionsOverride ?? reservationOptionsRef.current[rowId];
      let nextDraft = draft;
      if (existingReservation && optionDraft) {
        const optionGite = resolveReservationGite(existingReservation, draft);
        const optionPreview = computeReservationOptionsPreview(optionDraft, draft, optionGite);
        const enabledDeclarationFlags = [
          optionDraft.draps?.enabled ? Boolean(optionDraft.draps.declared) : null,
          optionDraft.linge_toilette?.enabled ? Boolean(optionDraft.linge_toilette.declared) : null,
          optionDraft.menage?.enabled ? Boolean(optionDraft.menage.declared) : null,
          optionDraft.depart_tardif?.enabled ? Boolean(optionDraft.depart_tardif.declared) : null,
          optionDraft.chiens?.enabled ? Boolean(optionDraft.chiens.declared) : null,
        ].filter((value): value is boolean => value !== null);
        const allDeclared = enabledDeclarationFlags.length > 0 && enabledDeclarationFlags.every(Boolean);
        nextDraft = {
          ...buildReservationPricingAdjustedDraft({ draft, optionPreview }),
          frais_optionnels_declares: allDeclared,
        };
      }
      const keepIcalToVerifyMarker =
        options?.keepIcalToVerifyMarker ?? hasIcalToVerifyMarker(existingReservation?.commentaire);
      const updated = await apiFetch<Reservation>(`/reservations/${rowId}`, {
        method: "PUT",
        json: toPayload(nextDraft, optionDraft, keepIcalToVerifyMarker),
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

  const mergeUpdatedReservations = (updatedReservations: Reservation[]) => {
    if (updatedReservations.length === 0) return;
    setReservations((previous) => {
      const byId = new Map(updatedReservations.map((reservation) => [reservation.id, reservation]));
      return previous.map((reservation) => byId.get(reservation.id) ?? reservation);
    });
  };

  const startLiveEnergyTracking = async (reservation: Reservation) => {
    setError(null);
    setStartingEnergyById((previous) => ({ ...previous, [reservation.id]: true }));

    try {
      const response = await apiFetch<ReservationEnergyStartResponse>(
        `/reservations/${reservation.id}/energy/start`,
        { method: "POST" },
      );
      mergeUpdatedReservations(response.updated_reservations ?? []);

      const messageParts = [...(response.messages ?? []), ...(response.errors ?? [])]
        .filter(Boolean)
        .slice(0, 3);
      dispatchAppNotice({
        label: "Énergie",
        tone: response.errors?.length ? "error" : "success",
        message:
          messageParts.join(" · ") ||
          "Le comptage énergie a été initialisé pour cette réservation.",
        timeoutMs: 5200,
        role: response.errors?.length ? "alert" : "status",
      });
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      dispatchAppNotice({
        label: "Énergie",
        tone: "error",
        message,
        timeoutMs: 5200,
        role: "alert",
      });
    } finally {
      setStartingEnergyById((previous) => {
        if (!previous[reservation.id]) return previous;
        const next = { ...previous };
        delete next[reservation.id];
        return next;
      });
    }
  };

  const startMonthlyEnergyTracking = async (giteId: string, targetMonth: number) => {
    const controlKey = getMonthlyEnergyTrackingControlKey(giteId, year, targetMonth);
    setError(null);
    setStartingMonthlyEnergyByKey((previous) => ({ ...previous, [controlKey]: true }));

    try {
      const response = await apiFetch<MonthlyEnergyStartResponse>(
        "/reservations/monthly-energy/start",
        {
          method: "POST",
          json: { gite_id: giteId },
        },
      );
      await load();

      const messageParts = [...(response.messages ?? []), ...(response.errors ?? [])]
        .filter(Boolean)
        .slice(0, 3);
      dispatchAppNotice({
        label: "Énergie",
        tone: response.errors?.length ? "error" : "success",
        message:
          messageParts.join(" · ") ||
          "Le comptage mensuel a été lancé à partir du relevé actuel.",
        timeoutMs: 5200,
        role: response.errors?.length ? "alert" : "status",
      });
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      dispatchAppNotice({
        label: "Énergie",
        tone: "error",
        message,
        timeoutMs: 5200,
        role: "alert",
      });
    } finally {
      setStartingMonthlyEnergyByKey((previous) => {
        if (!previous[controlKey]) return previous;
        const next = { ...previous };
        delete next[controlKey];
        return next;
      });
    }
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

  const blurActiveEditingElement = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  };

  const focusInlineField = (rowId: string, field: InlineEditableField, options: { openPicker?: boolean } = {}) => {
    const element = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[data-inline-row-id="${rowId}"][data-inline-field="${field}"]`
    );
    if (!element) return;
    element.focus();

    const canSelectText = "select" in element && typeof element.select === "function";
    if (canSelectText && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
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
    JSON.stringify(toPayload(draft, optionValue, hasIcalToVerifyMarker(reservation.commentaire))) !==
    JSON.stringify(
      toPayload(toDraft(reservation), reservation.options, hasIcalToVerifyMarker(reservation.commentaire))
    );

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

  const selectExistingNightlySuggestion = async (params: {
    reservation: Reservation;
    draft: ReservationDraft;
    price: number;
    isEditing: boolean;
  }) => {
    const { reservation, draft, price, isEditing } = params;
    const rowId = reservation.id;
    const nextDraft = recalcDraft(
      {
        ...draft,
        prix_par_nuit: price,
      },
      "nightly"
    );

    setDrafts((previous) => ({
      ...previous,
      [rowId]: nextDraft,
    }));

    if (!isEditing) {
      await saveInlineField(reservation, "prix_par_nuit", nextDraft);
      return;
    }

    clearRowFeedback(rowId);
    setEditingRows((previous) => ({ ...previous, [rowId]: true }));
    if (saveTimers.current[rowId]) {
      window.clearTimeout(saveTimers.current[rowId]);
      delete saveTimers.current[rowId];
    }
    blurActiveEditingElement();
    await persistExistingRow(rowId, nextDraft);
  };

  const selectNewRowNightlySuggestion = (monthIndex: number, price: number) => {
    updateNewRow(monthIndex, (previous) =>
      recalcDraft(
        {
          ...previous,
          prix_par_nuit: price,
        },
        "nightly"
      )
    );
    blurActiveEditingElement();
  };

  const handleInlineKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
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
    const confirmed = window.confirm(`Supprimer la réservation de ${getEditableHostName(reservation.hote_nom)} ?`);
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

  const markReservationAsVerified = async (reservation: Reservation) => {
    if (!hasIcalToVerifyMarker(reservation.commentaire)) return;

    const rowId = reservation.id;
    clearRowFeedback(rowId);

    if (saveTimers.current[rowId]) {
      window.clearTimeout(saveTimers.current[rowId]);
      delete saveTimers.current[rowId];
    }

    const nextDraft: ReservationDraft = {
      ...(draftsRef.current[rowId] ?? toDraft(reservation)),
      commentaire: stripIcalToVerifyMarker(draftsRef.current[rowId]?.commentaire ?? reservation.commentaire),
    };

    setDrafts((previous) => ({
      ...previous,
      [rowId]: nextDraft,
    }));

    const saved = await persistExistingRow(rowId, nextDraft, {
      optionsOverride: reservationOptionsRef.current[rowId],
      keepIcalToVerifyMarker: false,
    });

    if (!saved) return;

    clearDraft(rowId);
    startSavedRowFade(rowId);
  };

  const splitReservationByMonth = async (reservation: Reservation) => {
    if (splittingId) return;
    if (!needsMonthSplit(reservation.date_entree, reservation.date_sortie)) return;

    const confirmed = window.confirm(`Scinder la réservation de ${getEditableHostName(reservation.hote_nom)} par mois ?`);
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

  const activeGite = gites.find((gite) => gite.id === activeTab) ?? null;

  const getNewRowBaseGite = () =>
    activeTab && activeTab !== UNASSIGNED_TAB && activeTab !== ALL_GITES_TAB ? activeGite : null;

  const buildSuggestedNewRowDraft = (monthIndex: number, previousReservation: Reservation | null = null) => {
    const baseDraft = buildEmptyDraft(year, monthIndex, getNewRowBaseGite());
    const suggestedEntry = previousReservation ? addDaysToInputDate(toInputDate(previousReservation.date_sortie), 1) : "";
    const nextEntry = suggestedEntry || baseDraft.date_entree;
    const nextExit = addDaysToInputDate(nextEntry, 1) || baseDraft.date_sortie;
    return recalcDraft({
      ...baseDraft,
      date_entree: nextEntry,
      date_sortie: nextExit,
    });
  };

  const applySuggestedExitFromEntry = (draft: ReservationDraft, nextEntry: string) => {
    const suggestedExit = addDaysToInputDate(nextEntry, 1);
    if (!suggestedExit) {
      return recalcDraft({ ...draft, date_entree: nextEntry });
    }

    const previousSuggestedExit = addDaysToInputDate(draft.date_entree, 1);
    const hasCustomValidExit =
      Boolean(draft.date_sortie) &&
      computeNights(nextEntry, draft.date_sortie) > 0 &&
      draft.date_sortie !== previousSuggestedExit;

    return recalcDraft({
      ...draft,
      date_entree: nextEntry,
      date_sortie: hasCustomValidExit ? draft.date_sortie : suggestedExit,
    });
  };

  const ensureNewRow = (monthIndex: number, previousReservation: Reservation | null = null): ReservationDraft => {
    const existing = newRows[monthIndex];
    if (existing) return existing;
    const created = buildSuggestedNewRowDraft(monthIndex, previousReservation);
    setNewRows((previous) => ({ ...previous, [monthIndex]: created }));
    return created;
  };

  const updateNewRow = (monthIndex: number, updater: (draft: ReservationDraft) => ReservationDraft) => {
    setNewRows((previous) => {
      const base =
        previous[monthIndex] ?? buildEmptyDraft(year, monthIndex, getNewRowBaseGite());
      return {
        ...previous,
        [monthIndex]: updater(base),
      };
    });
  };

  const addReservation = useCallback(async (monthIndex: number) => {
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
          [monthIndex]: buildEmptyDraft(year, monthIndex, activeGite),
        }));
      }
      setInsertRowIndexByMonth((previous) => ({ ...previous, [monthIndex]: null }));
      setError(null);
      startAirbnbCalendarRefreshPolling(created.airbnb_calendar_refresh);
    } catch (err) {
      const nextError = isApiError(err) && Array.isArray((err.payload as any)?.conflicts)
        ? `${err.message} ${((err.payload as any).conflicts as Array<{ label: string }>).map((item) => item.label).join(" · ")}`
        : (err as Error).message;
      setError(nextError);
    }
  }, [activeGite, activeTab, month, newRows, startAirbnbCalendarRefreshPolling, year]);

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

  const currentTime = new Date(currentTimeMs);
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
      ...buildReservationPricingAdjustedDraft({ draft, optionPreview: preview }),
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

    const saved = await persistExistingRow(reservation.id, nextDraft, {
      optionsOverride: optionDraft,
    });
    if (!saved) return;
    closeEditModeWithAnimation(reservation.id, { highlightSaved: true });
  };

  const resetOptionsForReservation = (reservation: Reservation, draft: ReservationDraft) => {
    setReservationOptions((previous) => ({
      ...previous,
      [reservation.id]: buildDefaultReservationOptions(draft),
    }));
    setDrafts((previous) => ({
      ...previous,
      [reservation.id]: {
        ...applyReservationPricingHelpers({
          draft: previous[reservation.id] ?? draft,
          previewOptionsTotal: 0,
          commissionMode: "euro",
          commissionValue: 0,
          remiseMontant: 0,
        }),
        frais_optionnels_montant: 0,
        frais_optionnels_libelle: "",
        frais_optionnels_declares: false,
      },
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
    const now = new Date(currentTimeMs);
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
    };
  }, [currentTimeMs]);

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
      const zeroTotalReservationsCount = (reservationsByMonth.get(monthIndex) ?? []).reduce((count, reservation) => {
        return round2(Number(reservation.prix_total ?? 0)) === 0 ? count + 1 : count;
      }, 0);

      items.push({
        month: monthIndex,
        amount,
        zeroTotalReservationsCount,
        managers: undeclaredManagers,
      });
    }

    return items.sort((left, right) => left.month - right.month);
  }, [activeManagerIds, currentPeriod.month, currentPeriod.year, reservationsByMonth, statisticsDataset, urssafDeclarationsByKey, year]);

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
  const declarationExcludedSourceKeys = useMemo(
    () => new Set(declarationExcludedSources.map((source) => normalizeTextKey(source)).filter(Boolean)),
    [declarationExcludedSources]
  );

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

  const captureViewSnapshot = useCallback((): ReservationsViewSnapshot => {
    const expandedState: Record<number, boolean> = {};
    monthsToRender.forEach((monthIndex) => {
      expandedState[monthIndex] = monthExpandedByIndex[monthIndex] ?? isMonthExpandedByDefault(monthIndex);
    });

    const sections = Array.from(document.querySelectorAll<HTMLElement>(".reservations-month[data-month-index]"));
    if (!sections.length) {
      return {
        monthExpandedByIndex: expandedState,
        scrollAnchor: null,
      };
    }

    const rootStyles = window.getComputedStyle(document.documentElement);
    const anchorLine = Number.parseFloat(rootStyles.getPropertyValue("--reservations-month-head-top")) || 0;
    const anchorSection =
      sections.find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= anchorLine && rect.bottom > anchorLine;
      }) ??
      sections.find((section) => section.getBoundingClientRect().top >= anchorLine) ??
      sections[sections.length - 1];

    const monthIndex = Number(anchorSection.dataset.monthIndex);
    return {
      monthExpandedByIndex: expandedState,
      scrollAnchor: Number.isFinite(monthIndex)
        ? {
            monthIndex,
            sectionTopInViewport: anchorSection.getBoundingClientRect().top,
          }
        : null,
    };
  }, [isMonthExpandedByDefault, monthExpandedByIndex, monthsToRender]);

  const handleTabChange = useCallback(
    (nextTab: string) => {
      if (!nextTab || nextTab === activeTab) return;
      const snapshot = captureViewSnapshot();
      pendingViewSnapshotRef.current = snapshot;
      flushSync(() => {
        setMonthExpandedByIndex(snapshot.monthExpandedByIndex);
        setActiveTab(nextTab);
      });
    },
    [activeTab, captureViewSnapshot]
  );

  const handleYearChange = useCallback(
    (nextYear: number) => {
      if (!Number.isFinite(nextYear) || nextYear === year) return;
      const snapshot = captureViewSnapshot();
      pendingViewSnapshotRef.current = snapshot;
      flushSync(() => {
        setMonthExpandedByIndex(snapshot.monthExpandedByIndex);
        setYear(nextYear);
      });
    },
    [captureViewSnapshot, year]
  );

  useEffect(() => {
    const snapshot = pendingViewSnapshotRef.current;
    if (!activeTab || !snapshot) return;

    pendingViewSnapshotRef.current = null;
    if (restoreViewRafRef.current) {
      window.cancelAnimationFrame(restoreViewRafRef.current);
    }

    restoreViewRafRef.current = window.requestAnimationFrame(() => {
      restoreViewRafRef.current = window.requestAnimationFrame(() => {
        restoreViewRafRef.current = null;
        if (!snapshot.scrollAnchor) return;

        const section = document.querySelector<HTMLElement>(
          `.reservations-month[data-month-index="${snapshot.scrollAnchor.monthIndex}"]`
        );
        if (!section) return;

        const targetTop = window.scrollY + section.getBoundingClientRect().top - snapshot.scrollAnchor.sectionTopInViewport;
        window.scrollTo({ top: Math.max(0, targetTop) });
      });
    });
  }, [activeTab, reservationsByMonth]);

  useEffect(() => {
    if (!requestedFocusReservationId) {
      handledLinkedFocusRef.current = null;
      return;
    }

    const targetReservation = reservations.find((reservation) => reservation.id === requestedFocusReservationId);
    if (!targetReservation) return;

    const targetTab = targetReservation.gite_id ?? UNASSIGNED_TAB;
    if (requestedTab && activeTab !== requestedTab) return;
    if (!requestedTab && activeTab !== targetTab) return;

    const targetMonth = toUtcDateOnly(targetReservation.date_entree)?.getUTCMonth();
    if (targetMonth !== null && targetMonth !== undefined) {
      const monthIndex = targetMonth + 1;
      const isExpanded = monthExpandedByIndex[monthIndex] ?? isMonthExpandedByDefault(monthIndex);
      if (!isExpanded) {
        setMonthExpanded(monthIndex, true);
        return;
      }
    }

    const focusSignature = `${location.key}:${requestedFocusReservationId}`;
    if (handledLinkedFocusRef.current === focusSignature) return;

    let rafId = window.requestAnimationFrame(() => {
      const targetRow = document.getElementById(`reservation-${requestedFocusReservationId}`);
      if (!targetRow) return;

      handledLinkedFocusRef.current = focusSignature;
      targetRow.scrollIntoView({ block: "center", behavior: "smooth" });
      setLinkedFocusReservationId(requestedFocusReservationId);
      if (linkedFocusTimerRef.current) {
        window.clearTimeout(linkedFocusTimerRef.current);
      }
      linkedFocusTimerRef.current = window.setTimeout(() => {
        setLinkedFocusReservationId((current) => (current === requestedFocusReservationId ? null : current));
      }, 2200);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    activeTab,
    isMonthExpandedByDefault,
    location.key,
    monthExpandedByIndex,
    requestedFocusReservationId,
    requestedTab,
    reservations,
    setMonthExpanded,
  ]);

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
      "Téléphone",
      "Email",
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
        reservation.telephone ?? "",
        reservation.email ?? "",
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
        stripIcalToVerifyMarker(reservation.commentaire),
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
    let guestNights = 0;
    let declaredGuestNights = 0;
    let zeroTotalReservationsCount = 0;

    list.forEach((item) => {
      const reservationGuestNights = computeReservationGuestNights(item);
      guestNights += reservationGuestNights;
      if (round2(Number(item.prix_total ?? 0)) === 0) {
        zeroTotalReservationsCount += 1;
      }

      const normalizedSource = normalizeTextKey(normalizeReservationSource(item.source_paiement));
      if (!declarationExcludedSourceKeys.has(normalizedSource)) {
        declaredGuestNights += reservationGuestNights;
      }
    });

    return {
      count: list.length,
      nights: list.reduce((acc, item) => acc + item.nb_nuits, 0),
      guestNights,
      declaredGuestNights,
      zeroTotalReservationsCount,
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

  const scrollGridCellIntoView = useCallback((monthIndex: number, rowIndex: number, colIndex: number) => {
    window.setTimeout(() => {
      const selector = `[data-grid-month="${monthIndex}"][data-grid-row="${rowIndex}"][data-grid-col="${colIndex}"]`;
      const element = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
      if (!element) return;
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 0);
  }, []);

  const focusAndOpenGridDateSortiePicker = (monthIndex: number, rowIndex: number) => {
    window.setTimeout(() => {
      const selector = `[data-grid-month="${monthIndex}"][data-grid-row="${rowIndex}"][data-grid-col="2"]`;
      const element = document.querySelector<HTMLInputElement>(selector);
      if (!element) return;
      element.focus();
      openNativePicker(element);
    }, 0);
  };

  useEffect(() => {
    if (requestedCreateMode !== "1" || !requestedCreateEntry || !requestedCreateExit) {
      handledCalendarInsertRef.current = null;
      return;
    }

    if (requestedTab && activeTab !== requestedTab) return;
    if (!activeGite?.id || activeTab === ALL_GITES_TAB || activeTab === UNASSIGNED_TAB) return;

    const entryDate = parseInputDate(requestedCreateEntry);
    const exitDate = parseInputDate(requestedCreateExit);
    if (!entryDate || !exitDate || exitDate.getTime() <= entryDate.getTime()) return;

    const requestedCreateMonthIndex = entryDate.getUTCMonth() + 1;
    if (month && month !== requestedCreateMonthIndex) return;

    const isExpanded = monthExpandedByIndex[requestedCreateMonthIndex] ?? isMonthExpandedByDefault(requestedCreateMonthIndex);
    if (!isExpanded) {
      setMonthExpanded(requestedCreateMonthIndex, true);
      return;
    }

    const createSignature = `${location.key}:${activeTab}:${requestedCreateEntry}:${requestedCreateExit}`;
    if (handledCalendarInsertRef.current === createSignature) return;

    const monthRows = reservationsByMonth.get(requestedCreateMonthIndex) ?? [];
    const insertIndex = monthRows.findIndex((reservation) => {
      const reservationEntry = toUtcDateOnly(reservation.date_entree);
      return reservationEntry ? reservationEntry.getTime() >= entryDate.getTime() : false;
    });
    const nextInsertIndex = insertIndex >= 0 ? insertIndex : monthRows.length;

    const nextDraft = buildEmptyDraft(year, requestedCreateMonthIndex, activeGite, {
      date_entree: requestedCreateEntry,
      date_sortie: requestedCreateExit,
    });

    handledCalendarInsertRef.current = createSignature;
    setError(null);
    setNewRows((previous) => ({ ...previous, [requestedCreateMonthIndex]: nextDraft }));
    setInsertRowIndexByMonth((previous) => ({ ...previous, [requestedCreateMonthIndex]: nextInsertIndex }));
    const shouldKeepInlineListingMode =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(`(max-width: ${MOBILE_INLINE_INSERT_BREAKPOINT}px)`).matches;

    if (shouldKeepInlineListingMode) {
      scrollGridCellIntoView(requestedCreateMonthIndex, nextInsertIndex, 0);
      return;
    }

    focusGridCell(requestedCreateMonthIndex, nextInsertIndex, 0);
  }, [
    activeGite,
    activeTab,
    isMonthExpandedByDefault,
    location.key,
    month,
    monthExpandedByIndex,
    requestedCreateEntry,
    requestedCreateExit,
    requestedCreateMode,
    requestedTab,
    reservationsByMonth,
    scrollGridCellIntoView,
    setMonthExpanded,
    year,
  ]);

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
    const monthRows = reservationsByMonth.get(monthIndex) ?? [];
    const previousReservation = rowIndex > 0 ? monthRows[rowIndex - 1] ?? null : null;
    ensureNewRow(monthIndex, previousReservation);
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
    const newRowGite = (newRow.gite_id ? giteById.get(newRow.gite_id) : null) ?? activeGite ?? null;
    const nightlySuggestions = getGiteNightlyPriceSuggestions(newRowGite);

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
              updateNewRow(monthIndex, (prev) => applySuggestedExitFromEntry(prev, nextValue));
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
            onFocus={() => {
              updateNewRow(monthIndex, (prev) => applySuggestedExitFromEntry(prev, prev.date_entree));
            }}
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
        <td className="reservations-col-nightly">
          <div className="reservations-nightly-field">
            <input
              data-grid-month={monthIndex}
              data-grid-row={newRowIndex}
              data-grid-col={5}
              className="reservations-nightly-field__input"
              type="number"
              min={0}
              step={1}
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
            {nightlySuggestions.length > 0 ? (
              <div className="reservations-nightly-popover">
                <div className="reservations-nightly-popover__label">Tarifs du gîte</div>
                <div className="reservations-nightly-popover__list">
                  {nightlySuggestions.map((price) => {
                    const isActive = round2(newRow.prix_par_nuit) === price;
                    return (
                      <button
                        key={price}
                        type="button"
                        tabIndex={-1}
                        className={`reservations-nightly-popover__option ${
                          isActive ? "reservations-nightly-popover__option--active" : ""
                        }`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectNewRowNightlySuggestion(monthIndex, price)}
                      >
                        {formatEuro(price)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </td>
        <td>
          <input
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={6}
            type="number"
            min={0}
            step={1}
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
          <textarea
            data-grid-month={monthIndex}
            data-grid-row={newRowIndex}
            data-grid-col={8}
            className="reservations-comment-editor"
            rows={1}
            value={newRow.commentaire}
            ref={resizeCommentTextarea}
            onChange={(event) => {
              resizeCommentTextarea(event.currentTarget);
              updateNewRow(monthIndex, (prev) => ({ ...prev, commentaire: event.target.value }));
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                addReservation(monthIndex).catch((err) => setError((err as Error).message));
              }
            }}
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
            <select value={year} onChange={(event) => handleYearChange(Number(event.target.value))}>
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
            Recherche (hôte, téléphone, dates, source)
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="ex: Martin, 0612345678, 12/07/2026, Airbnb"
            />
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
            (() => {
              const recentImportedCount = recentImportedCountByTab.get(gite.id) ?? 0;
              const recentImportedLabel = recentImportedCount > 0 ? getRecentImportedTabLabel(recentImportedCount) : null;

              return (
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
                  onClick={() => handleTabChange(gite.id)}
                  disabled={reorderingTabs}
                  title={
                    reorderingTabs
                      ? "Réorganisation en cours..."
                      : recentImportedLabel
                        ? `${recentImportedLabel}. Glisser-déposer pour réorganiser`
                        : "Glisser-déposer pour réorganiser"
                  }
                >
                  <span className="reservations-tab__label">{gite.nom}</span>
                  {recentImportedCount > 0 ? (
                    <span
                      className="reservations-tab__badge"
                      aria-label={recentImportedLabel ?? undefined}
                      title={recentImportedLabel ?? undefined}
                    >
                      {recentImportedCount}
                    </span>
                  ) : null}
                </button>
              );
            })()
          ))}
          {showUnassignedTab && (
            (() => {
              const recentImportedCount = recentImportedCountByTab.get(UNASSIGNED_TAB) ?? 0;
              const recentImportedLabel = recentImportedCount > 0 ? getRecentImportedTabLabel(recentImportedCount) : null;

              return (
                <button
                  type="button"
                  className={`reservations-tab ${activeTab === UNASSIGNED_TAB ? "reservations-tab--active" : ""}`}
                  onClick={() => handleTabChange(UNASSIGNED_TAB)}
                  title={recentImportedLabel ?? undefined}
                >
                  <span className="reservations-tab__label">Non attribuées</span>
                  {recentImportedCount > 0 ? (
                    <span
                      className="reservations-tab__badge"
                      aria-label={recentImportedLabel ?? undefined}
                      title={recentImportedLabel ?? undefined}
                    >
                      {recentImportedCount}
                    </span>
                  ) : null}
                </button>
              );
            })()
          )}
          <button
            type="button"
            className={`reservations-tab reservations-tab--all ${activeTab === ALL_GITES_TAB ? "reservations-tab--active" : ""}`}
            onClick={() => handleTabChange(ALL_GITES_TAB)}
          >
            <span className="reservations-tab__label">Tous les gîtes</span>
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
                    {item.zeroTotalReservationsCount > 0 ? (
                      <div className="reservations-urssaf-reminder__flags">
                        <span
                          className="reservations-summary-pill reservations-summary-pill--needs-completion"
                          title={`${formatPluralLabel(
                            item.zeroTotalReservationsCount,
                            "réservation",
                            "réservations"
                          )} avec un total à 0€ sur ce mois`}
                        >
                          Réservation à compléter
                        </span>
                      </div>
                    ) : null}
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
            const newRow = newRows[monthIndex] ?? (addAllowed && activeGite ? buildEmptyDraft(year, monthIndex, activeGite) : null);
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
            const holidaySegments = holidaySegmentsByMonth.get(monthIndex) ?? [];
            const monthHasPendingUrssafReminder = undeclaredUrssafForMonth > 0;
            const monthHasZeroTotalReservations =
              summary.zeroTotalReservationsCount > 0 && isUrssafConcernedMonth(year, monthIndex, currentPeriod);
            const isMonthExpandedDefault = isMonthExpandedByDefault(monthIndex);
            const isMonthExpanded = monthExpandedByIndex[monthIndex] ?? isMonthExpandedDefault;
            const monthPanelId = `reservations-month-panel-${year}-${monthIndex}`;
            const monthOccupation = occupationByMonth.get(monthIndex) ?? null;
            const topOccupationGiteId = topOccupationGiteIdByMonth.get(monthIndex) ?? null;
            const isActiveGiteMonthLeader =
              activeTab !== ALL_GITES_TAB && activeTab !== UNASSIGNED_TAB && topOccupationGiteId === activeTab;
            const activeGiteMonthlyEnergy =
              activeTab !== ALL_GITES_TAB && activeTab !== UNASSIGNED_TAB
                ? monthlyEnergySummaryByKey.get(
                    getMonthlyEnergySummaryKey(activeTab, year, monthIndex),
                  ) ?? null
                : null;
            const monthEnergySummariesForAllGites = isAllGitesTab
              ? [...monthlyEnergySummaries]
                  .filter((energySummary) => energySummary.month === monthIndex)
                  .sort((a, b) => {
                    const orderA = giteOrderById.get(a.gite_id) ?? Number.MAX_SAFE_INTEGER;
                    const orderB = giteOrderById.get(b.gite_id) ?? Number.MAX_SAFE_INTEGER;
                    if (orderA !== orderB) return orderA - orderB;

                    const nameA = giteById.get(a.gite_id)?.nom ?? "";
                    const nameB = giteById.get(b.gite_id)?.nom ?? "";
                    return nameA.localeCompare(nameB, "fr", { sensitivity: "base" });
                  })
              : [];

            return (
              <section
                className={`reservations-month ${isAllGitesTab ? "reservations-month--all-gites" : ""} ${
                  monthHasPendingUrssafReminder ? "reservations-month--urssaf-pending" : ""
                } ${!isMonthExpanded ? "reservations-month--collapsed" : ""}`}
                key={monthIndex}
                data-month-index={monthIndex}
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
                  <div className="reservations-month__head-main">
                    <div className="reservations-month__title-row">
                      <div className="section-subtitle reservations-month__title">{MONTHS[monthIndex - 1]}</div>
                      {holidaySegments.length > 0 ? (
                        <div className="reservations-month__holiday-list">
                          {holidaySegments.map((segment) => (
                            <span
                              key={segment.key}
                              className="reservations-month__holiday-item"
                              title={segment.name ?? "Vacances scolaires"}
                            >
                              {segment.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="reservations-month__meta">
                      <span className="reservations-summary-pill">{formatPluralLabel(summary.count, "réservation", "réservations")}</span>
                      <span className="reservations-summary-pill">{formatPluralLabel(summary.nights, "nuit", "nuits")}</span>
                      <span className="reservations-summary-pill reservations-summary-pill--guest-nights">
                        Total {formatPluralLabel(summary.guestNights, "nuitée", "nuitées")}
                      </span>
                      <span className="reservations-summary-pill reservations-summary-pill--guest-nights-declared">
                        {formatPluralLabel(summary.declaredGuestNights, "nuitée", "nuitées")} à déclarer
                      </span>
                      <span className="reservations-summary-pill reservations-summary-pill--revenue">{formatEuro(summary.revenue)} revenus</span>
                      <span className="reservations-summary-pill reservations-summary-pill--fees">{formatEuro(summary.fees)} frais</span>
                      {isAllGitesTab
                        ? monthEnergySummariesForAllGites.map((energySummary) => (
                            <Fragment
                              key={getMonthlyEnergySummaryKey(energySummary.gite_id, energySummary.year, energySummary.month)}
                            >
                              {renderMonthlyEnergyIndicator({
                                giteId: energySummary.gite_id,
                                monthIndex,
                                summary: energySummary,
                                showGiteName: true,
                              })}
                            </Fragment>
                          ))
                        : null}
                      {!isAllGitesTab
                        ? renderMonthlyEnergyIndicator({
                            giteId: activeTab,
                            monthIndex,
                            summary: activeGiteMonthlyEnergy,
                          })
                        : null}
                      {monthHasZeroTotalReservations ? (
                        <span
                          className="reservations-summary-pill reservations-summary-pill--needs-completion"
                          title={`${formatPluralLabel(
                            summary.zeroTotalReservationsCount,
                            "réservation",
                            "réservations"
                          )} avec un total à 0€ sur ce mois`}
                        >
                          Réservation à compléter
                        </span>
                      ) : null}
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
                  <div className="reservations-month__head-side">
                    {monthOccupation !== null ? (
                      <div className="reservations-month__occupation">
                        <OccupationGaugeDial
                          id={`reservations-month-occupation-${year}-${monthIndex}-${activeTab}`}
                          occupation={monthOccupation}
                          highlighted={false}
                          animate={false}
                          size={{ width: 52, height: 24 }}
                          className="reservations-month__occupation-gauge"
                          showLeaderBadge={isActiveGiteMonthLeader}
                        />
                      </div>
                    ) : null}
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
                      const groupOccupation =
                        groupKey === UNASSIGNED_TAB ? null : (occupationByMonthByGite.get(groupKey)?.get(monthIndex) ?? null);
                      const groupMonthlyEnergy =
                        groupKey === UNASSIGNED_TAB
                          ? null
                          : monthlyEnergySummaryByKey.get(
                              getMonthlyEnergySummaryKey(groupKey, year, monthIndex),
                            ) ?? null;
                      const groupLabel =
                        groupKey === UNASSIGNED_TAB
                          ? "Non attribuées"
                          : (giteById.get(groupKey)?.nom ?? reservation.gite?.nom ?? "Gîte");
                      const isEditing = Boolean(editingRows[reservation.id]);
                      const draft = getRowDraft(reservation);
                      const rowSaveState = rowState[reservation.id] ?? "idle";
                      const optionDraft = getOptionsDraft(reservation, draft);
                      const optionGite = resolveReservationGite(reservation, draft);
                      const nightlySuggestions = getGiteNightlyPriceSuggestions(optionGite);
                      const optionPreview = computeReservationOptionsPreview(optionDraft, draft, optionGite);
                      const pricingDetails = computeReservationPricingDetails(draft, optionPreview.total);
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
                      const isCurrentReservation = isReservationInProgress(reservation, currentTime);
                      const isArrivalToday = shouldShowArrivalTodayPill(reservation, currentTime);
                      const isDepartureToday = isReservationDepartureToday(reservation, currentTime);
                      const departureTodayLabel = getDepartureTodayPillLabel(reservation, currentTime);
                      const isArrivalTomorrow = isReservationArrivalTomorrow(reservation, currentTime);
                      const isDepartureTomorrow = isReservationDepartureTomorrow(reservation, currentTime);
                      const isIcalToVerify = hasIcalToVerifyMarker(reservation.commentaire);
                      const isRecentImported = recentImportedReservationIds.has(reservation.id);
                      const holidayNightCount = holidayNightsByReservationId.get(reservation.id) ?? 0;
                      const visibleComment = stripIcalToVerifyMarker(reservation.commentaire);
                      const canSplitByMonth = needsMonthSplit(reservation.date_entree, reservation.date_sortie);
                      const rowStatusLabel = statusLabel(rowSaveState);
                      const telephoneHref = buildTelephoneHref(reservation.telephone);
                      const hasOpenEnergySession = Boolean(
                        reservation.energy_tracking?.some((entry) => entry.status === "open"),
                      );
                      const hasEnergyData =
                        reservation.energy_consumption_kwh > 0 ||
                        reservation.energy_cost_eur > 0;
                      const hasLiveEnergyData =
                        isCurrentReservation &&
                        ((reservation.energy_live_consumption_kwh ?? 0) > 0 ||
                          (reservation.energy_live_cost_eur ?? 0) > 0);
                      const displayedEnergyCost =
                        hasLiveEnergyData
                          ? reservation.energy_live_cost_eur ?? 0
                          : hasEnergyData
                            ? reservation.energy_cost_eur
                            : null;
                      const displayedEnergyKwh =
                        hasLiveEnergyData
                          ? reservation.energy_live_consumption_kwh ?? 0
                          : hasEnergyData
                            ? reservation.energy_consumption_kwh
                            : null;
                      const hasDisplayedEnergyInline =
                        displayedEnergyCost !== null && displayedEnergyKwh !== null;
                      const canStartLiveEnergyTracking =
                        isCurrentReservation &&
                        Boolean(reservation.gite_id) &&
                        !hasOpenEnergySession;
                      const isStartingLiveEnergy = Boolean(startingEnergyById[reservation.id]);
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
                                    {renderMonthlyEnergyIndicator({
                                      giteId: groupKey === UNASSIGNED_TAB ? null : groupKey,
                                      monthIndex,
                                      summary: groupMonthlyEnergy,
                                    })}
                                    {groupOccupation !== null ? (
                                      <div className="reservations-gite-group-row__occupation">
                                        <OccupationGaugeDial
                                          id={`reservations-group-occupation-${year}-${monthIndex}-${groupKey}`}
                                          occupation={groupOccupation}
                                          highlighted={false}
                                          animate={false}
                                          size={{ width: 52, height: 24 }}
                                          className="reservations-month__occupation-gauge"
                                          showLeaderBadge={topOccupationGiteId === groupKey}
                                        />
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                          <tr
                            id={`reservation-${reservation.id}`}
                            className={`reservations-row ${isEditing ? "reservations-row--editing" : ""} ${
                              isRowSavedFading ? "reservations-row--saved-fade" : ""
                            } ${isCurrentReservation ? "reservations-row--current" : ""} ${
                              linkedFocusReservationId === reservation.id ? "reservations-row--linked-focus" : ""
                            }`}
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
                              {isCurrentReservation ||
                              isRecentImported ||
                              isArrivalToday ||
                              isDepartureToday ||
                              isArrivalTomorrow ||
                              isDepartureTomorrow ||
                              isIcalToVerify ||
                              holidayNightCount > 0 ? (
                                <div className="reservations-row-flags">
                                  {isRecentImported ? (
                                    <span className="reservations-current-pill reservations-current-pill--new">Nouveau</span>
                                  ) : null}
                                  {isIcalToVerify ? (
                                    <span className="reservations-current-pill reservations-current-pill--to-verify">A vérifier</span>
                                  ) : null}
                                  {isArrivalToday ? (
                                    <span className="reservations-current-pill reservations-current-pill--arrival">
                                      Arrive aujourd'hui
                                    </span>
                                  ) : null}
                                  {isCurrentReservation && !isArrivalToday && !isDepartureToday && !isDepartureTomorrow ? (
                                    <span className="reservations-current-pill reservations-current-pill--row-start">En cours</span>
                                  ) : null}
                                  {isDepartureToday ? (
                                    <span className="reservations-current-pill reservations-current-pill--departure-today">
                                      {departureTodayLabel}
                                    </span>
                                  ) : null}
                                  {isArrivalTomorrow ? (
                                    <span className="reservations-current-pill reservations-current-pill--arrival">Arrive demain</span>
                                  ) : null}
                                  {isDepartureTomorrow ? (
                                    <span className="reservations-current-pill reservations-current-pill--departure">Part demain</span>
                                  ) : null}
                                  {holidayNightCount > 0 ? (
                                    <span
                                      className="reservations-current-pill reservations-current-pill--holiday"
                                      title={`Vacances scolaires zone B: ${formatNightsLabel(holidayNightCount)}`}
                                    >
                                      Vacances · {formatNightsLabel(holidayNightCount)}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
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
                                  <span className="reservations-host-inline">
                                    <span className="reservations-host-inline__name">{getEditableHostName(reservation.hote_nom)}</span>
                                    {reservation.telephone || reservation.email ? (
                                      <span className="reservations-host-inline__contacts" aria-hidden="true">
                                        {reservation.telephone ? (
                                          <span className="reservations-host-inline__contact-indicator" title="Téléphone renseigné">
                                            <ReservationPhoneIcon />
                                          </span>
                                        ) : null}
                                        {reservation.email ? (
                                          <span className="reservations-host-inline__contact-indicator" title="Email renseigné">
                                            <ReservationEmailIcon />
                                          </span>
                                        ) : null}
                                      </span>
                                    ) : null}
                                  </span>
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
                            <td className="reservations-col-nightly">
                              {isEditing || isInlineFieldActive(reservation.id, "prix_par_nuit") ? (
                                <div className="reservations-nightly-field">
                                  <input
                                    data-grid-month={monthIndex}
                                    data-grid-row={gridRowIndex}
                                    data-grid-col={5}
                                    data-inline-row-id={!isEditing ? reservation.id : undefined}
                                    data-inline-field={!isEditing ? "prix_par_nuit" : undefined}
                                    className="reservations-nightly-field__input"
                                    type="number"
                                    min={0}
                                    step={1}
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
                                  {nightlySuggestions.length > 0 ? (
                                    <div className="reservations-nightly-popover">
                                      <div className="reservations-nightly-popover__label">Tarifs du gîte</div>
                                      <div className="reservations-nightly-popover__list">
                                        {nightlySuggestions.map((price) => {
                                          const isActive = round2(draft.prix_par_nuit) === price;
                                          return (
                                            <button
                                              key={price}
                                              type="button"
                                              tabIndex={-1}
                                              className={`reservations-nightly-popover__option ${
                                                isActive ? "reservations-nightly-popover__option--active" : ""
                                              }`}
                                              onMouseDown={(event) => event.preventDefault()}
                                              onClick={() =>
                                                selectExistingNightlySuggestion({
                                                  reservation,
                                                  draft,
                                                  price,
                                                  isEditing,
                                                }).catch((err) => setError((err as Error).message))
                                              }
                                            >
                                              {formatEuro(price)}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
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
                                  step={1}
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
                                  <span className="reservations-total-value__amount">
                                    {formatEuro(reservation.prix_total)}
                                  </span>
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
                                <span className="reservations-fees-stack">
                                  <span className="reservations-fees-cell">
                                    <span className="reservations-fee-pill reservations-fee-pill--declared" title="Frais déclarés">
                                      {formatEuro(feeBreakdown.declared)}
                                    </span>
                                    <span className="reservations-fees-separator">/</span>
                                    <span className="reservations-fee-pill reservations-fee-pill--undeclared" title="Frais non déclarés">
                                      {formatEuro(feeBreakdown.undeclared)}
                                    </span>
                                  </span>
                                  {hasDisplayedEnergyInline ? (
                                    <span className="reservations-energy-inline reservations-energy-inline--compact">
                                      <span className="reservations-energy-inline__item" title="Coût électricité">
                                        {formatEuro(displayedEnergyCost)}
                                      </span>
                                      <span className="reservations-energy-inline__dot">·</span>
                                      <span className="reservations-energy-inline__item" title="Consommation électricité">
                                        {formatKwh(displayedEnergyKwh)} kWh
                                      </span>
                                    </span>
                                  ) : null}
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
                              {((isEditing && !isDetailsExpanded && !isDetailsClosing) ||
                                isInlineFieldActive(reservation.id, "commentaire")) ? (
                                <div className="reservations-comment-field reservations-comment-field--editing">
                                  <div className="reservations-comment-popover reservations-comment-popover--editing">
                                    <textarea
                                      data-grid-month={monthIndex}
                                      data-grid-row={gridRowIndex}
                                      data-grid-col={8}
                                      className="reservations-comment-editor"
                                      data-inline-row-id={!isEditing ? reservation.id : undefined}
                                      data-inline-field={!isEditing ? "commentaire" : undefined}
                                      rows={1}
                                      value={draft.commentaire}
                                      autoFocus={!isEditing}
                                      ref={resizeCommentTextarea}
                                      onChange={(event) => {
                                        resizeCommentTextarea(event.currentTarget);
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
                                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                            event.preventDefault();
                                            saveInlineField(reservation, "commentaire").catch((err) => setError((err as Error).message));
                                            return;
                                          }
                                          if (event.key === "Escape") {
                                            event.preventDefault();
                                            closeInlineField(reservation, "commentaire");
                                          }
                                          return;
                                        }
                                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                          event.preventDefault();
                                          saveExistingRow(reservation.id).catch((err) => setError((err as Error).message));
                                        }
                                      }}
                                      onBlur={() => {
                                        if (!isEditing) handleInlineBlur(reservation, "commentaire");
                                      }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="reservations-comment-field">
                                  <button
                                    type="button"
                                    className="reservations-source-inline-trigger reservations-comment-trigger"
                                    onClick={() => openInlineField(reservation, "commentaire")}
                                    title={visibleComment || "Modifier le commentaire"}
                                  >
                                    {visibleComment}
                                  </button>
                                  {visibleComment && !isDetailsExpanded && !isDetailsClosing ? (
                                    <div className="reservations-comment-popover" aria-hidden="true">
                                      <div className="reservations-comment-popover__body">{visibleComment}</div>
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td className="table-actions-cell">
                              <div className="reservations-actions-cell">
                                {rowStatusLabel && (
                                  <div
                                    className={`reservations-save-state reservations-save-state--${rowSaveState}`}
                                    title={rowError[reservation.id] ?? ""}
                                  >
                                    {rowStatusLabel}
                                  </div>
                                )}
                                <div className="reservations-actions-menu">
                                  <button className="table-action table-action--neutral reservations-actions-trigger" title="Actions">
                                    ⋯
                                  </button>
                                  <div className="reservations-row-actions">
                                  {isIcalToVerify && (
                                    <button
                                      type="button"
                                      className="table-action table-action--success"
                                      onClick={() => markReservationAsVerified(reservation).catch((err) => setError((err as Error).message))}
                                      disabled={rowSaveState === "saving" || deletingId === reservation.id}
                                      title='Retirer le statut "A vérifier"'
                                    >
                                      OK
                                    </button>
                                  )}
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
                                  {reservation.airbnb_url && (
                                    <a
                                      className="table-action table-action--neutral"
                                      href={reservation.airbnb_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Ouvrir la réservation Airbnb"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      AB
                                    </a>
                                  )}
                                  {telephoneHref && (
                                    <a
                                      className="table-action table-action--neutral"
                                      href={telephoneHref}
                                      title={reservation.telephone ?? "Appeler"}
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      ☎
                                    </a>
                                  )}
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
                              </div>
                            </td>
                          </tr>
                          {(isDetailsExpanded || isDetailsClosing) && (
                            <tr className={`reservations-row-details ${isDetailsClosing ? "reservations-row-details--closing" : ""}`}>
                              <td colSpan={12}>
                                <div className="reservations-row-details-content">
                                  <div className="reservations-details-grid">
                                    {hasEnergyData ? (
                                      <div className="reservations-energy-inline">
                                        Électricité: {formatKwh(reservation.energy_consumption_kwh)} kWh
                                        {" · "}
                                        {formatEuro(reservation.energy_cost_eur)}
                                      </div>
                                    ) : null}
                                    {hasLiveEnergyData ? (
                                      <div className="reservations-energy-inline">
                                        Électricité en cours: {formatKwh(reservation.energy_live_consumption_kwh ?? 0)} kWh
                                        {" · "}
                                        {formatEuro(reservation.energy_live_cost_eur ?? 0)}
                                      </div>
                                    ) : null}
                                    {canStartLiveEnergyTracking ? (
                                      <div className="reservations-energy-inline">
                                        <button
                                          type="button"
                                          className="table-action table-action--neutral"
                                          onClick={() => startLiveEnergyTracking(reservation).catch((err) => setError((err as Error).message))}
                                          disabled={
                                            isStartingLiveEnergy ||
                                            rowSaveState === "saving" ||
                                            deletingId === reservation.id
                                          }
                                          title="Initialiser le relevé de départ maintenant"
                                        >
                                          {isStartingLiveEnergy ? "Initialisation..." : "Démarrer comptage"}
                                        </button>
                                        {" "}
                                        Relevé de départ manuel pour afficher la consommation en cours.
                                      </div>
                                    ) : null}
                                    <div className="reservations-contact-card">
                                      <div className="reservations-contact-card__title">Contact</div>
                                      <div className="grid-2">
                                        <div className="field">
                                          <span>Téléphone</span>
                                          {isEditing ? (
                                            <input
                                              value={draft.telephone}
                                              onChange={(event) =>
                                                updateExistingField(reservation, (prev) => ({
                                                  ...prev,
                                                  telephone: event.target.value,
                                                }))
                                              }
                                            />
                                          ) : reservation.telephone && telephoneHref ? (
                                            <a className="detail-link" href={telephoneHref}>
                                              {reservation.telephone}
                                            </a>
                                          ) : (
                                            <span className="detail-value">—</span>
                                          )}
                                        </div>
                                        <div className="field">
                                          <span>Email</span>
                                          {isEditing ? (
                                            <input
                                              type="email"
                                              value={draft.email}
                                              onChange={(event) =>
                                                updateExistingField(reservation, (prev) => ({
                                                  ...prev,
                                                  email: event.target.value,
                                                }))
                                              }
                                            />
                                          ) : reservation.email ? (
                                            <a className="detail-link" href={`mailto:${reservation.email}`}>
                                              {reservation.email}
                                            </a>
                                          ) : (
                                            <span className="detail-value">—</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="reservations-options-builder">
                                    <div className="reservations-options-builder__head">
                                      <div>
                                        <div className="reservations-options-builder__title-row">
                                          <strong>Options contrat/devis</strong>
                                          {optionGite && (
                                            <span className="reservations-options-builder__title-total">
                                              Total recalculé: {formatEuro(pricingDetails.adjustedTotal)}
                                            </span>
                                          )}
                                        </div>
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
                                        <ReservationOptionsEditor
                                          options={optionDraft}
                                          preview={optionPreview}
                                          gite={optionGite}
                                          guestCount={draft.nb_adultes}
                                          onChange={(nextOptions) =>
                                            updateReservationOptionsSelection(reservation, draft, () => nextOptions)
                                          }
                                        />
                                        <div className="reservations-pricing-card">
                                          <div className="reservations-pricing-card__head">
                                            <strong>Commission channel et réduction</strong>
                                            <div className="field-hint">Ajuste directement le total et le prix/nuit</div>
                                          </div>
                                          <div className="reservations-pricing-card__form">
                                            <label className="reservations-pricing-card__field">
                                              <span>Commission</span>
                                              <div className="reservations-pricing-card__commission-inputs">
                                                <select
                                                  value={draft.commission_channel_mode}
                                                  onChange={(event) => {
                                                    const nextMode = normalizeReservationCommissionMode(event.target.value);
                                                    updateExistingField(reservation, (prev) => ({
                                                      ...applyReservationPricingHelpers({
                                                        draft: prev,
                                                        previewOptionsTotal: optionPreview.total,
                                                        commissionMode: nextMode,
                                                        commissionValue: prev.commission_channel_value,
                                                      }),
                                                    }));
                                                  }}
                                                >
                                                  <option value="euro">Montant €</option>
                                                  <option value="percent">Pourcentage %</option>
                                                </select>
                                                <input
                                                  type="number"
                                                  min={0}
                                                  max={draft.commission_channel_mode === "percent" ? 99.99 : undefined}
                                                  step={1}
                                                  value={draft.commission_channel_value}
                                                  onChange={(event) =>
                                                    updateExistingField(reservation, (prev) => ({
                                                      ...applyReservationPricingHelpers({
                                                        draft: prev,
                                                        previewOptionsTotal: optionPreview.total,
                                                        commissionValue: Number(event.target.value),
                                                      }),
                                                    }))
                                                  }
                                                />
                                              </div>
                                            </label>
                                            <label className="reservations-pricing-card__field">
                                              <span>Réduction offerte</span>
                                              <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={draft.remise_montant}
                                                onChange={(event) =>
                                                  updateExistingField(reservation, (prev) => ({
                                                    ...applyReservationPricingHelpers({
                                                      draft: prev,
                                                      previewOptionsTotal: optionPreview.total,
                                                      remiseMontant: Number(event.target.value),
                                                    }),
                                                  }))
                                                }
                                              />
                                            </label>
                                          </div>
                                          <div className="reservations-pricing-card__totals">
                                            <span>Total avant ajustement</span>
                                            <strong>{formatEuro(pricingDetails.baseTotal)}</strong>
                                            <span>Commission channel</span>
                                            <strong>-{formatEuro(pricingDetails.commissionAmount)}</strong>
                                            <span>Réduction offerte</span>
                                            <strong>-{formatEuro(draft.remise_montant)}</strong>
                                            <span>Total recalculé</span>
                                            <strong>{formatEuro(pricingDetails.adjustedTotal)}</strong>
                                            <span>Prix/nuit recalculé</span>
                                            <strong>{formatEuro(pricingDetails.adjustedNightlyPrice)}</strong>
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

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { OccupationGaugeDial } from "./statistics/components/OccupationGauge";
import MobileReservationActionsBar from "./shared/MobileReservationActionsBar";
import MobileReservationSheet from "./shared/MobileReservationSheet";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import { getGiteColor } from "../utils/giteColors";
import {
  DEFAULT_PAYMENT_SOURCE_COLORS,
  buildPaymentColorMap,
  getPaymentColorFromMap,
} from "../utils/paymentColors";
import {
  areReservationOptionsAllDeclared,
  buildQuickReservationOptions,
  computeReservationOptionsPreview,
  mergeReservationOptions,
  toNonNegativeInt,
} from "../utils/reservationOptions";
import { buildSmsHref, buildTelephoneHref } from "../utils/sms";
import type { Gestionnaire, Gite, Reservation } from "../utils/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOTAL_DAY_COUNT = 14;
const MOBILE_RESERVATION_BREAKPOINT = 760;
const USER_STORAGE_KEY = "contrats-today-user";
const TRASH_COLORS = {
  yellow: "#FFCB05",
  darkGreen: "#104911",
};

type TodayStatuses = Record<
  string,
  {
    done: boolean;
    user: string;
  }
>;

type TodayOverviewPayload = {
  today: string;
  days: number;
  gites: Gite[];
  managers: Gestionnaire[];
  reservations: Reservation[];
  statuses: TodayStatuses;
  source_colors: Record<string, string>;
  unassigned_count: number;
  recent_import_log: TodayImportLogEntry[];
  recent_app_activity: TodayAppActivityEntry[];
};

type TodayImportLogEntry = {
  id: string;
  at: string;
  source: string;
  status?: "success" | "error";
  errorMessage?: string | null;
  selectionCount: number;
  inserted: number;
  updated: number;
  deleted?: number;
  insertedItems?: Array<{
    giteName?: string;
    giteId?: string;
    checkIn?: string;
    checkOut?: string;
    source?: string;
  }>;
  updatedItems?: Array<{
    giteName?: string;
    giteId?: string;
    checkIn?: string;
    checkOut?: string;
    source?: string;
    updatedFields?: string[];
  }>;
  deletedItems?: Array<{
    giteName?: string;
    giteId?: string;
    checkIn?: string;
    checkOut?: string;
    source?: string;
  }>;
};

type TodayAppActivityEntry = {
  id: string;
  at: string;
  type: "created" | "updated";
  reservation_id: string;
  gite_id: string | null;
  gite_name: string;
  guest_name: string;
  source: string | null;
};

type TodayEventType = "arrival" | "depart" | "both";

type TodayEvent = {
  id: string;
  statusId: string;
  type: TodayEventType;
  dateIso: string;
  giteId: string;
  giteName: string;
  gitePrefix: string;
  source: string | null;
  arrivalReservation: Reservation | null;
  departureReservation: Reservation | null;
  primaryReservation: Reservation;
};

type TimelineStay = {
  id: string;
  startRatio: number;
  endRatio: number;
  color: string;
};

type TimelineMarker = {
  id: string;
  ratio: number;
  event: TodayEvent;
};

type TimelineRow = {
  gite: Gite;
  stays: TimelineStay[];
  markers: TimelineMarker[];
  blockedDateIsos: Set<string>;
};

type QuickReservationDraft = {
  hote_nom: string;
  telephone: string;
  date_entree: string;
  date_sortie: string;
  nb_adultes: number;
  prix_par_nuit: string;
  source_paiement: string;
  commentaire: string;
  option_menage: boolean;
  option_draps: number;
  option_serviettes: number;
};
type QuickReservationErrorField = keyof QuickReservationDraft | null;

type QuickReservationSmsSnippet = {
  id: string;
  title: string;
  text: string;
};

type QuickReservationSmsSettings = {
  texts: QuickReservationSmsSnippet[];
};

type TodayActivitySourceCount = {
  label: string;
  count: number;
  color: string;
};

type TodayActivitySummary = {
  kind: "created" | "updated" | "deleted";
  label: string;
  total: number;
  sources: TodayActivitySourceCount[];
};

type TodayMobileActionState =
  | {
      mode: "actions";
      reservationId: string;
    }
  | {
      mode: "rotation-choice";
      eventId: string;
    }
  | null;

const DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS: QuickReservationSmsSnippet[] = [
  {
    id: "bedding-cleaning",
    title: "Draps/ménage",
    text: "Comme indiqué, je vous laisse prendre vos draps, serviettes et faire le ménage avant de partir.",
  },
  {
    id: "bedding-option",
    title: "Option Draps/Serviettes",
    text: "Vous pourrez prendre l'option draps à 15€ par lit si vous ne souhaitez pas emporter votre linge.",
  },
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

const getStoredTodayUser = () => {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(USER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const getMatchesMediaQuery = (query: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;

const subscribeToMediaQueryChange = (mediaQuery: MediaQueryList, listener: (event: MediaQueryListEvent) => void) => {
  const mediaQueryWithLegacyApi = mediaQuery as MediaQueryList & {
    addListener?: (callback: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (callback: (event: MediaQueryListEvent) => void) => void;
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }

  mediaQueryWithLegacyApi.addListener?.(listener);
  return () => mediaQueryWithLegacyApi.removeListener?.(listener);
};

const parseIsoDate = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * DAY_MS);
const diffUtcDays = (left: Date, right: Date) => Math.round((left.getTime() - right.getTime()) / DAY_MS);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;
const formatManagerName = (manager: Gestionnaire) => `${manager.prenom} ${manager.nom}`.trim();
const normalizeIsoDate = (value: string) => value.slice(0, 10);
const formatShortDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const formatStayNights = (nights: number) => `${nights} nuit${nights > 1 ? "s" : ""}`;
const formatLongDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
const formatQuickReservationPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
};
const getQuickReservationSmsPhoneDigits = (value: string) => value.replace(/\D/g, "");
const getQuickReservationAdultsMax = (gite: Gite | null) => Math.max(1, Math.trunc(Number(gite?.capacite_max ?? 1)) || 1);
const getQuickReservationOptionCountMax = (gite: Gite | null) => Math.max(1, Math.trunc(Number(gite?.capacite_max ?? 1)) || 1);
const clampQuickReservationAdults = (value: number, gite: Gite | null) =>
  Math.min(getQuickReservationAdultsMax(gite), Math.max(1, Math.trunc(Number(value) || 1)));
const clampQuickReservationOptionCount = (value: number, gite: Gite | null) =>
  Math.min(getQuickReservationOptionCountMax(gite), Math.max(0, Math.trunc(Number(value) || 0)));
const isIsoDateString = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
const parseOptionalIsoDate = (value: string) => (isIsoDateString(value) ? parseIsoDate(value) : null);
const interpolateQuickReservationSmsSnippet = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
const formatQuickReservationSmsHour = (value: string, options?: { middayLabel?: boolean }) => {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (options?.middayLabel && hours === 12 && minutes === 0) return "midi";
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
};
const formatQuickReservationSmsAmount = (value: number) => {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : round2(value).toFixed(2).replace(".", ",");
};
const formatQuickReservationOptionSmsSummary = (params: {
  options: ReturnType<typeof mergeReservationOptions>;
  optionsPreview: ReturnType<typeof computeReservationOptionsPreview>;
}) => {
  const { options, optionsPreview } = params;
  const items: string[] = [];

  if (options.menage.enabled) {
    items.push(optionsPreview.byKey.menage > 0 ? `ménage ${formatQuickReservationSmsAmount(optionsPreview.byKey.menage)}€` : "ménage offert");
  }

  if (options.draps.enabled) {
    const count = toNonNegativeInt(options.draps.nb_lits, 0);
    items.push(
      optionsPreview.byKey.draps > 0
        ? `draps x${count} ${formatQuickReservationSmsAmount(optionsPreview.byKey.draps)}€`
        : `draps x${count} offerts`
    );
  }

  if (options.linge_toilette.enabled) {
    const count = toNonNegativeInt(options.linge_toilette.nb_personnes, 0);
    items.push(
      optionsPreview.byKey.linge_toilette > 0
        ? `serviettes x${count} ${formatQuickReservationSmsAmount(optionsPreview.byKey.linge_toilette)}€`
        : `serviettes x${count} offertes`
    );
  }

  if (options.depart_tardif.enabled) {
    items.push(
      optionsPreview.byKey.depart_tardif > 0
        ? `départ tardif ${formatQuickReservationSmsAmount(optionsPreview.byKey.depart_tardif)}€`
        : "départ tardif offert"
    );
  }

  if (options.chiens.enabled) {
    const count = toNonNegativeInt(options.chiens.nb, 0);
    items.push(
      optionsPreview.byKey.chiens > 0
        ? `chiens x${count} ${formatQuickReservationSmsAmount(optionsPreview.byKey.chiens)}€`
        : `chiens x${count} offerts`
    );
  }

  return items.join(" · ");
};

const getWeekNumber = (value: Date) => {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
};

const getReservationGuestName = (reservation: Reservation | null | undefined) =>
  String(reservation?.hote_nom ?? "").trim() || "Réservation";

const getReservationPhone = (reservation: Reservation | null | undefined) => String(reservation?.telephone ?? "").trim();
const getReservationComment = (reservation: Reservation | null | undefined) => String(reservation?.commentaire ?? "").trim();
const getReservationAirbnbUrl = (reservation: Reservation | null | undefined) => reservation?.airbnb_url ?? null;
const getEventDateLabel = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const buildEventStatusId = (giteId: string, dateIso: string, type: TodayEventType) => `today:${giteId}:${dateIso}:${type}`;

const formatImportSource = (source: string | null | undefined) => {
  const normalized = String(source ?? "").trim().toLowerCase();
  if (normalized === "ical-manual") return "ICAL manuel";
  if (normalized === "ical-cron") return "ICAL cron";
  if (normalized === "ical-startup") return "ICAL démarrage";
  if (normalized === "pump") return "Pump";
  if (normalized === "pump-cron") return "Pump cron";
  if (normalized === "pump-refresh") return "Pump refresh";
  return source || "Import";
};

const isPumpRefreshImportSource = (source: string | null | undefined) =>
  String(source ?? "").trim().toLowerCase() === "pump-refresh";

const mixHexColors = (baseHex: string, targetHex: string, weight: number) => {
  const parse = (value: string) => {
    const normalized = value.replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
  };

  const base = parse(baseHex);
  const target = parse(targetHex);
  if (!base || !target) return baseHex;

  const ratio = clamp(weight, 0, 1);
  const mixChannel = (left: number, right: number) => Math.round(left * (1 - ratio) + right * ratio);
  const toHex = (value: number) => value.toString(16).padStart(2, "0");

  return `#${toHex(mixChannel(base.r, target.r))}${toHex(mixChannel(base.g, target.g))}${toHex(mixChannel(base.b, target.b))}`;
};

const getTrashTextColor = (background: string) => {
  const normalized = background.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "#111827";
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? mixHexColors(background, "#111827", 0.64) : mixHexColors(background, "#ffffff", 0.48);
};

const buildActivitySourceCounts = (
  items: Array<{ source?: string | null }> | undefined,
  fallbackTotal: number,
  paymentColorMap: Record<string, string>
) => {
  const counts = new Map<string, number>();

  (items ?? []).forEach((item) => {
    const label = String(item.source ?? "").trim() || "A définir";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  if (counts.size === 0) {
    return fallbackTotal > 0
      ? [
          {
            label: "Non détaillé",
            count: fallbackTotal,
            color: "#d1d5db",
          },
        ]
      : [];
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "fr", { sensitivity: "base" }))
    .map(([label, count]) => ({
      label,
      count,
      color: getPaymentColorFromMap(label, paymentColorMap),
    }));
};

const buildTodayEvents = (reservations: Reservation[], todayIso: string, lastVisibleIso: string) => {
  const grouped = new Map<
    string,
    {
      giteId: string;
      dateIso: string;
      arrivals: Reservation[];
      departures: Reservation[];
    }
  >();

  const register = (giteId: string, dateIso: string, type: "arrivals" | "departures", reservation: Reservation) => {
    if (dateIso < todayIso || dateIso > lastVisibleIso) return;
    const key = `${giteId}:${dateIso}`;
    const entry = grouped.get(key) ?? { giteId, dateIso, arrivals: [], departures: [] };
    entry[type].push(reservation);
    grouped.set(key, entry);
  };

  reservations.forEach((reservation) => {
    if (!reservation.gite_id || !reservation.gite) return;
    register(reservation.gite_id, reservation.date_entree.slice(0, 10), "arrivals", reservation);
    register(reservation.gite_id, reservation.date_sortie.slice(0, 10), "departures", reservation);
  });

  return [...grouped.values()]
    .map((entry) => {
      const arrivalReservation = entry.arrivals[0] ?? null;
      const departureReservation = entry.departures[0] ?? null;
      const primaryReservation = arrivalReservation ?? departureReservation;
      if (!primaryReservation?.gite_id || !primaryReservation.gite) return null;

      const type: TodayEventType =
        entry.arrivals.length > 0 && entry.departures.length > 0
          ? "both"
          : entry.arrivals.length > 0
            ? "arrival"
            : "depart";

      return {
        id: `${primaryReservation.gite_id}:${entry.dateIso}:${type}`,
        statusId: buildEventStatusId(primaryReservation.gite_id, entry.dateIso, type),
        type,
        dateIso: entry.dateIso,
        giteId: primaryReservation.gite_id,
        giteName: primaryReservation.gite.nom,
        gitePrefix: primaryReservation.gite.prefixe_contrat,
        source:
          arrivalReservation?.source_paiement ??
          departureReservation?.source_paiement ??
          primaryReservation.source_paiement ??
          null,
        arrivalReservation,
        departureReservation,
        primaryReservation,
      } satisfies TodayEvent;
    })
    .filter((value): value is TodayEvent => Boolean(value))
    .sort((left, right) => {
      const leftDate = parseIsoDate(left.dateIso).getTime();
      const rightDate = parseIsoDate(right.dateIso).getTime();
      if (leftDate !== rightDate) return leftDate - rightDate;
      return left.giteName.localeCompare(right.giteName, "fr", { sensitivity: "base" });
    });
};

const getMarkerVariantLabel = (type: TodayEventType) => {
  if (type === "arrival") return "Arrivée";
  if (type === "depart") return "Départ";
  return "Rotation";
};

const getEventSummaryLabel = (event: TodayEvent) => {
  if (event.type === "arrival") return getReservationGuestName(event.arrivalReservation);
  if (event.type === "depart") return getReservationGuestName(event.departureReservation);
  return "Départ + arrivée";
};

const buildReservationFocusHref = (event: TodayEvent) => {
  const reservationStartDate = parseIsoDate(event.primaryReservation.date_entree);
  const params = new URLSearchParams();
  params.set("focus", event.primaryReservation.id);
  params.set("year", String(reservationStartDate.getUTCFullYear()));
  params.set("tab", event.giteId);
  return `/reservations?${params.toString()}#reservation-${event.primaryReservation.id}`;
};

const buildReservationCreateHref = (giteId: string, dateIso: string) => {
  const date = parseIsoDate(dateIso);
  const params = new URLSearchParams();
  params.set("create", "1");
  params.set("entry", dateIso);
  params.set("exit", toIsoDate(addUtcDays(date, 1)));
  params.set("year", String(date.getUTCFullYear()));
  params.set("month", String(date.getUTCMonth() + 1));
  params.set("tab", giteId);
  return `/reservations?${params.toString()}`;
};

const buildMobileReservationEditorHref = (reservationId: string) => {
  const params = new URLSearchParams();
  params.set("mode", "edit");
  params.set("id", reservationId);
  params.set("returnTo", "/aujourdhui");
  return `/reservations/mobile?${params.toString()}`;
};

const getTimelinePercent = (dayIndex: number, totalDays: number) => {
  if (totalDays <= 1) return 0;
  return (dayIndex / (totalDays - 1)) * 100;
};

const getTimelineRatio = (dayIndex: number, totalDays: number) => {
  if (totalDays <= 1) return 0;
  return dayIndex / (totalDays - 1);
};

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6.9 3.2c.4-.4 1-.5 1.5-.3l2.4 1c.7.3 1 .9.9 1.6l-.4 2.5c0 .3.1.6.3.8l3 3c.2.2.5.3.8.3l2.5-.4c.7-.1 1.4.2 1.6.9l1 2.4c.2.5.1 1.1-.3 1.5l-1.7 1.7c-.6.6-1.5.9-2.3.7-2.7-.6-5.3-2.1-7.6-4.3-2.2-2.2-3.7-4.8-4.3-7.6-.2-.8.1-1.7.7-2.3Z" />
  </svg>
);

const SmsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5Z" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 6h8" />
    <path d="M9 6V4.8c0-.4.3-.8.8-.8h4.4c.5 0 .8.4.8.8V6" />
    <path d="M6.8 6h10.4l-.7 11.4c0 .9-.8 1.6-1.7 1.6H9.2c-.9 0-1.6-.7-1.7-1.6Z" />
    <path d="M10 10.2v5.6" />
    <path d="M14 10.2v5.6" />
  </svg>
);

const ArrowArrivalIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 19V6" />
    <path d="m6.5 11.5 5.5-5.5 5.5 5.5" />
  </svg>
);

const ArrowDepartureIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 5v13" />
    <path d="m17.5 12.5-5.5 5.5-5.5-5.5" />
  </svg>
);

const ArrowSwapIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 5v14" />
    <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
    <path d="m16.5 14.5-4.5 4.5-4.5-4.5" />
  </svg>
);

const getEventIcon = (type: TodayEventType) => {
  if (type === "arrival") return <ArrowArrivalIcon />;
  if (type === "depart") return <ArrowDepartureIcon />;
  return <ArrowSwapIcon />;
};

const TodayPage = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<TodayOverviewPayload | null>(null);
  const [selectedUser, setSelectedUser] = useState(() => getStoredTodayUser());
  const [quickReservationSmsSnippets, setQuickReservationSmsSnippets] = useState<QuickReservationSmsSnippet[]>(
    DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS
  );
  const [mobileActionState, setMobileActionState] = useState<TodayMobileActionState>(null);
  const [quickReservationDraft, setQuickReservationDraft] = useState<QuickReservationDraft | null>(null);
  const [quickReservationOpen, setQuickReservationOpen] = useState(false);
  const [quickReservationEditingId, setQuickReservationEditingId] = useState<string | null>(null);
  const [quickReservationSmsSelection, setQuickReservationSmsSelection] = useState<string[]>([]);
  const [quickReservationSaving, setQuickReservationSaving] = useState(false);
  const [quickReservationError, setQuickReservationError] = useState<string | null>(null);
  const [quickReservationErrorField, setQuickReservationErrorField] = useState<QuickReservationErrorField>(null);
  const [quickReservationSaved, setQuickReservationSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [usesViewportScroll, setUsesViewportScroll] = useState(() =>
    getMatchesMediaQuery(`(max-width: ${MOBILE_RESERVATION_BREAKPOINT}px)`)
  );

  const loadData = async (options?: { preserveContent?: boolean }) => {
    const shouldShowLoader = !options?.preserveContent || !overview;
    if (shouldShowLoader) {
      setLoading(true);
    }

    try {
      setError(null);
      const payload = await apiFetch<TodayOverviewPayload>(`/today/overview?days=${TOTAL_DAY_COUNT}`);
      setOverview(payload);
    } catch (err: any) {
      setError(err.message ?? "Impossible de charger la page Aujourd'hui.");
    } finally {
      if (shouldShowLoader) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    apiFetch<QuickReservationSmsSettings>("/settings/sms-texts")
      .then((data) => {
        setQuickReservationSmsSnippets(
          Array.isArray(data.texts) && data.texts.length > 0 ? data.texts : DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS
        );
      })
      .catch(() => {
        setQuickReservationSmsSnippets(DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS);
      });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_RESERVATION_BREAKPOINT}px)`);
    const updateScrollMode = (matches: boolean) => {
      setUsesViewportScroll((current) => (current === matches ? current : matches));
    };

    updateScrollMode(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      updateScrollMode(event.matches);
    };

    return subscribeToMediaQueryChange(mediaQuery, handleChange);
  }, []);

  const todayIso = overview?.today ?? toIsoDate(new Date());
  const totalDays = overview?.days ?? TOTAL_DAY_COUNT;
  const todayDate = useMemo(() => parseIsoDate(todayIso), [todayIso]);
  const tomorrowIso = useMemo(() => toIsoDate(addUtcDays(todayDate, 1)), [todayDate]);
  const lastVisibleDate = useMemo(() => addUtcDays(todayDate, totalDays - 1), [todayDate, totalDays]);
  const lastVisibleIso = useMemo(() => toIsoDate(lastVisibleDate), [lastVisibleDate]);

  const gites = overview?.gites ?? [];
  const managers = overview?.managers ?? [];
  const reservations = overview?.reservations ?? [];
  const statuses = overview?.statuses ?? {};
  const unassignedCount = overview?.unassigned_count ?? 0;
  const recentImportLog = overview?.recent_import_log ?? [];
  const recentAppActivity = overview?.recent_app_activity ?? [];
  const mobileActionEvent = useMemo(
    () =>
      mobileActionState?.mode === "rotation-choice"
        ? buildTodayEvents(reservations, todayIso, lastVisibleIso).find((event) => event.id === mobileActionState.eventId) ?? null
        : null,
    [lastVisibleIso, mobileActionState, reservations, todayIso]
  );
  const mobileActionReservation = useMemo(
    () =>
      mobileActionState?.mode === "actions"
        ? reservations.find((reservation) => reservation.id === mobileActionState.reservationId) ?? null
        : null,
    [mobileActionState, reservations]
  );
  const quickReservationEditingReservation = useMemo(
    () => (quickReservationEditingId ? reservations.find((reservation) => reservation.id === quickReservationEditingId) ?? null : null),
    [quickReservationEditingId, reservations]
  );
  const quickReservationSelectedGite = useMemo(
    () =>
      gites.find(
        (gite) =>
          gite.id === (quickReservationEditingReservation?.gite_id ?? mobileActionReservation?.gite_id ?? "")
      ) ?? null,
    [gites, mobileActionReservation?.gite_id, quickReservationEditingReservation?.gite_id]
  );

  const managerOptions = useMemo(
    () =>
      managers
        .map(formatManagerName)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "fr", { sensitivity: "base" })),
    [managers]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(USER_STORAGE_KEY, selectedUser);
    } catch {
      // Ignore local storage write failures on restrictive mobile browsers.
    }
  }, [selectedUser]);

  useEffect(() => {
    if (managerOptions.length === 0 || selectedUser) return;
    setSelectedUser(managerOptions[0]);
  }, [managerOptions, selectedUser]);

  useEffect(() => {
    if (usesViewportScroll) return;
    setMobileActionState(null);
    setQuickReservationOpen(false);
    setQuickReservationDraft(null);
    setQuickReservationEditingId(null);
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
    setQuickReservationErrorField(null);
    setQuickReservationSaved(false);
  }, [usesViewportScroll]);

  useEffect(() => {
    if (quickReservationOpen) {
      setMobileActionState(null);
    }
  }, [quickReservationOpen]);

  const paymentColorMap = useMemo(
    () => buildPaymentColorMap(overview?.source_colors ?? DEFAULT_PAYMENT_SOURCE_COLORS),
    [overview?.source_colors]
  );

  const days = useMemo(
    () =>
      Array.from({ length: totalDays }, (_, index) => {
        const date = addUtcDays(todayDate, index);
        const iso = toIsoDate(date);
        const weekday = date.getUTCDay();
        return {
          iso,
          shortLabel: date.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" }),
          dayNumber: date.toLocaleDateString("fr-FR", { day: "numeric", timeZone: "UTC" }),
          isToday: iso === todayIso,
          isTomorrow: iso === tomorrowIso,
          isWeekend: weekday === 0 || weekday === 6,
        };
      }),
    [todayDate, todayIso, tomorrowIso, totalDays]
  );

  const todayEvents = useMemo(
    () => buildTodayEvents(reservations, todayIso, lastVisibleIso),
    [reservations, todayIso, lastVisibleIso]
  );

  useEffect(() => {
    if (mobileActionState?.mode === "actions" && !mobileActionReservation) {
      setMobileActionState(null);
      return;
    }
    if (mobileActionState?.mode === "rotation-choice" && !mobileActionEvent) {
      setMobileActionState(null);
    }
  }, [mobileActionEvent, mobileActionReservation, mobileActionState]);

  const eventsByGite = useMemo(() => {
    const map = new Map<string, TodayEvent[]>();
    todayEvents.forEach((event) => {
      const list = map.get(event.giteId) ?? [];
      list.push(event);
      map.set(event.giteId, list);
    });
    return map;
  }, [todayEvents]);

  const timelineRows = useMemo<TimelineRow[]>(
    () =>
      gites.map((gite) => {
        const reservationsForGite = reservations.filter((reservation) => reservation.gite_id === gite.id);
        const blockedDateIsos = new Set<string>();

        const stays = reservationsForGite
          .map((reservation) => {
            const startIndex = clamp(diffUtcDays(parseIsoDate(reservation.date_entree), todayDate), 0, totalDays - 1);
            const endIndex = clamp(diffUtcDays(parseIsoDate(reservation.date_sortie), todayDate), 0, totalDays - 1);
            const occupiedStartIndex = Math.max(diffUtcDays(parseIsoDate(reservation.date_entree), todayDate), 0);
            const occupiedEndIndexExclusive = Math.min(diffUtcDays(parseIsoDate(reservation.date_sortie), todayDate), totalDays);

            for (let index = occupiedStartIndex; index < occupiedEndIndexExclusive; index += 1) {
              blockedDateIsos.add(toIsoDate(addUtcDays(todayDate, index)));
            }

            return {
              id: reservation.id,
              startRatio: getTimelineRatio(startIndex, totalDays),
              endRatio: getTimelineRatio(endIndex, totalDays),
              color: getPaymentColorFromMap(reservation.source_paiement, paymentColorMap),
            } satisfies TimelineStay;
          })
          .sort((left, right) => left.startRatio - right.startRatio);

        const markers = (eventsByGite.get(gite.id) ?? [])
          .map((event) => {
            const index = diffUtcDays(parseIsoDate(event.dateIso), todayDate);
            if (index < 0 || index >= totalDays) return null;
            return {
              id: event.id,
              ratio: getTimelineRatio(index, totalDays),
              event,
            } satisfies TimelineMarker;
          })
          .filter((value): value is TimelineMarker => Boolean(value));

        return {
          gite,
          stays,
          markers,
          blockedDateIsos,
        };
      }),
    [eventsByGite, gites, paymentColorMap, reservations, todayDate, totalDays]
  );

  const eventsToday = useMemo(() => todayEvents.filter((event) => event.dateIso === todayIso), [todayEvents, todayIso]);
  const eventsTomorrow = useMemo(() => todayEvents.filter((event) => event.dateIso === tomorrowIso), [todayEvents, tomorrowIso]);
  const activeStayCount = useMemo(
    () =>
      reservations.filter(
        (reservation) =>
          parseIsoDate(reservation.date_entree).getTime() <= todayDate.getTime() &&
          parseIsoDate(reservation.date_sortie).getTime() > todayDate.getTime()
      ).length,
    [reservations, todayDate]
  );
  const filledGiteCount = useMemo(
    () =>
      new Set(
        reservations
          .filter(
            (reservation) =>
              reservation.gite_id &&
              parseIsoDate(reservation.date_entree).getTime() <= todayDate.getTime() &&
              parseIsoDate(reservation.date_sortie).getTime() > todayDate.getTime()
          )
          .map((reservation) => reservation.gite_id as string)
      ).size,
    [reservations, todayDate]
  );
  const filledGiteRate = useMemo(() => (gites.length > 0 ? filledGiteCount / gites.length : 0), [filledGiteCount, gites.length]);
  const currentViewOccupation = useMemo(() => {
    const totalSlots = timelineRows.length * totalDays;
    if (totalSlots <= 0) {
      return {
        occupiedSlots: 0,
        totalSlots: 0,
        rate: 0,
      };
    }

    const occupiedSlots = timelineRows.reduce((sum, row) => sum + row.blockedDateIsos.size, 0);

    return {
      occupiedSlots,
      totalSlots,
      rate: occupiedSlots / totalSlots,
    };
  }, [timelineRows, totalDays]);

  const quickReservationNightlySuggestions = useMemo(() => {
    const seen = new Set<number>();
    const suggestions: number[] = [];
    const rawList = Array.isArray(quickReservationSelectedGite?.prix_nuit_liste) ? quickReservationSelectedGite.prix_nuit_liste : [];

    rawList.forEach((item) => {
      const nextValue = round2(Math.max(0, Number(item)));
      if (!Number.isFinite(nextValue) || seen.has(nextValue)) return;
      seen.add(nextValue);
      suggestions.push(nextValue);
    });

    return suggestions;
  }, [quickReservationSelectedGite]);

  const quickReservationAdultsMax = useMemo(
    () => getQuickReservationAdultsMax(quickReservationSelectedGite),
    [quickReservationSelectedGite]
  );
  const quickReservationAdultOptions = useMemo(
    () => Array.from({ length: quickReservationAdultsMax }, (_, index) => index + 1),
    [quickReservationAdultsMax]
  );
  const quickReservationOptionCountMax = useMemo(
    () => getQuickReservationOptionCountMax(quickReservationSelectedGite),
    [quickReservationSelectedGite]
  );

  const quickReservationDateSummary = useMemo(() => {
    if (!quickReservationDraft) {
      return {
        startIso: "",
        exitIso: "",
        nights: 0,
      };
    }

    const entryDate = parseOptionalIsoDate(quickReservationDraft.date_entree);
    const exitDate = parseOptionalIsoDate(quickReservationDraft.date_sortie);
    if (!entryDate || !exitDate) {
      return {
        startIso: quickReservationDraft.date_entree,
        exitIso: quickReservationDraft.date_sortie,
        nights: 0,
      };
    }

    return {
      startIso: quickReservationDraft.date_entree,
      exitIso: quickReservationDraft.date_sortie,
      nights: Math.max(0, Math.round((exitDate.getTime() - entryDate.getTime()) / DAY_MS)),
    };
  }, [quickReservationDraft]);

  const quickReservationOptions = useMemo(
    () =>
      quickReservationDraft
        ? buildQuickReservationOptions({
            baseOptions: quickReservationEditingReservation?.options,
            menageEnabled: quickReservationDraft.option_menage,
            drapsCount: quickReservationDraft.option_draps,
            serviettesCount: quickReservationDraft.option_serviettes,
          })
        : null,
    [quickReservationDraft, quickReservationEditingReservation?.options]
  );
  const quickReservationOptionsPreview = useMemo(
    () =>
      computeReservationOptionsPreview(quickReservationOptions, {
        nights: quickReservationDateSummary.nights,
        gite: quickReservationSelectedGite,
      }),
    [quickReservationDateSummary.nights, quickReservationOptions, quickReservationSelectedGite]
  );
  const quickReservationBaseTotal = useMemo(() => {
    if (!quickReservationDraft) return null;
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    if (!Number.isFinite(nightly) || nightly < 0) return null;
    return quickReservationDateSummary.nights > 0 ? round2(nightly * quickReservationDateSummary.nights) : null;
  }, [quickReservationDateSummary.nights, quickReservationDraft]);
  const quickReservationComputedTotal = useMemo(
    () =>
      quickReservationBaseTotal !== null
        ? round2(quickReservationBaseTotal + quickReservationOptionsPreview.total)
        : null,
    [quickReservationBaseTotal, quickReservationOptionsPreview.total]
  );
  const quickReservationOptionSummary = useMemo(
    () =>
      quickReservationOptions
        ? formatQuickReservationOptionSmsSummary({
            options: quickReservationOptions,
            optionsPreview: quickReservationOptionsPreview,
          })
        : "",
    [quickReservationOptions, quickReservationOptionsPreview]
  );

  const quickReservationSmsText = useMemo(() => {
    if (!quickReservationSelectedGite || !quickReservationDraft) return "";

    const { startIso, exitIso, nights } = quickReservationDateSummary;
    if (!isIsoDateString(startIso) || !isIsoDateString(exitIso) || nights <= 0) return "";

    const startDate = formatLongDate(startIso);
    const endDate = formatLongDate(exitIso);
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    const address = [quickReservationSelectedGite.adresse_ligne1, quickReservationSelectedGite.adresse_ligne2].filter(Boolean).join(", ");
    const arrivalTime = formatQuickReservationSmsHour(quickReservationSelectedGite.heure_arrivee_defaut || "17:00");
    const departureTime = formatQuickReservationSmsHour(quickReservationSelectedGite.heure_depart_defaut || "12:00", {
      middayLabel: true,
    });
    const snippetValues = {
      adresse: address,
      dateDebut: startDate,
      dateFin: endDate,
      heureArrivee: arrivalTime,
      heureDepart: departureTime,
      gite: quickReservationSelectedGite.nom,
      nbNuits: String(nights),
      nom: quickReservationDraft.hote_nom.trim(),
    };

    const baseLines = [
      "Bonjour,",
      `Je vous confirme votre réservation pour le gîte ${quickReservationSelectedGite.nom} du ${startDate} à partir de ${arrivalTime} au ${endDate} ${departureTime} (${nights} nuit${
        nights > 1 ? "s" : ""
      }).`,
    ];

    if (Number.isFinite(nightly) && nightly >= 0 && quickReservationBaseTotal !== null) {
      baseLines.push(
        `Le tarif est de ${formatQuickReservationSmsAmount(round2(nightly))}€/nuit, soit ${formatQuickReservationSmsAmount(
          quickReservationBaseTotal
        )}€.`
      );
    }

    if (quickReservationOptionSummary) {
      baseLines.push(`Options retenues : ${quickReservationOptionSummary}.`);
    }

    if (quickReservationComputedTotal !== null && (quickReservationOptionsPreview.total > 0 || quickReservationOptionSummary)) {
      baseLines.push(`Le total du séjour est de ${formatQuickReservationSmsAmount(quickReservationComputedTotal)}€.`);
    }

    if (address) baseLines.push(`L'adresse est ${address}.`);

    const selectedSnippets = quickReservationSmsSnippets
      .filter((snippet) => quickReservationSmsSelection.includes(snippet.id))
      .map((snippet) => interpolateQuickReservationSmsSnippet(snippet.text, snippetValues))
      .filter((snippet) => snippet.trim().length > 0);

    return [...baseLines, ...selectedSnippets, "Merci Beaucoup,", "Soazig Molinier"].join("\n");
  }, [
    quickReservationBaseTotal,
    quickReservationComputedTotal,
    quickReservationDateSummary,
    quickReservationDraft,
    quickReservationOptionSummary,
    quickReservationOptionsPreview.total,
    quickReservationSelectedGite,
    quickReservationSmsSelection,
    quickReservationSmsSnippets,
  ]);

  const quickReservationSmsHref = useMemo(() => {
    const phone = quickReservationDraft ? getQuickReservationSmsPhoneDigits(quickReservationDraft.telephone) : "";
    return buildSmsHref(phone, quickReservationSmsText);
  }, [quickReservationDraft, quickReservationSmsText]);

  const closeQuickReservationSheet = () => {
    setQuickReservationOpen(false);
    setQuickReservationDraft(null);
    setQuickReservationEditingId(null);
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
    setQuickReservationErrorField(null);
    setQuickReservationSaved(false);
  };

  const openQuickReservationEditSheet = (reservation: Reservation) => {
    if (!usesViewportScroll) return;

    setMobileActionState(null);
    setQuickReservationEditingId(reservation.id);
    setQuickReservationDraft({
      hote_nom: reservation.hote_nom,
      telephone: formatQuickReservationPhone(reservation.telephone ?? ""),
      date_entree: normalizeIsoDate(reservation.date_entree),
      date_sortie: normalizeIsoDate(reservation.date_sortie),
      nb_adultes: clampQuickReservationAdults(reservation.nb_adultes, gites.find((gite) => gite.id === reservation.gite_id) ?? null),
      prix_par_nuit: String(reservation.prix_par_nuit ?? ""),
      source_paiement: reservation.source_paiement?.trim() || DEFAULT_RESERVATION_SOURCE,
      commentaire: reservation.commentaire ?? "",
      option_menage: Boolean(reservation.options?.menage?.enabled),
      option_draps: reservation.options?.draps?.enabled
        ? clampQuickReservationOptionCount(
            toNonNegativeInt(reservation.options?.draps?.nb_lits, Math.max(1, reservation.nb_adultes || 1)),
            gites.find((gite) => gite.id === reservation.gite_id) ?? null
          )
        : 0,
      option_serviettes: reservation.options?.linge_toilette?.enabled
        ? clampQuickReservationOptionCount(
            toNonNegativeInt(reservation.options?.linge_toilette?.nb_personnes, Math.max(1, reservation.nb_adultes || 1)),
            gites.find((gite) => gite.id === reservation.gite_id) ?? null
          )
        : 0,
    });
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
    setQuickReservationErrorField(null);
    setQuickReservationSaved(false);
    setQuickReservationOpen(true);
  };

  const handleQuickReservationFieldChange = (field: keyof QuickReservationDraft, value: string | number | boolean) => {
    setQuickReservationSaved(false);
    setQuickReservationError(null);
    setQuickReservationErrorField(null);
    setQuickReservationDraft((current) => {
      if (!current) return current;
      if (field === "telephone") {
        return { ...current, telephone: formatQuickReservationPhone(String(value)) };
      }
      if (field === "nb_adultes") {
        return { ...current, nb_adultes: clampQuickReservationAdults(Number(value), quickReservationSelectedGite) };
      }
      if (field === "option_draps" || field === "option_serviettes") {
        return { ...current, [field]: clampQuickReservationOptionCount(Number(value), quickReservationSelectedGite) };
      }
      if (field === "option_menage") {
        return { ...current, option_menage: Boolean(value) };
      }
      return { ...current, [field]: value };
    });
  };

  const openMobileActionForEvent = (event: TodayEvent) => {
    if (!usesViewportScroll) {
      navigate(buildReservationFocusHref(event));
      return;
    }

    setQuickReservationOpen(false);
    setQuickReservationDraft(null);
    setQuickReservationEditingId(null);
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
    setQuickReservationErrorField(null);
    setQuickReservationSaved(false);

    setMobileActionState((current) => {
      if (event.type === "both") {
        return current?.mode === "rotation-choice" && current.eventId === event.id ? null : { mode: "rotation-choice", eventId: event.id };
      }

      return current?.mode === "actions" && current.reservationId === event.primaryReservation.id
        ? null
        : { mode: "actions", reservationId: event.primaryReservation.id };
    });
  };

  const saveQuickReservation = async () => {
    if (!quickReservationDraft || !quickReservationEditingReservation || quickReservationSaving) return;

    const hostName = quickReservationDraft.hote_nom.trim();
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    const adults = Math.max(0, Math.trunc(Number(quickReservationDraft.nb_adultes) || 0));
    const entryDate = parseOptionalIsoDate(quickReservationDraft.date_entree);
    const exitDate = parseOptionalIsoDate(quickReservationDraft.date_sortie);
    const nights = entryDate && exitDate ? Math.max(0, Math.round((exitDate.getTime() - entryDate.getTime()) / DAY_MS)) : 0;
    const quickOptions = buildQuickReservationOptions({
      baseOptions: quickReservationEditingReservation?.options,
      menageEnabled: quickReservationDraft.option_menage,
      drapsCount: quickReservationDraft.option_draps,
      serviettesCount: quickReservationDraft.option_serviettes,
    });
    const quickOptionsPreview = computeReservationOptionsPreview(quickOptions, {
      nights,
      gite: quickReservationSelectedGite,
    });
    const quickOptionsDeclared = areReservationOptionsAllDeclared(quickOptions);

    if (!hostName) {
      setQuickReservationError("Renseigne le nom de l'hôte.");
      setQuickReservationErrorField("hote_nom");
      setQuickReservationSaved(false);
      return;
    }

    if (!entryDate || !exitDate) {
      setQuickReservationError("Renseigne des dates valides.");
      setQuickReservationErrorField(!entryDate ? "date_entree" : "date_sortie");
      setQuickReservationSaved(false);
      return;
    }

    if (exitDate.getTime() <= entryDate.getTime()) {
      setQuickReservationError("La date de sortie doit être postérieure à la date d'entrée.");
      setQuickReservationErrorField("date_sortie");
      setQuickReservationSaved(false);
      return;
    }

    if (!Number.isFinite(nightly) || nightly < 0) {
      setQuickReservationError("Renseigne un prix par nuit valide.");
      setQuickReservationErrorField("prix_par_nuit");
      setQuickReservationSaved(false);
      return;
    }

    setQuickReservationSaving(true);
    setQuickReservationError(null);
    setQuickReservationErrorField(null);

    try {
      await apiFetch<Reservation>(`/reservations/${quickReservationEditingReservation.id}`, {
        method: "PUT",
        json: {
          gite_id: quickReservationEditingReservation.gite_id ?? undefined,
          placeholder_id: quickReservationEditingReservation.placeholder_id ?? undefined,
          airbnb_url: quickReservationEditingReservation.airbnb_url ?? undefined,
          hote_nom: hostName,
          telephone: quickReservationDraft.telephone.trim() || undefined,
          date_entree: quickReservationDraft.date_entree,
          date_sortie: quickReservationDraft.date_sortie,
          nb_adultes: adults,
          prix_par_nuit: round2(nightly),
          price_driver: "nightly",
          source_paiement: quickReservationDraft.source_paiement || DEFAULT_RESERVATION_SOURCE,
          commentaire: quickReservationDraft.commentaire.trim() || undefined,
          remise_montant: quickReservationEditingReservation.remise_montant ?? 0,
          commission_channel_mode: quickReservationEditingReservation.commission_channel_mode ?? "euro",
          commission_channel_value: quickReservationEditingReservation.commission_channel_value ?? 0,
          frais_optionnels_montant: quickOptionsPreview.total,
          frais_optionnels_libelle: quickOptionsPreview.label || undefined,
          frais_optionnels_declares: quickOptionsDeclared,
          options: quickOptions,
        },
      });

      await loadData({ preserveContent: true });
      setQuickReservationSaved(true);
    } catch (err) {
      if (isApiError(err)) {
        setQuickReservationError(err.message);
      } else {
        setQuickReservationError("Impossible d'enregistrer la réservation.");
      }
      setQuickReservationErrorField(null);
      setQuickReservationSaved(false);
    } finally {
      setQuickReservationSaving(false);
    }
  };

  const handleQuickReservationPrimaryAction = () => {
    if (quickReservationSaved) {
      if (!quickReservationSmsHref) return;
      window.location.href = quickReservationSmsHref;
      return;
    }

    void saveQuickReservation();
  };

  const getMobileCardActionProps = (event: TodayEvent) =>
    usesViewportScroll
      ? {
          role: "button" as const,
          tabIndex: 0,
          onClick: () => openMobileActionForEvent(event),
          onKeyDown: (keyboardEvent: ReactKeyboardEvent<HTMLElement>) => {
            if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
            keyboardEvent.preventDefault();
            openMobileActionForEvent(event);
          },
        }
      : {};

  const evenWeek = useMemo(() => getWeekNumber(todayDate) % 2 === 0, [todayDate]);
  const mauronTrashColor = evenWeek ? TRASH_COLORS.yellow : TRASH_COLORS.darkGreen;
  const neantTrashColor = evenWeek ? TRASH_COLORS.darkGreen : TRASH_COLORS.yellow;
  const mauronTrashTextColor = useMemo(() => getTrashTextColor(mauronTrashColor), [mauronTrashColor]);
  const neantTrashTextColor = useMemo(() => getTrashTextColor(neantTrashColor), [neantTrashColor]);

  const recentActivitySummary = useMemo<TodayActivitySummary[]>(() => {
    const summaries = new Map<"created" | "updated" | "deleted", Map<string, number>>([
      ["created", new Map()],
      ["updated", new Map()],
      ["deleted", new Map()],
    ]);
    const totals = new Map<"created" | "updated" | "deleted", number>([
      ["created", 0],
      ["updated", 0],
      ["deleted", 0],
    ]);

    const addSourceCount = (kind: "created" | "updated" | "deleted", label: string, count: number) => {
      if (count <= 0) return;
      totals.set(kind, (totals.get(kind) ?? 0) + count);
      const sourceMap = summaries.get(kind);
      if (!sourceMap) return;
      sourceMap.set(label, (sourceMap.get(label) ?? 0) + count);
    };

    recentImportLog.forEach((entry) => {
      if (entry.status === "error" || isPumpRefreshImportSource(entry.source)) return;

      buildActivitySourceCounts(entry.insertedItems, entry.inserted ?? 0, paymentColorMap).forEach((source) =>
        addSourceCount("created", source.label, source.count)
      );
      buildActivitySourceCounts(entry.updatedItems, entry.updated ?? 0, paymentColorMap).forEach((source) =>
        addSourceCount("updated", source.label, source.count)
      );
      buildActivitySourceCounts(entry.deletedItems, entry.deleted ?? 0, paymentColorMap).forEach((source) =>
        addSourceCount("deleted", source.label, source.count)
      );
    });

    recentAppActivity.forEach((entry) => {
      addSourceCount(entry.type, "App", 1);
    });

    const toSources = (kind: "created" | "updated" | "deleted") =>
      [...(summaries.get(kind)?.entries() ?? [])]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "fr", { sensitivity: "base" }))
        .map(([label, count]) => ({
          label:
            kind === "created"
              ? label === "App"
                ? "Direct"
                : label === "A définir"
                  ? "Direct externe"
                  : label
              : label,
          count,
          color: label === "App" ? "#94a3b8" : getPaymentColorFromMap(label, paymentColorMap),
        }));

    return [
      { kind: "created", label: "Ajouts", total: totals.get("created") ?? 0, sources: toSources("created") },
      { kind: "deleted", label: "Suppressions", total: totals.get("deleted") ?? 0, sources: toSources("deleted") },
      { kind: "updated", label: "Mises à jour", total: totals.get("updated") ?? 0, sources: toSources("updated") },
    ];
  }, [paymentColorMap, recentAppActivity, recentImportLog]);

  const toggleStatus = async (event: TodayEvent) => {
    const current = statuses[event.statusId];
    const nextValue = {
      done: !current?.done,
      user: selectedUser,
    };

    setSavingStatusId(event.statusId);
    setOverview((previous) =>
      previous
        ? {
            ...previous,
            statuses: {
              ...previous.statuses,
              [event.statusId]: nextValue,
            },
          }
        : previous
    );

    try {
      await apiFetch(`/today/statuses/${encodeURIComponent(event.statusId)}`, {
        method: "POST",
        json: nextValue,
      });
    } catch (err: any) {
      setOverview((previous) =>
        previous
          ? {
              ...previous,
              statuses: {
                ...previous.statuses,
                [event.statusId]: current ?? { done: false, user: "" },
              },
            }
          : previous
      );
      setError(err.message ?? "Impossible d'enregistrer le statut.");
    } finally {
      setSavingStatusId(null);
    }
  };

  if (loading) {
    return (
      <div className={`today-page${usesViewportScroll && (mobileActionState || quickReservationOpen) ? " today-page--mobile-overlay-visible" : ""}`}>
        <section className="card today-hero">
          <div className="section-title">Aujourd&apos;hui</div>
          <div className="field-hint">Chargement de la vue opérationnelle...</div>
        </section>
      </div>
    );
  }

  const hasMobileOverlay = usesViewportScroll && (Boolean(mobileActionState) || quickReservationOpen);

  return (
    <div className={`today-page${hasMobileOverlay ? " today-page--mobile-overlay-visible" : ""}`}>
      <section className="today-calendar-card">
        <div className="today-section-head today-section-head--calendar">
          <div>
            <div className="section-title">Calendrier</div>
            <div className="field-hint">
              {totalDays} jours glissants · {gites.length} gîte{gites.length > 1 ? "s" : ""}
            </div>
          </div>
          <div className="today-calendar-occupation">
            <div className="today-calendar-occupation__copy">
              <strong>
                {currentViewOccupation.occupiedSlots}/{currentViewOccupation.totalSlots}
              </strong>
            </div>
            <OccupationGaugeDial
              id={`today-view-occupation-${todayIso}`}
              occupation={currentViewOccupation.rate}
              highlighted={false}
              animate={false}
              size={{ width: 56, height: 26 }}
              className="today-calendar-occupation__gauge"
            />
          </div>
        </div>
        <div className="today-timeline__viewport">
          <div className="today-timeline today-timeline__content">
            <div className="today-timeline__weekend-bands" aria-hidden="true">
              {days.map((day) => (
                <span
                  key={`${day.iso}:weekend-band`}
                  className={[
                    "today-timeline__weekend-band",
                    day.isWeekend ? "today-timeline__weekend-band--visible" : "",
                    day.isToday ? "today-timeline__weekend-band--today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </div>
            <div className="today-timeline__header">
              {days.map((day) => (
                <div
                  key={day.iso}
                  className={[
                    "today-timeline__day",
                    day.isWeekend ? "today-timeline__day--weekend" : "",
                    day.isToday ? "today-timeline__day--today" : "",
                    day.isTomorrow ? "today-timeline__day--tomorrow" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span>{day.shortLabel}</span>
                  <strong>{day.dayNumber}</strong>
                </div>
              ))}
            </div>

            <div className="today-timeline__rows">
              {timelineRows.map((row) => (
                <div key={row.gite.id} className="today-timeline__row">
                  <div className="today-timeline__rail">
                    <div className="today-timeline__axis" />

                    {days.map((day, index) => (
                      row.blockedDateIsos.has(day.iso) ? null : (
                        <button
                          key={`${row.gite.id}:${day.iso}`}
                          type="button"
                          className={[
                            "today-timeline__tick today-timeline__tick-button",
                            day.isToday ? "today-timeline__tick--today" : "",
                            day.isTomorrow ? "today-timeline__tick--tomorrow" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          style={{
                            left: `calc(var(--today-timeline-edge-space) + (100% - (var(--today-timeline-edge-space) * 2)) * ${getTimelineRatio(
                              index,
                              totalDays
                            )})`,
                          }}
                          onClick={() => navigate(buildReservationCreateHref(row.gite.id, day.iso))}
                          title={`Nouvelle réservation ${row.gite.nom} à partir du ${getEventDateLabel(day.iso)}`}
                          aria-label={`Créer une réservation pour ${row.gite.nom} à partir du ${getEventDateLabel(day.iso)}`}
                        />
                      )
                    ))}

                    {row.stays.map((stay) => (
                      <span
                        key={stay.id}
                        className="today-timeline__stay"
                        style={{
                          left: `calc(var(--today-timeline-edge-space) + (100% - (var(--today-timeline-edge-space) * 2)) * ${stay.startRatio})`,
                          right: `calc(var(--today-timeline-edge-space) + (100% - (var(--today-timeline-edge-space) * 2)) * ${1 - stay.endRatio})`,
                          background: stay.color,
                        }}
                      />
                    ))}

                    {row.markers.map((marker) => {
                      const status = statuses[marker.event.statusId];
                      const prefix =
                        marker.event.gitePrefix.trim().slice(0, 2).toUpperCase() ||
                        marker.event.giteName.trim().slice(0, 1).toUpperCase();

                      return (
                        <button
                          key={marker.id}
                          type="button"
                          className={[
                            "today-timeline__marker",
                            status?.done ? "today-timeline__marker--done" : "",
                            marker.event.dateIso === todayIso ? "today-timeline__marker--pulse" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        style={{
                          left: `calc(var(--today-timeline-edge-space) + (100% - (var(--today-timeline-edge-space) * 2)) * ${marker.ratio})`,
                          background:
                            marker.event.source ? getPaymentColorFromMap(marker.event.source, paymentColorMap) : getGiteColor(marker.event.primaryReservation.gite),
                        }}
                          onClick={() => openMobileActionForEvent(marker.event)}
                          title={`${getMarkerVariantLabel(marker.event.type)} · ${marker.event.giteName} · Ouvrir la réservation`}
                          aria-label={`${getMarkerVariantLabel(marker.event.type)} ${marker.event.giteName}, ouvrir la réservation dans le listing`}
                        >
                          <span className="today-timeline__marker-prefix">{prefix}</span>
                          <span className="today-timeline__marker-icon">{getEventIcon(marker.event.type)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="today-events-grid">
        {[
          { key: "today", title: "Aujourd'hui", events: eventsToday },
          { key: "tomorrow", title: "Demain", events: eventsTomorrow },
        ].map((group) => (
          <section key={group.key} className="today-events-card">
            <div className="today-section-head">
              <div>
                <div className="section-title">{group.title}</div>
                <div className="field-hint">{group.events.length} opération(s) à suivre</div>
              </div>
            </div>

            <div className="today-events-list">
              {group.events.length === 0 ? <div className="today-events-empty">Aucune arrivée ni départ.</div> : null}

              {group.events.map((event) => {
                const status = statuses[event.statusId];
                const canToggle = event.dateIso === todayIso || event.dateIso === tomorrowIso;
                const phone = getReservationPhone(event.arrivalReservation) || getReservationPhone(event.departureReservation);
                const comment =
                  event.type === "depart"
                    ? ""
                    : getReservationComment(event.arrivalReservation) || getReservationComment(event.primaryReservation);
                const airbnbUrl = getReservationAirbnbUrl(event.arrivalReservation) || getReservationAirbnbUrl(event.departureReservation);
                const eventColor = event.source
                  ? getPaymentColorFromMap(event.source, paymentColorMap)
                  : getGiteColor(event.primaryReservation.gite);
                const phoneHref = buildTelephoneHref(phone);
                const smsHref = buildSmsHref(phone);

                return (
                  <article
                    key={event.id}
                    className={[
                      "today-event-card",
                      `today-event-card--${event.type}`,
                      status?.done ? "today-event-card--done" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ "--today-event-accent": eventColor } as CSSProperties}
                  >
                    <button
                      type="button"
                      className={["today-event-card__toggle", status?.done ? "today-event-card__toggle--done" : ""].filter(Boolean).join(" ")}
                      onClick={() => (canToggle ? void toggleStatus(event) : undefined)}
                      disabled={!canToggle || savingStatusId === event.statusId}
                      title={canToggle ? "Marquer comme traité" : "Le suivi est réservé à aujourd'hui et demain"}
                    >
                      <span className="today-event-card__toggle-prefix">
                        {event.gitePrefix.trim().slice(0, 2).toUpperCase() || event.giteName.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <span className="today-event-card__toggle-icon">{getEventIcon(event.type)}</span>
                    </button>

                    <div className="today-event-card__body" {...getMobileCardActionProps(event)}>
                      <div className="today-event-card__topline">
                        <span className="today-event-card__gite">{event.giteName}</span>
                        <span className="today-event-card__pill">{getMarkerVariantLabel(event.type)}</span>
                      </div>

                      <div className="today-event-card__headline">{getEventSummaryLabel(event)}</div>
                      <div className="today-event-card__date">{getEventDateLabel(event.dateIso)}</div>

                      {event.type === "both" ? (
                        <div className="today-event-card__swap">
                          <span>Départ: {getReservationGuestName(event.departureReservation)}</span>
                          <span>Arrivée: {getReservationGuestName(event.arrivalReservation)}</span>
                        </div>
                      ) : null}

                      {comment ? <div className="today-event-card__comment">{comment}</div> : null}
                    </div>

                    <div className="today-event-card__aside" {...getMobileCardActionProps(event)}>
                      {status?.done && status.user ? <span className="badge">Traité par {status.user}</span> : null}

                      <div className="today-event-card__meta">
                        <span>{event.source || "A définir"}</span>
                        <span>{event.primaryReservation.nb_adultes} adulte(s)</span>
                      </div>

                      {!usesViewportScroll ? (
                        <div className="today-event-card__actions">
                        {airbnbUrl ? (
                          <a href={airbnbUrl} target="_blank" rel="noreferrer" className="table-action table-action--neutral">
                            Airbnb
                          </a>
                        ) : null}
                        {phoneHref ? (
                          <a href={phoneHref} className="table-action table-action--icon" aria-label="Appeler">
                            <PhoneIcon />
                          </a>
                        ) : null}
                        {smsHref ? (
                          <a href={smsHref} className="table-action table-action--icon" aria-label="Envoyer un SMS">
                            <SmsIcon />
                          </a>
                        ) : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <section className="today-hero">
        <div className="today-hero__header">
          <div>
            <div className="today-hero__eyebrow">Exploitation</div>
            <h1 className="today-hero__title">Aujourd&apos;hui</h1>
            <p className="today-hero__text">Vue immédiate pour mobile: arrivées, départs, séjours en cours et suivi journalier.</p>
          </div>
        </div>

        <div className="today-kpis">
          <article className="today-kpi today-kpi--fill">
            <span className="today-kpi__label">Remplissage du jour</span>
            <div className="today-kpi__fill">
              <div className="today-kpi__fill-copy">
                <strong className="today-kpi__value">
                  {filledGiteCount}/{gites.length || 0}
                </strong>
                <span className="today-kpi__detail">
                  gîte{gites.length > 1 ? "s" : ""} rempli{filledGiteCount > 1 ? "s" : ""}
                </span>
              </div>
              <OccupationGaugeDial
                id={`today-fill-rate-${todayIso}`}
                occupation={filledGiteRate}
                highlighted={false}
                animate={false}
                size={{ width: 76, height: 36 }}
                className="today-kpi__fill-gauge"
              />
            </div>
          </article>
        </div>

        <div className="today-trash-inline">
          <div className="today-trash-inline__chips">
            <span
              className="today-trash-chip"
              style={
                {
                  "--today-trash-bg": mauronTrashColor,
                  "--today-trash-fg": mauronTrashTextColor,
                } as CSSProperties
              }
            >
              <TrashIcon />
              Mauron
            </span>
            <span
              className="today-trash-chip"
              style={
                {
                  "--today-trash-bg": neantTrashColor,
                  "--today-trash-fg": neantTrashTextColor,
                } as CSSProperties
              }
            >
              <TrashIcon />
              Néant
            </span>
          </div>
          <span className="today-trash-inline__detail">
            Semaine {evenWeek ? "paire" : "impaire"}
            {unassignedCount > 0 ? ` · ${unassignedCount} sans gîte masquée(s)` : ""}
          </span>
        </div>

        <div className="today-activity">
          <div className="today-section-head today-section-head--activity">
            <div>
              <div className="section-title">Résumé 3 jours</div>
              <div className="field-hint">Vue compacte des mouvements iCal, Pump et app</div>
            </div>
          </div>

          {recentActivitySummary.every((item) => item.total === 0) ? (
            <div className="today-activity__empty">Aucun ajout, suppression ou mise à jour sur les 3 derniers jours.</div>
          ) : (
            <div className="today-activity-compact">
              {recentActivitySummary.map((item) => (
                <article key={item.kind} className="today-activity-compact__card">
                  <div className="today-activity-compact__top">
                    <span className={`today-activity__action-label today-activity__action-label--${item.kind}`}>{item.label}</span>
                    <strong className="today-activity-compact__value">{item.total}</strong>
                  </div>

                  {item.sources.length > 0 ? (
                    <div className="today-activity__source-list">
                      {item.sources.map((source) => (
                        <span
                          key={`${item.kind}:${source.label}`}
                          className="today-activity__source-chip"
                          style={{ "--today-activity-source": source.color } as CSSProperties}
                        >
                          {source.label} {source.count}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="today-activity-compact__empty">Aucun</div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>

        {error ? <div className="note">{error}</div> : null}
      </section>

      {usesViewportScroll && mobileActionState?.mode === "rotation-choice" && mobileActionEvent ? (
        <MobileReservationActionsBar
          open
          mode="rotation-choice"
          title={mobileActionEvent.giteName}
          subtitle={getEventDateLabel(mobileActionEvent.dateIso)}
          onClose={() => setMobileActionState(null)}
          onSelectArrival={() => {
            if (!mobileActionEvent.arrivalReservation) return;
            setMobileActionState({ mode: "actions", reservationId: mobileActionEvent.arrivalReservation.id });
          }}
          onSelectDeparture={() => {
            if (!mobileActionEvent.departureReservation) return;
            setMobileActionState({ mode: "actions", reservationId: mobileActionEvent.departureReservation.id });
          }}
          arrivalLabel={`Arrivée · ${getReservationGuestName(mobileActionEvent.arrivalReservation)}`}
          departureLabel={`Départ · ${getReservationGuestName(mobileActionEvent.departureReservation)}`}
        />
      ) : null}

      {usesViewportScroll && mobileActionReservation ? (
        <MobileReservationActionsBar
          open
          title={getReservationGuestName(mobileActionReservation)}
          subtitle={`${formatShortDate(mobileActionReservation.date_entree)} → ${formatShortDate(mobileActionReservation.date_sortie)}`}
          details={[
            { label: "Durée", value: formatStayNights(mobileActionReservation.nb_nuits) },
            { label: "Total", value: formatEuro(mobileActionReservation.prix_total) },
          ]}
          onClose={() => setMobileActionState(null)}
          onEdit={() => navigate(buildMobileReservationEditorHref(mobileActionReservation.id))}
          phoneHref={buildTelephoneHref(mobileActionReservation.telephone)}
          smsHref={buildSmsHref(mobileActionReservation.telephone ?? "")}
          airbnbUrl={mobileActionReservation.airbnb_url}
        />
      ) : null}

      <MobileReservationSheet
        open={usesViewportScroll && quickReservationOpen}
        mode="edit"
        saving={quickReservationSaving}
        saved={quickReservationSaved}
        title={quickReservationSelectedGite?.nom ?? "Réservation"}
        error={quickReservationError}
        errorField={quickReservationErrorField}
        savedMessage={quickReservationSaved ? "Réservation enregistrée" : null}
        draft={quickReservationDraft}
        dateSummary={quickReservationDateSummary}
        computedTotal={quickReservationComputedTotal}
        adultOptions={quickReservationAdultOptions}
        nightlySuggestions={quickReservationNightlySuggestions}
        sourceOptions={RESERVATION_SOURCES}
        optionCountMax={quickReservationOptionCountMax}
        optionPreview={quickReservationOptionsPreview}
        gitePricing={{
          menage: Number(quickReservationSelectedGite?.options_menage_forfait ?? 0),
          draps: Number(quickReservationSelectedGite?.options_draps_par_lit ?? 0),
          serviettes: Number(quickReservationSelectedGite?.options_linge_toilette_par_personne ?? 0),
        }}
        smsSnippets={quickReservationSmsSnippets}
        smsSelection={quickReservationSmsSelection}
        smsText={quickReservationSmsText}
        smsHref={quickReservationSmsHref}
        primaryActionLabel={quickReservationSaved ? "Envoyer le SMS" : quickReservationSaving ? "Enregistrement..." : "Mettre à jour"}
        primaryActionDisabled={quickReservationSaving || (quickReservationSaved && !quickReservationSmsHref)}
        onRequestClose={closeQuickReservationSheet}
        onPrimaryAction={handleQuickReservationPrimaryAction}
        onFieldChange={handleQuickReservationFieldChange}
        onSmsSelectionChange={(snippetId, checked) =>
          setQuickReservationSmsSelection((current) =>
            checked ? [...current, snippetId] : current.filter((item) => item !== snippetId)
          )
        }
        formatShortDate={formatShortDate}
      />
    </div>
  );
};

export default TodayPage;

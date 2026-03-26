import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { apiFetch, isApiError } from "../utils/api";
import {
  buildAirbnbCalendarRefreshAppNotice,
  handleAirbnbCalendarRefreshFailure,
  waitForAirbnbCalendarRefreshJob,
  type AirbnbCalendarRefreshCreateStatus,
} from "../utils/airbnbCalendarRefresh";
import { dispatchAppNotice } from "../utils/appNotices";
import { formatEuro } from "../utils/format";
import { getGiteColor } from "../utils/giteColors";
import {
  DEFAULT_PAYMENT_SOURCE_COLORS,
  buildPaymentColorMap,
  getPaymentColorFromMap,
  getPaymentTextColorFromMap,
} from "../utils/paymentColors";
import {
  areReservationOptionsAllDeclared,
  buildQuickReservationOptions,
  computeReservationOptionsPreview,
  mergeReservationOptions,
  toNonNegativeInt,
} from "../utils/reservationOptions";
import { buildSmsHref, buildTelephoneHref } from "../utils/sms";
import MobileReservationActionsBar from "./shared/MobileReservationActionsBar";
import type { Gite, Reservation } from "../utils/types";

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
] as const;

const WEEKDAYS = [
  { full: "lun.", short: "L" },
  { full: "mar.", short: "M" },
  { full: "mer.", short: "M" },
  { full: "jeu.", short: "J" },
  { full: "ven.", short: "V" },
  { full: "sam.", short: "S" },
  { full: "dim.", short: "D" },
] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const MOBILE_CALENDAR_BREAKPOINT = 760;
const DEFAULT_MONTH_SCROLL_OFFSET = 104;
const DEFAULT_DAY_SCROLL_OFFSET = 76;
const DEFAULT_MOBILE_TOPBAR_OFFSET = 56;
const RENDERED_MONTH_RADIUS = 2;

type CalendarDay = {
  isoDate: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isOccupied: boolean;
  isConnectedToPrevious: boolean;
  isConnectedToNext: boolean;
};

type CalendarWeekSegment = {
  id: string;
  startColumn: number;
  endColumn: number;
  label: string;
  showLabel: boolean;
  isPast: boolean;
  continuesFromPreviousWeek: boolean;
  continuesToNextWeek: boolean;
  reservation: Reservation;
};

type CalendarWeek = {
  index: number;
  days: CalendarDay[];
  segments: CalendarWeekSegment[];
};

type CalendarMonthData = {
  index: number;
  monthNumber: number;
  title: string;
  subtitle: string;
  daysInMonth: number;
  reservations: Reservation[];
  weeks: CalendarWeek[];
  occupiedNights: number;
  occupancyRate: number;
};

type HoveredReservationState = {
  reservationId: string;
  monthIndex: number;
  weekIndex: number;
  segmentKey: string;
} | null;

type SelectedDateRange = {
  monthIndex: number;
  startIso: string;
  endIso: string;
} | null;

type SourceColorSettings = {
  colors: Record<string, string>;
};

type PendingCalendarScrollTarget =
  | { kind: "month"; value: number }
  | { kind: "date"; value: string };

type FloatingPopoverLayout = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
} | null;

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

type ReservationCreateResponse = Reservation & {
  created_reservations?: Reservation[];
  airbnb_calendar_refresh?: AirbnbCalendarRefreshCreateStatus;
};

type QuickReservationSmsSnippet = {
  id: string;
  title: string;
  text: string;
};

type QuickReservationSmsSettings = {
  texts: QuickReservationSmsSnippet[];
};

type QuickReservationMode = "create" | "edit";

const normalizeIsoDate = (value: string) => value.slice(0, 10);
const round2 = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const parseIsoDate = (value: string) => {
  const normalized = normalizeIsoDate(value);
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * DAY_MS);

const getGiteNightlyPriceSuggestions = (gite: Gite | null) => {
  const seen = new Set<number>();
  const suggestions: number[] = [];
  const rawList = Array.isArray(gite?.prix_nuit_liste) ? gite.prix_nuit_liste : [];

  rawList.forEach((item) => {
    const nextValue = round2(Math.max(0, Number(item)));
    if (!Number.isFinite(nextValue) || seen.has(nextValue)) return;
    seen.add(nextValue);
    suggestions.push(nextValue);
  });

  return suggestions;
};

const haveSharedReservationId = (leftIds: string[] | undefined, rightIds: string[] | undefined) => {
  if (!leftIds?.length || !rightIds?.length) return false;
  return leftIds.some((id) => rightIds.includes(id));
};

const formatShortDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

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

const interpolateQuickReservationSmsSnippet = (
  template: string,
  values: Record<string, string>
) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

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

const isIsoDateString = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());

const parseOptionalIsoDate = (value: string) => (isIsoDateString(value) ? parseIsoDate(value) : null);

const overlapsRange = (reservation: Reservation, from: Date, to: Date) =>
  parseIsoDate(reservation.date_entree) < to && parseIsoDate(reservation.date_sortie) > from;

const getReservationOverlapNights = (reservation: Reservation, from: Date, to: Date) => {
  const entry = parseIsoDate(reservation.date_entree);
  const exit = parseIsoDate(reservation.date_sortie);
  const overlapStart = Math.max(entry.getTime(), from.getTime());
  const overlapEnd = Math.min(exit.getTime(), to.getTime());
  return overlapEnd > overlapStart ? Math.round((overlapEnd - overlapStart) / DAY_MS) : 0;
};

const getReservationDisplayLabel = (reservation: Reservation) => reservation.hote_nom.trim() || reservation.hote_nom;

const hexToRgba = (hex: string, alpha: number) => {
  const sanitized = hex.replace("#", "");
  const normalized =
    sanitized.length === 3
      ? sanitized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : sanitized;

  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return `rgba(255, 90, 95, ${alpha})`;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getContainerScrollTargetTop = (container: HTMLElement, target: HTMLElement, offset: number) =>
  Math.max(target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - offset, 0);

const getViewportScrollTop = () => window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

const getViewportScrollTargetTop = (target: HTMLElement, offset: number) =>
  Math.max(target.getBoundingClientRect().top + getViewportScrollTop() - offset, 0);

const getCalendarMonthHeaderHeight = (target: HTMLElement) => {
  const monthSection = target.closest(".calendar-month-section");
  if (!(monthSection instanceof HTMLElement)) return 0;

  const header = monthSection.querySelector(".calendar-month-section__header");
  return header instanceof HTMLElement ? Math.round(header.getBoundingClientRect().height) : 0;
};

const buildCalendarMonthData = ({
  year,
  monthIndex,
  reservations,
  todayDate,
  todayIso,
}: {
  year: number;
  monthIndex: number;
  reservations: Reservation[];
  todayDate: Date;
  todayIso: string;
}): CalendarMonthData => {
  const monthNumber = monthIndex + 1;
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const leadingEmptyDays = (monthStart.getUTCDay() + 6) % 7;
  const gridStart = addUtcDays(monthStart, -leadingEmptyDays);
  const monthReservations = reservations.filter((reservation) => overlapsRange(reservation, monthStart, monthEnd));

  const reservationIdsByDay = new Map<string, string[]>();
  for (const reservation of monthReservations) {
    const start = new Date(Math.max(parseIsoDate(reservation.date_entree).getTime(), monthStart.getTime()));
    const end = new Date(Math.min(parseIsoDate(reservation.date_sortie).getTime(), monthEnd.getTime()));

    for (let cursor = start; cursor < end; cursor = addUtcDays(cursor, 1)) {
      const isoDate = toIsoDate(cursor);
      const ids = reservationIdsByDay.get(isoDate);
      if (ids) ids.push(reservation.id);
      else reservationIdsByDay.set(isoDate, [reservation.id]);
    }
  }

  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = addUtcDays(gridStart, index);
    const isoDate = toIsoDate(date);
    const isCurrentMonth = date.getUTCMonth() === monthStart.getUTCMonth();
    const currentReservationIds = reservationIdsByDay.get(isoDate);
    const isOccupied = (currentReservationIds?.length ?? 0) > 0;
    const previousDate = index % 7 === 0 ? null : addUtcDays(date, -1);
    const nextDate = index % 7 === 6 ? null : addUtcDays(date, 1);
    const previousReservationIds = previousDate ? reservationIdsByDay.get(toIsoDate(previousDate)) : undefined;
    const nextReservationIds = nextDate ? reservationIdsByDay.get(toIsoDate(nextDate)) : undefined;
    const isConnectedToPrevious =
      isCurrentMonth &&
      isOccupied &&
      previousDate !== null &&
      previousDate.getUTCMonth() === monthStart.getUTCMonth() &&
      haveSharedReservationId(currentReservationIds, previousReservationIds);
    const isConnectedToNext =
      isCurrentMonth &&
      isOccupied &&
      nextDate !== null &&
      nextDate.getUTCMonth() === monthStart.getUTCMonth() &&
      haveSharedReservationId(currentReservationIds, nextReservationIds);

    return {
      isoDate,
      dayNumber: date.getUTCDate(),
      isCurrentMonth,
      isToday: isoDate === todayIso,
      isPast: date.getTime() < todayDate.getTime(),
      isOccupied,
      isConnectedToPrevious,
      isConnectedToNext,
    } satisfies CalendarDay;
  });

  const segmentsByWeek = new Map<number, CalendarWeekSegment[]>();
  for (const reservation of monthReservations) {
    const reservationStart = new Date(Math.max(parseIsoDate(reservation.date_entree).getTime(), monthStart.getTime()));
    const reservationEnd = new Date(Math.min(parseIsoDate(reservation.date_sortie).getTime(), monthEnd.getTime()));

    for (let cursor = reservationStart; cursor < reservationEnd; ) {
      const dayOffset = Math.floor((cursor.getTime() - gridStart.getTime()) / DAY_MS);
      const weekIndex = Math.floor(dayOffset / 7);
      const weekEnd = addUtcDays(gridStart, weekIndex * 7 + 7);
      const segmentEndExclusive = new Date(Math.min(reservationEnd.getTime(), weekEnd.getTime()));
      const segments = segmentsByWeek.get(weekIndex) ?? [];
      const segmentPoints = [cursor, segmentEndExclusive];

      for (let pointIndex = 0; pointIndex < segmentPoints.length - 1; pointIndex += 1) {
        const partStart = segmentPoints[pointIndex];
        const partEndExclusive = segmentPoints[pointIndex + 1];
        const segmentLastDay = addUtcDays(partEndExclusive, -1);
        const startColumn = (Math.floor((partStart.getTime() - gridStart.getTime()) / DAY_MS) % 7) + 1;
        const endColumn = (Math.floor((segmentLastDay.getTime() - gridStart.getTime()) / DAY_MS) % 7) + 1;

        segments.push({
          id: reservation.id,
          startColumn,
          endColumn,
          label: getReservationDisplayLabel(reservation),
          showLabel: partStart.getTime() === reservationStart.getTime() || (pointIndex === 0 && cursor.getTime() > reservationStart.getTime()),
          isPast: partEndExclusive.getTime() <= todayDate.getTime(),
          continuesFromPreviousWeek: partStart.getTime() > reservationStart.getTime(),
          continuesToNextWeek: partEndExclusive.getTime() < reservationEnd.getTime(),
          reservation,
        });
      }

      segmentsByWeek.set(weekIndex, segments);
      cursor = segmentEndExclusive;
    }
  }

  const weeks = Array.from({ length: 6 }, (_, index) => ({
    index,
    days: calendarDays.slice(index * 7, index * 7 + 7),
    segments: segmentsByWeek.get(index) ?? [],
  }));

  const occupiedNights = monthReservations.reduce((sum, reservation) => sum + getReservationOverlapNights(reservation, monthStart, monthEnd), 0);
  const occupancyRate = daysInMonth > 0 ? occupiedNights / daysInMonth : 0;

  return {
    index: monthIndex,
    monthNumber,
    title: `${MONTHS[monthIndex]} ${year}`,
    subtitle: MONTHS[monthIndex],
    daysInMonth,
    reservations: monthReservations,
    weeks,
    occupiedNights,
    occupancyRate,
  };
};

const CalendrierPage = () => {
  const now = new Date();
  const navigate = useNavigate();
  const currentYear = now.getUTCFullYear();
  const currentMonthIndex = now.getUTCMonth();
  const todayIso = toIsoDate(new Date(Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate())));

  const [gites, setGites] = useState<Gite[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedGiteId, setSelectedGiteId] = useState("");
  const [sourceColors, setSourceColors] = useState<Record<string, string>>(DEFAULT_PAYMENT_SOURCE_COLORS);
  const [year, setYear] = useState(currentYear);
  const [activeMonthIndex, setActiveMonthIndex] = useState(currentMonthIndex);
  const [hoveredReservation, setHoveredReservation] = useState<HoveredReservationState>(null);
  const [floatingPopoverLayout, setFloatingPopoverLayout] = useState<FloatingPopoverLayout>(null);
  const [selectedDateRange, setSelectedDateRange] = useState<SelectedDateRange>(null);
  const [quickReservationDraft, setQuickReservationDraft] = useState<QuickReservationDraft | null>(null);
  const [quickReservationOpen, setQuickReservationOpen] = useState(false);
  const [quickReservationMode, setQuickReservationMode] = useState<QuickReservationMode>("create");
  const [quickReservationEditingId, setQuickReservationEditingId] = useState<string | null>(null);
  const [quickReservationSmsSelection, setQuickReservationSmsSelection] = useState<string[]>([]);
  const [quickReservationSmsSnippets, setQuickReservationSmsSnippets] = useState<QuickReservationSmsSnippet[]>(
    DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS
  );
  const [quickReservationSaving, setQuickReservationSaving] = useState(false);
  const [quickReservationError, setQuickReservationError] = useState<string | null>(null);
  const [mobileActionReservationId, setMobileActionReservationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usesViewportScroll, setUsesViewportScroll] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-width: ${MOBILE_CALENDAR_BREAKPOINT}px)`).matches
      : false
  );
  const [viewportStickyOffsets, setViewportStickyOffsets] = useState({
    topbar: DEFAULT_MOBILE_TOPBAR_OFFSET,
    hero: 0,
  });

  const heroRef = useRef<HTMLElement | null>(null);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const weekdaysRef = useRef<HTMLDivElement | null>(null);
  const monthSectionRefs = useRef<Record<number, HTMLElement | null>>({});
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingScrollTargetRef = useRef<PendingCalendarScrollTarget | null>({
    kind: "date",
    value: todayIso,
  });
  const airbnbCalendarRefreshControllersRef = useRef<AbortController[]>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [gitesData, reservationsData, sourceColorSettings, smsTextSettings] = await Promise.all([
        apiFetch<Gite[]>("/gites"),
        apiFetch<Reservation[]>("/reservations"),
        apiFetch<SourceColorSettings>("/settings/source-colors"),
        apiFetch<QuickReservationSmsSettings>("/settings/sms-texts"),
      ]);

      setGites(gitesData);
      setReservations(reservationsData);
      setSourceColors(sourceColorSettings.colors ?? DEFAULT_PAYMENT_SOURCE_COLORS);
      setQuickReservationSmsSnippets(
        Array.isArray(smsTextSettings.texts) && smsTextSettings.texts.length > 0
          ? smsTextSettings.texts
          : DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS
      );
      setSelectedGiteId((previous) => previous || gitesData[0]?.id || "");
    } catch (err) {
      if (isApiError(err)) setError(err.message);
      else setError("Impossible de charger le calendrier.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    return () => {
      airbnbCalendarRefreshControllersRef.current.forEach((controller) => controller.abort());
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_CALENDAR_BREAKPOINT}px)`);
    const updateScrollMode = (matches: boolean) => {
      setUsesViewportScroll((current) => (current === matches ? current : matches));
    };

    updateScrollMode(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      updateScrollMode(event.matches);
    };

    const mediaQueryWithLegacyApi = mediaQuery as MediaQueryList & {
      addListener?: (callback: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (callback: (event: MediaQueryListEvent) => void) => void;
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQueryWithLegacyApi.addListener?.(handleChange);
    }

    return () => {
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.removeEventListener("change", handleChange);
        return;
      }
      mediaQueryWithLegacyApi.removeListener?.(handleChange);
    };
  }, []);

  useEffect(() => {
    const heroNode = heroRef.current;
    const topbarNode = document.querySelector(".topbar");
    if (!heroNode) return;

    const updateStickyOffsets = () => {
      const nextTopbar = Math.round(topbarNode?.getBoundingClientRect().height ?? DEFAULT_MOBILE_TOPBAR_OFFSET);
      const nextHero = Math.round(heroNode.getBoundingClientRect().height);

      setViewportStickyOffsets((current) => {
        if (current.topbar === nextTopbar && current.hero === nextHero) {
          return current;
        }

        return {
          topbar: nextTopbar,
          hero: nextHero,
        };
      });
    };

    updateStickyOffsets();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateStickyOffsets, { passive: true });

      return () => {
        window.removeEventListener("resize", updateStickyOffsets);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateStickyOffsets();
    });

    resizeObserver.observe(heroNode);
    if (topbarNode instanceof HTMLElement) {
      resizeObserver.observe(topbarNode);
    }
    window.addEventListener("resize", updateStickyOffsets, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateStickyOffsets);
    };
  }, []);

  useEffect(() => {
    if (!gites.length) {
      if (selectedGiteId) setSelectedGiteId("");
      return;
    }

    if (!gites.some((gite) => gite.id === selectedGiteId)) {
      setSelectedGiteId(gites[0]?.id ?? "");
    }
  }, [gites, selectedGiteId]);

  useEffect(() => {
    setHoveredReservation(null);
    setSelectedDateRange(null);
    setMobileActionReservationId(null);
  }, [selectedGiteId, year]);

  useEffect(() => {
    if (quickReservationOpen) {
      setMobileActionReservationId(null);
    }
  }, [quickReservationOpen]);

  useEffect(() => {
    if (selectedDateRange || quickReservationMode === "edit") return;
    setQuickReservationOpen(false);
    setQuickReservationDraft(null);
    setQuickReservationEditingId(null);
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
  }, [quickReservationMode, selectedDateRange]);

  useEffect(() => {
    if (!quickReservationOpen || !usesViewportScroll) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !quickReservationSaving) {
        setQuickReservationOpen(false);
        setQuickReservationDraft(null);
        setQuickReservationMode("create");
        setQuickReservationEditingId(null);
        setQuickReservationSmsSelection([]);
        setQuickReservationError(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [quickReservationOpen, quickReservationSaving, usesViewportScroll]);

  const selectedGite = useMemo(() => gites.find((gite) => gite.id === selectedGiteId) ?? null, [gites, selectedGiteId]);
  const paymentColorMap = useMemo(() => buildPaymentColorMap(sourceColors), [sourceColors]);
  const accentColor = selectedGite ? getGiteColor(selectedGite) : "#ff5a5f";
  const todayDate = useMemo(() => parseIsoDate(todayIso), [todayIso]);
  const selectedRangeExitIso = useMemo(
    () => (selectedDateRange ? toIsoDate(addUtcDays(parseIsoDate(selectedDateRange.endIso), 1)) : ""),
    [selectedDateRange]
  );
  const selectedRangeNights = useMemo(() => {
    if (!selectedDateRange || !selectedRangeExitIso) return 0;
    return Math.round((parseIsoDate(selectedRangeExitIso).getTime() - parseIsoDate(selectedDateRange.startIso).getTime()) / DAY_MS);
  }, [selectedDateRange, selectedRangeExitIso]);
  const selectedRangeSummary = useMemo(() => {
    if (!selectedDateRange || !selectedRangeExitIso) return "";
    return `${formatLongDate(selectedDateRange.startIso)} → ${formatLongDate(selectedRangeExitIso)}`;
  }, [selectedDateRange, selectedRangeExitIso]);
  const quickReservationNightlySuggestions = useMemo(() => getGiteNightlyPriceSuggestions(selectedGite), [selectedGite]);
  const quickReservationSuggestedNightly = quickReservationNightlySuggestions[0] ?? 0;
  const quickReservationAdultsMax = useMemo(() => getQuickReservationAdultsMax(selectedGite), [selectedGite]);
  const quickReservationAdultOptions = useMemo(
    () => Array.from({ length: quickReservationAdultsMax }, (_, index) => index + 1),
    [quickReservationAdultsMax]
  );
  const quickReservationOptionCountMax = useMemo(() => getQuickReservationOptionCountMax(selectedGite), [selectedGite]);
  const canUseQuickReservation = usesViewportScroll && Boolean(selectedDateRange && selectedGiteId);
  const quickReservationEditingReservation = useMemo(
    () => (quickReservationEditingId ? reservations.find((reservation) => reservation.id === quickReservationEditingId) ?? null : null),
    [quickReservationEditingId, reservations]
  );
  const pageStyle = useMemo(
    () =>
      ({
        "--calendar-accent": accentColor,
        "--calendar-accent-soft": hexToRgba(accentColor, 0.12),
        "--calendar-accent-strong": hexToRgba(accentColor, 0.24),
        "--calendar-mobile-topbar-offset": `${viewportStickyOffsets.topbar}px`,
        "--calendar-mobile-sticky-offset": `${viewportStickyOffsets.topbar + viewportStickyOffsets.hero}px`,
      }) as CSSProperties,
    [accentColor, viewportStickyOffsets.hero, viewportStickyOffsets.topbar]
  );

  const reservationsForGite = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.gite_id === selectedGiteId)
        .sort((left, right) => parseIsoDate(left.date_entree).getTime() - parseIsoDate(right.date_entree).getTime()),
    [reservations, selectedGiteId]
  );

  const mobileActionReservation = useMemo(
    () => (mobileActionReservationId ? reservationsForGite.find((reservation) => reservation.id === mobileActionReservationId) ?? null : null),
    [mobileActionReservationId, reservationsForGite]
  );

  const calendarMonths = useMemo(
    () =>
      MONTHS.map((_, monthIndex) =>
        buildCalendarMonthData({
          year,
          monthIndex,
          reservations: reservationsForGite,
          todayDate,
          todayIso,
        })
      ),
    [reservationsForGite, todayDate, todayIso, year]
  );

  const visibleMonth = calendarMonths[activeMonthIndex] ?? calendarMonths[0] ?? null;
  const renderedMonthIndexes = useMemo(() => {
    const indexes = new Set<number>();
    for (let index = Math.max(0, activeMonthIndex - RENDERED_MONTH_RADIUS); index <= Math.min(11, activeMonthIndex + RENDERED_MONTH_RADIUS); index += 1) {
      indexes.add(index);
    }
    return indexes;
  }, [activeMonthIndex]);

  const hoveredReservationDetails = useMemo(() => {
    if (!hoveredReservation) return null;
    const reservation = reservationsForGite.find((item) => item.id === hoveredReservation.reservationId) ?? null;
    if (!reservation) return null;
    return {
      reservation,
      month: calendarMonths[hoveredReservation.monthIndex] ?? null,
    };
  }, [calendarMonths, hoveredReservation, reservationsForGite]);

  useEffect(() => {
    if (mobileActionReservationId && !mobileActionReservation) {
      setMobileActionReservationId(null);
    }
  }, [mobileActionReservation, mobileActionReservationId]);

  const selectableDateSetsByMonth = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const monthData of calendarMonths) {
      const selectableDates = new Set<string>();
      monthData.weeks.forEach((week) => {
        week.days.forEach((day) => {
          if (day.isCurrentMonth && !day.isOccupied && !day.isPast) {
            selectableDates.add(day.isoDate);
          }
        });
      });
      map.set(monthData.index, selectableDates);
    }
    return map;
  }, [calendarMonths]);

  const isSelectableDateRange = useCallback(
    (monthIndex: number, startIso: string, endIso: string) => {
      const selectableDates = selectableDateSetsByMonth.get(monthIndex);
      if (!selectableDates?.size) return false;

      for (let cursor = parseIsoDate(startIso); cursor.getTime() <= parseIsoDate(endIso).getTime(); cursor = addUtcDays(cursor, 1)) {
        if (!selectableDates.has(toIsoDate(cursor))) return false;
      }

      return true;
    },
    [selectableDateSetsByMonth]
  );

  const toggleDateSelection = useCallback(
    (monthIndex: number, isoDate: string) => {
      const selectableDates = selectableDateSetsByMonth.get(monthIndex);
      if (!selectableDates?.has(isoDate)) return;

      setSelectedDateRange((current) => {
        if (!current || current.monthIndex !== monthIndex) {
          return { monthIndex, startIso: isoDate, endIso: isoDate };
        }

        if (current.startIso === isoDate && current.endIso === isoDate) {
          return null;
        }

        if (isoDate >= current.startIso && isoDate <= current.endIso) {
          return { monthIndex, startIso: isoDate, endIso: isoDate };
        }

        const nextStartIso = isoDate < current.startIso ? isoDate : current.startIso;
        const nextEndIso = isoDate > current.endIso ? isoDate : current.endIso;

        if (!isSelectableDateRange(monthIndex, nextStartIso, nextEndIso)) {
          return { monthIndex, startIso: isoDate, endIso: isoDate };
        }

        return {
          monthIndex,
          startIso: nextStartIso,
          endIso: nextEndIso,
        };
      });
    },
    [isSelectableDateRange, selectableDateSetsByMonth]
  );

  const buildQuickReservationDraft = useCallback((): QuickReservationDraft | null => {
    if (!selectedDateRange || !selectedGiteId) return null;

    const defaultAdults = Math.max(1, selectedGite?.nb_adultes_habituel ?? 2);

    return {
      hote_nom: "",
      telephone: "",
      date_entree: selectedDateRange.startIso,
      date_sortie: toIsoDate(addUtcDays(parseIsoDate(selectedDateRange.endIso), 1)),
      nb_adultes: clampQuickReservationAdults(defaultAdults, selectedGite),
      prix_par_nuit: quickReservationSuggestedNightly > 0 ? String(quickReservationSuggestedNightly) : "",
      source_paiement: DEFAULT_RESERVATION_SOURCE,
      commentaire: "",
      option_menage: false,
      option_draps: 0,
      option_serviettes: 0,
    };
  }, [quickReservationSuggestedNightly, selectedDateRange, selectedGite, selectedGiteId]);

  const buildQuickReservationDraftFromReservation = useCallback(
    (reservation: Reservation): QuickReservationDraft => ({
      hote_nom: reservation.hote_nom,
      telephone: formatQuickReservationPhone(reservation.telephone ?? ""),
      date_entree: normalizeIsoDate(reservation.date_entree),
      date_sortie: normalizeIsoDate(reservation.date_sortie),
      nb_adultes: clampQuickReservationAdults(reservation.nb_adultes, selectedGite),
      prix_par_nuit: String(reservation.prix_par_nuit ?? ""),
      source_paiement: reservation.source_paiement?.trim() || DEFAULT_RESERVATION_SOURCE,
      commentaire: reservation.commentaire ?? "",
      option_menage: Boolean(reservation.options?.menage?.enabled),
      option_draps: reservation.options?.draps?.enabled
        ? clampQuickReservationOptionCount(
            toNonNegativeInt(reservation.options?.draps?.nb_lits, Math.max(1, reservation.nb_adultes || 1)),
            selectedGite
          )
        : 0,
      option_serviettes: reservation.options?.linge_toilette?.enabled
        ? clampQuickReservationOptionCount(
            toNonNegativeInt(reservation.options?.linge_toilette?.nb_personnes, Math.max(1, reservation.nb_adultes || 1)),
            selectedGite
          )
        : 0,
    }),
    [selectedGite]
  );

  const closeQuickReservationSheet = useCallback(() => {
    setQuickReservationOpen(false);
    setQuickReservationDraft(null);
    setQuickReservationMode("create");
    setQuickReservationEditingId(null);
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
  }, []);

  const openReservationInsertFromSelection = useCallback(
    (monthNumber: number) => {
      if (!selectedDateRange || !selectedGiteId) return;

      const params = new URLSearchParams();
      params.set("create", "1");
      params.set("entry", selectedDateRange.startIso);
      params.set("exit", toIsoDate(addUtcDays(parseIsoDate(selectedDateRange.endIso), 1)));
      params.set("year", String(year));
      params.set("month", String(monthNumber));
      params.set("tab", selectedGiteId);
      navigate(`/reservations?${params.toString()}`);
    },
    [navigate, selectedDateRange, selectedGiteId, year]
  );

  const openReservationInListing = useCallback(
    (reservation: Reservation, options?: { monthNumber?: number; year?: number }) => {
      const params = new URLSearchParams();
      const reservationStartDate = parseIsoDate(reservation.date_entree);
      params.set("focus", reservation.id);
      params.set("year", String(options?.year ?? reservationStartDate.getUTCFullYear()));
      if (reservation.gite_id) {
        params.set("tab", reservation.gite_id);
      }
      navigate(`/reservations?${params.toString()}#reservation-${reservation.id}`);
    },
    [navigate]
  );

  const openQuickReservationSheet = useCallback(() => {
    const nextDraft = buildQuickReservationDraft();
    if (!nextDraft) return;
    setQuickReservationMode("create");
    setQuickReservationEditingId(null);
    setQuickReservationDraft(nextDraft);
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
    setQuickReservationOpen(true);
  }, [buildQuickReservationDraft]);

  const openQuickReservationEditSheet = useCallback(
    (reservation: Reservation) => {
      if (!usesViewportScroll) return;

      setMobileActionReservationId(null);
      setQuickReservationMode("edit");
      setQuickReservationEditingId(reservation.id);
      setQuickReservationDraft(buildQuickReservationDraftFromReservation(reservation));
      setQuickReservationSmsSelection([]);
      setQuickReservationError(null);
      setSelectedDateRange(null);
      setQuickReservationOpen(true);
    },
    [buildQuickReservationDraftFromReservation, usesViewportScroll]
  );

  const handleReservationOpen = useCallback(
    (reservation: Reservation, options?: { monthNumber?: number; year?: number }) => {
      if (usesViewportScroll) {
        setSelectedDateRange(null);
        setQuickReservationOpen(false);
        setQuickReservationDraft(null);
        setQuickReservationMode("create");
        setQuickReservationEditingId(null);
        setQuickReservationSmsSelection([]);
        setQuickReservationError(null);
        setMobileActionReservationId((current) => (current === reservation.id ? null : reservation.id));
        return;
      }

      openReservationInListing(reservation, options);
    },
    [openReservationInListing, usesViewportScroll]
  );

  const handleReservationInsertFromSelection = useCallback(
    (monthNumber: number) => {
      if (usesViewportScroll) {
        openQuickReservationSheet();
        return;
      }

      openReservationInsertFromSelection(monthNumber);
    },
    [openQuickReservationSheet, openReservationInsertFromSelection, usesViewportScroll]
  );

  const handleQuickReservationFieldChange = useCallback(
    (field: keyof QuickReservationDraft, value: string | number | boolean) => {
      setQuickReservationDraft((current) => {
        if (!current) return current;
        if (field === "telephone") {
          return { ...current, telephone: formatQuickReservationPhone(String(value)) };
        }
        if (field === "nb_adultes") {
          return { ...current, nb_adultes: clampQuickReservationAdults(Number(value), selectedGite) };
        }
        if (field === "option_draps" || field === "option_serviettes") {
          return { ...current, [field]: clampQuickReservationOptionCount(Number(value), selectedGite) };
        }
        if (field === "option_menage") {
          return { ...current, option_menage: Boolean(value) };
        }
        return { ...current, [field]: value };
      });
    },
    [selectedGite]
  );

  const saveQuickReservation = useCallback(async () => {
    if (!selectedGiteId || !quickReservationDraft || quickReservationSaving) return;

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
      gite: selectedGite,
    });
    const quickOptionsDeclared = areReservationOptionsAllDeclared(quickOptions);

    if (!hostName) {
      setQuickReservationError("Renseigne le nom de l'hôte.");
      return;
    }

    if (!entryDate || !exitDate) {
      setQuickReservationError("Renseigne des dates valides.");
      return;
    }

    if (exitDate.getTime() <= entryDate.getTime()) {
      setQuickReservationError("La date de sortie doit être postérieure à la date d'entrée.");
      return;
    }

    if (!Number.isFinite(nightly) || nightly < 0) {
      setQuickReservationError("Renseigne un prix par nuit valide.");
      return;
    }

    setQuickReservationSaving(true);
    setQuickReservationError(null);

    try {
      if (quickReservationMode === "edit") {
        const existingReservation = quickReservationEditingReservation;
        if (!existingReservation) {
          setQuickReservationError("Réservation introuvable.");
          return;
        }

        await apiFetch<Reservation>(`/reservations/${existingReservation.id}`, {
          method: "PUT",
          json: {
            gite_id: existingReservation.gite_id ?? selectedGiteId,
            placeholder_id: existingReservation.placeholder_id ?? undefined,
            airbnb_url: existingReservation.airbnb_url ?? undefined,
            hote_nom: hostName,
            telephone: quickReservationDraft.telephone.trim() || undefined,
            date_entree: quickReservationDraft.date_entree,
            date_sortie: quickReservationDraft.date_sortie,
            nb_adultes: adults,
            prix_par_nuit: round2(nightly),
            price_driver: "nightly",
            source_paiement: quickReservationDraft.source_paiement || DEFAULT_RESERVATION_SOURCE,
            commentaire: quickReservationDraft.commentaire.trim() || undefined,
            remise_montant: existingReservation.remise_montant ?? 0,
            commission_channel_mode: existingReservation.commission_channel_mode ?? "euro",
            commission_channel_value: existingReservation.commission_channel_value ?? 0,
            frais_optionnels_montant: quickOptionsPreview.total,
            frais_optionnels_libelle: quickOptionsPreview.label || undefined,
            frais_optionnels_declares: quickOptionsDeclared,
            options: quickOptions,
          },
        });
      } else {
        const created = await apiFetch<ReservationCreateResponse>("/reservations", {
          method: "POST",
          json: {
            gite_id: selectedGiteId,
            hote_nom: hostName,
            telephone: quickReservationDraft.telephone.trim() || undefined,
            date_entree: quickReservationDraft.date_entree,
            date_sortie: quickReservationDraft.date_sortie,
            nb_adultes: adults,
            prix_par_nuit: round2(nightly),
            price_driver: "nightly",
            source_paiement: quickReservationDraft.source_paiement || DEFAULT_RESERVATION_SOURCE,
            commentaire: quickReservationDraft.commentaire.trim() || undefined,
            frais_optionnels_montant: quickOptionsPreview.total,
            frais_optionnels_libelle: quickOptionsPreview.label || undefined,
            frais_optionnels_declares: quickOptionsDeclared,
            options: quickOptions,
          },
        });
        startAirbnbCalendarRefreshPolling(created.airbnb_calendar_refresh);
      }

      await loadData();
      closeQuickReservationSheet();
      if (quickReservationMode === "create") {
        setSelectedDateRange(null);
      }
    } catch (err) {
      if (isApiError(err)) {
        setQuickReservationError(err.message);
      } else {
        setQuickReservationError("Impossible d'enregistrer la réservation.");
      }
    } finally {
      setQuickReservationSaving(false);
    }
  }, [
    closeQuickReservationSheet,
    loadData,
    quickReservationDraft,
    quickReservationEditingReservation,
    quickReservationMode,
    quickReservationSaving,
    selectedGite,
    selectedGiteId,
    startAirbnbCalendarRefreshPolling,
  ]);

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
        gite: selectedGite,
      }),
    [quickReservationDateSummary.nights, quickReservationOptions, selectedGite]
  );
  const quickReservationBaseTotal = useMemo(() => {
    if (!quickReservationDraft) return null;
    const entryDate = parseOptionalIsoDate(quickReservationDraft.date_entree);
    const exitDate = parseOptionalIsoDate(quickReservationDraft.date_sortie);
    if (!entryDate || !exitDate) return null;
    const nightCount = Math.round((exitDate.getTime() - entryDate.getTime()) / DAY_MS);
    if (nightCount <= 0) return null;
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    if (!Number.isFinite(nightly) || nightly < 0) return null;
    return round2(nightly * nightCount);
  }, [quickReservationDraft]);
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
    if (!selectedGite || !quickReservationDraft) return "";

    const { startIso, exitIso, nights } = quickReservationDateSummary;
    if (!isIsoDateString(startIso) || !isIsoDateString(exitIso) || nights <= 0) return "";

    const startDate = formatLongDate(startIso);
    const endDate = formatLongDate(exitIso);
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    const address = [selectedGite.adresse_ligne1, selectedGite.adresse_ligne2].filter(Boolean).join(", ");
    const arrivalTime = formatQuickReservationSmsHour(selectedGite.heure_arrivee_defaut || "17:00");
    const departureTime = formatQuickReservationSmsHour(selectedGite.heure_depart_defaut || "12:00", { middayLabel: true });
    const snippetValues = {
      adresse: address,
      dateDebut: startDate,
      dateFin: endDate,
      heureArrivee: arrivalTime,
      heureDepart: departureTime,
      gite: selectedGite.nom,
      nbNuits: String(nights),
      nom: quickReservationDraft.hote_nom.trim(),
    };

    const baseLines = [
      "Bonjour,",
      `Je vous confirme votre réservation pour le gîte ${selectedGite.nom} du ${startDate} à partir de ${arrivalTime} au ${endDate} ${departureTime} (${nights} nuit${
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

    const selectedSnippets = quickReservationSmsSnippets.filter((snippet) => quickReservationSmsSelection.includes(snippet.id))
      .map((snippet) => interpolateQuickReservationSmsSnippet(snippet.text, snippetValues))
      .filter((snippet) => snippet.trim().length > 0);

    return [...baseLines, ...selectedSnippets, "Merci Beaucoup,", "Soazig Molinier"].join("\n");
  }, [
    quickReservationBaseTotal,
    quickReservationComputedTotal,
    quickReservationDateSummary,
    quickReservationDraft,
    quickReservationOptionSummary,
    quickReservationSmsSnippets,
    quickReservationSmsSelection,
    quickReservationOptionsPreview.total,
    selectedGite,
  ]);

  const quickReservationSmsHref = useMemo(() => {
    const phone = quickReservationDraft ? getQuickReservationSmsPhoneDigits(quickReservationDraft.telephone) : "";
    return buildSmsHref(phone, quickReservationSmsText);
  }, [quickReservationDraft, quickReservationSmsText]);

  const getScrollOffset = useCallback(
    (kind: "month" | "date") => {
      const stickyHeight = weekdaysRef.current?.getBoundingClientRect().height ?? 0;
      const viewportChromeOffset = usesViewportScroll ? viewportStickyOffsets.topbar + viewportStickyOffsets.hero : 0;
      if (stickyHeight <= 0) {
        return (kind === "month" ? DEFAULT_MONTH_SCROLL_OFFSET : DEFAULT_DAY_SCROLL_OFFSET) + viewportChromeOffset;
      }

      return viewportChromeOffset + stickyHeight + (kind === "month" ? 18 : 10);
    },
    [usesViewportScroll, viewportStickyOffsets.hero, viewportStickyOffsets.topbar]
  );

  const scrollToMonth = useCallback((monthIndex: number, behavior: ScrollBehavior = "smooth") => {
    const target = monthSectionRefs.current[monthIndex];
    if (!target) return false;

    const topOffset = getScrollOffset("month");

    if (usesViewportScroll) {
      window.scrollTo({
        top: getViewportScrollTargetTop(target, topOffset),
        behavior,
      });
    } else {
      const container = boardScrollRef.current;
      if (!container) return false;

      container.scrollTo({
        top: getContainerScrollTargetTop(container, target, topOffset),
        behavior,
      });
    }

    setActiveMonthIndex(monthIndex);
    return true;
  }, [getScrollOffset, usesViewportScroll]);

  const scrollToDate = useCallback(
    (isoDate: string, behavior: ScrollBehavior = "smooth") => {
      const target = dayRefs.current[isoDate];
      if (!target) return false;

      const monthHeaderOffset = usesViewportScroll ? getCalendarMonthHeaderHeight(target) + 8 : 0;
      const topOffset = getScrollOffset("date") + monthHeaderOffset;

      if (usesViewportScroll) {
        window.scrollTo({
          top: getViewportScrollTargetTop(target, topOffset),
          behavior,
        });
      } else {
        const container = boardScrollRef.current;
        if (!container) return false;

        container.scrollTo({
          top: getContainerScrollTargetTop(container, target, topOffset),
          behavior,
        });
      }

      setActiveMonthIndex(parseIsoDate(isoDate).getUTCMonth());
      return true;
    },
    [getScrollOffset, usesViewportScroll]
  );

  useEffect(() => {
    if (loading || !calendarMonths.length) return;
    if (pendingScrollTargetRef.current == null) return;

    let frameId = 0;

    const runPendingScroll = () => {
      const target = pendingScrollTargetRef.current;
      if (target == null) return;

      const didScroll = target.kind === "date" ? scrollToDate(target.value, "auto") : scrollToMonth(target.value, "auto");

      if (didScroll) {
        pendingScrollTargetRef.current = null;
        return;
      }

      frameId = window.requestAnimationFrame(runPendingScroll);
    };

    frameId = window.requestAnimationFrame(runPendingScroll);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [calendarMonths.length, loading, scrollToDate, scrollToMonth, year]);

  useEffect(() => {
    let frameId = 0;

    const updateVisibleMonth = () => {
      const currentTop = usesViewportScroll
        ? getViewportScrollTop() + getScrollOffset("month")
        : (() => {
            const container = boardScrollRef.current;
            if (!container) return 0;
            return container.scrollTop + getScrollOffset("month");
          })();
      let nextActiveMonthIndex = 0;

      for (const monthData of calendarMonths) {
        const section = monthSectionRefs.current[monthData.index];
        if (!section) continue;
        const sectionTop = usesViewportScroll ? getViewportScrollTargetTop(section, 0) : section.offsetTop;
        if (sectionTop <= currentTop) nextActiveMonthIndex = monthData.index;
        else break;
      }

      setActiveMonthIndex((current) => (current === nextActiveMonthIndex ? current : nextActiveMonthIndex));
    };

    const handleScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateVisibleMonth();
      });
    };

    updateVisibleMonth();
    const scrollTarget: Window | HTMLDivElement | null = usesViewportScroll ? window : boardScrollRef.current;
    if (!scrollTarget) return;

    scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      scrollTarget.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [calendarMonths, getScrollOffset, selectedGiteId, usesViewportScroll]);

  useEffect(() => {
    if (usesViewportScroll || !hoveredReservation?.segmentKey) {
      setFloatingPopoverLayout((current) => (current === null ? current : null));
      return;
    }

    let frameId = 0;

    const updateFloatingPopoverLayout = () => {
      const target = segmentRefs.current[hoveredReservation.segmentKey];
      if (!target || !target.isConnected) {
        setFloatingPopoverLayout((current) => (current === null ? current : null));
        return;
      }

      const rect = target.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const horizontalMargin = 12;
      const verticalMargin = 12;
      const gap = 12;
      const width = Math.min(320, Math.max(260, viewportWidth - horizontalMargin * 2));
      const maxLeft = Math.max(horizontalMargin, viewportWidth - width - horizontalMargin);
      const top = Math.max(verticalMargin, rect.bottom + gap);
      const left = clamp(rect.left, horizontalMargin, maxLeft);
      const maxHeight = Math.max(96, viewportHeight - top - verticalMargin);
      const isOffscreen = rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth;

      if (isOffscreen) {
        setFloatingPopoverLayout((current) => (current === null ? current : null));
        return;
      }

      setFloatingPopoverLayout((current) => {
        if (
          current &&
          current.top === top &&
          current.left === left &&
          current.width === width &&
          current.maxHeight === maxHeight
        ) {
          return current;
        }

        return {
          top,
          left,
          width,
          maxHeight,
        };
      });
    };

    const scheduleLayoutUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateFloatingPopoverLayout();
      });
    };

    updateFloatingPopoverLayout();

    const boardScrollNode = boardScrollRef.current;
    boardScrollNode?.addEventListener("scroll", scheduleLayoutUpdate, { passive: true });
    window.addEventListener("scroll", scheduleLayoutUpdate, { passive: true });
    window.addEventListener("resize", scheduleLayoutUpdate, { passive: true });

    return () => {
      boardScrollNode?.removeEventListener("scroll", scheduleLayoutUpdate);
      window.removeEventListener("scroll", scheduleLayoutUpdate);
      window.removeEventListener("resize", scheduleLayoutUpdate);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [hoveredReservation?.segmentKey, usesViewportScroll]);

  if (loading) {
    return (
      <div className="card">
        <div className="section-title">Calendrier</div>
        <p>Chargement du calendrier...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="section-title">Calendrier</div>
        <p>{error}</p>
      </div>
    );
  }

  if (!gites.length) {
    return (
      <div className="card">
        <div className="section-title">Calendrier</div>
        <p>Aucun gîte disponible.</p>
      </div>
    );
  }

  const hasMobileOverlay = usesViewportScroll && (canUseQuickReservation || Boolean(mobileActionReservation));

  return (
    <div
      className={`calendar-page${canUseQuickReservation ? " calendar-page--quick-create-visible" : ""}${
        hasMobileOverlay ? " calendar-page--mobile-overlay-visible" : ""
      }`}
      style={pageStyle}
    >
      <section ref={heroRef} className="card calendar-hero">
        <div className="calendar-hero__header">
          <label className="calendar-month-trigger">
            <span>{MONTHS[activeMonthIndex].toLocaleLowerCase("fr-FR")}</span>
            <select
              id="calendar-month-select"
              value={activeMonthIndex + 1}
              onChange={(event) => {
                const nextMonthIndex = Number(event.target.value) - 1;
                pendingScrollTargetRef.current = null;
                scrollToMonth(nextMonthIndex);
              }}
              aria-label="Sélection du mois"
            >
              {MONTHS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </label>

          <div className="calendar-hero__actions">
            <label className="calendar-pill-select">
              <span>Gîte</span>
              <select
                value={selectedGiteId}
                onChange={(event) => {
                  setSelectedGiteId(event.target.value);
                }}
              >
                {gites.map((gite) => (
                  <option key={gite.id} value={gite.id}>
                    {gite.nom}
                  </option>
                ))}
              </select>
            </label>

            <div className="calendar-year-switch" aria-label="Sélection de l'année">
              <button
                type="button"
                className="calendar-year-switch__button"
                onClick={() => {
                  pendingScrollTargetRef.current = { kind: "month", value: activeMonthIndex };
                  setYear((value) => value - 1);
                }}
                aria-label="Année précédente"
              >
                ‹
              </button>
              <strong>{year}</strong>
              <button
                type="button"
                className="calendar-year-switch__button"
                onClick={() => {
                  pendingScrollTargetRef.current = { kind: "month", value: activeMonthIndex };
                  setYear((value) => value + 1);
                }}
                aria-label="Année suivante"
              >
                ›
              </button>
            </div>

            <button
              type="button"
              className="calendar-today-button"
              onClick={() => {
                if (year === currentYear) {
                  pendingScrollTargetRef.current = null;
                  if (!scrollToDate(todayIso)) {
                    scrollToMonth(currentMonthIndex);
                  }
                } else {
                  pendingScrollTargetRef.current = { kind: "date", value: todayIso };
                  setYear(currentYear);
                }
                setHoveredReservation(null);
              }}
            >
              Aujourd&apos;hui
            </button>
          </div>
        </div>
      </section>

      <div className="calendar-layout">
        <section className="card calendar-board">
          <div ref={boardScrollRef} className="calendar-board__scroll">
            <div ref={weekdaysRef} className="calendar-weekdays" role="row">
              {WEEKDAYS.map((day) => (
                <div key={day.full} className="calendar-weekdays__item" role="columnheader" aria-label={day.full}>
                  <span className="calendar-weekdays__item-full">{day.full}</span>
                  <span className="calendar-weekdays__item-short" aria-hidden="true">
                    {day.short}
                  </span>
                </div>
              ))}
            </div>

            <div className="calendar-months">
              {calendarMonths.map((monthData) => {
                const shouldRenderSegments = renderedMonthIndexes.has(monthData.index);
                const selectedRangeForMonth =
                  selectedDateRange?.monthIndex === monthData.index ? selectedDateRange : null;

                return (
                  <section
                    key={`${year}-${monthData.monthNumber}`}
                    ref={(node) => {
                      monthSectionRefs.current[monthData.index] = node;
                    }}
                    className={`calendar-month-section${monthData.index === activeMonthIndex ? " calendar-month-section--active" : ""}`}
                    aria-label={monthData.title}
                  >
                    <header className="calendar-month-section__header">
                      <div>
                        <p className="calendar-month-section__eyebrow">{monthData.subtitle}</p>
                        <h2>{monthData.title}</h2>
                      </div>
                      <div className="calendar-month-section__summary">
                        <span>{monthData.reservations.length} séjour{monthData.reservations.length > 1 ? "s" : ""}</span>
                        <strong>{Math.round(monthData.occupancyRate * 100)}%</strong>
                      </div>
                    </header>

                    <div className="calendar-weeks">
                      {monthData.weeks.map((week) => (
                        <section
                          key={`${monthData.monthNumber}-${week.index}`}
                          className={`calendar-week${
                            hoveredReservation?.monthIndex === monthData.index && hoveredReservation.weekIndex === week.index
                              ? " calendar-week--overlay-active"
                              : ""
                          }`}
                          aria-label={`Semaine ${week.index + 1}`}
                        >
                          <div className="calendar-week__days">
                            {week.days.map((day) => {
                              const isSelectable = day.isCurrentMonth && !day.isOccupied && !day.isPast;
                              const isSelected =
                                selectedRangeForMonth !== null &&
                                day.isoDate >= selectedRangeForMonth.startIso &&
                                day.isoDate <= selectedRangeForMonth.endIso;
                              const isSelectionEnd = selectedRangeForMonth?.endIso === day.isoDate;

                              return (
                                <article
                                  key={day.isoDate}
                                  ref={(node) => {
                                    if (!day.isCurrentMonth) return;
                                    dayRefs.current[day.isoDate] = node;
                                  }}
                                  className={[
                                    "calendar-day",
                                    day.isCurrentMonth ? "" : "calendar-day--ghost",
                                    day.isOccupied ? "calendar-day--occupied" : "",
                                    day.isPast ? "calendar-day--past" : "",
                                    day.isConnectedToPrevious ? "calendar-day--occupied-connected-left" : "",
                                    day.isConnectedToNext ? "calendar-day--occupied-connected-right" : "",
                                    day.isToday ? "calendar-day--today" : "",
                                    isSelectable ? "calendar-day--selectable" : "",
                                    isSelected ? "calendar-day--selected" : "",
                                    isSelectionEnd ? "calendar-day--selection-end" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  onClick={isSelectable ? () => toggleDateSelection(monthData.index, day.isoDate) : undefined}
                                  onKeyDown={
                                    isSelectable
                                      ? (event) => {
                                          if (event.key !== "Enter" && event.key !== " ") return;
                                          event.preventDefault();
                                          toggleDateSelection(monthData.index, day.isoDate);
                                        }
                                      : undefined
                                  }
                                  tabIndex={isSelectable ? 0 : undefined}
                                  aria-pressed={isSelectable ? isSelected : undefined}
                                >
                                  {day.isCurrentMonth ? (
                                    <>
                                      <div className="calendar-day__number-wrap">
                                        <span className="calendar-day__number">{day.dayNumber}</span>
                                      </div>
                                      {isSelectionEnd ? (
                                        <button
                                          type="button"
                                          className="calendar-day__add-button"
                                          aria-label="Créer une réservation sur ces dates"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            handleReservationInsertFromSelection(monthData.monthNumber);
                                          }}
                                        >
                                          +
                                        </button>
                                      ) : null}
                                    </>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>

                          {shouldRenderSegments ? (
                            <div className="calendar-week__segments">
                              {week.segments.map((segment) => {
                                const segmentKey = `${segment.id}-${monthData.monthNumber}-${week.index}-${segment.startColumn}`;

                                return (
                                  <div
                                    key={segmentKey}
                                    ref={(node) => {
                                      segmentRefs.current[segmentKey] = node;
                                    }}
                                    className={[
                                      "calendar-reservation",
                                      segment.showLabel ? "" : "calendar-reservation--continuation",
                                      segment.isPast ? "calendar-reservation--past" : "",
                                      hoveredReservation?.segmentKey === segmentKey ? "calendar-reservation--hovered" : "",
                                      segment.continuesFromPreviousWeek ? "calendar-reservation--continues-from-previous" : "",
                                      segment.continuesToNextWeek ? "calendar-reservation--continues-to-next" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    style={
                                      {
                                        gridColumn: `${segment.startColumn} / ${segment.endColumn + 1}`,
                                        "--calendar-reservation-bg": getPaymentColorFromMap(segment.reservation.source_paiement, paymentColorMap),
                                        "--calendar-reservation-fg": getPaymentTextColorFromMap(segment.reservation.source_paiement, paymentColorMap),
                                      } as CSSProperties
                                    }
                                    onMouseEnter={() =>
                                      setHoveredReservation({
                                        reservationId: segment.reservation.id,
                                        monthIndex: monthData.index,
                                        weekIndex: week.index,
                                        segmentKey,
                                      })
                                    }
                                    onMouseLeave={() =>
                                      setHoveredReservation((current) => (current?.segmentKey === segmentKey ? null : current))
                                    }
                                    onFocus={() =>
                                      setHoveredReservation({
                                        reservationId: segment.reservation.id,
                                        monthIndex: monthData.index,
                                        weekIndex: week.index,
                                        segmentKey,
                                      })
                                    }
                                    onBlur={() =>
                                      setHoveredReservation((current) => (current?.segmentKey === segmentKey ? null : current))
                                    }
                                    onClick={() =>
                                      handleReservationOpen(segment.reservation, {
                                        monthNumber: monthData.monthNumber,
                                        year,
                                      })
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter" && event.key !== " ") return;
                                      event.preventDefault();
                                      handleReservationOpen(segment.reservation, {
                                        monthNumber: monthData.monthNumber,
                                        year,
                                      });
                                    }}
                                    aria-describedby={hoveredReservation?.segmentKey === segmentKey ? "calendar-floating-popover" : undefined}
                                    tabIndex={0}
                                  >
                                    {segment.showLabel ? (
                                      <>
                                        <span className="calendar-reservation__content">
                                          <strong className="calendar-reservation__label">{segment.label}</strong>
                                          <span className="calendar-reservation__price">{formatEuro(segment.reservation.prix_total)}</span>
                                        </span>
                                      </>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </section>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="calendar-sidebar">
          <section className="card calendar-sidebar__card">
            <div className="section-title">Aperçu</div>
            <p className="calendar-sidebar__month-label">{visibleMonth?.title}</p>
            <div className="calendar-metrics">
              <div className="calendar-metric">
                <span>Taux d&apos;occupation</span>
                <strong>{visibleMonth ? Math.round(visibleMonth.occupancyRate * 100) : 0}%</strong>
              </div>
              <div className="calendar-metric">
                <span>Nuits réservées</span>
                <strong>{visibleMonth?.occupiedNights ?? 0}</strong>
              </div>
              <div className="calendar-metric">
                <span>Séjours</span>
                <strong>{visibleMonth?.reservations.length ?? 0}</strong>
              </div>
            </div>
          </section>

          <section className="card calendar-sidebar__card">
            <div className="section-title">Séjours du mois</div>
            <p className="calendar-sidebar__month-label">{visibleMonth?.title}</p>
            {hoveredReservationDetails?.month?.index === activeMonthIndex ? (
              <article className="calendar-stay calendar-stay--highlighted calendar-stay--focused">
                <div className="calendar-stay__head">
                  <strong>{hoveredReservationDetails.reservation.hote_nom}</strong>
                  <span>
                    {hoveredReservationDetails.reservation.nb_adultes} adulte
                    {hoveredReservationDetails.reservation.nb_adultes > 1 ? "s" : ""}
                  </span>
                </div>
                <p>
                  {formatShortDate(hoveredReservationDetails.reservation.date_entree)} →{" "}
                  {formatShortDate(hoveredReservationDetails.reservation.date_sortie)}
                </p>
                <div className="calendar-stay__meta">
                  <span>
                    {hoveredReservationDetails.reservation.nb_nuits} nuit
                    {hoveredReservationDetails.reservation.nb_nuits > 1 ? "s" : ""}
                  </span>
                  <strong>{formatEuro(hoveredReservationDetails.reservation.prix_total)}</strong>
                </div>
                <small>{hoveredReservationDetails.reservation.source_paiement || "Source non renseignée"}</small>
                {hoveredReservationDetails.reservation.commentaire ? (
                  <p className="calendar-stay__note">{hoveredReservationDetails.reservation.commentaire}</p>
                ) : null}
              </article>
            ) : (
              <p className="calendar-sidebar__empty">Touchez ou survolez une réservation pour consulter rapidement les détails du séjour.</p>
            )}
          </section>
        </aside>
      </div>

      {canUseQuickReservation ? (
        <div className="calendar-quick-create-bar" role="status" aria-live="polite">
          <div className="calendar-quick-create-bar__content">
            <strong>{selectedRangeNights} nuit{selectedRangeNights > 1 ? "s" : ""}</strong>
            <span>{selectedRangeSummary}</span>
          </div>
          <div className="calendar-quick-create-bar__actions">
            <button type="button" className="calendar-quick-create-bar__ghost" onClick={() => setSelectedDateRange(null)}>
              Effacer
            </button>
            <button type="button" className="calendar-quick-create-bar__primary" onClick={openQuickReservationSheet}>
              Ajouter
            </button>
          </div>
        </div>
      ) : null}

      {!usesViewportScroll && hoveredReservationDetails?.reservation && floatingPopoverLayout
        ? createPortal(
            <div
              id="calendar-floating-popover"
              className="calendar-floating-popover"
              role="tooltip"
              style={{
                top: floatingPopoverLayout.top,
                left: floatingPopoverLayout.left,
                width: floatingPopoverLayout.width,
                maxHeight: floatingPopoverLayout.maxHeight,
              }}
            >
              <div className="calendar-floating-popover__title">{hoveredReservationDetails.reservation.hote_nom}</div>
              <div className="calendar-floating-popover__row">
                <span>Séjour</span>
                <strong>
                  {formatShortDate(hoveredReservationDetails.reservation.date_entree)} →{" "}
                  {formatShortDate(hoveredReservationDetails.reservation.date_sortie)}
                </strong>
              </div>
              <div className="calendar-floating-popover__row">
                <span>Voyageurs</span>
                <strong>
                  {hoveredReservationDetails.reservation.nb_adultes} adulte
                  {hoveredReservationDetails.reservation.nb_adultes > 1 ? "s" : ""}
                </strong>
              </div>
              <div className="calendar-floating-popover__row">
                <span>Montant</span>
                <strong>{formatEuro(hoveredReservationDetails.reservation.prix_total)}</strong>
              </div>
              <div className="calendar-floating-popover__row">
                <span>Source</span>
                <strong>{hoveredReservationDetails.reservation.source_paiement || "Non renseignée"}</strong>
              </div>
              {hoveredReservationDetails.reservation.commentaire ? (
                <p className="calendar-floating-popover__note">{hoveredReservationDetails.reservation.commentaire}</p>
              ) : null}
            </div>,
            document.body
          )
        : null}

      {usesViewportScroll && mobileActionReservation ? (
        <MobileReservationActionsBar
          open
          title={getReservationDisplayLabel(mobileActionReservation)}
          subtitle={`${formatShortDate(mobileActionReservation.date_entree)} → ${formatShortDate(mobileActionReservation.date_sortie)}`}
          onClose={() => setMobileActionReservationId(null)}
          onEdit={() => openQuickReservationEditSheet(mobileActionReservation)}
          phoneHref={buildTelephoneHref(mobileActionReservation.telephone)}
          smsHref={buildSmsHref(mobileActionReservation.telephone ?? "")}
          airbnbUrl={mobileActionReservation.airbnb_url}
        />
      ) : null}

      {usesViewportScroll && quickReservationOpen && quickReservationDraft ? (
        <div
          className="calendar-quick-create-sheet"
          role="presentation"
          onClick={() => {
            if (quickReservationSaving) return;
            closeQuickReservationSheet();
          }}
        >
          <section
            className="calendar-quick-create-sheet__panel"
            role="dialog"
            aria-modal="true"
            aria-label={quickReservationMode === "edit" ? "Réservation rapide" : "Nouvelle réservation"}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="calendar-quick-create-sheet__handle" aria-hidden="true" />
            <div className="calendar-quick-create-sheet__header">
              <p className="calendar-quick-create-sheet__eyebrow">{selectedGite?.nom ?? "Réservation"}</p>
              <button
                type="button"
                className="calendar-quick-create-sheet__close"
                aria-label={quickReservationMode === "edit" ? "Fermer l'édition rapide" : "Fermer la création rapide"}
                onClick={closeQuickReservationSheet}
                disabled={quickReservationSaving}
              >
                ×
              </button>
            </div>

            <div className="calendar-quick-create-sheet__summary">
              <div className="calendar-quick-create-sheet__summary-main">
                <strong className="calendar-quick-create-sheet__summary-dates">
                  {isIsoDateString(quickReservationDateSummary.startIso) && isIsoDateString(quickReservationDateSummary.exitIso)
                    ? `${formatShortDate(quickReservationDateSummary.startIso)} → ${formatShortDate(quickReservationDateSummary.exitIso)}`
                    : "Dates à renseigner"}
                </strong>
                <span className="calendar-quick-create-sheet__summary-pill">
                  {quickReservationDateSummary.nights} nuit{quickReservationDateSummary.nights > 1 ? "s" : ""}
                </span>
              </div>
              <div className="calendar-quick-create-sheet__summary-total">
                <strong>{quickReservationComputedTotal !== null ? formatEuro(quickReservationComputedTotal) : "A calculer"}</strong>
              </div>
            </div>

            {quickReservationError ? <p className="calendar-quick-create-sheet__error">{quickReservationError}</p> : null}

            <div className="calendar-quick-create-sheet__form">
              <section className="calendar-quick-create-sheet__section">
                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Hôte
                  <input
                    type="text"
                    value={quickReservationDraft.hote_nom}
                    placeholder="Nom du voyageur"
                    onChange={(event) => handleQuickReservationFieldChange("hote_nom", event.target.value)}
                  />
                </label>

                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Téléphone
                  <input
                    type="tel"
                    inputMode="tel"
                    value={quickReservationDraft.telephone}
                    placeholder="06 12 34 56 78"
                    onChange={(event) => handleQuickReservationFieldChange("telephone", event.target.value)}
                  />
                </label>

                <div className="calendar-quick-create-sheet__dates-band">
                  <label className="field field--small calendar-quick-create-sheet__host-field">
                    Entrée
                    <input
                      type="date"
                      value={quickReservationDraft.date_entree}
                      onChange={(event) => handleQuickReservationFieldChange("date_entree", event.target.value)}
                    />
                  </label>

                  <label className="field field--small calendar-quick-create-sheet__host-field">
                    Sortie
                    <input
                      type="date"
                      value={quickReservationDraft.date_sortie}
                      onChange={(event) => handleQuickReservationFieldChange("date_sortie", event.target.value)}
                    />
                  </label>
                </div>

                <div className="calendar-quick-create-sheet__stats-grid">
                  <label className="field field--small calendar-quick-create-sheet__compact-field calendar-quick-create-sheet__compact-field--adults">
                    <span className="calendar-quick-create-sheet__compact-label">Adultes</span>
                    <select
                      value={quickReservationDraft.nb_adultes}
                      onChange={(event) => handleQuickReservationFieldChange("nb_adultes", Number(event.target.value))}
                    >
                      {quickReservationAdultOptions.map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field field--small calendar-quick-create-sheet__compact-field calendar-quick-create-sheet__compact-field--nightly">
                    <span className="calendar-quick-create-sheet__compact-label">Prix / nuit</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="decimal"
                      value={quickReservationDraft.prix_par_nuit}
                      onChange={(event) => handleQuickReservationFieldChange("prix_par_nuit", event.target.value)}
                    />
                  </label>

                  {quickReservationNightlySuggestions.length > 0 ? (
                    <div className="calendar-quick-create-sheet__prices">
                      <span className="calendar-quick-create-sheet__compact-label">Tarifs du gîte</span>
                      <div className="calendar-quick-create-sheet__price-list">
                        {quickReservationNightlySuggestions.map((price) => {
                          const isActive = round2(Number(quickReservationDraft.prix_par_nuit) || 0) === price;
                          return (
                            <button
                              key={price}
                              type="button"
                              className={`calendar-quick-create-sheet__price-chip${
                                isActive ? " calendar-quick-create-sheet__price-chip--active" : ""
                              }`}
                              onClick={() => handleQuickReservationFieldChange("prix_par_nuit", String(price))}
                            >
                              {formatEuro(price)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="calendar-quick-create-sheet__prices calendar-quick-create-sheet__prices--empty">
                      <span className="calendar-quick-create-sheet__compact-label">Tarifs du gîte</span>
                      <strong>Manuel</strong>
                    </div>
                  )}
                </div>

                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Source
                  <select
                    value={quickReservationDraft.source_paiement}
                    onChange={(event) => handleQuickReservationFieldChange("source_paiement", event.target.value)}
                  >
                    {RESERVATION_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field field--small calendar-quick-create-sheet__note-field">
                  Note
                  <textarea
                    rows={2}
                    value={quickReservationDraft.commentaire}
                    placeholder="Optionnel"
                    onChange={(event) => handleQuickReservationFieldChange("commentaire", event.target.value)}
                  />
                </label>

                <div className="calendar-quick-create-sheet__options-card">
                  <label className="calendar-quick-create-sheet__toggle-row">
                    <div>
                      <span className="calendar-quick-create-sheet__toggle-title">Option ménage</span>
                      <span className="calendar-quick-create-sheet__toggle-meta">
                        {formatEuro(Number(selectedGite?.options_menage_forfait ?? 0))}
                      </span>
                    </div>
                    <span className="calendar-quick-create-sheet__switch-control">
                      <input
                        type="checkbox"
                        checked={quickReservationDraft.option_menage}
                        onChange={(event) => handleQuickReservationFieldChange("option_menage", event.target.checked)}
                      />
                      <span aria-hidden="true" />
                    </span>
                  </label>

                  <label className="calendar-quick-create-sheet__range-field">
                    <div className="calendar-quick-create-sheet__range-head">
                      <span className="calendar-quick-create-sheet__toggle-title">Draps</span>
                      <span className="calendar-quick-create-sheet__range-value">
                        {quickReservationDraft.option_draps} · {formatEuro(quickReservationOptionsPreview.byKey.draps)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={quickReservationOptionCountMax}
                      step={1}
                      value={quickReservationDraft.option_draps}
                      onChange={(event) => handleQuickReservationFieldChange("option_draps", Number(event.target.value))}
                    />
                    <span className="calendar-quick-create-sheet__range-meta">
                      {formatEuro(Number(selectedGite?.options_draps_par_lit ?? 0))} / lit
                    </span>
                  </label>

                  <label className="calendar-quick-create-sheet__range-field">
                    <div className="calendar-quick-create-sheet__range-head">
                      <span className="calendar-quick-create-sheet__toggle-title">Serviettes</span>
                      <span className="calendar-quick-create-sheet__range-value">
                        {quickReservationDraft.option_serviettes} · {formatEuro(quickReservationOptionsPreview.byKey.linge_toilette)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={quickReservationOptionCountMax}
                      step={1}
                      value={quickReservationDraft.option_serviettes}
                      onChange={(event) => handleQuickReservationFieldChange("option_serviettes", Number(event.target.value))}
                    />
                    <span className="calendar-quick-create-sheet__range-meta">
                      {formatEuro(Number(selectedGite?.options_linge_toilette_par_personne ?? 0))} / personne
                    </span>
                  </label>
                </div>
              </section>

              <section className="calendar-quick-create-sheet__section">
                <p className="calendar-quick-create-sheet__section-title">3 - Envoyer un SMS de confirmation</p>

                <div className="calendar-quick-create-sheet__switches">
                  {quickReservationSmsSnippets.map((snippet) => {
                    const checked = quickReservationSmsSelection.includes(snippet.id);
                    return (
                      <label key={snippet.id} className="calendar-quick-create-sheet__switch">
                        <span>{snippet.title}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setQuickReservationSmsSelection((current) =>
                              event.target.checked
                                ? [...current, snippet.id]
                                : current.filter((item) => item !== snippet.id)
                            )
                          }
                        />
                      </label>
                    );
                  })}
                </div>

                <div className="calendar-quick-create-sheet__sms-preview">
                  <pre>{quickReservationSmsText}</pre>
                </div>

                <div className="calendar-quick-create-sheet__sms-actions">
                  <button
                    type="button"
                    className="calendar-quick-create-sheet__sms-button"
                    onClick={() => {
                      if (!quickReservationSmsHref) return;
                      window.location.href = quickReservationSmsHref;
                    }}
                    disabled={!quickReservationSmsHref}
                    aria-label="Ouvrir l'envoi du SMS"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4.5 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M7 9h10M7 12h6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="calendar-quick-create-sheet__copy"
                    onClick={() => {
                      if (!navigator.clipboard?.writeText) return;
                      void navigator.clipboard.writeText(quickReservationSmsText);
                    }}
                    aria-label="Copier le SMS"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 19.5v-10Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M6 16H5.5A1.5 1.5 0 0 1 4 14.5v-10A1.5 1.5 0 0 1 5.5 3h8A1.5 1.5 0 0 1 15 4.5V5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </section>
            </div>

            <div className="calendar-quick-create-sheet__footer">
              <button type="button" className="calendar-quick-create-sheet__submit" onClick={saveQuickReservation} disabled={quickReservationSaving}>
                {quickReservationSaving ? "Enregistrement..." : quickReservationMode === "edit" ? "Mettre à jour" : "Enregistrer"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};

export default CalendrierPage;

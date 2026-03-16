import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import { getGiteColor } from "../utils/giteColors";
import {
  DEFAULT_PAYMENT_SOURCE_COLORS,
  buildPaymentColorMap,
  getPaymentColorFromMap,
  getPaymentTextColorFromMap,
} from "../utils/paymentColors";
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

type QuickReservationDraft = {
  hote_nom: string;
  nb_adultes: number;
  prix_par_nuit: string;
  commentaire: string;
};

const normalizeIsoDate = (value: string) => value.slice(0, 10);
const round2 = (value: number) => Math.round(value * 100) / 100;

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
      const splitPoints: Date[] = [];

      if (cursor.getTime() < todayDate.getTime() && segmentEndExclusive.getTime() > todayDate.getTime()) {
        splitPoints.push(todayDate);
      }

      const segmentPoints = [cursor, ...splitPoints, segmentEndExclusive];

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
  const [selectedDateRange, setSelectedDateRange] = useState<SelectedDateRange>(null);
  const [quickReservationDraft, setQuickReservationDraft] = useState<QuickReservationDraft | null>(null);
  const [quickReservationOpen, setQuickReservationOpen] = useState(false);
  const [quickReservationSaving, setQuickReservationSaving] = useState(false);
  const [quickReservationError, setQuickReservationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usesViewportScroll, setUsesViewportScroll] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${MOBILE_CALENDAR_BREAKPOINT}px)`).matches : false
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
  const pendingScrollTargetRef = useRef<PendingCalendarScrollTarget | null>({
    kind: "date",
    value: todayIso,
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [gitesData, reservationsData, sourceColorSettings] = await Promise.all([
        apiFetch<Gite[]>("/gites"),
        apiFetch<Reservation[]>("/reservations"),
        apiFetch<SourceColorSettings>("/settings/source-colors"),
      ]);

      setGites(gitesData);
      setReservations(reservationsData);
      setSourceColors(sourceColorSettings.colors ?? DEFAULT_PAYMENT_SOURCE_COLORS);
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
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_CALENDAR_BREAKPOINT}px)`);
    const updateScrollMode = (matches: boolean) => {
      setUsesViewportScroll((current) => (current === matches ? current : matches));
    };

    updateScrollMode(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      updateScrollMode(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
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
  }, [selectedGiteId, year]);

  useEffect(() => {
    if (selectedDateRange) return;
    setQuickReservationOpen(false);
    setQuickReservationDraft(null);
    setQuickReservationError(null);
  }, [selectedDateRange]);

  useEffect(() => {
    if (!quickReservationOpen || !usesViewportScroll) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !quickReservationSaving) {
        setQuickReservationOpen(false);
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
  const canUseQuickReservation = usesViewportScroll && Boolean(selectedDateRange && selectedGiteId);
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
      nb_adultes: defaultAdults,
      prix_par_nuit: quickReservationSuggestedNightly > 0 ? String(quickReservationSuggestedNightly) : "",
      commentaire: "",
    };
  }, [quickReservationSuggestedNightly, selectedDateRange, selectedGite, selectedGiteId]);

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

  const openQuickReservationSheet = useCallback(() => {
    const nextDraft = buildQuickReservationDraft();
    if (!nextDraft) return;
    setQuickReservationDraft(nextDraft);
    setQuickReservationError(null);
    setQuickReservationOpen(true);
  }, [buildQuickReservationDraft]);

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
    (field: keyof QuickReservationDraft, value: string | number) => {
      setQuickReservationDraft((current) => (current ? { ...current, [field]: value } : current));
    },
    []
  );

  const saveQuickReservation = useCallback(async () => {
    if (!selectedDateRange || !selectedRangeExitIso || !selectedGiteId || !quickReservationDraft || quickReservationSaving) return;

    const hostName = quickReservationDraft.hote_nom.trim();
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    const adults = Math.max(0, Math.trunc(Number(quickReservationDraft.nb_adultes) || 0));

    if (!hostName) {
      setQuickReservationError("Renseigne le nom de l'hôte.");
      return;
    }

    if (!Number.isFinite(nightly) || nightly < 0) {
      setQuickReservationError("Renseigne un prix par nuit valide.");
      return;
    }

    setQuickReservationSaving(true);
    setQuickReservationError(null);

    try {
      await apiFetch<Reservation>("/reservations", {
        method: "POST",
        json: {
          gite_id: selectedGiteId,
          hote_nom: hostName,
          date_entree: selectedDateRange.startIso,
          date_sortie: selectedRangeExitIso,
          nb_adultes: adults,
          prix_par_nuit: round2(nightly),
          price_driver: "nightly",
          commentaire: quickReservationDraft.commentaire.trim() || undefined,
        },
      });

      await loadData();
      setQuickReservationOpen(false);
      setQuickReservationDraft(null);
      setSelectedDateRange(null);
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
    loadData,
    quickReservationDraft,
    quickReservationSaving,
    selectedDateRange,
    selectedGiteId,
    selectedRangeExitIso,
  ]);

  const quickReservationComputedTotal = useMemo(() => {
    if (!quickReservationDraft || selectedRangeNights <= 0) return null;
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    if (!Number.isFinite(nightly) || nightly < 0) return null;
    return round2(nightly * selectedRangeNights);
  }, [quickReservationDraft, selectedRangeNights]);

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

      const topOffset = getScrollOffset("date");

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
    if (!hoveredReservation) return;
    if (hoveredReservation.monthIndex === activeMonthIndex) return;
    setHoveredReservation(null);
  }, [activeMonthIndex, hoveredReservation]);

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

  return (
    <div className={`calendar-page${canUseQuickReservation ? " calendar-page--quick-create-visible" : ""}`} style={pageStyle}>
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
                                    onClick={() => {
                                      const params = new URLSearchParams();
                                      params.set("focus", segment.reservation.id);
                                      params.set("year", String(year));
                                      params.set("month", String(monthData.monthNumber));
                                      if (segment.reservation.gite_id) {
                                        params.set("tab", segment.reservation.gite_id);
                                      }
                                      navigate(`/reservations?${params.toString()}#reservation-${segment.reservation.id}`);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter" && event.key !== " ") return;
                                      event.preventDefault();
                                      const params = new URLSearchParams();
                                      params.set("focus", segment.reservation.id);
                                      params.set("year", String(year));
                                      params.set("month", String(monthData.monthNumber));
                                      if (segment.reservation.gite_id) {
                                        params.set("tab", segment.reservation.gite_id);
                                      }
                                      navigate(`/reservations?${params.toString()}#reservation-${segment.reservation.id}`);
                                    }}
                                    tabIndex={0}
                                  >
                                    {segment.showLabel ? (
                                      <>
                                        <span className="calendar-reservation__content">
                                          <strong className="calendar-reservation__label">{segment.label}</strong>
                                          <span className="calendar-reservation__price">{formatEuro(segment.reservation.prix_total)}</span>
                                        </span>
                                        <div className="calendar-reservation__popover" role="tooltip">
                                          <div className="calendar-reservation__popover-title">{segment.reservation.hote_nom}</div>
                                          <div className="calendar-reservation__popover-row">
                                            <span>Séjour</span>
                                            <strong>
                                              {formatShortDate(segment.reservation.date_entree)} → {formatShortDate(segment.reservation.date_sortie)}
                                            </strong>
                                          </div>
                                          <div className="calendar-reservation__popover-row">
                                            <span>Voyageurs</span>
                                            <strong>
                                              {segment.reservation.nb_adultes} adulte{segment.reservation.nb_adultes > 1 ? "s" : ""}
                                            </strong>
                                          </div>
                                          <div className="calendar-reservation__popover-row">
                                            <span>Montant</span>
                                            <strong>{formatEuro(segment.reservation.prix_total)}</strong>
                                          </div>
                                          <div className="calendar-reservation__popover-row">
                                            <span>Source</span>
                                            <strong>{segment.reservation.source_paiement || "Non renseignée"}</strong>
                                          </div>
                                          {segment.reservation.commentaire ? (
                                            <p className="calendar-reservation__popover-note">{segment.reservation.commentaire}</p>
                                          ) : null}
                                        </div>
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

      {usesViewportScroll && quickReservationOpen && quickReservationDraft && selectedDateRange ? (
        <div
          className="calendar-quick-create-sheet"
          role="presentation"
          onClick={() => {
            if (quickReservationSaving) return;
            setQuickReservationOpen(false);
          }}
        >
          <section
            className="calendar-quick-create-sheet__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-quick-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="calendar-quick-create-sheet__handle" aria-hidden="true" />
            <div className="calendar-quick-create-sheet__header">
              <div>
                <p className="calendar-quick-create-sheet__eyebrow">{selectedGite?.nom ?? "Réservation"}</p>
                <h2 id="calendar-quick-create-title">Nouvelle réservation</h2>
              </div>
              <button
                type="button"
                className="calendar-quick-create-sheet__close"
                aria-label="Fermer la création rapide"
                onClick={() => setQuickReservationOpen(false)}
                disabled={quickReservationSaving}
              >
                ×
              </button>
            </div>

            <div className="calendar-quick-create-sheet__summary">
              <strong>{selectedRangeNights} nuit{selectedRangeNights > 1 ? "s" : ""}</strong>
              <span>
                {formatShortDate(selectedDateRange.startIso)} → {formatShortDate(selectedRangeExitIso)}
              </span>
            </div>

            {quickReservationError ? <p className="calendar-quick-create-sheet__error">{quickReservationError}</p> : null}

            <div className="calendar-quick-create-sheet__form">
              <label className="field field--small">
                Hôte
                <input
                  type="text"
                  value={quickReservationDraft.hote_nom}
                  placeholder="Nom du voyageur"
                  onChange={(event) => handleQuickReservationFieldChange("hote_nom", event.target.value)}
                  autoFocus
                />
              </label>

              <div className="calendar-quick-create-sheet__grid">
                <label className="field field--small">
                  Adultes
                  <input
                    type="number"
                    min={0}
                    value={quickReservationDraft.nb_adultes}
                    onChange={(event) => handleQuickReservationFieldChange("nb_adultes", Math.max(0, Number(event.target.value)))}
                  />
                </label>

                <label className="field field--small">
                  Prix / nuit
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={quickReservationDraft.prix_par_nuit}
                    onChange={(event) => handleQuickReservationFieldChange("prix_par_nuit", event.target.value)}
                  />
                </label>
              </div>

              {quickReservationNightlySuggestions.length > 0 ? (
                <div className="calendar-quick-create-sheet__prices">
                  <span>Tarifs du gîte</span>
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
              ) : null}

              <div className="calendar-quick-create-sheet__computed-total">
                <span>Total calculé</span>
                <strong>{quickReservationComputedTotal !== null ? formatEuro(quickReservationComputedTotal) : "A calculer"}</strong>
              </div>

              <label className="field field--small">
                Note
                <textarea
                  rows={2}
                  value={quickReservationDraft.commentaire}
                  placeholder="Optionnel"
                  onChange={(event) => handleQuickReservationFieldChange("commentaire", event.target.value)}
                />
              </label>
            </div>

            <div className="calendar-quick-create-sheet__footer">
              <button
                type="button"
                className="calendar-quick-create-sheet__link"
                onClick={() => openReservationInsertFromSelection(selectedDateRange.monthIndex + 1)}
                disabled={quickReservationSaving}
              >
                Ouvrir la fiche complète
              </button>
              <button type="button" className="calendar-quick-create-sheet__submit" onClick={saveQuickReservation} disabled={quickReservationSaving}>
                {quickReservationSaving ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};

export default CalendrierPage;

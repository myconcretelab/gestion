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

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOARD_MONTH_SCROLL_OFFSET = 104;
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

const normalizeIsoDate = (value: string) => value.slice(0, 10);

const parseIsoDate = (value: string) => {
  const normalized = normalizeIsoDate(value);
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * DAY_MS);

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const monthSectionRefs = useRef<Record<number, HTMLElement | null>>({});
  const pendingScrollTargetRef = useRef<number | null>(currentMonthIndex);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [gitesData, reservationsData, sourceColorSettings] = await Promise.all([
          apiFetch<Gite[]>("/gites"),
          apiFetch<Reservation[]>("/reservations"),
          apiFetch<SourceColorSettings>("/settings/source-colors"),
        ]);

        if (cancelled) return;
        setGites(gitesData);
        setReservations(reservationsData);
        setSourceColors(sourceColorSettings.colors ?? DEFAULT_PAYMENT_SOURCE_COLORS);
        setSelectedGiteId((previous) => previous || gitesData[0]?.id || "");
      } catch (err) {
        if (cancelled) return;
        if (isApiError(err)) setError(err.message);
        else setError("Impossible de charger le calendrier.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadData();

    return () => {
      cancelled = true;
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

  const selectedGite = useMemo(() => gites.find((gite) => gite.id === selectedGiteId) ?? null, [gites, selectedGiteId]);
  const paymentColorMap = useMemo(() => buildPaymentColorMap(sourceColors), [sourceColors]);
  const accentColor = selectedGite ? getGiteColor(selectedGite) : "#ff5a5f";
  const todayDate = useMemo(() => parseIsoDate(todayIso), [todayIso]);
  const pageStyle = useMemo(
    () =>
      ({
        "--calendar-accent": accentColor,
        "--calendar-accent-soft": hexToRgba(accentColor, 0.12),
        "--calendar-accent-strong": hexToRgba(accentColor, 0.24),
      }) as CSSProperties,
    [accentColor]
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

  const scrollToMonth = useCallback((monthIndex: number, behavior: ScrollBehavior = "smooth") => {
    const container = boardScrollRef.current;
    const target = monthSectionRefs.current[monthIndex];
    if (!container || !target) return;

    container.scrollTo({
      top: Math.max(target.offsetTop - BOARD_MONTH_SCROLL_OFFSET, 0),
      behavior,
    });
    setActiveMonthIndex(monthIndex);
  }, []);

  useEffect(() => {
    if (loading || !calendarMonths.length) return;
    const targetMonthIndex = pendingScrollTargetRef.current;
    if (targetMonthIndex == null) return;

    const frameId = window.requestAnimationFrame(() => {
      scrollToMonth(targetMonthIndex, "auto");
      pendingScrollTargetRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [calendarMonths.length, loading, scrollToMonth, year]);

  useEffect(() => {
    const container = boardScrollRef.current;
    if (!container || !calendarMonths.length) return;

    let frameId = 0;

    const updateVisibleMonth = () => {
      const currentTop = container.scrollTop + BOARD_MONTH_SCROLL_OFFSET;
      let nextActiveMonthIndex = 0;

      for (const monthData of calendarMonths) {
        const section = monthSectionRefs.current[monthData.index];
        if (!section) continue;
        if (section.offsetTop <= currentTop) nextActiveMonthIndex = monthData.index;
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
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [calendarMonths, selectedGiteId]);

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
    <div className="calendar-page" style={pageStyle}>
      <section className="card calendar-hero">
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
                  pendingScrollTargetRef.current = activeMonthIndex;
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
                  pendingScrollTargetRef.current = activeMonthIndex;
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
                  scrollToMonth(currentMonthIndex);
                } else {
                  pendingScrollTargetRef.current = currentMonthIndex;
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
            <div className="calendar-weekdays" role="row">
              {WEEKDAYS.map((day) => (
                <div key={day} className="calendar-weekdays__item" role="columnheader">
                  {day}
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
                                            openReservationInsertFromSelection(monthData.monthNumber);
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
              <p className="calendar-sidebar__empty">Survolez une barre de réservation pour afficher ici les détails du séjour.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};

export default CalendrierPage;

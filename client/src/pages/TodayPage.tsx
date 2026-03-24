import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { OccupationGaugeDial } from "./statistics/components/OccupationGauge";
import MobileReservationActionsBar from "./shared/MobileReservationActionsBar";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import { getGiteColor } from "../utils/giteColors";
import {
  DEFAULT_PAYMENT_SOURCE_COLORS,
  buildPaymentColorMap,
  getPaymentColorFromMap,
} from "../utils/paymentColors";
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
};

type QuickReservationSmsSnippet = {
  id: string;
  title: string;
  text: string;
};

type QuickReservationSmsSettings = {
  texts: QuickReservationSmsSnippet[];
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
const clampQuickReservationAdults = (value: number, gite: Gite | null) =>
  Math.min(getQuickReservationAdultsMax(gite), Math.max(1, Math.trunc(Number(value) || 1)));
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

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 11a8 8 0 1 0 2 5.3" />
    <path d="M20 4v7h-7" />
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [usesViewportScroll, setUsesViewportScroll] = useState(() =>
    getMatchesMediaQuery(`(max-width: ${MOBILE_RESERVATION_BREAKPOINT}px)`)
  );

  const loadData = async (options?: { silent?: boolean }) => {
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const payload = await apiFetch<TodayOverviewPayload>(`/today/overview?days=${TOTAL_DAY_COUNT}`);
      setOverview(payload);
    } catch (err: any) {
      setError(err.message ?? "Impossible de charger la page Aujourd'hui.");
    } finally {
      setLoading(false);
      setRefreshing(false);
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
  }, [usesViewportScroll]);

  useEffect(() => {
    if (quickReservationOpen) {
      setMobileActionState(null);
    }
  }, [quickReservationOpen]);

  useEffect(() => {
    if (!quickReservationOpen || !usesViewportScroll) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !quickReservationSaving) {
        setQuickReservationOpen(false);
        setQuickReservationDraft(null);
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

            for (let index = startIndex; index <= endIndex; index += 1) {
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

  const quickReservationComputedTotal = useMemo(() => {
    if (!quickReservationDraft) return null;
    const nightly = Number.parseFloat(String(quickReservationDraft.prix_par_nuit).replace(",", "."));
    if (!Number.isFinite(nightly) || nightly < 0) return null;
    return quickReservationDateSummary.nights > 0 ? round2(nightly * quickReservationDateSummary.nights) : null;
  }, [quickReservationDateSummary.nights, quickReservationDraft]);

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

    if (Number.isFinite(nightly) && nightly >= 0 && quickReservationComputedTotal !== null) {
      baseLines.push(
        `Le tarif est de ${formatQuickReservationSmsAmount(round2(nightly))}€/nuit, soit ${formatQuickReservationSmsAmount(
          quickReservationComputedTotal
        )}€.`
      );
    }

    if (address) baseLines.push(`L'adresse est ${address}.`);

    const selectedSnippets = quickReservationSmsSnippets
      .filter((snippet) => quickReservationSmsSelection.includes(snippet.id))
      .map((snippet) => interpolateQuickReservationSmsSnippet(snippet.text, snippetValues))
      .filter((snippet) => snippet.trim().length > 0);

    return [...baseLines, ...selectedSnippets, "Merci Beaucoup,", "Soazig Molinier"].join("\n");
  }, [
    quickReservationComputedTotal,
    quickReservationDateSummary,
    quickReservationDraft,
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
    });
    setQuickReservationSmsSelection([]);
    setQuickReservationError(null);
    setQuickReservationOpen(true);
  };

  const handleQuickReservationFieldChange = (field: keyof QuickReservationDraft, value: string | number) => {
    setQuickReservationDraft((current) => {
      if (!current) return current;
      if (field === "telephone") {
        return { ...current, telephone: formatQuickReservationPhone(String(value)) };
      }
      if (field === "nb_adultes") {
        return { ...current, nb_adultes: clampQuickReservationAdults(Number(value), quickReservationSelectedGite) };
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
          frais_optionnels_montant: quickReservationEditingReservation.frais_optionnels_montant ?? 0,
          frais_optionnels_libelle: quickReservationEditingReservation.frais_optionnels_libelle ?? undefined,
          frais_optionnels_declares: quickReservationEditingReservation.frais_optionnels_declares ?? false,
          options: quickReservationEditingReservation.options ?? {},
        },
      });

      await loadData({ silent: true });
      closeQuickReservationSheet();
    } catch (err) {
      if (isApiError(err)) {
        setQuickReservationError(err.message);
      } else {
        setQuickReservationError("Impossible d'enregistrer la réservation.");
      }
    } finally {
      setQuickReservationSaving(false);
    }
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
      <div className="today-page">
        <section className="card today-hero">
          <div className="section-title">Aujourd&apos;hui</div>
          <div className="field-hint">Chargement de la vue opérationnelle...</div>
        </section>
      </div>
    );
  }

  return (
    <div className="today-page">
      <section className="card today-calendar-card">
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
          <section key={group.key} className="card today-events-card">
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

      <section className="card today-hero">
        <div className="today-hero__header">
          <div>
            <div className="today-hero__eyebrow">Exploitation</div>
            <h1 className="today-hero__title">Aujourd&apos;hui</h1>
            <p className="today-hero__text">Vue immédiate pour mobile: arrivées, départs, séjours en cours et suivi journalier.</p>
          </div>
          <div className="today-hero__controls">
            <label className="field today-hero__field">
              Utilisateur
              <select value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} disabled={managerOptions.length === 0}>
                {managerOptions.length === 0 ? <option value="">Aucun gestionnaire</option> : null}
                {managerOptions.map((manager) => (
                  <option key={manager} value={manager}>
                    {manager}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary today-hero__refresh" onClick={() => void loadData({ silent: true })} disabled={refreshing}>
              <span className={`today-hero__refresh-icon${refreshing ? " today-hero__refresh-icon--spinning" : ""}`} aria-hidden="true">
                <RefreshIcon />
              </span>
              {refreshing ? "Rafraîchissement..." : "Rafraîchir"}
            </button>
          </div>
        </div>

        <div className="today-kpis">
          <article className="today-kpi">
            <span className="today-kpi__label">Aujourd&apos;hui</span>
            <strong className="today-kpi__value">{eventsToday.length}</strong>
            <span className="today-kpi__detail">arrivées, départs ou rotations</span>
          </article>
          <article className="today-kpi">
            <span className="today-kpi__label">Demain</span>
            <strong className="today-kpi__value">{eventsTomorrow.length}</strong>
            <span className="today-kpi__detail">déjà visibles</span>
          </article>
          <article className="today-kpi">
            <span className="today-kpi__label">En cours</span>
            <strong className="today-kpi__value">{activeStayCount}</strong>
            <span className="today-kpi__detail">séjours actifs</span>
          </article>
          <article className="today-kpi today-kpi--trash">
            <span className="today-kpi__label">Poubelles</span>
            <div className="today-trash-legend">
              <span className="today-trash-chip" style={{ "--today-trash-bg": mauronTrashColor } as CSSProperties}>
                <TrashIcon />
                Mauron
              </span>
              <span className="today-trash-chip" style={{ "--today-trash-bg": neantTrashColor } as CSSProperties}>
                <TrashIcon />
                Néant
              </span>
            </div>
            <span className="today-kpi__detail">
              Semaine {evenWeek ? "paire" : "impaire"}{unassignedCount > 0 ? ` · ${unassignedCount} sans gîte masquée(s)` : ""}
            </span>
          </article>
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
          onClose={() => setMobileActionState(null)}
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
            aria-labelledby="today-quick-edit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="calendar-quick-create-sheet__handle" aria-hidden="true" />
            <div className="calendar-quick-create-sheet__header">
              <div>
                <p className="calendar-quick-create-sheet__eyebrow">{quickReservationSelectedGite?.nom ?? "Réservation"}</p>
                <h2 id="today-quick-edit-title">Modifier la réservation</h2>
              </div>
              <button
                type="button"
                className="calendar-quick-create-sheet__close"
                aria-label="Fermer l'édition rapide"
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
                <span>Total</span>
                <strong>{quickReservationComputedTotal !== null ? formatEuro(quickReservationComputedTotal) : "A calculer"}</strong>
              </div>
            </div>

            {quickReservationError ? <p className="calendar-quick-create-sheet__error">{quickReservationError}</p> : null}

            <div className="calendar-quick-create-sheet__form">
              <section className="calendar-quick-create-sheet__section">
                <p className="calendar-quick-create-sheet__section-title">1 - Entrer les informations</p>

                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Hôte
                  <input
                    type="text"
                    value={quickReservationDraft.hote_nom}
                    placeholder="Nom du voyageur"
                    onChange={(event) => handleQuickReservationFieldChange("hote_nom", event.target.value)}
                    autoFocus
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

                <div className="calendar-quick-create-sheet__dates-grid">
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
                      step="0.01"
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
                              className={`calendar-quick-create-sheet__price-chip${isActive ? " calendar-quick-create-sheet__price-chip--active" : ""}`}
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
                              event.target.checked ? [...current, snippet.id] : current.filter((item) => item !== snippet.id)
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
                    <SmsIcon />
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
              <button
                type="button"
                className="calendar-quick-create-sheet__submit"
                onClick={() => void saveQuickReservation()}
                disabled={quickReservationSaving}
              >
                {quickReservationSaving ? "Enregistrement..." : "Mettre à jour"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};

export default TodayPage;

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
import { buildMobileReservationEditorHref } from "./shared/mobileReservationEditor";
import type { Gestionnaire, Gite, Reservation } from "../utils/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOTAL_DAY_COUNT = 14;
const MOBILE_RESERVATION_BREAKPOINT = 760;
const USER_STORAGE_KEY = "contrats-today-user";
const TODAY_RETURN_HREF = "/aujourdhui";
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
  notification_days: number;
  gites: Gite[];
  managers: Gestionnaire[];
  reservations: Reservation[];
  statuses: TodayStatuses;
  source_colors: Record<string, string>;
  unassigned_count: number;
  new_reservations: TodayNewReservationNotification[];
  ical_conflicts: TodayIcalConflict[];
};

type TodayNewReservationNotification = {
  id: string;
  gite_id: string | null;
  gite_nom: string;
  hote_nom: string;
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  prix_total: number;
  source_paiement: string | null;
  created_at: string;
};

type TodayIcalConflictSnapshot = {
  reservation_id: string;
  gite_id: string | null;
  gite_nom: string | null;
  hote_nom: string | null;
  date_entree: string;
  date_sortie: string;
  source_paiement: string | null;
  airbnb_url: string | null;
  commentaire: string | null;
  origin_system: string | null;
  origin_reference: string | null;
  source_type?: string | null;
  final_source?: string | null;
  summary?: string | null;
  description?: string | null;
};

type TodayIcalConflictReservation = {
  id: string;
  gite_id: string | null;
  hote_nom: string;
  date_entree: string;
  date_sortie: string;
  source_paiement: string | null;
  commentaire: string | null;
  airbnb_url: string | null;
  origin_system: string | null;
  origin_reference: string | null;
  gite?: Pick<Gite, "id" | "nom" | "prefixe_contrat" | "ordre"> | null;
};

type TodayIcalConflict = {
  id: string;
  type: "deleted" | "modified";
  status: "open" | "resolved";
  fingerprint: string;
  reservation_id: string;
  gite_id: string | null;
  detected_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_action: "keep_reservation" | "apply_ical" | "delete_reservation" | null;
  reservation_snapshot: TodayIcalConflictSnapshot;
  incoming_snapshot: TodayIcalConflictSnapshot | null;
  reservation: TodayIcalConflictReservation | null;
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

type TodayNotificationItem =
  | {
      id: string;
      kind: "reservation";
      at: string;
      reservation: TodayNewReservationNotification;
    }
  | {
      id: string;
      kind: "ical_conflict";
      at: string;
      conflict: TodayIcalConflict;
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
const formatManagerName = (manager: Gestionnaire) => `${manager.prenom} ${manager.nom}`.trim();
const formatShortDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const formatStayNights = (nights: number) => `${nights} nuit${nights > 1 ? "s" : ""}`;
const formatDateTimeFr = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};
const getReservationDisplayedEnergyCost = (reservation: Reservation | null | undefined) => {
  if (!reservation) return null;

  const hasLiveEnergyData =
    (reservation.energy_live_consumption_kwh ?? 0) > 0 ||
    (reservation.energy_live_cost_eur ?? 0) > 0;
  if (hasLiveEnergyData) {
    return reservation.energy_live_cost_eur ?? 0;
  }

  const hasSavedEnergyData = reservation.energy_consumption_kwh > 0 || reservation.energy_cost_eur > 0;
  return hasSavedEnergyData ? reservation.energy_cost_eur : null;
};
const formatLongDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

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

const getIcalConflictTypeLabel = (type: TodayIcalConflict["type"]) =>
  type === "modified" ? "Modification détectée" : "Suppression détectée";

const getIcalConflictIntro = (conflict: TodayIcalConflict) =>
  conflict.type === "modified"
    ? "La réservation existe encore dans le flux iCal, mais ses informations ont changé. Rien n'a été appliqué automatiquement."
    : "La réservation a disparu du flux iCal. Rien n'a été supprimé automatiquement.";

const getConflictCurrentSnapshot = (conflict: TodayIcalConflict): TodayIcalConflictSnapshot => ({
  reservation_id: conflict.reservation?.id ?? conflict.reservation_snapshot.reservation_id,
  gite_id: conflict.reservation?.gite_id ?? conflict.reservation_snapshot.gite_id,
  gite_nom: conflict.reservation?.gite?.nom ?? conflict.reservation_snapshot.gite_nom,
  hote_nom: conflict.reservation?.hote_nom ?? conflict.reservation_snapshot.hote_nom,
  date_entree: conflict.reservation?.date_entree?.slice(0, 10) ?? conflict.reservation_snapshot.date_entree,
  date_sortie: conflict.reservation?.date_sortie?.slice(0, 10) ?? conflict.reservation_snapshot.date_sortie,
  source_paiement: conflict.reservation?.source_paiement ?? conflict.reservation_snapshot.source_paiement,
  airbnb_url: conflict.reservation?.airbnb_url ?? conflict.reservation_snapshot.airbnb_url,
  commentaire: conflict.reservation?.commentaire ?? conflict.reservation_snapshot.commentaire,
  origin_system: conflict.reservation?.origin_system ?? conflict.reservation_snapshot.origin_system,
  origin_reference: conflict.reservation?.origin_reference ?? conflict.reservation_snapshot.origin_reference,
  source_type: conflict.reservation_snapshot.source_type,
  final_source: conflict.reservation_snapshot.final_source,
  summary: conflict.reservation_snapshot.summary,
  description: conflict.reservation_snapshot.description,
});

const getIcalConflictDiffLabels = (conflict: TodayIcalConflict) => {
  if (conflict.type === "deleted" || !conflict.incoming_snapshot) {
    return ["Absent du flux"];
  }

  const current = getConflictCurrentSnapshot(conflict);
  const next = conflict.incoming_snapshot;
  const labels: string[] = [];
  if (current.date_entree !== next.date_entree || current.date_sortie !== next.date_sortie) labels.push("Dates");
  if ((current.hote_nom ?? "") !== (next.hote_nom ?? "")) labels.push("Nom");
  if ((current.source_paiement ?? "") !== (next.final_source ?? next.source_paiement ?? "")) labels.push("Source");
  if ((current.airbnb_url ?? "") !== (next.airbnb_url ?? "")) labels.push("Lien Airbnb");
  return labels.length > 0 ? labels : ["Métadonnées"];
};

const buildConflictReservationHref = (conflict: TodayIcalConflict) => {
  const current = getConflictCurrentSnapshot(conflict);
  const giteId = current.gite_id;
  if (!giteId) return "/reservations";
  const startDate = parseIsoDate(current.date_entree);
  const params = new URLSearchParams();
  params.set("focus", conflict.reservation_id);
  params.set("year", String(startDate.getUTCFullYear()));
  params.set("tab", giteId);
  return `/reservations?${params.toString()}#reservation-${conflict.reservation_id}`;
};

const buildEventStatusId = (giteId: string, dateIso: string, type: TodayEventType) => `today:${giteId}:${dateIso}:${type}`;

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

const buildReservationHref = (reservationId: string, giteId: string | null | undefined, startDateIso: string) => {
  if (!giteId) return "/reservations";
  const reservationStartDate = parseIsoDate(startDateIso);
  const params = new URLSearchParams();
  params.set("focus", reservationId);
  params.set("year", String(reservationStartDate.getUTCFullYear()));
  params.set("tab", giteId);
  return `/reservations?${params.toString()}#reservation-${reservationId}`;
};

const formatNotificationDayLabel = (dayCount: number) => `${dayCount} jour${dayCount > 1 ? "s" : ""}`;

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

const buildMobileReservationCreateHref = (giteId: string, dateIso: string) => {
  const date = parseIsoDate(dateIso);
  return buildMobileReservationEditorHref({
    mode: "create",
    origin: "today",
    backHref: TODAY_RETURN_HREF,
    giteId,
    entry: dateIso,
    exit: toIsoDate(addUtcDays(date, 1)),
  });
};

const buildMobileReservationEditHref = (reservationId: string) =>
  buildMobileReservationEditorHref({
    mode: "edit",
    origin: "today",
    backHref: TODAY_RETURN_HREF,
    reservationId,
  });

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
  const [notificationDayCount, setNotificationDayCount] = useState(1);
  const [notificationSliderValue, setNotificationSliderValue] = useState(1);
  const [selectedUser, setSelectedUser] = useState(() => getStoredTodayUser());
  const [mobileActionState, setMobileActionState] = useState<TodayMobileActionState>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [usesViewportScroll, setUsesViewportScroll] = useState(() =>
    getMatchesMediaQuery(`(max-width: ${MOBILE_RESERVATION_BREAKPOINT}px)`)
  );

  const loadData = async (options?: { preserveContent?: boolean; notificationDays?: number }) => {
    const shouldShowLoader = !options?.preserveContent || !overview;
    const nextNotificationDays = options?.notificationDays ?? notificationDayCount;
    if (shouldShowLoader) {
      setLoading(true);
    }

    try {
      setError(null);
      const payload = await apiFetch<TodayOverviewPayload>(
        `/today/overview?days=${TOTAL_DAY_COUNT}&notification_days=${nextNotificationDays}`
      );
      setOverview(payload);
      setNotificationDayCount((current) => (current === payload.notification_days ? current : payload.notification_days));
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
    setNotificationSliderValue((current) => (current === notificationDayCount ? current : notificationDayCount));
  }, [notificationDayCount]);

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
  const newReservations = overview?.new_reservations ?? [];
  const icalConflicts = overview?.ical_conflicts ?? [];
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
  }, [usesViewportScroll]);

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

  const notificationItems = useMemo<TodayNotificationItem[]>(
    () =>
      [
        ...newReservations.map(
          (reservation) =>
            ({
              id: `reservation:${reservation.id}`,
              kind: "reservation",
              at: reservation.created_at,
              reservation,
            }) satisfies TodayNotificationItem
        ),
        ...icalConflicts.map(
          (conflict) =>
            ({
              id: `ical-conflict:${conflict.id}`,
              kind: "ical_conflict",
              at: conflict.detected_at,
              conflict,
            }) satisfies TodayNotificationItem
        ),
      ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()),
    [icalConflicts, newReservations]
  );

  const openMobileReservationEditPage = (reservation: Reservation) => {
    navigate(buildMobileReservationEditHref(reservation.id));
  };

  const openMobileActionForEvent = (event: TodayEvent) => {
    if (!usesViewportScroll) {
      navigate(buildReservationFocusHref(event));
      return;
    }

    setMobileActionState((current) => {
      if (event.type === "both") {
        return current?.mode === "rotation-choice" && current.eventId === event.id ? null : { mode: "rotation-choice", eventId: event.id };
      }

      return current?.mode === "actions" && current.reservationId === event.primaryReservation.id
        ? null
        : { mode: "actions", reservationId: event.primaryReservation.id };
    });
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

  const commitNotificationDayCount = (nextValue: number) => {
    if (nextValue === notificationDayCount) return;
    setNotificationDayCount(nextValue);
    void loadData({ preserveContent: true, notificationDays: nextValue });
  };

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

  const resolveIcalConflict = async (
    conflict: TodayIcalConflict,
    action: "keep_reservation" | "apply_ical" | "delete_reservation"
  ) => {
    setResolvingConflictId(conflict.id);
    try {
      setError(null);
      await apiFetch(`/today/ical-conflicts/${encodeURIComponent(conflict.id)}/resolve`, {
        method: "POST",
        json: { action },
      });
      await loadData({ preserveContent: true });
    } catch (err) {
      let message = (err as Error).message;
      if (isApiError(err) && Array.isArray((err.payload as any)?.conflicts)) {
        const conflicts = (err.payload as any).conflicts as Array<{ label?: string }>;
        const suffix = conflicts.map((item) => item.label).filter(Boolean).join(" · ");
        if (suffix) {
          message = `${message} ${suffix}`;
        }
      }
      setError(message);
    } finally {
      setResolvingConflictId(null);
    }
  };

  if (loading) {
    return (
      <div className={`today-page${usesViewportScroll && mobileActionState ? " today-page--mobile-overlay-visible" : ""}`}>
        <section className="card today-hero">
          <div className="section-title">Aujourd&apos;hui</div>
          <div className="field-hint">Chargement de la vue opérationnelle...</div>
        </section>
      </div>
    );
  }

  const hasMobileOverlay = usesViewportScroll && Boolean(mobileActionState);

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
                          onClick={() =>
                            navigate(
                              usesViewportScroll
                                ? buildMobileReservationCreateHref(row.gite.id, day.iso)
                                : buildReservationCreateHref(row.gite.id, day.iso)
                            )
                          }
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

      <section className="today-utility-strip">
        <div className="today-utility-strip__block today-utility-strip__block--trash">
          <span className="today-utility-strip__label">Poubelles</span>
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
          <span className="today-utility-strip__detail">
            Semaine {evenWeek ? "paire" : "impaire"}
            {unassignedCount > 0 ? ` · ${unassignedCount} sans gîte masquée(s)` : ""}
          </span>
        </div>

        <div className="today-utility-strip__block today-utility-strip__block--fill">
          <span className="today-utility-strip__label">Remplissage du jour</span>
          <div className="today-utility-strip__fill">
            <OccupationGaugeDial
              id={`today-fill-rate-${todayIso}`}
              occupation={filledGiteRate}
              highlighted={false}
              animate={false}
              size={{ width: 60, height: 28 }}
              className="today-utility-strip__fill-gauge"
            />
            <div className="today-utility-strip__fill-copy">
              <strong>{Math.round(filledGiteRate * 100)}%</strong>
              <span>
                {filledGiteCount}/{gites.length || 0} gîte{gites.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        <div className="today-utility-strip__block today-utility-strip__block--archive">
          <div className="today-utility-strip__slider-head">
            <span className="today-utility-strip__label">Archives notifications</span>
            <strong>{formatNotificationDayLabel(notificationSliderValue)}</strong>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={notificationSliderValue}
            className="today-utility-strip__slider"
            onChange={(event) => setNotificationSliderValue(Number(event.target.value))}
            onPointerUp={() => commitNotificationDayCount(notificationSliderValue)}
            onBlur={() => commitNotificationDayCount(notificationSliderValue)}
            onKeyUp={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                return;
              }
              commitNotificationDayCount(Number((event.currentTarget as HTMLInputElement).value));
            }}
            aria-label="Nombre de jours d'archives des notifications"
          />
          <div className="today-utility-strip__scale" aria-hidden="true">
            <span>1 j</span>
            <span>5 j</span>
          </div>
        </div>
      </section>

      <section className="today-notifications-card">
        <div className="today-section-head today-section-head--notifications">
          <div>
            <div className="section-title">Centre de notifications</div>
            <div className="field-hint">
              {notificationItems.length} notification{notificationItems.length > 1 ? "s" : ""} sur{" "}
              {formatNotificationDayLabel(notificationDayCount)}
            </div>
          </div>
        </div>

        {notificationItems.length === 0 ? (
          <div className="today-notifications-empty">Aucun conflit iCal ni nouvelle réservation sur cette période.</div>
        ) : (
          <div className="today-notifications-list">
            {notificationItems.map((item) => {
              if (item.kind === "reservation") {
                const reservation = item.reservation;
                const reservationSourceColor = getPaymentColorFromMap(reservation.source_paiement, paymentColorMap);

                return (
                  <article
                    key={item.id}
                    className="today-notification-card today-notification-card--reservation"
                    style={{ "--today-notification-accent": reservationSourceColor } as CSSProperties}
                  >
                    <div className="today-notification-card__top">
                      <div className="today-notification-card__header">
                        <span className="today-notification-card__kind today-notification-card__kind--reservation">
                          Nouvelle réservation
                        </span>
                        <strong>{reservation.gite_nom || "Sans gîte"}</strong>
                        <span>Créée le {formatDateTimeFr(reservation.created_at)}</span>
                      </div>
                    </div>

                    <div className="today-notification-card__reservation-body">
                      <strong className="today-notification-card__headline">{reservation.hote_nom || "Réservation"}</strong>
                      <div className="today-notification-card__dates">
                        {formatLongDate(reservation.date_entree)} → {formatLongDate(reservation.date_sortie)}
                      </div>
                      <div className="today-notification-card__meta">
                        <span>
                          {reservation.nb_nuits} nuit{reservation.nb_nuits > 1 ? "s" : ""}
                        </span>
                        <span>{reservation.source_paiement || "A définir"}</span>
                      </div>
                    </div>

                    <div className="today-notification-card__reservation-footer">
                      <div className="today-notification-card__metric">
                        <span>Montant</span>
                        <strong>{formatEuro(reservation.prix_total)}</strong>
                      </div>
                      <button
                        type="button"
                        className="table-action"
                        onClick={() => navigate(buildReservationHref(reservation.id, reservation.gite_id, reservation.date_entree))}
                      >
                        Ouvrir
                      </button>
                    </div>
                  </article>
                );
              }

              const conflict = item.conflict;
              const current = getConflictCurrentSnapshot(conflict);
              const incoming = conflict.incoming_snapshot;
              const diffLabels = getIcalConflictDiffLabels(conflict);
              const canApplyIcal = conflict.type === "modified" && Boolean(incoming) && Boolean(conflict.reservation);

              return (
                <article key={item.id} className={`today-conflict-card today-conflict-card--${conflict.type}`}>
                  <div className="today-conflict-card__top">
                    <div className="today-conflict-card__header">
                      <span className={`today-conflict-card__kind today-conflict-card__kind--${conflict.type}`}>
                        {getIcalConflictTypeLabel(conflict.type)}
                      </span>
                      <strong>{current.gite_nom || "Sans gîte"}</strong>
                      <span>Détecté le {formatDateTimeFr(conflict.detected_at)}</span>
                    </div>

                    <div className="today-conflict-card__diffs">
                      {diffLabels.map((label) => (
                        <span key={`${conflict.id}:${label}`} className="today-conflict-card__diff-chip">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <p className="today-conflict-card__intro">{getIcalConflictIntro(conflict)}</p>

                  <div className="today-conflict-card__grid">
                    <section className="today-conflict-card__panel">
                      <span className="today-conflict-card__panel-label">Réservation actuelle</span>
                      <strong>{current.hote_nom || "Réservation"}</strong>
                      <div className="today-conflict-card__dates">
                        {formatLongDate(current.date_entree)} → {formatLongDate(current.date_sortie)}
                      </div>
                      <div className="today-conflict-card__meta">
                        <span>{current.source_paiement || "A définir"}</span>
                        {current.origin_reference ? <span>UID {current.origin_reference}</span> : null}
                      </div>
                      {current.commentaire ? <div className="today-conflict-card__note">{current.commentaire}</div> : null}
                    </section>

                    <section className="today-conflict-card__panel today-conflict-card__panel--incoming">
                      <span className="today-conflict-card__panel-label">Version iCal</span>
                      {incoming ? (
                        <>
                          <strong>{incoming.hote_nom || incoming.summary || "Événement iCal"}</strong>
                          <div className="today-conflict-card__dates">
                            {formatLongDate(incoming.date_entree)} → {formatLongDate(incoming.date_sortie)}
                          </div>
                          <div className="today-conflict-card__meta">
                            <span>{incoming.final_source || incoming.source_paiement || incoming.source_type || "iCal"}</span>
                            {incoming.summary ? <span>{incoming.summary}</span> : null}
                          </div>
                          {incoming.description ? <div className="today-conflict-card__note">{incoming.description}</div> : null}
                        </>
                      ) : (
                        <>
                          <strong>Absente du flux iCal</strong>
                          <div className="today-conflict-card__empty">
                            Aucun événement correspondant n&apos;a été retrouvé lors de la dernière synchronisation.
                          </div>
                        </>
                      )}
                    </section>
                  </div>

                  <div className="today-conflict-card__actions">
                    <button
                      type="button"
                      className="table-action table-action--neutral"
                      onClick={() => void resolveIcalConflict(conflict, "keep_reservation")}
                      disabled={resolvingConflictId === conflict.id}
                    >
                      Conserver
                    </button>
                    {conflict.type === "modified" ? (
                      <button
                        type="button"
                        className="table-action table-action--primary"
                        onClick={() => void resolveIcalConflict(conflict, "apply_ical")}
                        disabled={!canApplyIcal || resolvingConflictId === conflict.id}
                      >
                        Appliquer iCal
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="table-action table-action--danger"
                        onClick={() => void resolveIcalConflict(conflict, "delete_reservation")}
                        disabled={resolvingConflictId === conflict.id}
                      >
                        Supprimer la réservation
                      </button>
                    )}
                    <button
                      type="button"
                      className="table-action"
                      onClick={() => navigate(buildConflictReservationHref(conflict))}
                    >
                      Ouvrir
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
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

      {error ? <div className="note">{error}</div> : null}

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
            {
              label: "Total",
              value: formatEuro(mobileActionReservation.prix_total, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              }),
            },
            ...(getReservationDisplayedEnergyCost(mobileActionReservation) !== null
              ? [{ label: "Conso", value: formatEuro(getReservationDisplayedEnergyCost(mobileActionReservation) ?? 0) }]
              : []),
          ]}
          onClose={() => setMobileActionState(null)}
          onEdit={() => openMobileReservationEditPage(mobileActionReservation)}
          phoneHref={buildTelephoneHref(mobileActionReservation.telephone)}
          smsHref={buildSmsHref(mobileActionReservation.telephone ?? "")}
          airbnbUrl={mobileActionReservation.airbnb_url}
        />
      ) : null}
    </div>
  );
};

export default TodayPage;

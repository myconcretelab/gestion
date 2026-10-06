import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { apiFetch, ApiError, isAbortError } from "./utils/api";
import { AUTH_REQUIRED_EVENT, setCurrentAuthUser, type AppPageId, type AppUser, type ServerAuthSession } from "./utils/auth";
import { APP_NOTICE_EVENT, type AppNotice } from "./utils/appNotices";
import { BOOKING_REQUESTS_CHANGED_EVENT } from "./utils/bookingRequestsBadge";
import { RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT } from "./utils/recentImportsBadge";

const GitesPage = lazy(() => import("./pages/GitesPage"));
const ContratsListPage = lazy(() => import("./pages/ContratsListPage"));
const ContratFormPage = lazy(() => import("./pages/ContratFormPage"));
const ContratDetailPage = lazy(() => import("./pages/ContratDetailPage"));
const FacturesListPage = lazy(() => import("./pages/FacturesListPage"));
const FactureFormPage = lazy(() => import("./pages/FactureFormPage"));
const FactureDetailPage = lazy(() => import("./pages/FactureDetailPage"));
const ReservationsPage = lazy(() => import("./pages/ReservationsPage"));
const BookingRequestsPage = lazy(() => import("./pages/BookingRequestsPage"));
const BookingRequestDetailPage = lazy(() => import("./pages/BookingRequestDetailPage"));
const MobileReservationEditorPage = lazy(() => import("./pages/MobileReservationEditorPage"));
const CalendrierPage = lazy(() => import("./pages/CalendrierPage"));
const StatisticsPage = lazy(() => import("./pages/StatisticsPage"));
const PersonalExpensesPage = lazy(() => import("./pages/PersonalExpensesPage"));
const ProfessionalExpensesPage = lazy(() => import("./pages/ProfessionalExpensesPage"));
const SeasonRatesPage = lazy(() => import("./pages/SeasonRatesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const IntervenantsPage = lazy(() => import("./pages/IntervenantsPage"));
const TodayPage = lazy(() => import("./pages/TodayPage"));
const OperationsPrintPage = lazy(() => import("./pages/OperationsPrintPage"));
const PublicPlanningRelayPage = lazy(() => import("./pages/PublicPlanningRelayPage"));

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
);

type RecentImportedReservationsCountPayload = {
  count: number;
  since: string;
};

type PendingBookingRequestsCountPayload = {
  count: number;
};

type IcalAutoSyncResultSummary = {
  created_count: number;
  updated_count: number;
  pump_follow_up?: {
    status: "success" | "error";
    message: string;
  };
};

type IcalAutoSyncResponse = {
  status: "success" | "skipped-disabled" | "skipped-no-sources" | "skipped-recent" | "shared-running";
  summary: IcalAutoSyncResultSummary | null;
  message: string;
};

type PumpHealthNotice = {
  status: "connected" | "stale" | "auth_required" | "refresh_failed" | "disabled";
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  summary: string;
};

type LoginResult = ServerAuthSession;
type LoginUser = Pick<AppUser, "id" | "displayName">;

const ICAL_AUTO_SYNC_SESSION_KEY = "ical-auto-sync-attempted";
const ICAL_AUTO_SYNC_TIMEOUT_MS = 15_000;
let appLoadIcalAutoSyncPromise: Promise<IcalAutoSyncResponse> | null = null;

const readSessionStorageItem = (key: string) => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSessionStorageItem = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Safari peut refuser le storage dans certains contextes; on ignore et on continue.
  }
};

const formatSessionDurationLabel = (hours: number) => {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} jour${days > 1 ? "s" : ""}`;
  }
  return `${hours} heure${hours > 1 ? "s" : ""}`;
};

const buildIcalAutoSyncNotice = (result: IcalAutoSyncResponse): AppNotice => {
  if ((result.status === "success" || result.status === "shared-running") && result.summary) {
    const pumpNotice =
      result.summary.pump_follow_up?.status === "success"
        ? " · Pump relancé"
        : result.summary.pump_follow_up?.status === "error"
          ? " · Pump auto en échec"
          : "";

    if (result.summary.pump_follow_up?.status === "error") {
      return {
        label: "iCal",
        tone: "warning",
        message:
          result.summary.created_count <= 0 && result.summary.updated_count <= 0
            ? `iCal a jour${pumpNotice}`
            : `${result.summary.created_count} ajout(s), ${result.summary.updated_count} mise(s) a jour${pumpNotice}`,
        timeoutMs: 5_200,
      };
    }

    if (result.summary.created_count <= 0 && result.summary.updated_count <= 0) {
      return {
        label: "iCal",
        tone: "success",
        message: `iCal a jour${pumpNotice}`,
        timeoutMs: 4_200,
      };
    }

    return {
      label: "iCal",
      tone: "success",
      message: `${result.summary.created_count} ajout(s), ${result.summary.updated_count} mise(s) a jour${pumpNotice}`,
      timeoutMs: 4_200,
    };
  }

  if (result.status === "skipped-no-sources") {
    return {
      label: "iCal",
      tone: "neutral",
      message: "Aucune source iCal active",
      timeoutMs: 2_600,
    };
  }

  if (result.status === "skipped-recent") {
    return {
      label: "iCal",
      tone: "neutral",
      message: "Import iCal recent deja lance",
      timeoutMs: 2_600,
    };
  }

  if (result.status === "shared-running") {
    return {
      label: "iCal",
      tone: "neutral",
      message: "Import iCal deja en cours",
      timeoutMs: 2_600,
    };
  }

  return {
    label: "iCal",
    tone: "neutral",
    message: "Import iCal auto desactive",
    timeoutMs: 2_600,
  };
};

const getAppLoadIcalAutoSyncPromise = () => {
  if (typeof window === "undefined") return null;
  if (readSessionStorageItem(ICAL_AUTO_SYNC_SESSION_KEY) !== "1") {
    writeSessionStorageItem(ICAL_AUTO_SYNC_SESSION_KEY, "1");
  }

  if (!appLoadIcalAutoSyncPromise) {
    appLoadIcalAutoSyncPromise = new Promise<IcalAutoSyncResponse>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("Le chargement iCal prend trop de temps."));
      }, ICAL_AUTO_SYNC_TIMEOUT_MS);

      apiFetch<IcalAutoSyncResponse>("/settings/ical/auto-sync", {
        method: "POST",
      })
        .then(resolve)
        .catch(reject)
        .finally(() => {
          window.clearTimeout(timeoutId);
        });
    });
  }

  return appLoadIcalAutoSyncPromise;
};

type AuthScreenProps = {
  session: ServerAuthSession | null;
  users: LoginUser[];
  userId: string;
  password: string;
  error: string | null;
  submitting: boolean;
  onUserChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

const AuthScreen = ({ session, users, userId, password, error, submitting, onUserChange, onPasswordChange, onSubmit }: AuthScreenProps) => (
  <main className="auth-shell">
    <section className="card auth-card">
      <div className="auth-card__eyebrow">Protection serveur</div>
      <h1 className="auth-card__title">Connexion requise</h1>
      <p className="auth-card__text">
        Sélectionnez votre utilisateur puis entrez le mot de passe pour ouvrir l’application.
      </p>
      <label className="field">
        Utilisateur
        <select value={userId} onChange={(event) => onUserChange(event.target.value)} disabled={submitting || users.length === 0} autoFocus>
          <option value="">Sélectionner un utilisateur</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
        </select>
      </label>
      <label className="field">
        Mot de passe
        <input
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          disabled={submitting}
        />
      </label>
      <div className="field-hint">
        Session par défaut: {formatSessionDurationLabel(session?.sessionDurationHours ?? 24 * 7)}.
      </div>
      {error ? <div className="note" style={{ marginTop: 12 }}>{error}</div> : null}
      <div className="actions" style={{ marginTop: 16 }}>
        <button type="button" onClick={onSubmit} disabled={submitting || !userId || !password.trim()}>
          {submitting ? "Connexion..." : "Se connecter"}
        </button>
      </div>
    </section>
  </main>
);

const AmountsAccess = ({ allowed, children }: { allowed: boolean; children: ReactNode }) =>
  allowed ? children : (
    <section className="card access-restricted">
      <h1>Accès restreint</h1>
      <p>Votre profil ne permet pas de consulter les montants en euros.</p>
    </section>
  );

const PageAccess = ({ allowed, children }: { allowed: boolean; children: ReactNode }) =>
  allowed ? children : (
    <section className="card access-restricted">
      <h1>Page non autorisée</h1>
      <p>Cette page n’est pas activée pour votre utilisateur.</p>
    </section>
  );

const App = () => {
  const location = useLocation();
  const [authSession, setAuthSession] = useState<ServerAuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authPassword, setAuthPassword] = useState("");
  const [authUsers, setAuthUsers] = useState<LoginUser[]>([]);
  const [authUserId, setAuthUserId] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recentImportedReservationsCount, setRecentImportedReservationsCount] = useState(0);
  const [pendingBookingRequestsCount, setPendingBookingRequestsCount] = useState(0);
  const [appNotice, setAppNotice] = useState<(AppNotice & { id: number }) | null>(null);
  const [pumpHealthNotice, setPumpHealthNotice] = useState<PumpHealthNotice | null>(null);
  const isAuthenticated = authSession?.authenticated ?? false;
  const isAuthRequired = authSession?.required ?? false;
  const currentUser = authSession?.user ?? null;
  const canViewAmounts = currentUser?.permissions.canViewAmounts ?? true;
  const canWrite = currentUser?.permissions.canWrite ?? true;
  const canAccessPage = (page: AppPageId) => !currentUser || currentUser.permissions.isOwner || currentUser.pageAccess.includes(page);
  const canAccessSettings = canAccessPage("settings");
  const isContratsSection =
    location.pathname === "/contrats" ||
    location.pathname.startsWith("/contrats/");
  const isFacturesSection =
    location.pathname === "/factures" ||
    location.pathname.startsWith("/factures/");
  const isReservationsSection =
    location.pathname === "/reservations" ||
    location.pathname.startsWith("/reservations/");
  const isBookingRequestsSection =
    location.pathname === "/demandes" ||
    location.pathname.startsWith("/demandes/");
  const isTodaySection =
    location.pathname === "/aujourdhui" ||
    location.pathname.startsWith("/aujourdhui/");
  const isCalendarSection =
    location.pathname === "/calendrier" ||
    location.pathname.startsWith("/calendrier/");
  const isOperationsSection =
    location.pathname === "/planning-relais" ||
    location.pathname.startsWith("/planning-relais/");
  const isStatsSection =
    location.pathname === "/statistiques" ||
    location.pathname.startsWith("/statistiques/");
  const isExpensesSection =
    location.pathname === "/frais-personnels" ||
    location.pathname.startsWith("/frais-personnels/");
  const isProfessionalExpensesSection =
    location.pathname === "/frais-professionnels" ||
    location.pathname.startsWith("/frais-professionnels/");
  const isSeasonRatesSection =
    location.pathname === "/tarifs" ||
    location.pathname.startsWith("/tarifs/");
  const isInterventionsSection =
    location.pathname === "/interventions" ||
    location.pathname.startsWith("/interventions/");
  const isSettingsSection =
    location.pathname === "/parametres" ||
    location.pathname.startsWith("/parametres/");
  const navItems = [
    {
      to: "/aujourdhui",
      pageId: "today" as const,
      label: "Aujourd'hui",
      isActive: isTodaySection,
      mobilePrimary: true,
    },
    {
      to: "/reservations",
      pageId: "reservations" as const,
      label: "Réservations",
      isActive: isReservationsSection,
    },
    {
      to: "/demandes",
      pageId: "booking_requests" as const,
      label: "Demandes",
      isActive: isBookingRequestsSection,
    },
    {
      to: "/calendrier",
      pageId: "calendar" as const,
      label: "Calendrier",
      isActive: isCalendarSection,
      mobilePrimary: true,
    },
    {
      to: "/planning-relais",
      pageId: "planning_relay" as const,
      label: "Planning relais",
      isActive: isOperationsSection,
      desktopOverflow: true,
    },
    {
      to: "/contrats",
      pageId: "contracts" as const,
      label: "Contrats",
      isActive: isContratsSection,
      requiresAmounts: true,
    },
    {
      to: "/factures",
      pageId: "invoices" as const,
      label: "Factures",
      isActive: isFacturesSection,
      desktopOverflow: true,
      requiresAmounts: true,
    },
    {
      to: "/gites",
      pageId: "gites" as const,
      label: "Gîtes",
      isActive: location.pathname === "/gites" || location.pathname.startsWith("/gites/"),
      desktopOverflow: true,
      requiresAmounts: true,
    },
    {
      to: "/frais-professionnels",
      pageId: "professional_expenses" as const,
      label: "Frais professionnels",
      isActive: isProfessionalExpensesSection,
      desktopOverflow: true,
      requiresAmounts: true,
    },
    {
      to: "/frais-personnels",
      pageId: "personal_expenses" as const,
      label: "Frais personnels",
      isActive: isExpensesSection,
      desktopOverflow: true,
      requiresAmounts: true,
    },
    {
      to: "/statistiques",
      pageId: "statistics" as const,
      label: "Statistiques",
      isActive: isStatsSection,
      desktopOverflow: true,
      requiresAmounts: true,
    },
    {
      to: "/tarifs",
      pageId: "rates" as const,
      label: "Tarifs",
      isActive: isSeasonRatesSection,
      desktopOverflow: true,
      requiresAmounts: true,
    },
    {
      to: "/interventions",
      pageId: "settings" as const,
      label: "Interventions",
      isActive: isInterventionsSection,
      desktopOverflow: true,
      requiresAmounts: true,
    },
    {
      to: "/parametres",
      pageId: "settings" as const,
      label: "Paramètres",
      isActive: isSettingsSection,
      desktopOverflow: true,
    },
  ];
  const visibleNavItems = navItems.filter((item) => canAccessPage(item.pageId) && !(item.requiresAmounts && !canViewAmounts));
  const desktopPrimaryItems = visibleNavItems.filter((item) => !item.desktopOverflow);
  const desktopOverflowItems = visibleNavItems.filter((item) => item.desktopOverflow);
  const mobilePrimaryItems = visibleNavItems.filter((item) => item.mobilePrimary);
  const mobileOverflowItems = visibleNavItems.filter((item) => !item.mobilePrimary);
  const reservationBadgeLabel =
    recentImportedReservationsCount > 0
      ? `${recentImportedReservationsCount} nouvelle${recentImportedReservationsCount > 1 ? "s" : ""} réservation${recentImportedReservationsCount > 1 ? "s" : ""} sur les dernières 24 heures`
        : null;
  const bookingRequestsBadgeLabel =
    pendingBookingRequestsCount > 0
      ? `${pendingBookingRequestsCount} demande${pendingBookingRequestsCount > 1 ? "s" : ""} à traiter`
      : null;

  const pushAppNotice = useCallback((notice: AppNotice) => {
    setAppNotice({
      ...notice,
      id: Date.now() + Math.random(),
    });
  }, []);
  const loadAuthSession = async () => {
    setAuthError(null);
    const payload = await apiFetch<ServerAuthSession>("/auth/session");
    setCurrentAuthUser(payload.user);
    setAuthSession(payload);
    return payload;
  };

  const loadAuthUsers = async () => {
    const users = await apiFetch<LoginUser[]>("/auth/users");
    setAuthUsers(users);
    setAuthUserId((current) => current && users.some((user) => user.id === current) ? current : users[0]?.id ?? "");
  };

  const submitLogin = async () => {
    if (!authUserId || !authPassword.trim()) {
      setAuthError("Sélectionne un utilisateur et renseigne le mot de passe.");
      return;
    }

    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const payload = await apiFetch<LoginResult>("/auth/login", {
        method: "POST",
        json: { userId: authUserId, password: authPassword },
      });
      setCurrentAuthUser(payload.user);
      setAuthSession(payload);
      setAuthPassword("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthError("Mot de passe invalide.");
      } else {
        setAuthError(error instanceof Error ? error.message : "Impossible d'ouvrir la session.");
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const logout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Le cookie local doit être considéré perdu même si la session serveur n'a pas pu être détruite.
    } finally {
      setAuthSession((current) =>
        current
          ? {
              ...current,
              authenticated: false,
              sessionExpiresAt: null,
              user: null,
            }
          : {
              required: true,
              authenticated: false,
              passwordConfigured: true,
              sessionDurationHours: 24 * 7,
              sessionExpiresAt: null,
              user: null,
            }
      );
      setCurrentAuthUser(null);
      setAuthPassword("");
      setAuthError(null);
      setMobileMenuOpen(false);
    }
  };

  const loadRecentImportedReservationsCount = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await apiFetch<RecentImportedReservationsCountPayload>("/reservations/recent-imports/count", {
        signal,
      });
      setRecentImportedReservationsCount(Math.max(0, Number(payload.count) || 0));
    } catch (error) {
      if (!isAbortError(error)) {
        setRecentImportedReservationsCount(0);
        console.error(error);
      }
    }
  }, []);

  const loadPendingBookingRequestsCount = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await apiFetch<PendingBookingRequestsCountPayload>("/booking-requests/pending/count", {
        signal,
      });
      setPendingBookingRequestsCount(Math.max(0, Number(payload.count) || 0));
    } catch (error) {
      if (!isAbortError(error)) {
        setPendingBookingRequestsCount(0);
        console.error(error);
      }
    }
  }, []);

  const loadPumpHealth = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await apiFetch<PumpHealthNotice>("/settings/pump/health", { signal });
      setPumpHealthNotice(payload);
    } catch (error) {
      if (!isAbortError(error)) {
        setPumpHealthNotice({
          status: "refresh_failed",
          tone: "danger",
          label: "Pump indisponible",
          summary: "Impossible de charger l'etat Pump.",
        });
        console.error(error);
      }
    }
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    setAuthLoading(true);
    Promise.all([loadAuthSession(), loadAuthUsers()])
      .catch((error) => {
        if (!active || isAbortError(error)) return;
        setAuthError(error instanceof Error ? error.message : "Impossible de vérifier la session.");
      })
      .finally(() => {
        if (active) {
          setAuthLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleAuthRequired = () => {
      setAuthSession((current) =>
        current
          ? {
              ...current,
              required: true,
              authenticated: false,
              sessionExpiresAt: null,
              user: null,
            }
          : {
              required: true,
              authenticated: false,
              passwordConfigured: true,
              sessionDurationHours: 24 * 7,
              sessionExpiresAt: null,
              user: null,
            }
      );
      setCurrentAuthUser(null);
      setAuthError("La session a expiré. Reconnecte-toi.");
    };

    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired as EventListener);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired as EventListener);
    };
  }, []);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    const controller = new AbortController();
    if (canAccessPage("reservations")) void loadRecentImportedReservationsCount(controller.signal);
    if (canAccessPage("booking_requests")) void loadPendingBookingRequestsCount(controller.signal);
    if (canAccessSettings) void loadPumpHealth(controller.signal);
    const pollId = window.setInterval(() => {
      if (canAccessSettings) void loadPumpHealth();
      if (canAccessPage("booking_requests")) void loadPendingBookingRequestsCount();
    }, 60_000);

    const handleRecentImportedReservationsCreated = (event: Event) => {
      const customEvent = event as CustomEvent<{ createdCount?: number }>;
      const createdCount = Math.max(0, Number(customEvent.detail?.createdCount) || 0);
      if (createdCount <= 0) return;
      setRecentImportedReservationsCount((current) => current + createdCount);
    };

    window.addEventListener(
      RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT,
      handleRecentImportedReservationsCreated as EventListener
    );
    const handleBookingRequestsChanged = () => {
      void loadPendingBookingRequestsCount();
    };
    window.addEventListener(BOOKING_REQUESTS_CHANGED_EVENT, handleBookingRequestsChanged);

    return () => {
      controller.abort();
      window.clearInterval(pollId);
      window.removeEventListener(
        RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT,
        handleRecentImportedReservationsCreated as EventListener
      );
      window.removeEventListener(BOOKING_REQUESTS_CHANGED_EVENT, handleBookingRequestsChanged);
    };
  }, [authLoading, canAccessSettings, currentUser, isAuthenticated, loadPendingBookingRequestsCount, loadPumpHealth, loadRecentImportedReservationsCount]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !canWrite || !canAccessSettings) return;
    if (typeof window === "undefined") return;
    const hasAttempted = readSessionStorageItem(ICAL_AUTO_SYNC_SESSION_KEY) === "1";
    if (hasAttempted && !appLoadIcalAutoSyncPromise) return;
    let active = true;

    const runAutoSync = async () => {
      pushAppNotice({
        label: "iCal",
        tone: "neutral",
        message: "Import iCal...",
        timeoutMs: null,
      });

      try {
        const promise = getAppLoadIcalAutoSyncPromise();
        if (!promise) return;
        const result = await promise;
        if (!active) return;
        pushAppNotice(buildIcalAutoSyncNotice(result));
        if (result.status === "success" || result.status === "shared-running") {
          void loadRecentImportedReservationsCount();
        }
      } catch (error) {
        if (!active) return;
        pushAppNotice({
          label: "iCal",
          tone: isAbortError(error) ? "neutral" : "error",
          message: isAbortError(error) ? "Import iCal interrompu" : error instanceof Error ? error.message : "Echec import iCal",
          timeoutMs: 5_200,
          role: isAbortError(error) ? "status" : "alert",
        });
      }
    };

    void runAutoSync();

    return () => {
      active = false;
    };
  }, [authLoading, canAccessSettings, canWrite, isAuthenticated, loadRecentImportedReservationsCount, pushAppNotice]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleAppNotice = (event: Event) => {
      const notice = (event as CustomEvent<AppNotice>).detail;
      if (!notice) return;
      pushAppNotice(notice);
    };

    window.addEventListener(APP_NOTICE_EVENT, handleAppNotice as EventListener);
    return () => {
      window.removeEventListener(APP_NOTICE_EVENT, handleAppNotice as EventListener);
    };
  }, [pushAppNotice]);

  useEffect(() => {
    if (!appNotice || !appNotice.timeoutMs) return;
    const noticeId = appNotice.id;

    const timeoutId = window.setTimeout(() => {
      setAppNotice((current) => (current?.id === noticeId ? null : current));
    }, appNotice.timeoutMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [appNotice]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const rootStyle = document.documentElement.style;

    const updateViewportCssVars = () => {
      const visualViewport = window.visualViewport;
      const viewportHeight = Math.round(visualViewport?.height ?? window.innerHeight);
      const viewportOffsetBottom = Math.max(
        0,
        Math.round(window.innerHeight - (visualViewport?.height ?? window.innerHeight) - (visualViewport?.offsetTop ?? 0))
      );

      rootStyle.setProperty("--app-height", `${viewportHeight}px`);
      rootStyle.setProperty("--viewport-offset-bottom", `${viewportOffsetBottom}px`);
    };

    updateViewportCssVars();

    window.addEventListener("resize", updateViewportCssVars, { passive: true });
    window.visualViewport?.addEventListener("resize", updateViewportCssVars);
    window.visualViewport?.addEventListener("scroll", updateViewportCssVars);

    return () => {
      window.removeEventListener("resize", updateViewportCssVars);
      window.visualViewport?.removeEventListener("resize", updateViewportCssVars);
      window.visualViewport?.removeEventListener("scroll", updateViewportCssVars);
    };
  }, []);

  const renderNavLabel = (item: { to: string; label: string; mobileLabel?: string }) => (
    <span className={`nav-item-label${item.to === "/reservations" || item.to === "/demandes" ? " nav-item-label--with-badge" : ""}`}>
      <span className="nav__label">{item.mobileLabel ?? item.label}</span>
      {item.to === "/reservations" && recentImportedReservationsCount > 0 ? (
        <span
          className="nav-badge nav-badge--reservation"
          aria-label={reservationBadgeLabel ?? undefined}
          title={reservationBadgeLabel ?? undefined}
        >
          {recentImportedReservationsCount}
        </span>
      ) : null}
      {item.to === "/demandes" && pendingBookingRequestsCount > 0 ? (
        <span
          className="nav-badge nav-badge--reservation"
          aria-label={bookingRequestsBadgeLabel ?? undefined}
          title={bookingRequestsBadgeLabel ?? undefined}
        >
          {pendingBookingRequestsCount}
        </span>
      ) : null}
    </span>
  );

  if (location.pathname.startsWith("/r/") || location.pathname.startsWith("/relais/")) {
    return (
      <Suspense fallback={<main className="public-relay-state">Chargement du planning…</main>}>
        <Routes>
          <Route path="/r/:token" element={<PublicPlanningRelayPage />} />
          <Route path="/relais/:token" element={<PublicPlanningRelayPage />} />
        </Routes>
      </Suspense>
    );
  }

  if (authLoading) {
    return (
      <main className="auth-shell">
        <section className="card auth-card">
          <div className="auth-card__eyebrow">Protection serveur</div>
          <h1 className="auth-card__title">Vérification de session</h1>
          <p className="auth-card__text">Le serveur vérifie si une session valide existe déjà.</p>
        </section>
      </main>
    );
  }

  if (isAuthRequired && !isAuthenticated) {
    return (
      <AuthScreen
        session={authSession}
        users={authUsers}
        userId={authUserId}
        password={authPassword}
        error={authError}
        submitting={authSubmitting}
        onUserChange={setAuthUserId}
        onPasswordChange={setAuthPassword}
        onSubmit={() => void submitLogin()}
      />
    );
  }

  return (
    <div className={`app${canWrite ? "" : " app--read-only"}${canViewAmounts ? "" : " app--amounts-hidden"}`}>
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Les gîtes de Brocéliande" />
          {pumpHealthNotice ? (
            <span
              className={`pump-indicator pump-indicator--${pumpHealthNotice.tone}`}
              title={`Pump: ${pumpHealthNotice.label}. ${pumpHealthNotice.summary}`}
              aria-label={`Statut Pump: ${pumpHealthNotice.label}`}
            >
              <span className={`pump-indicator__dot pump-indicator__dot--${pumpHealthNotice.tone}`} aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <nav className="nav">
          {desktopPrimaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={() => (item.isActive ? "active" : undefined)}
              aria-current={item.isActive ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
            >
              {renderNavLabel(item)}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-desktop-menu">
          {currentUser ? <span className="topbar-user" title={currentUser.status === "owner" ? "Propriétaire" : currentUser.status === "worker" ? "Intervenant" : "Utilisateur personnalisé"}>{currentUser.displayName}</span> : null}
          {!canWrite ? <span className="access-badge">Lecture seule</span> : null}
          {!canViewAmounts ? <span className="access-badge">Montants masqués</span> : null}
          {isAuthRequired ? (
            <button
              type="button"
              className="secondary topbar-auth-action"
              onClick={() => void logout()}
              title={
                authSession?.sessionExpiresAt
                  ? `Session active jusqu'au ${new Date(authSession.sessionExpiresAt).toLocaleString("fr-FR")}`
                  : "Déconnecter la session"
              }
            >
              Déconnexion
            </button>
          ) : null}
          <button
            type="button"
            className={`topbar-menu-button topbar-menu-button--desktop${mobileMenuOpen ? " topbar-menu-button--active" : ""}`}
            aria-expanded={mobileMenuOpen}
            aria-controls="desktop-navigation-overflow"
            aria-label={mobileMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            <span className="topbar-menu-button__icon" aria-hidden="true">
              <MenuIcon />
            </span>
          </button>
        </div>
        <nav
          id="desktop-navigation-overflow"
          className={`overflow-nav overflow-nav--desktop${mobileMenuOpen ? " overflow-nav--open" : ""}`}
          aria-label="Navigation secondaire"
        >
          {desktopOverflowItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={() => (item.isActive ? "active" : undefined)}
              aria-current={item.isActive ? "page" : undefined}
            >
              {renderNavLabel(item)}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-mobile-links">
          {mobilePrimaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={() => `topbar-mobile-links__item${item.isActive ? " topbar-mobile-links__item--active" : ""}`}
              aria-current={item.isActive ? "page" : undefined}
            >
              {renderNavLabel(item)}
            </NavLink>
          ))}
        </div>
        <div className="topbar-mobile-menu">
          <button
            type="button"
            className={`topbar-menu-button topbar-menu-button--mobile${mobileMenuOpen ? " topbar-menu-button--active" : ""}`}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-overflow"
            aria-label={mobileMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            <span className="topbar-menu-button__icon" aria-hidden="true">
              <MenuIcon />
            </span>
          </button>
        </div>
        <nav
          id="mobile-navigation-overflow"
          className={`overflow-nav overflow-nav--mobile${mobileMenuOpen ? " overflow-nav--open" : ""}`}
          aria-label="Navigation mobile"
        >
          {mobileOverflowItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={() => (item.isActive ? "active" : undefined)}
              aria-current={item.isActive ? "page" : undefined}
            >
              {renderNavLabel(item)}
            </NavLink>
          ))}
          {isAuthRequired ? (
            <button type="button" className="secondary topbar-auth-action topbar-auth-action--mobile" onClick={() => void logout()}>
              Déconnexion
            </button>
          ) : null}
        </nav>
      </header>
      <main className="content">
        <Suspense fallback={<div className="card">Chargement...</div>}>
          <Routes>
            <Route path="/" element={<Navigate to={visibleNavItems[0]?.to ?? "/aujourdhui"} replace />} />
            <Route path="/aujourdhui" element={<PageAccess allowed={canAccessPage("today")}><TodayPage /></PageAccess>} />
            <Route path="/gites" element={<PageAccess allowed={canAccessPage("gites")}><AmountsAccess allowed={canViewAmounts}><GitesPage /></AmountsAccess></PageAccess>} />
            <Route path="/demandes" element={<PageAccess allowed={canAccessPage("booking_requests")}><BookingRequestsPage /></PageAccess>} />
            <Route path="/demandes/:requestId" element={<PageAccess allowed={canAccessPage("booking_requests")}><BookingRequestDetailPage /></PageAccess>} />
            <Route path="/contrats" element={<PageAccess allowed={canAccessPage("contracts")}><AmountsAccess allowed={canViewAmounts}><ContratsListPage /></AmountsAccess></PageAccess>} />
            <Route path="/contrats/nouveau" element={<PageAccess allowed={canAccessPage("contracts")}><AmountsAccess allowed={canViewAmounts}><ContratFormPage /></AmountsAccess></PageAccess>} />
            <Route path="/contrats/:id/edition" element={<PageAccess allowed={canAccessPage("contracts")}><AmountsAccess allowed={canViewAmounts}><ContratFormPage /></AmountsAccess></PageAccess>} />
            <Route path="/contrats/:id" element={<PageAccess allowed={canAccessPage("contracts")}><AmountsAccess allowed={canViewAmounts}><ContratDetailPage /></AmountsAccess></PageAccess>} />
            <Route path="/factures" element={<PageAccess allowed={canAccessPage("invoices")}><AmountsAccess allowed={canViewAmounts}><FacturesListPage /></AmountsAccess></PageAccess>} />
            <Route path="/factures/nouvelle" element={<PageAccess allowed={canAccessPage("invoices")}><AmountsAccess allowed={canViewAmounts}><FactureFormPage /></AmountsAccess></PageAccess>} />
            <Route path="/factures/:id/edition" element={<PageAccess allowed={canAccessPage("invoices")}><AmountsAccess allowed={canViewAmounts}><FactureFormPage /></AmountsAccess></PageAccess>} />
            <Route path="/factures/:id" element={<PageAccess allowed={canAccessPage("invoices")}><AmountsAccess allowed={canViewAmounts}><FactureDetailPage /></AmountsAccess></PageAccess>} />
            <Route path="/reservations/mobile" element={<PageAccess allowed={canAccessPage("reservations")}><MobileReservationEditorPage /></PageAccess>} />
            <Route path="/reservations" element={<PageAccess allowed={canAccessPage("reservations")}><ReservationsPage /></PageAccess>} />
            <Route path="/calendrier" element={<PageAccess allowed={canAccessPage("calendar")}><CalendrierPage /></PageAccess>} />
            <Route path="/planning-relais" element={<PageAccess allowed={canAccessPage("planning_relay")}><OperationsPrintPage /></PageAccess>} />
            <Route path="/statistiques" element={<PageAccess allowed={canAccessPage("statistics")}><AmountsAccess allowed={canViewAmounts}><StatisticsPage /></AmountsAccess></PageAccess>} />
            <Route path="/frais-personnels" element={<PageAccess allowed={canAccessPage("personal_expenses")}><AmountsAccess allowed={canViewAmounts}><PersonalExpensesPage /></AmountsAccess></PageAccess>} />
            <Route path="/frais-professionnels" element={<PageAccess allowed={canAccessPage("professional_expenses")}><AmountsAccess allowed={canViewAmounts}><ProfessionalExpensesPage /></AmountsAccess></PageAccess>} />
            <Route path="/tarifs" element={<PageAccess allowed={canAccessPage("rates")}><AmountsAccess allowed={canViewAmounts}><SeasonRatesPage /></AmountsAccess></PageAccess>} />
            <Route path="/interventions" element={<PageAccess allowed={canAccessPage("settings")}><AmountsAccess allowed={canViewAmounts}><IntervenantsPage /></AmountsAccess></PageAccess>} />
            <Route path="/parametres/intervenants" element={<Navigate to="/interventions" replace />} />
            <Route path="/parametres/equipe" element={<Navigate to="/parametres/utilisateurs" replace />} />
            <Route path="/parametres/*" element={<PageAccess allowed={canAccessPage("settings")}><SettingsPage currentUser={currentUser} onAuthSessionUpdated={(session) => { setCurrentAuthUser(session.user); setAuthSession(session); }} /></PageAccess>} />
          </Routes>
        </Suspense>
      </main>
      {appNotice ? (
        <div
          className={`app-sync-notice app-sync-notice--${appNotice.tone}`}
          role={appNotice.role ?? (appNotice.tone === "error" ? "alert" : "status")}
          aria-live={(appNotice.role ?? (appNotice.tone === "error" ? "alert" : "status")) === "alert" ? "assertive" : "polite"}
        >
          <span className="app-sync-notice__label">{appNotice.label}</span>
          <span>{appNotice.message}</span>
        </div>
      ) : null}
    </div>
  );
};

export default App;

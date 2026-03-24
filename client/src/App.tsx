import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { apiFetch, ApiError, isAbortError } from "./utils/api";
import { AUTH_REQUIRED_EVENT, type ServerAuthSession } from "./utils/auth";
import { APP_NOTICE_EVENT, type AppNotice } from "./utils/appNotices";
import { RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT } from "./utils/recentImportsBadge";

const GitesPage = lazy(() => import("./pages/GitesPage"));
const ContratsListPage = lazy(() => import("./pages/ContratsListPage"));
const ContratFormPage = lazy(() => import("./pages/ContratFormPage"));
const ContratDetailPage = lazy(() => import("./pages/ContratDetailPage"));
const FacturesListPage = lazy(() => import("./pages/FacturesListPage"));
const FactureFormPage = lazy(() => import("./pages/FactureFormPage"));
const FactureDetailPage = lazy(() => import("./pages/FactureDetailPage"));
const ReservationsPage = lazy(() => import("./pages/ReservationsPage"));
const CalendrierPage = lazy(() => import("./pages/CalendrierPage"));
const StatisticsPage = lazy(() => import("./pages/StatisticsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const TodayPage = lazy(() => import("./pages/TodayPage"));

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

type IcalAutoSyncResultSummary = {
  created_count: number;
  updated_count: number;
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
    if (result.summary.created_count <= 0 && result.summary.updated_count <= 0) {
      return {
        label: "iCal",
        tone: "success",
        message: "iCal a jour",
        timeoutMs: 4_200,
      };
    }

    return {
      label: "iCal",
      tone: "success",
      message: `${result.summary.created_count} ajout(s), ${result.summary.updated_count} mise(s) a jour`,
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
  password: string;
  error: string | null;
  submitting: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

const AuthScreen = ({ session, password, error, submitting, onPasswordChange, onSubmit }: AuthScreenProps) => (
  <main className="auth-shell">
    <section className="card auth-card">
      <div className="auth-card__eyebrow">Protection serveur</div>
      <h1 className="auth-card__title">Connexion requise</h1>
      <p className="auth-card__text">
        Le serveur protège les données avec une session cookie HTTP-only. Entrez le mot de passe administrateur pour ouvrir l’application.
      </p>
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
          autoFocus
          disabled={submitting}
        />
      </label>
      <div className="field-hint">
        Session par défaut: {formatSessionDurationLabel(session?.sessionDurationHours ?? 24 * 7)}.
      </div>
      {error ? <div className="note" style={{ marginTop: 12 }}>{error}</div> : null}
      <div className="actions" style={{ marginTop: 16 }}>
        <button type="button" onClick={onSubmit} disabled={submitting || !password.trim()}>
          {submitting ? "Connexion..." : "Se connecter"}
        </button>
      </div>
    </section>
  </main>
);

const App = () => {
  const location = useLocation();
  const [authSession, setAuthSession] = useState<ServerAuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recentImportedReservationsCount, setRecentImportedReservationsCount] = useState(0);
  const [appNotice, setAppNotice] = useState<(AppNotice & { id: number }) | null>(null);
  const [pumpHealthNotice, setPumpHealthNotice] = useState<PumpHealthNotice | null>(null);
  const isAuthenticated = authSession?.authenticated ?? false;
  const isAuthRequired = authSession?.required ?? false;
  const isContratsSection =
    location.pathname === "/contrats" ||
    location.pathname.startsWith("/contrats/");
  const isFacturesSection =
    location.pathname === "/factures" ||
    location.pathname.startsWith("/factures/");
  const isReservationsSection =
    location.pathname === "/reservations" ||
    location.pathname.startsWith("/reservations/");
  const isTodaySection =
    location.pathname === "/aujourdhui" ||
    location.pathname.startsWith("/aujourdhui/");
  const isCalendarSection =
    location.pathname === "/calendrier" ||
    location.pathname.startsWith("/calendrier/");
  const isStatsSection =
    location.pathname === "/statistiques" ||
    location.pathname.startsWith("/statistiques/");
  const isSettingsSection =
    location.pathname === "/parametres" ||
    location.pathname.startsWith("/parametres/");
  const navItems = [
    {
      to: "/aujourdhui",
      label: "Aujourd'hui",
      isActive: isTodaySection,
      mobilePrimary: true,
    },
    {
      to: "/reservations",
      label: "Réservations",
      isActive: isReservationsSection,
    },
    {
      to: "/calendrier",
      label: "Calendrier",
      isActive: isCalendarSection,
      mobilePrimary: true,
    },
    {
      to: "/contrats",
      label: "Contrats",
      isActive: isContratsSection,
    },
    {
      to: "/factures",
      label: "Factures",
      isActive: isFacturesSection,
    },
    {
      to: "/gites",
      label: "Gîtes",
      isActive: location.pathname === "/gites" || location.pathname.startsWith("/gites/"),
      desktopOverflow: true,
    },
    {
      to: "/statistiques",
      label: "Statistiques",
      isActive: isStatsSection,
      desktopOverflow: true,
    },
    {
      to: "/parametres",
      label: "Paramètres",
      isActive: isSettingsSection,
      desktopOverflow: true,
    },
  ];
  const desktopPrimaryItems = navItems.filter((item) => !item.desktopOverflow);
  const desktopOverflowItems = navItems.filter((item) => item.desktopOverflow);
  const mobilePrimaryItems = navItems.filter((item) => item.mobilePrimary);
  const mobileOverflowItems = navItems.filter((item) => !item.mobilePrimary);
  const reservationBadgeLabel =
    recentImportedReservationsCount > 0
      ? `${recentImportedReservationsCount} création${recentImportedReservationsCount > 1 ? "s" : ""} importée${recentImportedReservationsCount > 1 ? "s" : ""} via iCal ou Pump sur les dernières 24 heures`
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
    setAuthSession(payload);
    return payload;
  };

  const submitLogin = async () => {
    if (!authPassword.trim()) {
      setAuthError("Renseigne le mot de passe serveur.");
      return;
    }

    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const payload = await apiFetch<LoginResult>("/auth/login", {
        method: "POST",
        json: { password: authPassword },
      });
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
            }
          : {
              required: true,
              authenticated: false,
              passwordConfigured: true,
              sessionDurationHours: 24 * 7,
              sessionExpiresAt: null,
            }
      );
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
    loadAuthSession()
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
            }
          : {
              required: true,
              authenticated: false,
              passwordConfigured: true,
              sessionDurationHours: 24 * 7,
              sessionExpiresAt: null,
            }
      );
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
    void loadRecentImportedReservationsCount(controller.signal);
    void loadPumpHealth(controller.signal);
    const pollId = window.setInterval(() => {
      void loadPumpHealth();
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

    return () => {
      controller.abort();
      window.clearInterval(pollId);
      window.removeEventListener(
        RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT,
        handleRecentImportedReservationsCreated as EventListener
      );
    };
  }, [authLoading, isAuthenticated, loadPumpHealth, loadRecentImportedReservationsCount]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
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
  }, [authLoading, isAuthenticated, loadRecentImportedReservationsCount, pushAppNotice]);

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

  const renderNavLabel = (item: { to: string; label: string; mobileLabel?: string }) => (
    <span className={`nav-item-label${item.to === "/reservations" ? " nav-item-label--with-badge" : ""}`}>
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
    </span>
  );

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
        password={authPassword}
        error={authError}
        submitting={authSubmitting}
        onPasswordChange={setAuthPassword}
        onSubmit={() => void submitLogin()}
      />
    );
  }

  return (
    <div className="app">
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
            <Route path="/" element={<Navigate to="/aujourdhui" replace />} />
            <Route path="/aujourdhui" element={<TodayPage />} />
            <Route path="/gites" element={<GitesPage />} />
            <Route path="/contrats" element={<ContratsListPage />} />
            <Route path="/contrats/nouveau" element={<ContratFormPage />} />
            <Route path="/contrats/:id/edition" element={<ContratFormPage />} />
            <Route path="/contrats/:id" element={<ContratDetailPage />} />
            <Route path="/factures" element={<FacturesListPage />} />
            <Route path="/factures/nouvelle" element={<FactureFormPage />} />
            <Route path="/factures/:id/edition" element={<FactureFormPage />} />
            <Route path="/factures/:id" element={<FactureDetailPage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/calendrier" element={<CalendrierPage />} />
            <Route path="/statistiques" element={<StatisticsPage />} />
            <Route path="/parametres" element={<SettingsPage onAuthSessionUpdated={setAuthSession} />} />
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

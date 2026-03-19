import { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { apiFetch, isAbortError } from "./utils/api";
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

type IcalAutoSyncNotice = {
  status: IcalAutoSyncResponse["status"] | "running" | "error";
  tone: "neutral" | "success" | "error";
  message: string;
};

const ICAL_AUTO_SYNC_SESSION_KEY = "ical-auto-sync-attempted";
let appLoadIcalAutoSyncPromise: Promise<IcalAutoSyncResponse> | null = null;

const buildIcalAutoSyncNotice = (result: IcalAutoSyncResponse): IcalAutoSyncNotice => {
  if ((result.status === "success" || result.status === "shared-running") && result.summary) {
    if (result.summary.created_count <= 0 && result.summary.updated_count <= 0) {
      return {
        status: result.status,
        tone: "success",
        message: "iCal a jour",
      };
    }

    return {
      status: result.status,
      tone: "success",
      message: `${result.summary.created_count} ajout(s), ${result.summary.updated_count} mise(s) a jour`,
    };
  }

  if (result.status === "skipped-no-sources") {
    return {
      status: result.status,
      tone: "neutral",
      message: "Aucune source iCal active",
    };
  }

  if (result.status === "skipped-recent") {
    return {
      status: result.status,
      tone: "neutral",
      message: "Import iCal recent deja lance",
    };
  }

  if (result.status === "shared-running") {
    return {
      status: result.status,
      tone: "neutral",
      message: "Import iCal deja en cours",
    };
  }

  return {
    status: result.status,
    tone: "neutral",
    message: "Import iCal auto desactive",
  };
};

const getAppLoadIcalAutoSyncPromise = () => {
  if (typeof window === "undefined") return null;
  if (window.sessionStorage.getItem(ICAL_AUTO_SYNC_SESSION_KEY) !== "1") {
    window.sessionStorage.setItem(ICAL_AUTO_SYNC_SESSION_KEY, "1");
  }

  if (!appLoadIcalAutoSyncPromise) {
    appLoadIcalAutoSyncPromise = apiFetch<IcalAutoSyncResponse>("/settings/ical/auto-sync", {
      method: "POST",
    });
  }

  return appLoadIcalAutoSyncPromise;
};

const App = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recentImportedReservationsCount, setRecentImportedReservationsCount] = useState(0);
  const [icalAutoSyncNotice, setIcalAutoSyncNotice] = useState<IcalAutoSyncNotice | null>(null);
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
  const loadRecentImportedReservationsCount = async (signal?: AbortSignal) => {
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
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const controller = new AbortController();
    void loadRecentImportedReservationsCount(controller.signal);

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
      window.removeEventListener(
        RECENT_IMPORTED_RESERVATIONS_CREATED_EVENT,
        handleRecentImportedReservationsCreated as EventListener
      );
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasAttempted = window.sessionStorage.getItem(ICAL_AUTO_SYNC_SESSION_KEY) === "1";
    if (hasAttempted && !appLoadIcalAutoSyncPromise) return;
    let active = true;

    const runAutoSync = async () => {
      setIcalAutoSyncNotice({
        status: "running",
        tone: "neutral",
        message: "Import iCal...",
      });

      try {
        const promise = getAppLoadIcalAutoSyncPromise();
        if (!promise) return;
        const result = await promise;
        if (!active) return;
        setIcalAutoSyncNotice(buildIcalAutoSyncNotice(result));
        if (result.status === "success" || result.status === "shared-running") {
          void loadRecentImportedReservationsCount();
        }
      } catch (error) {
        if (!active || isAbortError(error)) return;
        setIcalAutoSyncNotice({
          status: "error",
          tone: "error",
          message: "Echec import iCal",
        });
      }
    };

    void runAutoSync();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!icalAutoSyncNotice || icalAutoSyncNotice.status === "running") return;

    const timeoutMs =
      icalAutoSyncNotice.status === "error"
        ? 5200
        : icalAutoSyncNotice.status === "success" || icalAutoSyncNotice.status === "shared-running"
          ? 4200
          : 2600;

    const timeoutId = window.setTimeout(() => {
      setIcalAutoSyncNotice((current) => (current === icalAutoSyncNotice ? null : current));
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [icalAutoSyncNotice]);

  const renderNavLabel = (item: { to: string; label: string; mobileLabel?: string }) => (
    <span className="nav-item-label">
      <span className="nav__label">{item.mobileLabel ?? item.label}</span>
      {item.to === "/reservations" && recentImportedReservationsCount > 0 ? (
        <span className="nav-badge" aria-label={reservationBadgeLabel ?? undefined} title={reservationBadgeLabel ?? undefined}>
          {recentImportedReservationsCount}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            CG
          </span>
          <span className="brand-label">Contrats Gîtes</span>
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
            <Route path="/parametres" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
      {icalAutoSyncNotice ? (
        <div
          className={`app-sync-notice app-sync-notice--${icalAutoSyncNotice.tone}`}
          role={icalAutoSyncNotice.status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="app-sync-notice__label">iCal</span>
          <span>{icalAutoSyncNotice.message}</span>
        </div>
      ) : null}
    </div>
  );
};

export default App;

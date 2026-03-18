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

const App = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recentImportedReservationsCount, setRecentImportedReservationsCount] = useState(0);
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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const controller = new AbortController();

    const loadRecentImportedReservationsCount = async () => {
      try {
        const payload = await apiFetch<RecentImportedReservationsCountPayload>("/reservations/recent-imports/count", {
          signal: controller.signal,
        });
        setRecentImportedReservationsCount(Math.max(0, Number(payload.count) || 0));
      } catch (error) {
        if (!isAbortError(error)) {
          setRecentImportedReservationsCount(0);
          console.error(error);
        }
      }
    };

    loadRecentImportedReservationsCount();

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
    </div>
  );
};

export default App;

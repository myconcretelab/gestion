import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import GitesPage from "./pages/GitesPage";
import ContratsListPage from "./pages/ContratsListPage";
import ContratFormPage from "./pages/ContratFormPage";
import ContratDetailPage from "./pages/ContratDetailPage";
import FacturesListPage from "./pages/FacturesListPage";
import FactureFormPage from "./pages/FactureFormPage";
import FactureDetailPage from "./pages/FactureDetailPage";
import ReservationsPage from "./pages/ReservationsPage";
import CalendrierPage from "./pages/CalendrierPage";
import StatisticsPage from "./pages/StatisticsPage";
import SettingsPage from "./pages/SettingsPage";

const MOBILE_NAV_BREAKPOINT = 760;

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
);

const App = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [useMobileHome, setUseMobileHome] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${MOBILE_NAV_BREAKPOINT}px)`).matches : false
  );
  const isContratsSection =
    location.pathname === "/contrats" ||
    location.pathname.startsWith("/contrats/");
  const isFacturesSection =
    location.pathname === "/factures" ||
    location.pathname.startsWith("/factures/");
  const isReservationsSection =
    location.pathname === "/reservations" ||
    location.pathname.startsWith("/reservations/");
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
      to: "/reservations",
      label: "Réservations",
      isActive: isReservationsSection,
    },
    {
      to: "/calendrier",
      label: "Calendrier",
      isActive: isCalendarSection,
      mobileText: true,
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
    },
    {
      to: "/statistiques",
      label: "Statistiques",
      isActive: isStatsSection,
    },
    {
      to: "/parametres",
      label: "Paramètres",
      isActive: isSettingsSection,
    },
  ];
  const mobilePrimaryItem = navItems.find((item) => item.mobileText) ?? navItems[0];
  const mobileSecondaryItems = navItems.filter((item) => item !== mobilePrimaryItem);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_NAV_BREAKPOINT}px)`);
    const updateMobileHome = (matches: boolean) => {
      setUseMobileHome((current) => (current === matches ? current : matches));
    };

    updateMobileHome(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      updateMobileHome(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

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
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={() => (item.isActive ? "active" : undefined)}
              aria-current={item.isActive ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
            >
              <span className="nav__label">{item.mobileLabel ?? item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-mobile">
          <NavLink
            to={mobilePrimaryItem.to}
            className={() => `topbar-mobile__primary${mobilePrimaryItem.isActive ? " topbar-mobile__primary--active" : ""}`}
            aria-current={mobilePrimaryItem.isActive ? "page" : undefined}
          >
            {mobilePrimaryItem.mobileLabel ?? mobilePrimaryItem.label}
          </NavLink>
          <button
            type="button"
            className={`topbar-menu-button${mobileMenuOpen ? " topbar-menu-button--active" : ""}`}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            aria-label={mobileMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            <span className="topbar-menu-button__icon" aria-hidden="true">
              <MenuIcon />
            </span>
          </button>
        </div>
        <nav id="mobile-navigation" className={`mobile-nav${mobileMenuOpen ? " mobile-nav--open" : ""}`} aria-label="Navigation mobile">
          {mobileSecondaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={() => (item.isActive ? "active" : undefined)}
              aria-current={item.isActive ? "page" : undefined}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to={useMobileHome ? "/calendrier" : "/reservations"} replace />} />
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
      </main>
    </div>
  );
};

export default App;

import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

type SettingsTab = {
  label: string;
  path: string;
  navId?: string;
};

type SettingsCategory = {
  id: string;
  label: string;
  path: string;
  tabs: SettingsTab[];
};

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "organisation",
    label: "Organisation",
    path: "organisation",
    tabs: [
      { label: "Identité", path: "organisation" },
      { label: "Apparence", path: "apparence", navId: "nav-settings-appearance" },
    ],
  },
  {
    id: "hebergements",
    label: "Hébergements",
    path: "hebergements",
    tabs: [
      { label: "Vue d’ensemble", path: "hebergements" },
      { label: "Nuitées à déclarer", path: "nuitees", navId: "nav-settings-declaration-nights" },
      { label: "Couleurs des sources", path: "couleurs-sources", navId: "nav-settings-source-colors" },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    path: "documents",
    tabs: [{ label: "Vue d’ensemble", path: "documents" }],
  },
  {
    id: "canaux",
    label: "Canaux de communication",
    path: "canaux",
    tabs: [
      { label: "Vue d’ensemble", path: "canaux" },
      { label: "E-mails", path: "emails", navId: "nav-settings-email-texts" },
      { label: "SMS", path: "sms", navId: "nav-settings-sms" },
      { label: "Telegram", path: "telegram", navId: "nav-settings-telegram" },
      { label: "E-mail quotidien", path: "email-quotidien", navId: "nav-settings-daily-reservation-email" },
    ],
  },
  {
    id: "connexions",
    label: "Connexions",
    path: "connexions",
    tabs: [
      { label: "Vue d’ensemble", path: "connexions" },
      { label: "Sources iCal", path: "ical-sources", navId: "nav-settings-ical-sources" },
      { label: "Exports iCal", path: "ical-exports", navId: "nav-settings-ical-exports" },
      { label: "Synchronisation", path: "ical-sync", navId: "nav-settings-ical-sync" },
      { label: "Pump / Airbnb", path: "pump", navId: "nav-settings-imports" },
      { label: "Smart Life", path: "smartlife", navId: "nav-settings-smartlife" },
    ],
  },
  {
    id: "equipe-acces",
    label: "Équipe et accès",
    path: "equipe-acces",
    tabs: [
      { label: "Vue d’ensemble", path: "equipe-acces" },
      { label: "Utilisateurs", path: "utilisateurs", navId: "nav-settings-users" },
      { label: "Sécurité", path: "securite", navId: "nav-settings-security" },
    ],
  },
  {
    id: "donnees",
    label: "Données et sauvegardes",
    path: "donnees",
    tabs: [
      { label: "Vue d’ensemble", path: "donnees" },
      { label: "Journal des imports", path: "journal-imports", navId: "nav-settings-import-log" },
    ],
  },
  {
    id: "systeme",
    label: "Système et diagnostics",
    path: "systeme",
    tabs: [{ label: "Vue d’ensemble", path: "systeme" }],
  },
];

const categoryForPath = (pathname: string) => {
  const segment = pathname.split("/")[2] ?? "";
  return SETTINGS_CATEGORIES.find((category) =>
    category.tabs.some((tab) => tab.path === segment),
  ) ?? SETTINGS_CATEGORIES[0];
};

export default function SettingsShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const activeCategory = categoryForPath(location.pathname);
  const activeSegment = location.pathname.split("/")[2] ?? "";
  const activeCategoryLinkRef = useRef<HTMLAnchorElement>(null);
  const activeTabLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeCategoryLinkRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    activeTabLinkRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeCategory.id, activeSegment]);

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar__panel">
            <h1 className="settings-sidebar__title">Paramètres</h1>
            <nav className="settings-sidebar__nav" aria-label="Rubriques des paramètres">
              {SETTINGS_CATEGORIES.map((category) => {
                const active = category.id === activeCategory.id;
                return (
                  <NavLink
                    key={category.id}
                    ref={active ? activeCategoryLinkRef : undefined}
                    to={`/parametres/${category.path}`}
                    aria-current={active ? "page" : undefined}
                    className={`settings-sidebar__link${active ? " settings-sidebar__link--active" : ""}`}
                  >
                    {category.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="settings-content">
          {activeCategory.tabs.length > 1 ? (
            <nav className="settings-theme-tabs" aria-label={`Pages de la rubrique ${activeCategory.label}`}>
              {activeCategory.tabs.map((tab) => (
                <NavLink
                  end
                  id={tab.navId}
                  key={tab.path}
                  ref={tab.path === activeSegment ? activeTabLinkRef : undefined}
                  to={`/parametres/${tab.path}`}
                  className={({ isActive }) =>
                    `settings-theme-tabs__link${isActive ? " settings-theme-tabs__link--active" : ""}`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

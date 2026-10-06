import { NavLink, Navigate, useLocation } from "react-router-dom";
import OrganizationSettings from "./settings/OrganizationSettings";
import { AccommodationsSettings, ChannelsSettings, ConnectionsSettings, DataBackupSettings, DocumentsSettings, SystemDiagnosticsSettings, TeamAccessSettings } from "./settings/CategorySettings";

const sections = [
  ["organisation", "Organisation"], ["hebergements", "Hébergements"], ["documents", "Documents"],
  ["canaux", "Canaux de communication"], ["connexions", "Connexions"], ["equipe-acces", "Équipe et accès"],
  ["donnees", "Données et sauvegardes"], ["systeme", "Système et diagnostics"],
] as const;

export default function ProductSettingsPage() {
  const segment = useLocation().pathname.split("/")[2] || "";
  if (!sections.some(([id]) => id === segment)) return <Navigate to="/parametres/organisation" replace />;
  return <div className="settings-page"><div className="settings-layout"><aside className="settings-sidebar"><div className="settings-sidebar__panel"><h1 className="settings-sidebar__title">Paramètres</h1><nav className="settings-sidebar__nav">{sections.map(([id, label]) => <NavLink className={({ isActive }) => `settings-sidebar__link${isActive ? " settings-sidebar__link--active" : ""}`} key={id} to={`/parametres/${id}`}>{label}</NavLink>)}</nav></div></aside><div className="settings-content">
    {segment === "organisation" ? <OrganizationSettings /> : null}
    {segment === "hebergements" ? <AccommodationsSettings /> : null}
    {segment === "documents" ? <DocumentsSettings /> : null}
    {segment === "canaux" ? <ChannelsSettings /> : null}
    {segment === "connexions" ? <ConnectionsSettings /> : null}
    {segment === "equipe-acces" ? <TeamAccessSettings /> : null}
    {segment === "donnees" ? <DataBackupSettings /> : null}
    {segment === "systeme" ? <SystemDiagnosticsSettings /> : null}
  </div></div></div>;
}

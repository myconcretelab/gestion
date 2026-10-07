import { Navigate, useLocation } from "react-router-dom";
import OrganizationSettings from "./settings/OrganizationSettings";
import { AccommodationsSettings, ChannelsSettings, ConnectionsSettings, DataBackupSettings, DocumentsSettings, SystemDiagnosticsSettings, TeamAccessSettings } from "./settings/CategorySettings";
import SettingsShell from "./settings/SettingsShell";

const sections = [
  ["organisation", "Organisation"], ["hebergements", "Hébergements"], ["documents", "Documents"],
  ["canaux", "Canaux de communication"], ["connexions", "Connexions"], ["equipe-acces", "Équipe et accès"],
  ["donnees", "Données et sauvegardes"], ["systeme", "Système et diagnostics"],
] as const;

export default function ProductSettingsPage() {
  const segment = useLocation().pathname.split("/")[2] || "";
  if (!sections.some(([id]) => id === segment)) return <Navigate to="/parametres/organisation" replace />;
  return <SettingsShell>
    {segment === "organisation" ? <OrganizationSettings /> : null}
    {segment === "hebergements" ? <AccommodationsSettings /> : null}
    {segment === "documents" ? <DocumentsSettings /> : null}
    {segment === "canaux" ? <ChannelsSettings /> : null}
    {segment === "connexions" ? <ConnectionsSettings /> : null}
    {segment === "equipe-acces" ? <TeamAccessSettings /> : null}
    {segment === "donnees" ? <DataBackupSettings /> : null}
    {segment === "systeme" ? <SystemDiagnosticsSettings /> : null}
  </SettingsShell>;
}

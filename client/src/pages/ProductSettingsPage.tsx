import { Navigate, useLocation } from "react-router-dom";
import OrganizationSettings from "./settings/OrganizationSettings";
import { ConnectionsSettings, SystemDiagnosticsSettings } from "./settings/CategorySettings";
import SettingsShell from "./settings/SettingsShell";
import FiscalEntitiesSettings from "./settings/FiscalEntitiesSettings";

const sections = [
  ["organisation", "Organisation"], ["hebergements", "Hébergements"], ["documents", "Documents"],
  ["canaux", "Canaux de communication"], ["connexions", "Connexions"], ["equipe-acces", "Équipe et accès"],
  ["donnees", "Données et sauvegardes"], ["systeme", "Système et diagnostics"], ["entreprises", "Entreprises"],
] as const;

const overviewRedirects: Record<string, string> = {
  hebergements: "nuitees",
  documents: "emails",
  canaux: "emails",
  "equipe-acces": "utilisateurs",
  donnees: "journal-imports",
};

export default function ProductSettingsPage() {
  const segment = useLocation().pathname.split("/")[2] || "";
  if (!sections.some(([id]) => id === segment)) return <Navigate to="/parametres/organisation" replace />;
  if (overviewRedirects[segment]) return <Navigate to={`/parametres/${overviewRedirects[segment]}`} replace />;
  return <SettingsShell>
    {segment === "organisation" ? <OrganizationSettings /> : null}
    {segment === "entreprises" ? <FiscalEntitiesSettings /> : null}
    {segment === "connexions" ? <ConnectionsSettings /> : null}
    {segment === "systeme" ? <SystemDiagnosticsSettings /> : null}
  </SettingsShell>;
}

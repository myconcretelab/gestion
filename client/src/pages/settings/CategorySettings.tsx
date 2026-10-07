import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { apiFetch } from "../../utils/api";
import ModulesSettings from "./ModulesSettings";

type Section = "accommodations" | "documents" | "channels" | "connections" | "team" | "data" | "system";
const Overview = ({ section, title, children }: { section: Section; title: string; children: ReactNode }) => {
  const [state, setState] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<Record<string, unknown>>(`/settings/overview/${section}`).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible.")); }, [section]);
  return <section className="settings-cluster"><div className="settings-cluster__header"><h2>{title}</h2></div><div className="card">{error ? <div className="note">{error}</div> : !state ? <p>Chargement…</p> : <>{children}<details><summary>État technique</summary><pre>{JSON.stringify(state, null, 2)}</pre></details></>}</div></section>;
};
export const AccommodationsSettings = () => <Overview section="accommodations" title="Hébergements"><p>Les fiches, tarifs, photos et contenus publics disposent de leur propre validation.</p><NavLink to="/gites">Ouvrir les hébergements</NavLink></Overview>;
export const DocumentsSettings = () => <Overview section="documents" title="Documents"><p>Les nouveaux modèles sont versionnés côté serveur. Les anciens modèles restent disponibles pendant leur migration.</p></Overview>;
export const ChannelsSettings = () => <Overview section="channels" title="Canaux de communication"><p>Configurez ici les messages, expéditeurs et automatisations de chaque canal.</p></Overview>;
export const ConnectionsSettings = () => <><ModulesSettings /><Overview section="connections" title="Connexions"><p>Supervisez les calendriers, imports et intégrations reliés à l’application.</p></Overview></>;
export const TeamAccessSettings = () => <Overview section="team" title="Équipe et accès"><p>Gérez les utilisateurs, leurs droits et la sécurité des sessions.</p></Overview>;
export const DataBackupSettings = () => <Overview section="data" title="Données et sauvegardes"><p>Les exports standards excluent les secrets. Les commandes d’aperçu et de restauration sont documentées dans le README.</p></Overview>;
export const SystemDiagnosticsSettings = () => <Overview section="system" title="Système et diagnostics"><p>Version, santé de l’environnement et état de l’installation.</p></Overview>;

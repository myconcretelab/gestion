import { useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../../utils/api";
import ModulesSettings from "./ModulesSettings";

type Section = "documents" | "system";
const Overview = ({ section, title, children }: { section: Section; title: string; children: ReactNode }) => {
  const [state, setState] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<Record<string, unknown>>(`/settings/overview/${section}`).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible.")); }, [section]);
  return <section className="settings-cluster"><div className="settings-cluster__header"><h2>{title}</h2></div><div className="card">{error ? <div className="note">{error}</div> : !state ? <p>Chargement…</p> : <>{children}<details><summary>État technique</summary><pre>{JSON.stringify(state, null, 2)}</pre></details></>}</div></section>;
};
export const DocumentsSettings = () => <Overview section="documents" title="Documents"><p>Les nouveaux modèles sont versionnés côté serveur. Les anciens modèles restent disponibles pendant leur migration.</p></Overview>;
export const ConnectionsSettings = () => <ModulesSettings />;
export const SystemDiagnosticsSettings = () => <Overview section="system" title="Système et diagnostics"><p>Version, santé de l’environnement et état de l’installation.</p></Overview>;

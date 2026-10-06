import { useEffect, useState } from "react";
import { apiFetch } from "../../utils/api";
import { MODULE_KEYS, MODULE_LABELS, type ModuleSettings } from "../../utils/installation";

export default function ModulesSettings() {
  const [value, setValue] = useState<ModuleSettings | null>(null); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { apiFetch<ModuleSettings>("/settings/modules").then(setValue).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible.")); }, []);
  if (!value) return <section className="card">{error ?? "Chargement des modules…"}</section>;
  const save = async () => { setSaving(true); setError(null); try { setValue(await apiFetch<ModuleSettings>("/settings/modules", { method: "PUT", json: value })); } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); } finally { setSaving(false); } };
  return <section className="settings-cluster"><div className="settings-cluster__header"><div><div className="settings-cluster__eyebrow">Fonctionnalités optionnelles</div><h2>Modules</h2></div><p>Un module désactivé disparaît de la navigation, ses API répondent 404 et ses tâches ne démarrent pas.</p></div><div className="card settings-cluster__grid">{MODULE_KEYS.map((key) => <label className="field" key={key}><span><input type="checkbox" checked={value[key]} onChange={(e) => setValue({ ...value, [key]: e.target.checked })} /> {MODULE_LABELS[key]}</span></label>)}</div>{error ? <div className="note">{error}</div> : null}<div className="actions"><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Enregistrement…" : "Enregistrer les modules"}</button></div></section>;
}

import { useEffect, useState } from "react";
import { apiFetch } from "../../utils/api";
import type { OrganizationProfile } from "../../utils/installation";

const fields: Array<[keyof OrganizationProfile, string, string?]> = [
  ["tradeName", "Nom commercial"], ["legalName", "Raison sociale"], ["publicDisplayName", "Identité publique"],
  ["addressLine1", "Adresse"], ["addressLine2", "Complément"], ["postalCode", "Code postal"], ["city", "Ville"],
  ["country", "Pays (ISO)"], ["email", "E-mail", "email"], ["phone", "Téléphone"], ["website", "Site web", "url"],
  ["iban", "IBAN"], ["bic", "BIC"], ["bankAccountHolder", "Titulaire du compte"], ["locale", "Langue"],
  ["currency", "Devise"], ["timezone", "Fuseau horaire"], ["logoUrl", "Logo (URL ou chemin)"],
  ["faviconUrl", "Favicon (URL ou chemin)"], ["primaryColor", "Couleur principale", "color"],
  ["emailSignature", "Signature e-mail"], ["smsSignature", "Signature SMS"], ["documentFooter", "Pied de document"],
  ["documentLocale", "Langue des documents"], ["documentDateFormat", "Format des dates"], ["documentPaymentTerms", "Conditions de paiement"],
];

export default function OrganizationSettings() {
  const [value, setValue] = useState<OrganizationProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { apiFetch<OrganizationProfile>("/settings/organization").then(setValue).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible.")); }, []);
  if (error) return <section className="card"><h2>Organisation</h2><div className="note">{error}</div></section>;
  if (!value) return <section className="card">Chargement de l’organisation…</section>;
  const save = async () => {
    if (!value.tradeName.trim() || !value.legalName.trim()) { setError("Le nom commercial et la raison sociale sont requis."); return; }
    setSaving(true); setError(null);
    try { setValue(await apiFetch<OrganizationProfile>("/settings/organization", { method: "PUT", json: value })); }
    catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  };
  return <section className="settings-cluster"><div className="settings-cluster__header"><div><div className="settings-cluster__eyebrow">Identité centrale</div><h2>Organisation</h2></div><p>Ces valeurs alimentent les impressions, les pages publiques et les communications.</p></div>
    <div className="card form-grid">{fields.map(([key, label, type]) => <label className="field" key={key}>{label}<input type={type ?? "text"} value={value[key]} onChange={(e) => setValue({ ...value, [key]: e.target.value })} /></label>)}</div>
    {error ? <div className="note">{error}</div> : null}<div className="actions"><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Enregistrement…" : "Enregistrer"}</button></div>
  </section>;
}

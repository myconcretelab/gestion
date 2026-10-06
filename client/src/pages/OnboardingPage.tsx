import { useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import { MODULE_KEYS, MODULE_LABELS, type ModuleSettings, type OrganizationProfile } from "../utils/installation";

const blankOrganization: OrganizationProfile = {
  tradeName: "", legalName: "", addressLine1: "", addressLine2: "", postalCode: "", city: "",
  country: "FR", email: "", phone: "", website: "", iban: "", bic: "", bankAccountHolder: "",
  locale: "fr-FR", currency: "EUR", timezone: "Europe/Paris", logoUrl: "", faviconUrl: "",
  primaryColor: "#315f4b", emailSignature: "", smsSignature: "", documentFooter: "",
  publicDisplayName: "", documentLocale: "fr-FR", documentDateFormat: "", documentPaymentTerms: "",
};
const blankModules = Object.fromEntries(MODULE_KEYS.map((key) => [key, false])) as ModuleSettings;

export default function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [setupToken, setSetupToken] = useState("");
  const [admin, setAdmin] = useState({ displayName: "", email: "", loginId: "", password: "" });
  const [organization, setOrganization] = useState(blankOrganization);
  const [gite, setGite] = useState({ name: "", address: "", capacity: 2, contractPrefix: "GIT" });
  const [modules, setModules] = useState(blankModules);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titles = ["Sécuriser l’installation", "Organisation", "Premier hébergement", "Modules", "E-mail", "Vérification"];
  const canContinue = useMemo(() => {
    if (step === 0) return setupToken.length >= 24 && admin.displayName.trim() && admin.loginId.trim() && admin.password.length >= 12;
    if (step === 1) return organization.tradeName.trim() && organization.legalName.trim();
    if (step === 2) return gite.name.trim() && gite.address.trim() && gite.contractPrefix.trim();
    return true;
  }, [admin, gite, organization, setupToken, step]);

  const finish = async () => {
    setSubmitting(true); setError(null);
    try {
      await apiFetch("/installation/setup", { method: "POST", headers: { "X-Setup-Token": setupToken }, json: { administrator: admin, organization, firstGite: gite, modules } });
      onComplete();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Installation impossible."); }
    finally { setSubmitting(false); }
  };

  return <main className="auth-shell"><section className="card auth-card" style={{ maxWidth: 760 }}>
    <div className="auth-card__eyebrow">Première installation · Étape {step + 1}/6</div>
    <h1>{titles[step]}</h1>
    {step === 0 ? <>
      <label className="field">Jeton d’installation<input type="password" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} /></label>
      <label className="field">Nom de l’administrateur<input value={admin.displayName} onChange={(e) => setAdmin({ ...admin, displayName: e.target.value })} /></label>
      <label className="field">E-mail<input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></label>
      <label className="field">Identifiant<input autoComplete="username" value={admin.loginId} onChange={(e) => setAdmin({ ...admin, loginId: e.target.value })} /></label>
      <label className="field">Mot de passe (12 caractères minimum)<input type="password" autoComplete="new-password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} /></label>
    </> : null}
    {step === 1 ? <div className="form-grid">
      {(["tradeName", "legalName", "addressLine1", "postalCode", "city", "email", "phone", "website", "iban", "bic", "bankAccountHolder"] as const).map((key) => <label className="field" key={key}>{key}<input value={organization[key]} onChange={(e) => setOrganization({ ...organization, [key]: e.target.value })} /></label>)}
    </div> : null}
    {step === 2 ? <>
      <label className="field">Nom de l’hébergement<input value={gite.name} onChange={(e) => setGite({ ...gite, name: e.target.value })} /></label>
      <label className="field">Adresse<input value={gite.address} onChange={(e) => setGite({ ...gite, address: e.target.value })} /></label>
      <label className="field">Capacité<input type="number" min="1" value={gite.capacity} onChange={(e) => setGite({ ...gite, capacity: Number(e.target.value) })} /></label>
      <label className="field">Préfixe des contrats<input value={gite.contractPrefix} onChange={(e) => setGite({ ...gite, contractPrefix: e.target.value })} /></label>
    </> : null}
    {step === 3 ? <div className="settings-cluster__grid">{MODULE_KEYS.map((key) => <label className="field" key={key}><span><input type="checkbox" checked={modules[key]} onChange={(e) => setModules({ ...modules, [key]: e.target.checked })} /> {MODULE_LABELS[key]}</span></label>)}</div> : null}
    {step === 4 ? <p>La messagerie est facultative. Les identifiants SMTP restent dans l’environnement du serveur et ne sont jamais stockés dans le navigateur. Vous pourrez la vérifier dans « Canaux de communication ».</p> : null}
    {step === 5 ? <div><p><strong>{organization.tradeName}</strong> · {gite.name}</p><p>{MODULE_KEYS.filter((key) => modules[key]).length} module(s) activé(s). Aucun seed n’est nécessaire.</p></div> : null}
    {error ? <div className="note">{error}</div> : null}
    <div className="actions" style={{ marginTop: 20 }}>
      {step > 0 ? <button className="secondary" type="button" onClick={() => setStep(step - 1)}>Retour</button> : null}
      {step < 5 ? <button type="button" disabled={!canContinue} onClick={() => setStep(step + 1)}>Continuer</button> : <button type="button" disabled={submitting} onClick={() => void finish()}>{submitting ? "Installation…" : "Terminer l’installation"}</button>}
    </div>
  </section></main>;
}

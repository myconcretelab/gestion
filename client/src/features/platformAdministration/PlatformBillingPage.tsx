import { useEffect, useState } from "react";
import { apiFetch } from "../../utils/api";

type OrganizationRow = { id: string; name: string; slug: string; status: string; subscription: { status: string; planCode: string } | null };
type OrganizationDetail = {
  organization: OrganizationRow;
  billing: { plan: { name: string; code: string } | null; limits: Array<{ metricKey: string; usage: number; limit: number | null; exceeded: boolean }>; subscription: { status: string } | null };
  events: Array<{ id: string; type: string; status: string; result: string | null; error_message: string | null }>;
  overrides: Array<{ id: string; feature_key: string; reason: string; expires_at: string | null }>;
  jobs: Array<{ id: string; status: string; attempts: number; last_error: string | null; completed_at: string | null; attempt_runs: Array<{ status: string; result_json: unknown; error_message: string | null }> }>;
  plans: Array<{ code: string; name: string; status: string }>;
};

const statusLabels: Record<string, string> = { trialing: "Essai", active: "Actif", past_due: "Paiement en attente", grace_period: "Période de grâce", suspended: "Suspendu", cancelled: "Résilié" };

export default function PlatformBillingPage() {
  const [rows, setRows] = useState<OrganizationRow[]>([]);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [planCode, setPlanCode] = useState("");
  const [featureKey, setFeatureKey] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [error, setError] = useState("");
  const load = (q = "") => apiFetch<OrganizationRow[]>(`/platform/billing/organizations?q=${encodeURIComponent(q)}`).then(setRows).catch((cause) => setError(cause instanceof Error ? cause.message : "Accès refusé."));
  const selectOrganization = async (id: string) => {
    const value = await apiFetch<OrganizationDetail>(`/platform/billing/organizations/${id}`);
    setDetail(value); setStatus(value.billing.subscription?.status ?? "active"); setPlanCode(value.billing.plan?.code ?? ""); setError("");
  };
  useEffect(() => { void load(); }, []);
  return <main className="page"><header className="page-header"><div><h1>Administration commerciale</h1><p>Espace réservé aux administrateurs de plateforme. Chaque modification est auditée.</p></div></header>
    <form onSubmit={(event) => { event.preventDefault(); void load(query); }}><label>Rechercher une organisation<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="submit">Rechercher</button></form>
    {error ? <p role="alert">{error}</p> : null}
    <table><thead><tr><th>Organisation</th><th>Forfait</th><th>Statut</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><button type="button" onClick={() => void selectOrganization(row.id)}>{row.name}</button><br /><small>{row.slug}</small></td><td>{row.subscription?.planCode ?? "Non géré"}</td><td>{statusLabels[row.subscription?.status ?? row.status] ?? row.status}</td></tr>)}</tbody></table>
    {detail ? <section className="card"><h2>{detail.organization.name}</h2><p>Forfait : <strong>{detail.billing.plan?.name ?? "Non géré"}</strong></p>
      <form onSubmit={(event) => { event.preventDefault(); void apiFetch(`/platform/billing/organizations/${detail.organization.id}/subscription`, { method: "PATCH", body: JSON.stringify({ status, planCode }) }).then(() => selectOrganization(detail.organization.id)).catch((cause) => setError(cause instanceof Error ? cause.message : "Mise à jour impossible.")); }}>
        <label>Forfait<select value={planCode} onChange={(event) => setPlanCode(event.target.value)}>{detail.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}{plan.status === "archived" ? " (archivé)" : ""}</option>)}</select></label>
        <label>Statut<select value={status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button type="submit">Enregistrer le forfait et le statut</button>
      </form>
      <h3>Usages</h3>{detail.billing.limits.length ? <ul>{detail.billing.limits.map((item) => <li key={item.metricKey}>{item.metricKey}: {item.usage}/{item.limit ?? "∞"}{item.exceeded ? " — dépassement" : ""}</li>)}</ul> : <p>Aucune limite.</p>}
      <h3>Dérogations</h3>{detail.overrides.length ? <ul>{detail.overrides.map((override) => <li key={override.id}>{override.feature_key} — {override.reason}{override.expires_at ? ` (expire le ${new Date(override.expires_at).toLocaleDateString("fr-FR")})` : ""}</li>)}</ul> : <p>Aucune dérogation.</p>}
      <form onSubmit={(event) => { event.preventDefault(); const parsedLimit = limitValue === "" ? undefined : Number(limitValue); void apiFetch(`/platform/billing/organizations/${detail.organization.id}/overrides`, { method: "POST", body: JSON.stringify({ featureKey, valueBoolean: parsedLimit === undefined ? true : undefined, limitValue: parsedLimit, reason, expiresAt: expiresAt || undefined }) }).then(() => selectOrganization(detail.organization.id)).catch((cause) => setError(cause instanceof Error ? cause.message : "Dérogation impossible.")); }}>
        <label>Fonctionnalité ou usage<input required value={featureKey} onChange={(event) => setFeatureKey(event.target.value)} /></label><label>Nouvelle limite (facultatif)<input type="number" min="0" value={limitValue} onChange={(event) => setLimitValue(event.target.value)} /></label><label>Expiration (facultative)<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label>Motif<input required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="submit">Ajouter la dérogation</button>
      </form>
      <p><button type="button" onClick={() => void apiFetch(`/platform/billing/organizations/${detail.organization.id}/resync`, { method: "POST" }).then(() => selectOrganization(detail.organization.id)).catch((cause) => setError(cause instanceof Error ? cause.message : "Resynchronisation impossible."))}>Déclencher une resynchronisation</button></p>
      <h3>Resynchronisations</h3>{detail.jobs.length ? <ul>{detail.jobs.map((job) => <li key={job.id}>{job.status} — {job.attempts} tentative(s){job.last_error ? ` — ${job.last_error}` : job.completed_at ? ` — terminé le ${new Date(job.completed_at).toLocaleString("fr-FR")}` : ""}</li>)}</ul> : <p>Aucune resynchronisation.</p>}
      <h3>Événements de facturation</h3>{detail.events.length ? <ul>{detail.events.map((event) => <li key={event.id}>{event.type} — {event.result ?? event.status}{event.error_message ? ` — ${event.error_message}` : ""}</li>)}</ul> : <p>Aucun événement.</p>}
    </section> : null}
  </main>;
}

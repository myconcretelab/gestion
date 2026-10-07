import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../utils/api";
import type { AppUser } from "../../utils/auth";

type AdminSection = "overview" | "organizations" | "plans" | "users" | "activity";
type Tone = "success" | "warning" | "danger" | "neutral";

type Activity = {
  id: string;
  type: string;
  organization: string;
  detail: string;
  result: string | null;
  occurredAt: string;
  tone: Tone;
};

type Dashboard = {
  metrics: {
    users: number;
    organizations: number;
    trials: number;
    activeOrganizations: number;
    restrictedOrganizations: number;
    storageBytes: number;
  };
  planDistribution: Array<{ code: string; name: string; organizations: number }>;
  activity: Activity[];
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  metrics: { members: number; properties: number; reservations: number; storageBytes: number };
  subscription: {
    status: string;
    planCode: string;
    planName: string;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
    provider: string | null;
  } | null;
};

type OrganizationDetail = {
  organization: Pick<OrganizationRow, "id" | "name" | "slug" | "status">;
  billing: {
    plan: { name: string; code: string } | null;
    limits: Array<{ metricKey: string; usage: number; limit: number | null; exceeded: boolean; limitType: string }>;
    subscription: { status: string; providerConfigured: boolean; currentPeriodEnd: string | null; trialEnd: string | null } | null;
  };
  events: Array<{ id: string; type: string; status: string; result: string | null; error_message: string | null; received_at: string }>;
  overrides: Array<{ id: string; feature_key: string; reason: string; limit_value: number | null; value_boolean: boolean | null; expires_at: string | null }>;
  jobs: Array<{ id: string; status: string; attempts: number; last_error: string | null; completed_at: string | null }>;
  plans: Array<{ code: string; name: string; status: string }>;
};

type Entitlement = {
  featureKey: string;
  valueBoolean: boolean | null;
  limitValue: number | null;
  limitType: "soft" | "hard";
};

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  billingPeriods: Array<"monthly" | "annual">;
  locked: boolean;
  subscriptionCount: number;
  entitlements: Entitlement[];
  prices: Array<{ id: string; provider: string; productId: string; priceId: string; billingPeriod: string; status: string }>;
};

type PlansPayload = {
  plans: Plan[];
  catalog: {
    modules: Array<{ key: string; label: string }>;
    metrics: Array<{ key: string; label: string }>;
  };
};

type UserRow = {
  id: string;
  loginId: string;
  email: string | null;
  displayName: string;
  active: boolean;
  platformAdministrator: boolean;
  lastSeenAt: string | null;
  memberships: Array<{ organizationId: string; organizationName: string; role: string; status: string }>;
};

const statusLabels: Record<string, string> = {
  trialing: "Essai",
  active: "Actif",
  past_due: "Paiement en attente",
  grace_period: "Période de grâce",
  suspended: "Suspendu",
  cancelled: "Résilié",
  draft: "Brouillon",
  archived: "Archivé",
};

const metricLabels: Record<string, string> = {
  active_properties: "Hébergements actifs",
  manager_members: "Membres gestionnaires",
  worker_members: "Intervenants actifs",
  reservations_created: "Réservations créées",
  documents_generated: "Documents générés",
  storage_bytes: "Stockage utilisé",
  sms_sent: "SMS envoyés",
  automations_executed: "Automatisations exécutées",
};

const formatDate = (value: string | null | undefined, withTime = false) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(value));
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value)} ${units[index]}`;
};

const statusTone = (status: string): Tone => {
  if (["active", "applied", "success", "completed"].includes(status)) return "success";
  if (["trialing", "past_due", "grace_period", "pending", "queued", "running"].includes(status)) return "warning";
  if (["suspended", "cancelled", "failed", "error"].includes(status)) return "danger";
  return "neutral";
};

const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    organizations: <><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-7h6v7M8 9h.01M12 9h.01M16 9h.01" /></>,
    plans: <><path d="M12 2 3 7l9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    activity: <><path d="M3 12h4l2-7 4 14 2-7h6" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8A7 7 0 0 1 18 6l2 6M18 16a7 7 0 0 1-12 2l-2-6" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  };
  return <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name] ?? paths.activity}</svg>;
};

const Badge = ({ value, tone }: { value: string; tone?: Tone }) => (
  <span className={`admin-badge admin-badge--${tone ?? statusTone(value)}`}>{statusLabels[value] ?? value}</span>
);

const EmptyState = ({ children }: { children: React.ReactNode }) => <p className="admin-empty">{children}</p>;

const ActivityList = ({ items }: { items: Activity[] }) => (
  <div className="admin-activity-list">
    {items.length ? items.map((item) => (
      <div className="admin-activity-row" key={item.id}>
        <span className={`admin-activity-dot admin-activity-dot--${item.tone}`} />
        <div><strong>{item.type}</strong><span>{item.organization} · {item.detail}{item.result ? ` · ${item.result}` : ""}</span></div>
        <time dateTime={item.occurredAt}>{formatDate(item.occurredAt, true)}</time>
      </div>
    )) : <EmptyState>Aucune activité administrative enregistrée.</EmptyState>}
  </div>
);

function Overview({ dashboard, onNavigate }: { dashboard: Dashboard; onNavigate: (section: AdminSection) => void }) {
  const cards = [
    ["users", dashboard.metrics.users, "Utilisateurs"],
    ["organizations", dashboard.metrics.organizations, "Clients"],
    ["activity", dashboard.metrics.trials, "Essais"],
    ["plans", dashboard.metrics.activeOrganizations, "Clients actifs"],
    ["activity", dashboard.metrics.restrictedOrganizations, "Accès restreints"],
    ["plans", formatBytes(dashboard.metrics.storageBytes), "Stockage total"],
  ] as const;
  return <>
    <div className="admin-metrics">
      {cards.map(([icon, value, label]) => <article className="admin-metric-card" key={label}><div className="admin-metric-card__value">{value}</div><span className="admin-metric-card__icon"><Icon name={icon} /></span><div className="admin-metric-card__label">{label}</div></article>)}
    </div>
    <div className="admin-overview-grid">
      <section className="admin-panel">
        <header className="admin-panel__header"><div><h2>Répartition des forfaits</h2><p>Nombre de clients rattachés à chaque offre.</p></div><button className="admin-text-button" type="button" onClick={() => onNavigate("plans")}>Gérer</button></header>
        <div className="admin-plan-distribution">{dashboard.planDistribution.map((plan) => <div key={plan.code}><span><strong>{plan.name}</strong><small>{plan.code}</small></span><b>{plan.organizations}</b></div>)}</div>
      </section>
      <section className="admin-panel">
        <header className="admin-panel__header"><div><h2>Préparation du pilote</h2><p>Les points à vérifier avant les premiers clients.</p></div></header>
        <div className="admin-checklist"><div><span className="is-done">✓</span><p><strong>Socle multi-client</strong><small>Isolation et abonnements disponibles</small></p></div><div><span className="is-done">✓</span><p><strong>Catalogue de forfaits</strong><small>Modules et quotas administrables ici</small></p></div><div><span>3</span><p><strong>Configuration Stripe</strong><small>Relier les prix et tester le parcours complet</small></p></div><div><span>4</span><p><strong>Client pilote</strong><small>Créer, accompagner puis observer le premier compte</small></p></div></div>
      </section>
    </div>
    <section className="admin-panel"><header className="admin-panel__header"><div><h2>Activité administrative</h2><p>Dernières modifications et synchronisations enregistrées.</p></div><button className="admin-text-button" type="button" onClick={() => onNavigate("activity")}>Tout voir</button></header><ActivityList items={dashboard.activity.slice(0, 8)} /></section>
  </>;
}

function OrganizationDetails({ organizationId, onClose, onChanged }: { organizationId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [status, setStatus] = useState("active");
  const [planCode, setPlanCode] = useState("");
  const [featureKey, setFeatureKey] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const value = await apiFetch<OrganizationDetail>(`/platform/billing/organizations/${organizationId}`);
    setDetail(value);
    setStatus(value.billing.subscription?.status ?? "active");
    setPlanCode(value.billing.plan?.code ?? "");
  }, [organizationId]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Chargement impossible.")); }, [load]);

  const updateSubscription = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      await apiFetch(`/platform/billing/organizations/${organizationId}/subscription`, { method: "PATCH", json: { status, planCode } });
      await Promise.all([load(), onChanged()]); setMessage("Abonnement mis à jour.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Mise à jour impossible."); } finally { setSaving(false); }
  };

  const addOverride = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage("");
    const parsedLimit = limitValue === "" ? undefined : Number(limitValue);
    try {
      await apiFetch(`/platform/billing/organizations/${organizationId}/overrides`, { method: "POST", json: { featureKey, valueBoolean: parsedLimit === undefined ? true : undefined, limitValue: parsedLimit, reason, expiresAt: expiresAt || undefined } });
      setFeatureKey(""); setLimitValue(""); setReason(""); setExpiresAt(""); await load(); setMessage("Dérogation ajoutée.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Dérogation impossible."); } finally { setSaving(false); }
  };

  const resync = async () => {
    setSaving(true); setMessage("");
    try { await apiFetch(`/platform/billing/organizations/${organizationId}/resync`, { method: "POST" }); await load(); setMessage("Resynchronisation programmée."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Resynchronisation impossible."); }
    finally { setSaving(false); }
  };

  return <aside className="admin-drawer" aria-label="Détail du client">
    <header className="admin-drawer__header"><div><small>Fiche client</small><h2>{detail?.organization.name ?? "Chargement…"}</h2><span>{detail?.organization.slug}</span></div><button type="button" className="admin-close" aria-label="Fermer" onClick={onClose}>×</button></header>
    {!detail ? <div className="admin-loading">Chargement…</div> : <div className="admin-drawer__content">
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      <section><h3>Abonnement</h3><form className="admin-form" onSubmit={updateSubscription}><label>Forfait<select value={planCode} onChange={(event) => setPlanCode(event.target.value)}>{detail.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}{plan.status === "archived" ? " (archivé)" : ""}</option>)}</select></label><label>Statut<select value={status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(statusLabels).filter(([value]) => ["trialing", "active", "past_due", "grace_period", "suspended", "cancelled"].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="admin-primary-button" type="submit" disabled={saving}>Enregistrer</button></form></section>
      <section><h3>Quotas consommés</h3>{detail.billing.limits.length ? <div className="admin-quota-list">{detail.billing.limits.map((item) => { const ratio = item.limit ? Math.min(100, Math.round(item.usage / item.limit * 100)) : 0; return <div key={item.metricKey}><div><span>{metricLabels[item.metricKey] ?? item.metricKey}</span><strong>{item.metricKey === "storage_bytes" ? `${formatBytes(item.usage)} / ${item.limit ? formatBytes(item.limit) : "∞"}` : `${item.usage} / ${item.limit ?? "∞"}`}</strong></div><span className={`admin-progress${item.exceeded ? " is-exceeded" : ""}`}><i style={{ width: `${ratio}%` }} /></span></div>; })}</div> : <EmptyState>Aucun quota n’est défini pour ce forfait.</EmptyState>}</section>
      <section><h3>Dérogations</h3>{detail.overrides.length ? <div className="admin-compact-list">{detail.overrides.map((item) => <div key={item.id}><strong>{metricLabels[item.feature_key] ?? item.feature_key}</strong><span>{item.limit_value ?? (item.value_boolean ? "Autorisé" : "Refusé")} · {item.reason}{item.expires_at ? ` · jusqu’au ${formatDate(item.expires_at)}` : ""}</span></div>)}</div> : <EmptyState>Aucune dérogation.</EmptyState>}
        <form className="admin-form admin-form--compact" onSubmit={addOverride}><label>Fonctionnalité ou quota<input required value={featureKey} onChange={(event) => setFeatureKey(event.target.value)} placeholder="Ex. sms_sent" /></label><div className="admin-form__row"><label>Nouvelle limite<input type="number" min="0" value={limitValue} onChange={(event) => setLimitValue(event.target.value)} placeholder="Optionnel" /></label><label>Expiration<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div><label>Motif<input required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="admin-secondary-button" type="submit" disabled={saving}>Ajouter une dérogation</button></form>
      </section>
      <section><div className="admin-section-heading"><h3>Synchronisation</h3><button className="admin-secondary-button" type="button" disabled={saving || !detail.billing.subscription?.providerConfigured} onClick={() => void resync()}>Relancer</button></div>{detail.jobs.length ? <div className="admin-compact-list">{detail.jobs.slice(0, 5).map((job) => <div key={job.id}><strong><Badge value={job.status} /></strong><span>{job.attempts} tentative(s){job.last_error ? ` · ${job.last_error}` : job.completed_at ? ` · ${formatDate(job.completed_at, true)}` : ""}</span></div>)}</div> : <EmptyState>{detail.billing.subscription?.providerConfigured ? "Aucune synchronisation récente." : "Aucun fournisseur de paiement relié."}</EmptyState>}</section>
      <section><h3>Événements de facturation</h3>{detail.events.length ? <div className="admin-compact-list">{detail.events.slice(0, 8).map((item) => <div key={item.id}><strong>{item.type}</strong><span>{item.result ?? item.status} · {formatDate(item.received_at, true)}{item.error_message ? ` · ${item.error_message}` : ""}</span></div>)}</div> : <EmptyState>Aucun événement.</EmptyState>}</section>
    </div>}
  </aside>;
}

function Organizations({ rows, reload }: { rows: OrganizationRow[]; reload: (query?: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const filtered = rows.filter((row) => filter === "all" || (row.subscription?.status ?? row.status) === filter);
  return <>
    <div className="admin-toolbar"><form className="admin-search" onSubmit={(event) => { event.preventDefault(); void reload(query); }}><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un client…" aria-label="Rechercher un client" /></form><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrer par statut"><option value="all">Tous les statuts</option><option value="trialing">Essais</option><option value="active">Actifs</option><option value="past_due">Paiement en attente</option><option value="suspended">Suspendus</option><option value="cancelled">Résiliés</option></select></div>
    <section className="admin-panel admin-panel--table"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Client</th><th>Forfait</th><th>Statut</th><th>Membres</th><th>Hébergements</th><th>Stockage</th><th /></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.slug}</small></td><td>{row.subscription?.planName ?? "Sans forfait"}</td><td><Badge value={row.subscription?.status ?? row.status} /></td><td>{row.metrics.members}</td><td>{row.metrics.properties}</td><td>{formatBytes(row.metrics.storageBytes)}</td><td><button className="admin-row-button" type="button" onClick={() => setSelected(row.id)}>Gérer</button></td></tr>)}</tbody></table></div>{!filtered.length ? <EmptyState>Aucun client ne correspond à ces critères.</EmptyState> : null}</section>
    {selected ? <><button className="admin-drawer-backdrop" type="button" aria-label="Fermer le détail" onClick={() => setSelected(null)} /><OrganizationDetails organizationId={selected} onClose={() => setSelected(null)} onChanged={() => reload(query)} /></> : null}
  </>;
}

function Plans({ payload, reload }: { payload: PlansPayload; reload: () => Promise<void> }) {
  const newPlan = (): Plan => ({ id: "new", code: "", name: "", description: "", status: "draft", billingPeriods: ["monthly"], locked: false, subscriptionCount: 0, entitlements: [...payload.catalog.modules.map((item) => ({ featureKey: item.key, valueBoolean: true, limitValue: null, limitType: "hard" as const })), ...payload.catalog.metrics.map((item) => ({ featureKey: item.key, valueBoolean: null, limitValue: null, limitType: "hard" as const }))], prices: [] });
  const [draft, setDraft] = useState<Plan | null>(payload.plans[0] ?? null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!draft && payload.plans[0]) setDraft(payload.plans[0]); }, [draft, payload.plans]);
  const entitlement = (key: string) => draft?.entitlements.find((item) => item.featureKey === key);
  const updateEntitlement = (key: string, change: Partial<Entitlement>) => setDraft((current) => current ? { ...current, entitlements: current.entitlements.some((item) => item.featureKey === key) ? current.entitlements.map((item) => item.featureKey === key ? { ...item, ...change } : item) : [...current.entitlements, { featureKey: key, valueBoolean: null, limitValue: null, limitType: "hard", ...change }] } : current);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return; setSaving(true); setMessage("");
    const json = { code: draft.code, name: draft.name, description: draft.description, status: draft.status, billingPeriods: draft.billingPeriods, entitlements: draft.entitlements };
    try {
      const saved = draft.id === "new" ? await apiFetch<Plan>("/platform/billing/plans", { method: "POST", json }) : await apiFetch<Plan>(`/platform/billing/plans/${draft.id}`, { method: "PATCH", json: { name: json.name, description: json.description, status: json.status, billingPeriods: json.billingPeriods, entitlements: json.entitlements } });
      await reload(); setDraft(saved); setMessage("Forfait enregistré.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Enregistrement impossible."); } finally { setSaving(false); }
  };
  return <div className="admin-plans-layout">
    <aside className="admin-plan-list"><button className="admin-primary-button admin-primary-button--full" type="button" onClick={() => { setDraft(newPlan()); setMessage(""); }}>+ Nouveau forfait</button>{payload.plans.map((plan) => <button type="button" key={plan.id} className={`admin-plan-item${draft?.id === plan.id ? " is-active" : ""}`} onClick={() => { setDraft(plan); setMessage(""); }}><span><strong>{plan.name}</strong><small>{plan.code}</small></span><span><Badge value={plan.status} /><small>{plan.subscriptionCount} client(s)</small></span></button>)}</aside>
    <section className="admin-panel admin-plan-editor">{draft ? <form onSubmit={save}><header className="admin-panel__header"><div><h2>{draft.id === "new" ? "Créer un forfait" : draft.name}</h2><p>{draft.locked ? "Ce forfait protège l’installation historique et reste en lecture seule." : "Définissez l’offre, ses modules et ses quotas."}</p></div>{!draft.locked ? <button className="admin-primary-button" disabled={saving} type="submit">{saving ? "Enregistrement…" : "Enregistrer"}</button> : null}</header>{message ? <p className="admin-feedback" role="status">{message}</p> : null}
      <fieldset disabled={draft.locked || saving} className="admin-fieldset"><div className="admin-form__row"><label>Nom<input required minLength={2} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Code technique<input required pattern="[a-z][a-z0-9_]*" disabled={draft.id !== "new"} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="ex. essentiel" /></label><label>État<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Plan["status"] })}><option value="draft">Brouillon</option><option value="active">Actif</option><option value="archived">Archivé</option></select></label></div><label>Description<textarea rows={3} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <div className="admin-editor-section"><h3>Périodicités</h3><div className="admin-toggle-row">{(["monthly", "annual"] as const).map((period) => <label className="admin-checkbox" key={period}><input type="checkbox" checked={draft.billingPeriods.includes(period)} onChange={(event) => setDraft({ ...draft, billingPeriods: event.target.checked ? [...draft.billingPeriods, period] : draft.billingPeriods.filter((item) => item !== period) })} /><span>{period === "monthly" ? "Mensuelle" : "Annuelle"}</span></label>)}</div></div>
      <div className="admin-editor-section"><h3>Modules inclus</h3><div className="admin-entitlement-grid">{payload.catalog.modules.map((item) => <label className="admin-switch-row" key={item.key}><span><strong>{item.label}</strong><small>{item.key}</small></span><input type="checkbox" checked={entitlement(item.key)?.valueBoolean === true} onChange={(event) => updateEntitlement(item.key, { valueBoolean: event.target.checked })} /></label>)}</div></div>
      <div className="admin-editor-section"><h3>Quotas</h3><div className="admin-quota-editor">{payload.catalog.metrics.map((item) => <div key={item.key}><span><strong>{item.label}</strong><small>{item.key}</small></span><label>Limite<input type="number" min="0" value={entitlement(item.key)?.limitValue ?? ""} placeholder="Illimitée" onChange={(event) => updateEntitlement(item.key, { limitValue: event.target.value === "" ? null : Number(event.target.value) })} /></label><label>Contrôle<select value={entitlement(item.key)?.limitType ?? "hard"} onChange={(event) => updateEntitlement(item.key, { limitType: event.target.value as "soft" | "hard" })}><option value="soft">Souple</option><option value="hard">Dur</option></select></label></div>)}</div></div></fieldset>
      {draft.prices.length ? <div className="admin-editor-section"><h3>Prix reliés au fournisseur</h3><div className="admin-compact-list">{draft.prices.map((price) => <div key={price.id}><strong>{price.billingPeriod === "annual" ? "Annuel" : "Mensuel"} · {price.provider}</strong><span>{price.priceId} · {price.status}</span></div>)}</div></div> : <div className="admin-editor-section"><h3>Prix reliés au fournisseur</h3><EmptyState>Aucun prix Stripe relié à ce forfait.</EmptyState></div>}
    </form> : <EmptyState>Sélectionnez un forfait.</EmptyState>}</section>
  </div>;
}

function Users({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = users.filter((user) => `${user.displayName} ${user.loginId} ${user.email ?? ""} ${user.memberships.map((item) => item.organizationName).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="admin-toolbar"><div className="admin-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un utilisateur…" /></div></div><section className="admin-panel admin-panel--table"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Utilisateur</th><th>Clients</th><th>Rôle</th><th>Dernière activité</th><th>État</th></tr></thead><tbody>{filtered.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>{user.email ?? user.loginId}</small></td><td>{user.memberships.map((item) => <span className="admin-membership" key={item.organizationId}>{item.organizationName}</span>)}</td><td>{user.platformAdministrator ? "Administrateur plateforme" : user.memberships.map((item) => item.role).join(", ")}</td><td>{formatDate(user.lastSeenAt, true)}</td><td><Badge value={user.active ? "active" : "suspended"} /></td></tr>)}</tbody></table></div>{!filtered.length ? <EmptyState>Aucun utilisateur ne correspond à cette recherche.</EmptyState> : null}</section></>;
}

const sectionCopy: Record<AdminSection, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "Pilotage commercial", title: "Vue d’ensemble", description: "L’état de la plateforme, des clients et de la facturation en un coup d’œil." },
  organizations: { eyebrow: "Gestion commerciale", title: "Clients", description: "Forfaits, statuts, consommation et dérogations de chaque organisation." },
  plans: { eyebrow: "Catalogue commercial", title: "Forfaits et quotas", description: "Composez les offres qui seront attribuées à vos clients." },
  users: { eyebrow: "Accès à la plateforme", title: "Utilisateurs", description: "Consultez les comptes et leurs rattachements aux clients." },
  activity: { eyebrow: "Traçabilité", title: "Activité", description: "Suivez les changements administratifs et événements de facturation." },
};

export default function PlatformBillingPage({ currentUser, onLogout }: { currentUser?: AppUser | null; onLogout?: () => void }) {
  const [section, setSection] = useState<AdminSection>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [plans, setPlans] = useState<PlansPayload | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => setDashboard(await apiFetch<Dashboard>("/platform/billing/dashboard")), []);
  const loadOrganizations = useCallback(async (query = "") => setOrganizations(await apiFetch<OrganizationRow[]>(`/platform/billing/organizations?q=${encodeURIComponent(query)}`)), []);
  const loadPlans = useCallback(async () => setPlans(await apiFetch<PlansPayload>("/platform/billing/plans")), []);
  const loadUsers = useCallback(async () => setUsers(await apiFetch<UserRow[]>("/platform/billing/users")), []);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { await Promise.all([loadDashboard(), loadOrganizations(), loadPlans(), loadUsers()]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "L’administration n’est pas accessible."); }
    finally { setLoading(false); }
  }, [loadDashboard, loadOrganizations, loadPlans, loadUsers]);

  useEffect(() => { void refresh(); }, [refresh]);
  const nav = useMemo(() => [
    { id: "overview" as const, label: "Vue d’ensemble", icon: "overview" },
    { id: "organizations" as const, label: "Clients", icon: "organizations" },
    { id: "plans" as const, label: "Forfaits et quotas", icon: "plans" },
    { id: "users" as const, label: "Utilisateurs", icon: "users" },
    { id: "activity" as const, label: "Activité", icon: "activity" },
  ], []);
  const copy = sectionCopy[section];

  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><span>GA</span><div><strong>Gestion App</strong><small>Administration</small></div></div>
      <nav className="admin-nav" aria-label="Administration de plateforme">{nav.map((item) => <button type="button" className={section === item.id ? "is-active" : ""} key={item.id} onClick={() => setSection(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <div className="admin-sidebar__footer"><div className="admin-avatar">{(currentUser?.displayName ?? "A").slice(0, 1).toUpperCase()}</div><div><strong>{currentUser?.displayName ?? "Administrateur"}</strong><small>{error ? "Compte connecté" : dashboard ? "Super-administrateur" : "Vérification…"}</small></div>{onLogout ? <button type="button" title="Déconnexion" aria-label="Déconnexion" onClick={onLogout}><Icon name="logout" /></button> : <Link to="/aujourdhui" title="Retour à l’application" aria-label="Retour à l’application"><Icon name="logout" /></Link>}</div>
    </aside>
    <main className="admin-main">
      <header className="admin-page-header"><div><p>{copy.eyebrow}</p><h1>{copy.title}</h1><span>{copy.description}</span></div><div className="admin-page-header__actions"><Link className="admin-secondary-button" to="/aujourdhui">Retour à l’application</Link><button className="admin-secondary-button" type="button" onClick={() => void refresh()} disabled={loading}><Icon name="refresh" />Actualiser</button></div></header>
      {error ? <section className="admin-access-error" role="alert"><h2>Accès indisponible</h2><p>{error}</p><Link to="/aujourdhui">Retourner à l’application</Link></section> : loading || !dashboard || !plans ? <div className="admin-loading">Chargement du pilotage commercial…</div> : <div className="admin-page-content">
        {section === "overview" ? <Overview dashboard={dashboard} onNavigate={setSection} /> : null}
        {section === "organizations" ? <Organizations rows={organizations} reload={loadOrganizations} /> : null}
        {section === "plans" ? <Plans payload={plans} reload={loadPlans} /> : null}
        {section === "users" ? <Users users={users} /> : null}
        {section === "activity" ? <section className="admin-panel"><header className="admin-panel__header"><div><h2>Journal de la plateforme</h2><p>Les vingt événements les plus récents.</p></div></header><ActivityList items={dashboard.activity} /></section> : null}
      </div>}
    </main>
  </div>;
}

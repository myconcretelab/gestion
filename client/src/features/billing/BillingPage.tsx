import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../utils/api";

type BillingSnapshot = {
  plan: { code: string; name: string; description: string } | null;
  subscription: { status: string; trialEnd: string | null; currentPeriodEnd: string | null; gracePeriodEnd: string | null } | null;
  capabilities: { read: boolean; export: boolean; write: boolean; warning: boolean };
  features: Record<string, { planAllows: boolean; organizationEnabled: boolean; override: boolean | null; effective: boolean }>;
  limits: Array<{ metricKey: string; limit: number | null; usage: number; exceeded: boolean; limitType: string }>;
  actions: { checkoutAllowed: boolean; portalAllowed: boolean; periods: string[] };
};

const statusLabels: Record<string, string> = { trialing: "Essai", active: "Actif", past_due: "Paiement en attente", grace_period: "Période de grâce", suspended: "Suspendu", cancelled: "Résilié" };
const featureLabels: Record<string, string> = {
  reservations: "Réservations", contracts: "Contrats", invoices: "Factures", finances: "Finances et statistiques",
  personal_expenses: "Frais personnels", worker_planning: "Planning des intervenants", web_publication: "Publication web",
  ical: "Calendriers iCal", pump_airbnb: "Import Airbnb", smart_life: "Automatisations Smart Life", sms: "SMS",
  telegram: "Notifications Telegram", daily_email: "E-mail quotidien",
};
const metricLabels: Record<string, string> = {
  active_properties: "Hébergements actifs", manager_members: "Membres gestionnaires", worker_members: "Intervenants actifs",
  reservations_created: "Réservations créées ce mois", documents_generated: "Documents générés ce mois", storage_bytes: "Stockage utilisé",
  sms_sent: "SMS envoyés ce mois", automations_executed: "Automatisations exécutées ce mois",
};
const formatUsage = (key: string, value: number) => key === "storage_bytes" ? `${(value / 1_048_576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo` : value.toLocaleString("fr-FR");
const formatDate = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("fr-FR") : null;

export default function BillingPage() {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; result: string | null; received_at: string }>>([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void apiFetch<BillingSnapshot>("/billing/subscription").then(setSnapshot).catch((reason) => setError(reason instanceof Error ? reason.message : "Impossible de charger l’abonnement."));
    void apiFetch<Array<{ id: string; result: string | null; received_at: string }>>("/billing/events").then(setEvents).catch(() => undefined);
    void apiFetch<{ platformAdministrator: boolean }>("/platform/billing/session").then((value) => setPlatformAdmin(value.platformAdministrator)).catch(() => undefined);
  }, []);
  const openBillingLink = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const result = await apiFetch<{ url: string }>(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      window.location.assign(result.url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action impossible."); setBusy(false); }
  };
  if (error && !snapshot) return <main className="page"><h1>Abonnement</h1><p role="alert">{error}</p></main>;
  if (!snapshot) return <main className="page"><h1>Abonnement</h1><p>Chargement…</p></main>;
  const status = snapshot.subscription?.status ?? "active";
  return <main className="page">
    <header className="page-header"><div><h1>Abonnement</h1><p>{snapshot.plan?.description || "Aucun forfait commercial configuré."}</p></div>{platformAdmin ? <Link className="button" to="/administration/facturation">Administration commerciale</Link> : null}</header>
    {error ? <p role="alert">{error}</p> : null}
    <section className="card"><h2>{snapshot.plan?.name ?? "Installation autonome"}</h2><p>Statut : <strong>{statusLabels[status] ?? "État inconnu"}</strong></p>
      {status === "trialing" && snapshot.subscription?.trialEnd ? <p>Essai jusqu’au {formatDate(snapshot.subscription.trialEnd)}.</p> : null}
      {status === "past_due" ? <p role="status">Un paiement est en attente. Vous pouvez encore utiliser l’application et mettre à jour votre moyen de paiement.</p> : null}
      {status === "grace_period" ? <p role="status">La période de grâce court jusqu’au {formatDate(snapshot.subscription?.gracePeriodEnd) ?? "délai configuré"}.</p> : null}
      {status === "suspended" || status === "cancelled" ? <p role="status">Les nouvelles écritures sont bloquées, mais vos données existantes restent lisibles et exportables.</p> : null}
      {snapshot.subscription?.currentPeriodEnd ? <p>Prochaine échéance : {formatDate(snapshot.subscription.currentPeriodEnd)}.</p> : null}
      <p>Lecture et export : autorisés. Nouvelles modifications : {snapshot.capabilities.write ? "autorisées" : "bloquées"}.</p>
      <div className="actions">
        {snapshot.actions.periods.includes("monthly") ? <button type="button" disabled={busy || !snapshot.actions.checkoutAllowed} onClick={() => void openBillingLink("/billing/checkout", { billingPeriod: "monthly" })}>Choisir le paiement mensuel</button> : null}
        {snapshot.actions.periods.includes("annual") ? <button type="button" disabled={busy || !snapshot.actions.checkoutAllowed} onClick={() => void openBillingLink("/billing/checkout", { billingPeriod: "annual" })}>Choisir le paiement annuel</button> : null}
        {snapshot.actions.portalAllowed ? <button type="button" disabled={busy} onClick={() => void openBillingLink("/billing/portal")}>Gérer le paiement</button> : null}
      </div>
      {!snapshot.actions.checkoutAllowed && snapshot.plan?.code !== "legacy_unlimited" ? <p><small>Le paiement en ligne du pilote n’est pas encore configuré.</small></p> : null}
    </section>
    <section className="card"><h2>Fonctionnalités</h2><ul>{Object.entries(snapshot.features).map(([key, value]) => <li key={key}>{featureLabels[key] ?? "Fonctionnalité"} — {value.effective ? "Disponible" : value.organizationEnabled ? "Non incluse dans le forfait" : "Désactivée dans vos réglages"}</li>)}</ul></section>
    <section className="card"><h2>Limites et usages</h2>{snapshot.limits.length ? <ul>{snapshot.limits.map((item) => <li key={item.metricKey}>{metricLabels[item.metricKey] ?? "Usage"} : {formatUsage(item.metricKey, item.usage)} / {item.limit === null ? "illimité" : formatUsage(item.metricKey, item.limit)} — quota {item.limitType === "hard" ? "bloquant" : "avec avertissement"}{item.exceeded ? " (dépassé)" : ""}</li>)}</ul> : <p>Aucune limite sur ce forfait.</p>}</section>
    <section className="card"><h2>Historique de facturation</h2>{events.length ? <ul>{events.map((event) => <li key={event.id}>{new Date(event.received_at).toLocaleDateString("fr-FR")} — {event.result === "applied" ? "Mise à jour appliquée" : event.result === "ignored_out_of_order" ? "Événement ancien ignoré" : "Événement traité"}</li>)}</ul> : <p>Aucun événement de facturation.</p>}</section>
  </main>;
}

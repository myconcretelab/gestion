import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../utils/api";

type BillingSnapshot = {
  plan: { code: string; name: string; description: string } | null;
  subscription: { status: string; currentPeriodEnd: string | null; gracePeriodEnd: string | null; providerConfigured: boolean } | null;
  capabilities: { read: boolean; export: boolean; write: boolean; warning: boolean };
  features: Record<string, { planAllows: boolean; organizationEnabled: boolean; override: boolean | null; effective: boolean }>;
  limits: Array<{ metricKey: string; limit: number | null; usage: number; exceeded: boolean; limitType: string }>;
};

const labels: Record<string, string> = { trialing: "Essai", active: "Actif", past_due: "Paiement en attente", grace_period: "Période de grâce", suspended: "Suspendu", cancelled: "Résilié" };

export default function BillingPage() {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; type: string; result: string | null; received_at: string }>>([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void apiFetch<BillingSnapshot>("/billing/subscription").then(setSnapshot).catch((reason) => setError(reason instanceof Error ? reason.message : "Impossible de charger l’abonnement."));
    void apiFetch<Array<{ id: string; type: string; result: string | null; received_at: string }>>("/billing/events").then(setEvents).catch(() => undefined);
    void apiFetch<{ platformAdministrator: boolean }>("/platform/billing/session").then((value) => setPlatformAdmin(value.platformAdministrator)).catch(() => undefined);
  }, []);
  if (error) return <main className="page"><h1>Abonnement</h1><p role="alert">{error}</p></main>;
  if (!snapshot) return <main className="page"><h1>Abonnement</h1><p>Chargement…</p></main>;
  return <main className="page">
    <header className="page-header"><div><h1>Abonnement</h1><p>{snapshot.plan?.description || "Aucun forfait commercial configuré."}</p></div>{platformAdmin ? <Link className="button" to="/administration/facturation">Administration commerciale</Link> : null}</header>
    <section className="card"><h2>{snapshot.plan?.name ?? "Installation autonome"}</h2><p>Statut : <strong>{labels[snapshot.subscription?.status ?? "active"] ?? snapshot.subscription?.status}</strong></p>{snapshot.capabilities.warning ? <p role="status">Votre abonnement nécessite une attention. Vos données et exports restent accessibles.</p> : null}<p>Écriture : {snapshot.capabilities.write ? "autorisée" : "limitée"}</p></section>
    <section className="card"><h2>Fonctionnalités</h2><ul>{Object.entries(snapshot.features).map(([key, value]) => <li key={key}>{key} — {value.effective ? "Disponible" : value.organizationEnabled ? "Non incluse dans le forfait" : "Désactivée dans vos réglages"}</li>)}</ul></section>
    <section className="card"><h2>Limites et usages</h2>{snapshot.limits.length ? <ul>{snapshot.limits.map((item) => <li key={item.metricKey}>{item.metricKey} : {item.usage} / {item.limit ?? "∞"}{item.exceeded ? " — dépassement" : ""}</li>)}</ul> : <p>Aucune limite sur ce forfait.</p>}</section>
    <section className="card"><h2>Historique</h2>{events.length ? <ul>{events.map((event) => <li key={event.id}>{new Date(event.received_at).toLocaleDateString("fr-FR")} — {event.type} ({event.result ?? "traité"})</li>)}</ul> : <p>Aucun événement de facturation.</p>}</section>
  </main>;
}

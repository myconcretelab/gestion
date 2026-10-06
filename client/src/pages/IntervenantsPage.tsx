import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Gite, Intervenant } from "../utils/types";
import { formatWorkMinutes } from "../utils/intervenantHours";
import "./intervenantsPage.css";

type HourEntry = {
  id: string; intervenant_id: string | null; intervenant_nom: string; worked_on: string;
  minutes: number; paid_at: string | null; hourly_rate_snapshot: number | null;
};
type InterventionEntry = {
  id: string; user_id: string | null; user_name: string; kind: "cleaning_check" | "full_cleaning";
  occurred_on: string; gite_name: string | null; amount: number; paid_at: string | null;
};
type ProfileDraft = { show_on_today: boolean };
type ManualDraft = { userId: string; giteId: string; occurredOn: string };

const todayIso = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const formatEuro = (value: number) => new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR",
}).format(value);
const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
  day: "2-digit", month: "2-digit", year: "numeric",
});

export default function IntervenantsPage() {
  const [workers, setWorkers] = useState<Intervenant[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [hours, setHours] = useState<HourEntry[]>([]);
  const [interventions, setInterventions] = useState<InterventionEntry[]>([]);
  const [allUnpaidHours, setAllUnpaidHours] = useState<HourEntry[]>([]);
  const [allUnpaidInterventions, setAllUnpaidInterventions] = useState<InterventionEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});
  const [manualDraft, setManualDraft] = useState<ManualDraft>({ userId: "", giteId: "", occurredOn: todayIso() });
  const [workerFilter, setWorkerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "paid">("unpaid");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWorkers = useCallback(async () => {
    const [workerRows, giteRows] = await Promise.all([
      apiFetch<Intervenant[]>("/intervenants"),
      apiFetch<Gite[]>("/gites"),
    ]);
    setWorkers(workerRows);
    setGites(giteRows);
    setDrafts(Object.fromEntries(workerRows.map((worker) => [worker.id, { show_on_today: worker.show_on_today ?? false }])));
    setManualDraft((current) => ({
      ...current,
      userId: current.userId || workerRows.find((worker) => worker.is_active && worker.user_id)?.user_id || "",
      giteId: current.giteId || giteRows[0]?.id || "",
    }));
  }, []);

  const loadHistory = useCallback(async () => {
    const hourParams = new URLSearchParams({ status: statusFilter });
    if (workerFilter) hourParams.set("worker_id", workerFilter);
    const selectedUserId = workers.find((worker) => worker.id === workerFilter)?.user_id;
    const interventionParams = new URLSearchParams({ status: statusFilter });
    if (selectedUserId) interventionParams.set("user_id", selectedUserId);
    const [hourRows, interventionRows, unpaidHourRows, unpaidInterventionRows] = await Promise.all([
      apiFetch<{ entries: HourEntry[] }>(`/intervenants/hours/history?${hourParams}`),
      apiFetch<{ entries: InterventionEntry[] }>(`/interventions?${interventionParams}`),
      apiFetch<{ entries: HourEntry[] }>("/intervenants/hours/history?status=unpaid"),
      apiFetch<{ entries: InterventionEntry[] }>("/interventions?status=unpaid"),
    ]);
    setHours(hourRows.entries);
    setInterventions(interventionRows.entries);
    setAllUnpaidHours(unpaidHourRows.entries);
    setAllUnpaidInterventions(unpaidInterventionRows.entries);
  }, [statusFilter, workerFilter, workers]);

  useEffect(() => {
    setLoading(true);
    loadWorkers()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Impossible de charger les intervenants."))
      .finally(() => setLoading(false));
  }, [loadWorkers]);
  useEffect(() => {
    if (!workers.length && loading) return;
    void loadHistory().catch((reason) => setError(reason instanceof Error ? reason.message : "Impossible de charger les interventions."));
  }, [loadHistory, loading, workers.length]);

  const summaries = useMemo(() => workers.map((worker) => {
    const workerHours = allUnpaidHours.filter((entry) => entry.intervenant_id === worker.id);
    const workerInterventions = allUnpaidInterventions.filter((entry) => entry.user_id === worker.user_id);
    const minutes = workerHours.reduce((sum, entry) => sum + entry.minutes, 0);
    const hoursAmount = minutes / 60 * Number(worker.hourly_rate ?? 0);
    const checks = workerInterventions.filter((entry) => entry.kind === "cleaning_check");
    const cleanings = workerInterventions.filter((entry) => entry.kind === "full_cleaning");
    const interventionAmount = workerInterventions.reduce((sum, entry) => sum + Number(entry.amount), 0);
    return {
      worker, minutes, checks: checks.length, cleanings: cleanings.length,
      hoursAmount, interventionAmount, total: hoursAmount + interventionAmount,
    };
  }), [allUnpaidHours, allUnpaidInterventions, workers]);
  const totalMinutes = summaries.reduce((sum, row) => sum + row.minutes, 0);
  const totalChecks = summaries.reduce((sum, row) => sum + row.checks, 0);
  const totalCleanings = summaries.reduce((sum, row) => sum + row.cleanings, 0);
  const totalAmount = summaries.reduce((sum, row) => sum + row.total, 0);

  const saveOperationalSettings = async (worker: Intervenant) => {
    const draft = drafts[worker.id];
    if (!draft) return;
    setBusyId(worker.id); setError(null); setNotice(null);
    try {
      await apiFetch(`/intervenants/${worker.id}`, { method: "PATCH", json: { show_on_today: draft.show_on_today } });
      await loadWorkers();
      setNotice(`Paramètres de ${worker.nom} enregistrés.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d'enregistrer.");
    } finally { setBusyId(null); }
  };

  const settleWorker = async (worker: Intervenant) => {
    const summary = summaries.find((row) => row.worker.id === worker.id);
    if (!summary?.total || !confirm(`Confirmer le paiement de ${formatEuro(summary.total)} à ${worker.nom} ?`)) return;
    setBusyId(worker.id); setError(null); setNotice(null);
    try {
      const result = await apiFetch<{ amount: number }>(`/intervenants/hours/${worker.id}/settle`, { method: "POST" });
      await loadHistory();
      setNotice(`Paiement de ${worker.nom} enregistré (${formatEuro(result.amount)}).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d'enregistrer le paiement.");
    } finally { setBusyId(null); }
  };

  const createFullCleaning = async () => {
    if (!manualDraft.userId || !manualDraft.giteId || !manualDraft.occurredOn) {
      setError("Choisissez la personne, le gîte et la date.");
      return;
    }
    setBusyId("new-cleaning"); setError(null); setNotice(null);
    try {
      await apiFetch("/interventions", { method: "POST", json: manualDraft });
      await loadHistory();
      setNotice("Ménage complet comptabilisé.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de comptabiliser le ménage.");
    } finally { setBusyId(null); }
  };

  const removeIntervention = async (entry: InterventionEntry) => {
    if (!confirm("Retirer cette intervention non payée ?")) return;
    setBusyId(entry.id);
    try {
      await apiFetch(`/interventions/${entry.id}`, { method: "DELETE" });
      await loadHistory();
      setNotice("Intervention retirée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de retirer l'intervention.");
    } finally { setBusyId(null); }
  };

  return <div className="intervenants-page">
    <header className="intervenants-hero">
      <div><span className="intervenants-hero__eyebrow">Activité et rémunération</span><h1>Interventions</h1>
        <p>Suivez les heures, les contrôles de ménage, les ménages complets et les montants restant à payer.</p></div>
      <Link className="secondary button-link" to="/parametres/utilisateurs">Tarifs et utilisateurs</Link>
    </header>
    {error ? <div className="note" role="alert">{error}</div> : null}
    {notice ? <div className="note note--success" role="status">{notice}</div> : null}

    <section className="intervenants-kpis" aria-label="Synthèse à payer">
      <article><span>Heures à payer</span><strong>{formatWorkMinutes(totalMinutes)}</strong></article>
      <article><span>Contrôles à payer</span><strong>{totalChecks}</strong></article>
      <article><span>Ménages à payer</span><strong>{totalCleanings}</strong></article>
      <article><span>Total à payer</span><strong>{formatEuro(totalAmount)}</strong></article>
    </section>

    <section className="card intervenants-summary">
      <div className="intervenants-history__header"><div><span className="intervenants-hero__eyebrow">Synthèse</span><h2>À payer par intervenant</h2></div></div>
      <div className="intervenants-history__table-wrap"><table className="table intervenants-summary__table"><thead><tr>
        <th>Intervenant</th><th>Tarifs</th><th>Heures</th><th>Contrôles</th><th>Ménages</th><th>Total</th><th></th>
      </tr></thead><tbody>{summaries.map(({ worker, minutes, checks, cleanings, total }) => <tr key={worker.id}>
        <td><strong>{worker.nom}</strong><small>{worker.is_active ? "Actif" : "Inactif"}</small></td>
        <td><small>{formatEuro(worker.hourly_rate)}/h · {formatEuro(worker.cleaning_check_rate ?? 0)}/contrôle · {formatEuro(worker.full_cleaning_rate ?? 0)}/ménage</small></td>
        <td>{formatWorkMinutes(minutes)}</td><td>{checks}</td><td>{cleanings}</td><td><strong>{formatEuro(total)}</strong></td>
        <td><button type="button" disabled={!total || busyId === worker.id} onClick={() => void settleWorker(worker)}>Marquer payé</button></td>
      </tr>)}</tbody></table></div>
    </section>

    <section className="intervenants-grid">
      <article className="card intervenants-create-card">
        <div><span className="intervenants-hero__eyebrow">Nouvelle intervention</span><h2>Ménage complet</h2></div>
        <p className="field-hint">Seuls les départs avec l’option ménage peuvent être comptabilisés.</p>
        <label className="field">Intervenant<select value={manualDraft.userId} onChange={(event) => setManualDraft((current) => ({ ...current, userId: event.target.value }))}>
          <option value="">Choisir</option>{workers.filter((worker) => worker.is_active && worker.user_id).map((worker) => <option key={worker.id} value={worker.user_id!}>{worker.nom}</option>)}
        </select></label>
        <label className="field">Gîte<select value={manualDraft.giteId} onChange={(event) => setManualDraft((current) => ({ ...current, giteId: event.target.value }))}>
          <option value="">Choisir</option>{gites.map((gite) => <option key={gite.id} value={gite.id}>{gite.nom}</option>)}
        </select></label>
        <label className="field">Date du départ<input type="date" value={manualDraft.occurredOn} onChange={(event) => setManualDraft((current) => ({ ...current, occurredOn: event.target.value }))} /></label>
        <button type="button" disabled={busyId === "new-cleaning"} onClick={() => void createFullCleaning()}>{busyId === "new-cleaning" ? "Ajout…" : "Comptabiliser"}</button>
      </article>
      <article className="card intervenants-operational">
        <div><span className="intervenants-hero__eyebrow">Paramètres opérationnels</span><h2>Saisie des heures</h2></div>
        {workers.map((worker) => <div className="intervenants-operational__row" key={worker.id}>
          <div><strong>{worker.nom}</strong><small>Les trois tarifs sont définis dans sa fiche utilisateur.</small></div>
          <label className="intervenant-check"><input type="checkbox" checked={drafts[worker.id]?.show_on_today ?? false}
            onChange={(event) => setDrafts((current) => ({ ...current, [worker.id]: { show_on_today: event.target.checked } }))} />Afficher sur Aujourd’hui</label>
          <button className="secondary" type="button" disabled={busyId === worker.id} onClick={() => void saveOperationalSettings(worker)}>Enregistrer</button>
        </div>)}
      </article>
    </section>

    <section className="card intervenants-history">
      <div className="intervenants-history__header"><div><span className="intervenants-hero__eyebrow">Traçabilité</span><h2>Historique détaillé</h2></div>
        <div className="intervenants-history__filters">
          <label>Intervenant<select value={workerFilter} onChange={(event) => setWorkerFilter(event.target.value)}>
            <option value="">Tous</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.nom}</option>)}
          </select></label>
          <label>État<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">Tout</option><option value="unpaid">À payer</option><option value="paid">Payé</option>
          </select></label>
        </div>
      </div>
      <h3>Contrôles et ménages</h3>
      {!interventions.length ? <p className="field-hint">Aucune intervention pour ce filtre.</p> : <div className="intervenants-history__table-wrap">
        <table className="table intervenants-history__table"><thead><tr><th>Date</th><th>Intervenant</th><th>Type</th><th>Gîte</th><th>Montant</th><th>État</th><th></th></tr></thead>
          <tbody>{interventions.map((entry) => <tr key={entry.id}><td>{formatDate(entry.occurred_on)}</td><td>{entry.user_name}</td>
            <td>{entry.kind === "cleaning_check" ? "Contrôle ménage" : "Ménage complet"}</td><td>{entry.gite_name ?? "—"}</td><td>{formatEuro(entry.amount)}</td>
            <td><span className={`intervenants-status intervenants-status--${entry.paid_at ? "paid" : "unpaid"}`}>{entry.paid_at ? "Payé" : "À payer"}</span></td>
            <td>{!entry.paid_at && entry.kind === "full_cleaning" ? <button className="table-action table-action--danger" disabled={busyId === entry.id} onClick={() => void removeIntervention(entry)}>Retirer</button> : null}</td>
          </tr>)}</tbody></table></div>}
      <h3>Heures saisies</h3>
      {!hours.length ? <p className="field-hint">Aucune heure pour ce filtre.</p> : <div className="intervenants-history__table-wrap">
        <table className="table intervenants-history__table"><thead><tr><th>Date</th><th>Intervenant</th><th>Durée</th><th>Taux</th><th>Montant</th><th>État</th></tr></thead>
          <tbody>{hours.map((entry) => { const worker = workers.find((item) => item.id === entry.intervenant_id); const rate = entry.hourly_rate_snapshot ?? Number(worker?.hourly_rate ?? 0);
            return <tr key={entry.id}><td>{formatDate(entry.worked_on)}</td><td>{entry.intervenant_nom}</td><td>{formatWorkMinutes(entry.minutes)}</td>
              <td>{formatEuro(rate)}/h</td><td>{formatEuro(entry.minutes / 60 * rate)}</td>
              <td><span className={`intervenants-status intervenants-status--${entry.paid_at ? "paid" : "unpaid"}`}>{entry.paid_at ? "Payé" : "À payer"}</span></td></tr>; })}</tbody>
        </table></div>}
    </section>
  </div>;
}

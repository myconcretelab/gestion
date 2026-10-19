import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { AppUser } from "../utils/auth";
import type { Gite, Intervenant } from "../utils/types";
import { formatWorkMinutes, parseWorkHours } from "../utils/intervenantHours";
import "./intervenantsPage.css";

type HourEntry = {
  id: string; intervenant_id: string | null; intervenant_nom: string; worked_on: string;
  minutes: number; paid_at: string | null; hourly_rate_snapshot: number | null;
  updated_at: string;
};
type InterventionEntry = {
  id: string; user_id: string | null; user_name: string; kind: "cleaning_check" | "full_cleaning" | "task";
  occurred_on: string; gite_id: string | null; gite_name: string | null; amount: number; paid_at: string | null;
  updated_at: string;
};
type ProfileDraft = { show_on_today: boolean };
type ManualDraft = { userId: string; giteId: string; occurredOn: string };
type CorrectionDraft = {
  type: "intervention";
  entry: InterventionEntry;
  userId: string;
  kind: InterventionEntry["kind"];
  giteId: string;
  occurredOn: string;
  amount: string;
  paid: boolean;
  reason: string;
} | {
  type: "hours";
  entry: HourEntry;
  workerId: string;
  workedOn: string;
  hours: string;
  paid: boolean;
  reason: string;
};

const todayIso = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const formatEuro = (value: number) => new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR",
}).format(value);
const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
  day: "2-digit", month: "2-digit", year: "numeric",
});
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const unpaidAgeLabel = (firstUnpaidOn: string, today: string) => {
  const days = daysBetween(firstUnpaidOn, today);
  if (days < 0) return `Activité prévue le ${formatDate(firstUnpaidOn)}`;
  if (days === 0) return "En attente depuis aujourd’hui";
  return `En attente depuis le ${formatDate(firstUnpaidOn)} (${days} ${days === 1 ? "jour" : "jours"})`;
};

export default function IntervenantsPage({ currentUser }: { currentUser: AppUser | null }) {
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
  const [correction, setCorrection] = useState<CorrectionDraft | null>(null);
  const canCorrectHistory = !currentUser || currentUser.permissions.isOwner;

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
    const workerInterventions = worker.user_id
      ? allUnpaidInterventions.filter((entry) => entry.user_id === worker.user_id)
      : [];
    const minutes = workerHours.reduce((sum, entry) => sum + entry.minutes, 0);
    const hoursAmount = minutes / 60 * Number(worker.hourly_rate ?? 0);
    const checks = workerInterventions.filter((entry) => entry.kind === "cleaning_check");
    const cleanings = workerInterventions.filter((entry) => entry.kind === "full_cleaning");
    const tasks = workerInterventions.filter((entry) => entry.kind === "task");
    const interventionAmount = workerInterventions.reduce((sum, entry) => sum + Number(entry.amount), 0);
    const unpaidDates = [
      ...workerHours.map((entry) => entry.worked_on),
      ...workerInterventions.map((entry) => entry.occurred_on),
    ].sort();
    return {
      worker, minutes, checks: checks.length, cleanings: cleanings.length, tasks: tasks.length,
      hoursAmount, interventionAmount, total: hoursAmount + interventionAmount,
      firstUnpaidOn: unpaidDates[0] ?? null,
      lastUnpaidOn: unpaidDates.at(-1) ?? null,
    };
  }), [allUnpaidHours, allUnpaidInterventions, workers]);
  const totalMinutes = summaries.reduce((sum, row) => sum + row.minutes, 0);
  const totalChecks = summaries.reduce((sum, row) => sum + row.checks, 0);
  const totalCleanings = summaries.reduce((sum, row) => sum + row.cleanings, 0);
  const totalTasks = summaries.reduce((sum, row) => sum + row.tasks, 0);
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

  const openInterventionCorrection = (entry: InterventionEntry) => {
    setError(null);
    setCorrection({
      type: "intervention",
      entry,
      userId: entry.user_id ?? "",
      kind: entry.kind,
      giteId: entry.gite_id ?? "",
      occurredOn: entry.occurred_on,
      amount: String(entry.amount).replace(".", ","),
      paid: Boolean(entry.paid_at),
      reason: "",
    });
  };

  const openHoursCorrection = (entry: HourEntry) => {
    setError(null);
    setCorrection({
      type: "hours",
      entry,
      workerId: entry.intervenant_id ?? "",
      workedOn: entry.worked_on,
      hours: String(entry.minutes / 60).replace(".", ","),
      paid: Boolean(entry.paid_at),
      reason: "",
    });
  };

  const saveCorrection = async () => {
    if (!correction || correction.reason.trim().length < 3) {
      setError("Indiquez brièvement le motif de la correction.");
      return;
    }
    setBusyId(`correct-${correction.entry.id}`);
    setError(null);
    setNotice(null);
    try {
      if (correction.type === "intervention") {
        const amount = Number(correction.amount.trim().replace(",", "."));
        if (!correction.userId || !correction.giteId || !correction.occurredOn || !Number.isFinite(amount) || amount < 0) {
          throw new Error("Vérifiez l’intervenant, le gîte, la date et le montant.");
        }
        await apiFetch(`/interventions/${encodeURIComponent(correction.entry.id)}`, {
          method: "PATCH",
          json: {
            userId: correction.userId,
            kind: correction.kind,
            giteId: correction.giteId,
            occurredOn: correction.occurredOn,
            amount,
            paid: correction.paid,
            reason: correction.reason,
            expectedUpdatedAt: correction.entry.updated_at,
          },
        });
      } else {
        const minutes = parseWorkHours(correction.hours);
        if (!correction.workerId || !correction.workedOn || minutes === null) {
          throw new Error("Vérifiez l’intervenant, la date et la durée.");
        }
        await apiFetch(`/intervenants/hours/admin/${encodeURIComponent(correction.entry.id)}`, {
          method: "PATCH",
          json: {
            workerId: correction.workerId,
            workedOn: correction.workedOn,
            minutes,
            paid: correction.paid,
            reason: correction.reason,
            expectedUpdatedAt: correction.entry.updated_at,
          },
        });
      }
      await loadHistory();
      setCorrection(null);
      setNotice("Correction enregistrée et ajoutée au journal d’audit.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer la correction.");
    } finally {
      setBusyId(null);
    }
  };

  return <div className="intervenants-page">
    <header className="intervenants-hero">
      <div><span className="intervenants-hero__eyebrow">Activité et rémunération</span><h1>Interventions</h1>
        <p>Suivez les heures, les contrôles, les ménages, les tâches rémunérées et les montants restant à payer.</p></div>
      <Link className="secondary button-link" to="/parametres/utilisateurs">Tarifs et utilisateurs</Link>
    </header>
    {error ? <div className="note" role="alert">{error}</div> : null}
    {notice ? <div className="note note--success" role="status">{notice}</div> : null}

    <section className="intervenants-kpis" aria-label="Synthèse à payer">
      <article><span>Heures à payer</span><strong>{formatWorkMinutes(totalMinutes)}</strong></article>
      <article><span>Contrôles à payer</span><strong>{totalChecks}</strong></article>
      <article><span>Ménages à payer</span><strong>{totalCleanings}</strong></article>
      <article><span>Tâches au forfait</span><strong>{totalTasks}</strong></article>
      <article><span>Total à payer</span><strong>{formatEuro(totalAmount)}</strong></article>
    </section>

    <section className="card intervenants-summary">
      <div className="intervenants-history__header"><div><span className="intervenants-hero__eyebrow">Synthèse</span><h2>À payer par intervenant</h2></div></div>
      <div className="intervenants-history__table-wrap"><table className="table intervenants-summary__table"><thead><tr>
        <th>Intervenant</th><th>Période à payer</th><th>Heures</th><th>Contrôles</th><th>Ménages</th><th>Tâches</th><th>Total</th><th></th>
      </tr></thead><tbody>{summaries.map(({ worker, minutes, checks, cleanings, tasks, total, firstUnpaidOn, lastUnpaidOn }) => <tr key={worker.id}>
        <td><strong>{worker.nom}</strong><small>{worker.is_active ? "Actif" : "Inactif"}</small></td>
        <td>{firstUnpaidOn && lastUnpaidOn ? <div className="intervenants-summary__period">
          <strong>{firstUnpaidOn === lastUnpaidOn ? <>Le <time dateTime={firstUnpaidOn}>{formatDate(firstUnpaidOn)}</time></> : <>
            Du <time dateTime={firstUnpaidOn}>{formatDate(firstUnpaidOn)}</time> au <time dateTime={lastUnpaidOn}>{formatDate(lastUnpaidOn)}</time>
          </>}</strong>
          <small>{unpaidAgeLabel(firstUnpaidOn, todayIso())}</small>
        </div> : <small>Rien à payer</small>}</td>
        <td>{formatWorkMinutes(minutes)}</td><td>{checks}</td><td>{cleanings}</td><td>{tasks}</td><td><strong>{formatEuro(total)}</strong></td>
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
      {canCorrectHistory ? <p className="intervenants-history__admin-note">Les administrateurs peuvent corriger une erreur. Chaque modification exige un motif et conserve l’ancienne valeur dans le journal d’audit.</p> : null}
      <h3>Contrôles, ménages et tâches au forfait</h3>
      {!interventions.length ? <p className="field-hint">Aucune intervention pour ce filtre.</p> : <div className="intervenants-history__table-wrap">
        <table className="table intervenants-history__table"><thead><tr><th>Date</th><th>Intervenant</th><th>Type</th><th>Gîte</th><th>Montant</th><th>État</th><th></th></tr></thead>
          <tbody>{interventions.map((entry) => <tr key={entry.id}><td>{formatDate(entry.occurred_on)}</td><td>{entry.user_name}</td>
            <td>{entry.kind === "cleaning_check" ? "Contrôle ménage" : entry.kind === "full_cleaning" ? "Ménage complet" : "Tâche au forfait"}</td><td>{entry.gite_name ?? "—"}</td><td>{formatEuro(entry.amount)}</td>
            <td><span className={`intervenants-status intervenants-status--${entry.paid_at ? "paid" : "unpaid"}`}>{entry.paid_at ? "Payé" : "À payer"}</span></td>
            <td><div className="intervenants-history__actions">
              {canCorrectHistory ? <button className="table-action" disabled={Boolean(busyId)} onClick={() => openInterventionCorrection(entry)}>Corriger</button> : null}
              {!entry.paid_at && entry.kind === "full_cleaning" ? <button className="table-action table-action--danger" disabled={busyId === entry.id} onClick={() => void removeIntervention(entry)}>Retirer</button> : null}
            </div></td>
          </tr>)}</tbody></table></div>}
      <h3>Heures saisies</h3>
      {!hours.length ? <p className="field-hint">Aucune heure pour ce filtre.</p> : <div className="intervenants-history__table-wrap">
        <table className="table intervenants-history__table"><thead><tr><th>Date</th><th>Intervenant</th><th>Durée</th><th>Taux</th><th>Montant</th><th>État</th><th></th></tr></thead>
          <tbody>{hours.map((entry) => { const worker = workers.find((item) => item.id === entry.intervenant_id); const rate = entry.hourly_rate_snapshot ?? Number(worker?.hourly_rate ?? 0);
            return <tr key={entry.id}><td>{formatDate(entry.worked_on)}</td><td>{entry.intervenant_nom}</td><td>{formatWorkMinutes(entry.minutes)}</td>
              <td>{formatEuro(rate)}/h</td><td>{formatEuro(entry.minutes / 60 * rate)}</td>
              <td><span className={`intervenants-status intervenants-status--${entry.paid_at ? "paid" : "unpaid"}`}>{entry.paid_at ? "Payé" : "À payer"}</span></td>
              <td>{canCorrectHistory ? <button className="table-action" disabled={Boolean(busyId)} onClick={() => openHoursCorrection(entry)}>Corriger</button> : null}</td></tr>; })}</tbody>
        </table></div>}
    </section>
    {correction ? <div className="intervenants-correction" role="dialog" aria-modal="true" aria-labelledby="intervenants-correction-title">
      <button type="button" className="intervenants-correction__backdrop" disabled={Boolean(busyId)} onClick={() => setCorrection(null)} aria-label="Fermer la correction" />
      <form className="intervenants-correction__panel" onSubmit={(event) => { event.preventDefault(); void saveCorrection(); }}>
        <header>
          <div><span className="intervenants-hero__eyebrow">Correction administrateur</span><h2 id="intervenants-correction-title">Corriger une ligne</h2></div>
          <button type="button" className="intervenants-correction__close" disabled={Boolean(busyId)} onClick={() => setCorrection(null)} aria-label="Fermer">×</button>
        </header>
        {correction.entry.paid_at ? <p className="intervenants-correction__warning"><strong>Ligne déjà payée.</strong> Vous pouvez rectifier son état dans le suivi interne ; cette action ne déclenche aucun mouvement bancaire.</p> : null}
        <div className="intervenants-correction__fields">
          {correction.type === "intervention" ? <>
            <label className="field">Date<input type="date" required value={correction.occurredOn} onChange={(event) => setCorrection({ ...correction, occurredOn: event.target.value })} /></label>
            <label className="field">Intervenant<select required value={correction.userId} onChange={(event) => setCorrection({ ...correction, userId: event.target.value })}>
              <option value="">Choisir</option>{workers.filter((worker) => worker.user_id).map((worker) => <option key={worker.id} value={worker.user_id!}>{worker.nom}</option>)}
            </select></label>
            <label className="field">Type<select value={correction.kind} onChange={(event) => setCorrection({ ...correction, kind: event.target.value as InterventionEntry["kind"] })}>
              <option value="cleaning_check">Contrôle ménage</option><option value="full_cleaning">Ménage complet</option><option value="task">Tâche au forfait</option>
            </select></label>
            <label className="field">Gîte<select required value={correction.giteId} onChange={(event) => setCorrection({ ...correction, giteId: event.target.value })}>
              <option value="">Choisir</option>{gites.map((gite) => <option key={gite.id} value={gite.id}>{gite.nom}</option>)}
            </select></label>
            <label className="field intervenants-correction__amount">Montant (€)<input inputMode="decimal" required value={correction.amount} onChange={(event) => setCorrection({ ...correction, amount: event.target.value })} /></label>
            <label className="field">État<select value={correction.paid ? "paid" : "unpaid"} onChange={(event) => setCorrection({ ...correction, paid: event.target.value === "paid" })}>
              <option value="unpaid">À payer</option><option value="paid">Payé</option>
            </select></label>
          </> : <>
            <label className="field">Date<input type="date" required value={correction.workedOn} onChange={(event) => setCorrection({ ...correction, workedOn: event.target.value })} /></label>
            <label className="field">Intervenant<select required value={correction.workerId} onChange={(event) => setCorrection({ ...correction, workerId: event.target.value })}>
              <option value="">Choisir</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.nom}</option>)}
            </select></label>
            <label className="field intervenants-correction__amount">Durée en heures<input inputMode="decimal" required placeholder="Ex. 1,5" value={correction.hours} onChange={(event) => setCorrection({ ...correction, hours: event.target.value })} /></label>
            <label className="field">État<select value={correction.paid ? "paid" : "unpaid"} onChange={(event) => setCorrection({ ...correction, paid: event.target.value === "paid" })}>
              <option value="unpaid">À payer</option><option value="paid">Payé</option>
            </select></label>
          </>}
          <label className="field intervenants-correction__reason">Motif de la correction<textarea required minLength={3} maxLength={500} rows={3} placeholder="Ex. Mauvais intervenant sélectionné" value={correction.reason} onChange={(event) => setCorrection({ ...correction, reason: event.target.value })} /></label>
        </div>
        <p className="field-hint">L’ancienne valeur, la nouvelle valeur, le motif et l’administrateur sont conservés dans le journal d’audit.</p>
        <footer><button type="button" className="secondary" disabled={Boolean(busyId)} onClick={() => setCorrection(null)}>Annuler</button><button type="submit" disabled={Boolean(busyId)}>{busyId ? "Enregistrement…" : "Enregistrer la correction"}</button></footer>
      </form>
    </div> : null}
  </div>;
}

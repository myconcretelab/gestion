import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Intervenant } from "../utils/types";
import { formatWorkMinutes } from "../utils/intervenantHours";
import "./intervenantsPage.css";

type HourEntry = {
  id: string;
  intervenant_id: string | null;
  intervenant_nom: string;
  worked_on: string;
  minutes: number;
  paid_at: string | null;
  hourly_rate_snapshot: number | null;
  created_at: string;
  updated_at: string;
};

type ProfileDraft = {
  hourly_rate: string;
  show_on_today: boolean;
};

const toDraft = (worker: Intervenant): ProfileDraft => ({
  hourly_rate: worker.hourly_rate ? String(worker.hourly_rate).replace(".", ",") : "",
  show_on_today: worker.show_on_today ?? false,
});

const parseRate = (value: string) => {
  const parsed = Number(value.replace(",", ".").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const payload = (worker: Intervenant, draft: ProfileDraft) => ({
  nom: worker.nom,
  telephone: worker.telephone,
  hourly_rate: parseRate(draft.hourly_rate) ?? 0,
  show_on_today: draft.show_on_today,
});

const formatEuro = (value: number) => new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR",
}).format(value);

const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
  day: "2-digit", month: "2-digit", year: "numeric",
});

export default function IntervenantsPage() {
  const [workers, setWorkers] = useState<Intervenant[]>([]);
  const [entries, setEntries] = useState<HourEntry[]>([]);
  const [unpaidEntries, setUnpaidEntries] = useState<HourEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});
  const [workerFilter, setWorkerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "paid">("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWorkers = useCallback(async () => {
    const result = await apiFetch<Intervenant[]>("/intervenants");
    setWorkers(result);
    setDrafts(Object.fromEntries(result.map((worker) => [worker.id, toDraft(worker)])));
  }, []);

  const loadHistory = useCallback(async () => {
    const params = new URLSearchParams({ status: statusFilter });
    if (workerFilter) params.set("worker_id", workerFilter);
    const [result, unpaidResult] = await Promise.all([
      apiFetch<{ entries: HourEntry[] }>(`/intervenants/hours/history?${params}`),
      apiFetch<{ entries: HourEntry[] }>("/intervenants/hours/history?status=unpaid"),
    ]);
    setEntries(result.entries);
    setUnpaidEntries(unpaidResult.entries);
  }, [statusFilter, workerFilter]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadWorkers(), loadHistory()])
      .then(() => setError(null))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Impossible de charger les intervenants."))
      .finally(() => setLoading(false));
  }, [loadHistory, loadWorkers]);

  const allUnpaid = unpaidEntries;
  const unpaidByWorker = useMemo(() => {
    const result = new Map<string, number>();
    allUnpaid.forEach((entry) => {
      if (entry.intervenant_id) result.set(entry.intervenant_id, (result.get(entry.intervenant_id) ?? 0) + entry.minutes);
    });
    return result;
  }, [allUnpaid]);
  const totalUnpaidMinutes = allUnpaid.reduce((sum, entry) => sum + entry.minutes, 0);
  const totalUnpaidAmount = allUnpaid.reduce((sum, entry) => {
    const worker = workers.find((item) => item.id === entry.intervenant_id);
    return sum + entry.minutes / 60 * Number(worker?.hourly_rate ?? 0);
  }, 0);

  const changeDraft = (id: string, patch: Partial<ProfileDraft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const saveWorker = async (worker: Intervenant) => {
    const draft = drafts[worker.id];
    if (!draft || parseRate(draft.hourly_rate) === null) {
      setError("Renseignez un taux horaire valide.");
      return;
    }
    setBusyId(worker.id); setError(null); setNotice(null);
    try {
      await apiFetch(`/intervenants/${worker.id}`, { method: "PATCH", json: payload(worker, draft) });
      await loadWorkers();
      setNotice(`${worker.nom} a été enregistré.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d'enregistrer l'intervenant.");
    } finally { setBusyId(null); }
  };

  const settleWorker = async (worker: Intervenant) => {
    const minutes = unpaidByWorker.get(worker.id) ?? 0;
    if (!minutes || !confirm(
      `Confirmer le paiement de ${formatWorkMinutes(minutes)} à ${worker.nom} ? Le compteur repartira à zéro et les heures resteront dans l'historique.`,
    )) return;
    setBusyId(worker.id); setError(null); setNotice(null);
    try {
      const result = await apiFetch<{ amount: number }>(`/intervenants/hours/${worker.id}/settle`, { method: "POST" });
      await loadHistory();
      setNotice(`Paiement de ${worker.nom} enregistré (${formatEuro(result.amount)}).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d'enregistrer le paiement.");
    } finally { setBusyId(null); }
  };

  return <div className="intervenants-page">
    <header className="intervenants-hero">
      <div>
        <span className="intervenants-hero__eyebrow">Paramètres</span>
        <h1>Intervenants et heures</h1>
        <p>Gérez les taux horaires, les heures à payer et l’historique des paiements. L’identité et les coordonnées se modifient dans les utilisateurs.</p>
      </div>
      <Link className="secondary button-link" to="/parametres/utilisateurs">Gérer les utilisateurs</Link>
    </header>

    {error ? <div className="note" role="alert">{error}</div> : null}
    {notice ? <div className="note note--success" role="status">{notice}</div> : null}

    <section className="intervenants-kpis" aria-label="Synthèse des heures">
      <article><span>Intervenants actifs</span><strong>{workers.filter((worker) => worker.is_active).length}</strong></article>
      <article><span>Heures à payer</span><strong>{formatWorkMinutes(totalUnpaidMinutes)}</strong></article>
      <article><span>Montant estimé</span><strong>{formatEuro(totalUnpaidAmount)}</strong></article>
    </section>

    <section className="intervenants-layout">
      <div className="intervenants-profiles">
        {loading ? <div className="card">Chargement…</div> : workers.map((worker) => {
          const draft = drafts[worker.id] ?? toDraft(worker);
          const unpaid = unpaidByWorker.get(worker.id) ?? 0;
          const amount = unpaid / 60 * Number(worker.hourly_rate ?? 0);
          return <article className={`card intervenant-profile${worker.is_active ? "" : " is-disabled"}`} key={worker.id}>
            <div className="intervenant-profile__header">
              <div><strong>{worker.nom}</strong><span>{worker.is_active ? "Actif" : "Inactif"}{worker.telephone ? ` · ${worker.telephone}` : ""}</span></div>
              <div className="intervenant-profile__due"><strong>{formatWorkMinutes(unpaid)}</strong><span>{formatEuro(amount)} à payer</span></div>
            </div>
            <ProfileFields draft={draft} disabled={busyId === worker.id} onChange={(patch) => changeDraft(worker.id, patch)} compact />
            <div className="intervenant-profile__actions">
              <button type="button" disabled={busyId === worker.id} onClick={() => void saveWorker(worker)}>Enregistrer</button>
              <button type="button" className="secondary" disabled={busyId === worker.id || !unpaid}
                onClick={() => void settleWorker(worker)}>Payé · remettre à 0</button>
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className="card intervenants-history">
      <div className="intervenants-history__header">
        <div><span className="intervenants-hero__eyebrow">Traçabilité</span><h2>Historique des interventions</h2></div>
        <div className="intervenants-history__filters">
          <label>Intervenant<select value={workerFilter} onChange={(event) => setWorkerFilter(event.target.value)}>
            <option value="">Tous</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.nom}</option>)}
          </select></label>
          <label>État<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">Tout</option><option value="unpaid">À payer</option><option value="paid">Payé</option>
          </select></label>
        </div>
      </div>
      {!entries.length ? <p className="field-hint">Aucune heure pour ce filtre.</p> : <div className="intervenants-history__table-wrap">
        <table className="table intervenants-history__table"><thead><tr>
          <th>Date</th><th>Intervenant</th><th>Durée</th><th>Taux</th><th>Montant</th><th>État</th>
        </tr></thead><tbody>{entries.map((entry) => {
          const worker = workers.find((item) => item.id === entry.intervenant_id);
          const rate = entry.hourly_rate_snapshot ?? Number(worker?.hourly_rate ?? 0);
          return <tr key={entry.id}>
            <td>{formatDate(entry.worked_on)}</td><td>{entry.intervenant_nom}</td><td>{formatWorkMinutes(entry.minutes)}</td>
            <td>{formatEuro(rate)}/h</td><td>{formatEuro(entry.minutes / 60 * rate)}</td>
            <td><span className={`intervenants-status intervenants-status--${entry.paid_at ? "paid" : "unpaid"}`}>
              {entry.paid_at ? `Payé le ${new Date(entry.paid_at).toLocaleDateString("fr-FR")}` : "À payer"}
            </span></td>
          </tr>;
        })}</tbody></table>
      </div>}
    </section>
  </div>;
}

function ProfileFields({ draft, disabled, compact = false, onChange }: {
  draft: ProfileDraft; disabled: boolean; compact?: boolean; onChange: (patch: Partial<ProfileDraft>) => void;
}) {
  return <div className={`intervenant-fields${compact ? " intervenant-fields--compact" : ""}`}>
    <label className="field">Taux horaire (€)<input inputMode="decimal" placeholder="Ex. 15" value={draft.hourly_rate} disabled={disabled} onChange={(e) => onChange({ hourly_rate: e.target.value })} /></label>
    <label className="intervenant-check"><input type="checkbox" checked={draft.show_on_today} disabled={disabled} onChange={(e) => onChange({ show_on_today: e.target.checked })} />Afficher sur Aujourd’hui</label>
  </div>;
}

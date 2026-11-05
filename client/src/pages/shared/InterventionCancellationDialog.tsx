import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../utils/api";

type Entry = {
  id: string; kind: string; gite_name: string | null; user_name: string;
  occurred_on: string; updated_at: string;
};
type Preview = {
  fingerprint: string; effects: string[]; amount: number;
  entries: { id: string; kind: string; amount: number }[];
};
const euro = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
const reasons = ["Clic par erreur", "Doublon", "Intervention non réalisée"];

export default function InterventionCancellationDialog({ entry, onClose, onCancelled }: {
  entry: Entry;
  onClose: () => void;
  onCancelled: (removedIds: string[], effects: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState(reasons[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void apiFetch<Preview>(`/interventions/${encodeURIComponent(entry.id)}/cancellation`)
      .then((value) => { if (active) setPreview(value); })
      .catch((error) => { if (active) setError(error instanceof Error ? error.message : "Impossible de préparer l’annulation."); });
    return () => { active = false; };
  }, [entry.id]);

  const cancel = async () => {
    if (!preview || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await apiFetch<{ removed_ids: string[]; effects: string[] }>(`/interventions/${encodeURIComponent(entry.id)}/cancel`, {
        method: "POST",
        json: { reason: detail.trim() ? `${reason} — ${detail.trim()}` : reason,
          expectedUpdatedAt: entry.updated_at, fingerprint: preview.fingerprint },
      });
      onCancelled(result.removed_ids, result.effects);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Impossible d’annuler l’intervention.");
      setBusy(false);
    }
  };

  return <dialog ref={dialog} className="intervention-undo" aria-labelledby="intervention-undo-title"
    aria-describedby="intervention-undo-description" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void cancel(); }}>
      <header>
        <span className="intervention-undo__icon" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 14-5-5 5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg></span>
        <button type="button" className="intervenants-correction__close" disabled={busy} onClick={onClose} aria-label="Fermer l’annulation">×</button>
      </header>
      <div><span className="intervenants-hero__eyebrow">Droit à l’erreur</span>
        <h2 id="intervention-undo-title">Un clic de trop ?</h2>
        <p id="intervention-undo-description">On rembobine cette intervention et on remet les choses en place.</p>
      </div>
      <div className="intervention-undo__entry">
        <strong>{entry.gite_name ?? "Intervention"}</strong>
        <span>{entry.kind === "cleaning_check" ? "Contrôle ménage" : entry.kind === "full_cleaning" ? "Ménage complet" : "Tâche au forfait"} · {entry.user_name}</span>
        <small>{new Date(`${entry.occurred_on}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</small>
      </div>
      {error ? <p className="note" role="alert">{error}</p> : null}
      {!preview && !error ? <p role="status">Préparation du retour en arrière…</p> : null}
      {preview ? <>
        <div className="intervention-undo__effects">
          <strong>Après l’annulation</strong>
          <ul>{preview.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
          <div className="intervention-undo__amount"><span>{preview.entries.length > 1 ? `${preview.entries.length} lignes retirées du solde à payer` : "Retiré du solde à payer"}</span><strong>−{euro(preview.amount)}</strong></div>
        </div>
        <fieldset className="intervention-undo__reasons" disabled={busy}>
          <legend>Que s’est-il passé ?</legend>
          <div>{reasons.map((item) => <button type="button" key={item} aria-pressed={reason === item} onClick={() => setReason(item)}>{item}</button>)}</div>
        </fieldset>
        <details className="intervention-undo__detail"><summary>Ajouter une précision (facultatif)</summary>
          <label className="field">Un mot en plus
            <input maxLength={450} value={detail} disabled={busy} placeholder="Une précision, si besoin…" onChange={(event) => setDetail(event.target.value)} />
          </label>
        </details>
        <p className="intervention-undo__audit">Le motif, les lignes retirées et l’état précédent sont conservés dans le journal d’audit.</p>
      </> : null}
      <footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>Conserver l’intervention</button>
        <button type="submit" disabled={!preview || busy}>{busy ? "Retour en arrière…" : "Annuler l’intervention"}</button></footer>
    </form>
  </dialog>;
}

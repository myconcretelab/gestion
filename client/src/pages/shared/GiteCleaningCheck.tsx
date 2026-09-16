import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../utils/api";

type CheckState = { cleaning_checked_at: string | null; notification_warning?: string | null };

const GiteCleaningCheck = ({ giteId }: { giteId: string }) => {
  const [state, setState] = useState<CheckState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const endpoint = `/gites/${encodeURIComponent(giteId)}/cleaning-check`;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<CheckState>(endpoint, { signal: controller.signal })
      .then(setState)
      .catch(() => { if (!controller.signal.aborted) setError("Impossible de charger le contrôle du ménage. Rouvrez les détails pour réessayer."); });
    return () => controller.abort();
  }, [endpoint]);

  const toggle = async () => {
    if (!state || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      setState(await apiFetch<CheckState>(endpoint, {
        method: "PUT", json: { checked: !state.cleaning_checked_at },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d’enregistrer le contrôle.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const checked = Boolean(state?.cleaning_checked_at);
  return (
    <div className="gite-cleaning-check">
      <button type="button" className={`gite-cleaning-check__button${checked ? " is-checked" : ""}`}
        aria-pressed={checked} aria-label={checked ? "Remettre le gîte en pas checké" : "Checker le gîte : ménage vérifié"}
        disabled={!state || busy} onClick={() => void toggle()}>
        <span className="gite-cleaning-check__seal" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none"><path d="m5 14 11-9 11 9v13H5V14Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            {checked ? <path d="m11 19 3 3 7-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M12 19h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}</svg>
        </span>
        <span className="gite-cleaning-check__copy">
          <small>CONTRÔLE DU MÉNAGE</small>
          <strong>{busy ? "Enregistrement…" : !state ? "Chargement…" : checked ? "Checké · le gîte est OK" : "Pas checké"}</strong>
          <span>{checked ? `Vérifié le ${new Date(state!.cleaning_checked_at!).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · Annuler` : "J’ai vérifié, tout est prêt"}</span>
        </span>
        <span className="gite-cleaning-check__switch" aria-hidden="true"><span /></span>
      </button>
      {error ? <small role="alert">{error}</small> : null}
      {state?.notification_warning ? <small role="status">{state.notification_warning}</small> : null}
    </div>
  );
};
export default GiteCleaningCheck;

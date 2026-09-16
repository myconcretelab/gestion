import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "../../utils/api";

type CheckState = { cleaning_checked_at: string | null; notification_warning?: string | null };

const GiteCleaningCheck = ({ giteId }: { giteId: string }) => {
  const [state, setState] = useState<CheckState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showDetails) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setShowDetails(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowDetails(false);
      infoButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [showDetails]);
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
    <div className="gite-cleaning-check" ref={containerRef}>
      <div className="gite-cleaning-check__controls">
        <button type="button" ref={infoButtonRef}
          className={`gite-cleaning-check__info${checked ? " is-checked" : ""}`}
          aria-label="Informations sur le contrôle du ménage"
          aria-expanded={showDetails} aria-controls={detailsId}
          onClick={() => setShowDetails((previous) => !previous)}>
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="m5 14 11-9 11 9v13H5V14Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            {checked ? <path d="m11 19 3 3 7-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M12 19h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
          </svg>
        </button>
        <button type="button" role="switch" aria-checked={checked}
          aria-label="Ménage vérifié" aria-busy={busy}
          className={`gite-cleaning-check__toggle${checked ? " is-checked" : ""}`}
          disabled={!state || busy} onClick={() => void toggle()}>
          <span className="gite-cleaning-check__track" aria-hidden="true"><span /></span>
        </button>
      </div>
      {showDetails ? (
        <div id={detailsId} className="gite-cleaning-check__details" role="status">
          <strong>{checked ? "Ménage vérifié" : state ? "Pas checké" : "Contrôle du ménage"}</strong>
          {state?.cleaning_checked_at ? (
            <span>Le <time dateTime={state.cleaning_checked_at}>{new Date(state.cleaning_checked_at).toLocaleString("fr-FR", {
              timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
            })}</time></span>
          ) : <span>{state ? "Activez le switch après avoir vérifié le gîte." : error ? "Informations indisponibles." : "Chargement…"}</span>}
        </div>
      ) : null}
      {error ? <small role="alert">{error}</small> : null}
      {state?.notification_warning ? <small role="status">{state.notification_warning}</small> : null}
    </div>
  );
};
export default GiteCleaningCheck;

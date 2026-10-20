import { useEffect, useId, useRef, useState } from "react";
import { focusFormField, type FormCompletionItem } from "./formCompletion";
import "./formCompletion.css";

export default function FormCompletionAssistant({
  items,
  progress: suppliedProgress,
  checking = false,
  ariaLabel,
  description,
  completeMessage,
  checkingLabel = "Vérification en cours…",
  onNavigate = focusFormField,
}: {
  items: FormCompletionItem[];
  progress: number;
  checking?: boolean;
  ariaLabel: string;
  description: string;
  completeMessage: string;
  checkingLabel?: string;
  onNavigate?: (target: string) => void;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const assistantRef = useRef<HTMLElement>(null);
  const remaining = items.length;
  const progress = Math.min(Math.max(0, suppliedProgress), checking ? 99 : 100);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !assistantRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  return (
    <aside ref={assistantRef} className="form-assistant" aria-label={ariaLabel}>
      {open && (
        <div className="form-assistant__panel" id={panelId}>
          <strong>Les petits détails à compléter</strong>
          <p>{description}</p>
          {remaining ? (
            <ul>
              {items.map((item, index) => (
                <li key={`${item.target}-${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(item.target);
                      setOpen(false);
                    }}
                  >
                    <span aria-hidden="true">○</span>
                    {item.label}
                    <span aria-hidden="true">↗</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{completeMessage}</p>
          )}
        </div>
      )}
      <div className="form-assistant__summary">
        <button
          type="button"
          className="form-assistant__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <span
            className="form-assistant__orb"
            aria-hidden="true"
            key={remaining}
          >
            {checking ? "…" : remaining ? remaining : "✓"}
          </span>
          <span aria-live="polite">
            <strong>
              {checking
                ? checkingLabel
                : remaining
                  ? `${remaining} point${remaining > 1 ? "s" : ""} à compléter`
                  : "Formulaire complété"}
            </strong>
            <small>
              {open ? "Réduire l’assistant" : "Votre guide vers la validation"}{" "}
              · {progress} %
            </small>
          </span>
          <span aria-hidden="true">{open ? "⌄" : "⌃"}</span>
        </button>
        <div
          className={`form-assistant__progress${checking ? " form-assistant__progress--checking" : ""}`}
          role="progressbar"
          aria-label="Avancement des rubriques du formulaire"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={
            checking
              ? "Vérification en cours"
              : `${progress} % des rubriques complétées`
          }
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
    </aside>
  );
}

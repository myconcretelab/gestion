import { useEffect, useRef, useState } from "react";
import {
  focusInvoiceField,
  invoiceCompletionProgress,
  type InvoiceCompletionItem,
} from "./invoiceFormCompletion";

export default function InvoiceCompletionAssistant({
  items,
  checking,
}: {
  items: InvoiceCompletionItem[];
  checking: boolean;
}) {
  const [open, setOpen] = useState(false);
  const assistantRef = useRef<HTMLElement>(null);
  const remaining = items.length;
  const progress = Math.min(
    invoiceCompletionProgress(items),
    checking ? 99 : 100,
  );
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
    <aside
      ref={assistantRef}
      className="invoice-assistant"
      aria-label="Assistant de création de facture"
    >
      {open && (
        <div className="invoice-assistant__panel" id="invoice-completion-list">
          <strong>Les petits détails à compléter</strong>
          <p>Enregistrez votre brouillon sans attendre la validation finale.</p>
          {remaining ? (
            <ul>
              {items.map((item, index) => (
                <li key={`${item.target}-${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      focusInvoiceField(item.target);
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
            <p>
              Tout est renseigné. Enregistrez puis ouvrez la fiche pour la
              vérification finale.
            </p>
          )}
        </div>
      )}
      <div className="invoice-assistant__summary">
        <button
          type="button"
          className="invoice-assistant__toggle"
          aria-expanded={open}
          aria-controls="invoice-completion-list"
          onClick={() => setOpen(!open)}
        >
          <span
            className="invoice-assistant__orb"
            aria-hidden="true"
            key={remaining}
          >
            {checking ? "…" : remaining ? remaining : "✓"}
          </span>
          <span aria-live="polite">
            <strong>
              {checking
                ? "Préparation du séjour…"
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
          className={`invoice-assistant__progress${checking ? " invoice-assistant__progress--checking" : ""}`}
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

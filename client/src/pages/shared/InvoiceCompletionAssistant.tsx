import { useState } from "react";
import {
  focusInvoiceField,
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
  const remaining = items.length;
  return (
    <aside
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
            {open ? "Réduire l’assistant" : "Votre guide vers la validation"}
          </small>
        </span>
        <span aria-hidden="true">{open ? "⌄" : "⌃"}</span>
      </button>
    </aside>
  );
}

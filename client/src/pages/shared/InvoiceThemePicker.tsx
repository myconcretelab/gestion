import {
  invoiceThemeIds,
  invoiceThemes,
  type InvoiceThemeId,
} from "@contrats/shared";
import type { CSSProperties } from "react";
import "./invoiceThemes.css";

export default function InvoiceThemePicker({
  value,
  onChange,
}: {
  value: InvoiceThemeId;
  onChange: (id: InvoiceThemeId) => void;
}) {
  return (
    <fieldset className="invoice-themes">
      <legend>Le style de votre facture</legend>
      <p>
        Choisissez une présentation. Votre choix sera enregistré avec le
        brouillon.
      </p>
      <div
        className="invoice-themes__grid"
        role="group"
        aria-label="Modèle de facture"
      >
        {invoiceThemeIds.map((id) => {
          const theme = invoiceThemes[id];
          return (
            <button
              key={id}
              type="button"
              className={`invoice-theme${value === id ? " is-selected" : ""}`}
              aria-pressed={value === id}
              onClick={() => onChange(id)}
            >
              <span
                className={`invoice-theme__sample invoice-theme__sample--${id}`}
                style={
                  {
                    "--theme-paper": theme.paper,
                    "--theme-ink": theme.ink,
                    "--theme-accent": theme.accent,
                    "--theme-surface": theme.surface,
                  } as CSSProperties
                }
                aria-hidden="true"
              >
                <span className="invoice-theme__paper">
                  <span className="invoice-theme__masthead">
                    <i />
                    <b>FACTURE</b>
                  </span>
                  <span className="invoice-theme__parties">
                    <i />
                    <i />
                  </span>
                  <span className="invoice-theme__table">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="invoice-theme__total" />
                </span>
              </span>
              <span className="invoice-theme__title">
                {theme.name}
                <span className="invoice-theme__check" aria-hidden="true">
                  {value === id ? "✓" : ""}
                </span>
              </span>
              <span className="invoice-theme__description">
                {theme.description}
              </span>
            </button>
          );
        })}
      </div>
      <span className="invoice-themes__status" role="status">
        Modèle {invoiceThemes[value].name} sélectionné · aperçu mis à jour
        automatiquement.
      </span>
    </fieldset>
  );
}

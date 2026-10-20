import { countryOptions } from "./countryOptions";
import type { InvoiceFiscalInput } from "@contrats/shared";

export default function InvoiceBuyerEditor({
  value,
  onChange,
  children,
}: {
  value: InvoiceFiscalInput;
  onChange: (value: InvoiceFiscalInput) => void;
  children: React.ReactNode;
}) {
  const updateBuyer = (patch: Partial<InvoiceFiscalInput["buyer"]>) =>
    onChange({
      ...value,
      reviewed: false,
      buyer: { ...value.buyer, ...patch },
    });
  const required = (note = "Requis") => (
    <span className="invoice-fiscal__required">{note}</span>
  );
  const fieldLabel = (label: string, marker: React.ReactNode = required()) => (
    <span className="invoice-fiscal__label-row">
      <span>{label}</span>
      {marker}
    </span>
  );
  return (
    <section
      id="invoice-client"
      data-invoice-step="1"
      tabIndex={-1}
      className="card invoice-fiscal invoice-buyer"
      aria-labelledby="invoice-buyer-title"
    >
      <div className="section-title" id="invoice-buyer-title">
        Identité du client facturé
      </div>
      <p className="field-hint">
        Ces coordonnées sont utilisées directement sur votre facture.
      </p>
      <div
        className="invoice-buyer__switch"
        id="buyer-kind"
        role="group"
        aria-label="Type de client"
        tabIndex={-1}
      >
        {(
          [
            ["individual", "Particulier", "B2C · Un séjour à titre personnel"],
            ["business", "Entreprise", "B2B · Une facture à une entreprise"],
          ] as const
        ).map(([kind, label, hint]) => (
          <button
            type="button"
            key={kind}
            aria-pressed={value.buyer.kind === kind}
            onClick={() =>
              updateBuyer({
                kind,
                ...(kind === "individual" ? { siren: "", vat_number: "" } : {}),
              })
            }
          >
            <strong>{label}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
      {children}
      <div className="grid-2">
        <label className="field">
          {fieldLabel("Pays")}
          <select
            id="buyer-country"
            value={value.buyer.country_code}
            onChange={(e) => updateBuyer({ country_code: e.target.value })}
          >
            <option value="">Choisir un pays</option>
            {value.buyer.country_code &&
              !countryOptions.some(
                ({ code }) => code === value.buyer.country_code,
              ) && (
                <option value={value.buyer.country_code}>
                  {value.buyer.country_code}
                </option>
              )}
            {countryOptions.map(({ code, label }) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {fieldLabel("Adresse de facturation")}
          <input
            id="buyer-address"
            value={value.buyer.address_line1}
            maxLength={500}
            onChange={(e) => updateBuyer({ address_line1: e.target.value })}
          />
        </label>
        <label className="field">
          Complément d’adresse
          <input
            value={value.buyer.address_line2}
            maxLength={500}
            onChange={(e) => updateBuyer({ address_line2: e.target.value })}
          />
        </label>
        <label className="field">
          {fieldLabel("Code postal")}
          <input
            id="buyer-postal-code"
            value={value.buyer.postal_code}
            onChange={(e) => updateBuyer({ postal_code: e.target.value })}
          />
        </label>
        <label className="field">
          {fieldLabel("Ville")}
          <input
            id="buyer-city"
            value={value.buyer.city}
            onChange={(e) => updateBuyer({ city: e.target.value })}
          />
        </label>
        {value.buyer.kind === "business" && (
          <>
            <label className="field">
              {fieldLabel(
                "SIREN (entreprise française)",
                value.buyer.country_code === "FR" ? required() : null,
              )}
              <input
                id="buyer-siren"
                value={value.buyer.siren}
                maxLength={9}
                onChange={(e) => updateBuyer({ siren: e.target.value })}
              />
            </label>
            <label className="field">
              Numéro de TVA du client, si applicable
              <input
                id="buyer-vat-number"
                value={value.buyer.vat_number}
                onChange={(e) =>
                  updateBuyer({ vat_number: e.target.value.toUpperCase() })
                }
              />
            </label>
          </>
        )}
      </div>
    </section>
  );
}

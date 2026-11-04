import { Link } from "react-router-dom";
import {
  resolveTouristTaxRegistration,
  type ReportProperty,
  type ReportDefinition,
  type TouristTaxRegistration,
} from "@contrats/shared";
import { canCurrentUserAccessPage } from "../../../utils/auth";

export default function ReportNightRegistrationSettings({
  properties,
  overrides,
  onChange,
  disabled,
  refresh,
}: {
  properties: ReportProperty[];
  overrides: ReportDefinition["nightRegistrations"];
  onChange: (overrides: ReportDefinition["nightRegistrations"]) => void;
  disabled: boolean;
  refresh: () => Promise<void>;
}) {
  const setOverride = (
    id: string,
    value: TouristTaxRegistration | undefined,
  ) => {
    const next = { ...overrides };
    if (value) next[id] = value;
    else delete next[id];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <div
      className="rp-night-registration-settings"
      aria-label="Informations de déclaration des gîtes"
    >
      <p className="rp-field-help">
        Les informations sont reprises depuis chaque fiche de gîte. Après une
        modification de fiche, cliquez sur « Actualiser les informations des
        gîtes ». Vos réglages de rapport en cours sont conservés.
      </p>
      <button
        type="button"
        className="rp-text-button"
        disabled={disabled}
        onClick={() => void refresh()}
      >
        Actualiser les informations des gîtes
      </button>
      {properties.map((property) => {
        const override = overrides?.[property.id];
        const registration = resolveTouristTaxRegistration(
          override,
          property.declaration,
        );
        const central = property.declaration?.registration;
        return (
          <section
            className="rp-registration-field"
            key={property.id}
            aria-label={`Déclaration · ${property.name}`}
          >
            <strong>{property.name}</strong>
            <p className="rp-field-help">
              {override
                ? "Valeur d’enregistrement propre à ce rapport."
                : "Informations reprises automatiquement depuis la fiche du gîte."}
            </p>
            {override ? (
              <>
                <p className="rp-field-help">
                  Fiche du gîte :{" "}
                  {central?.notApplicable
                    ? "Non applicable"
                    : central?.number || "À compléter"}
                </p>
                <label className="rp-field">
                  Numéro d’enregistrement · {property.name}
                  <input
                    value={override.number}
                    maxLength={100}
                    disabled={disabled || override.notApplicable}
                    onChange={(e) =>
                      setOverride(property.id, {
                        ...override,
                        number: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="rp-reference-choice">
                  <input
                    type="checkbox"
                    checked={override.notApplicable}
                    disabled={disabled}
                    onChange={(e) =>
                      setOverride(property.id, {
                        number: "",
                        notApplicable: e.target.checked,
                      })
                    }
                  />
                  Enregistrement non applicable à ce gîte
                </label>
                <button
                  type="button"
                  className="rp-text-button"
                  disabled={disabled}
                  onClick={() => setOverride(property.id, undefined)}
                >
                  Utiliser les informations de la fiche · {property.name}
                </button>
              </>
            ) : (
              <>
                <p>
                  Enregistrement officiel :{" "}
                  <strong>
                    {registration?.notApplicable
                      ? "Non applicable"
                      : registration?.number ||
                        "À compléter dans la fiche du gîte"}
                  </strong>
                </p>
                <button
                  type="button"
                  className="rp-text-button"
                  disabled={disabled}
                  onClick={() =>
                    setOverride(
                      property.id,
                      registration ?? { number: "", notApplicable: false },
                    )
                  }
                >
                  Utiliser une valeur propre à ce rapport · {property.name}
                </button>
              </>
            )}
            {property.declaration?.portalReference && (
              <p className="rp-field-help">
                Référence du portail : {property.declaration.portalReference}
              </p>
            )}
            {property.declaration?.receiptReference && (
              <p className="rp-field-help">
                Récépissé de déclaration en mairie :{" "}
                {property.declaration.receiptReference}
              </p>
            )}
            {canCurrentUserAccessPage("gites") && (
              <Link
                className="rp-text-button"
                target="_blank"
                rel="noreferrer"
                to={`/gites?section=gestion-finance&gite=${encodeURIComponent(property.id)}`}
              >
                Ouvrir la fiche du gîte · {property.name}
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}

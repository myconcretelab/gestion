import { useEffect } from "react";
import {
  computeTouristTax,
  createTouristTaxStay,
  type TouristTaxSettings,
  type TouristTaxStay,
  type TouristTaxResult,
} from "@contrats/shared";
import { formatEuro } from "../../utils/format";
import "./touristTax.css";

export function TouristTaxSummary({ taxes }: { taxes: TouristTaxResult[] }) {
  return (
    <div
      className="tourist-tax-summary"
      aria-label="Détail de la taxe de séjour"
    >
      {taxes.map((tax, index) => (
        <div key={index}>
          <strong>
            Taxe de séjour{tax.stay_label ? ` · ${tax.stay_label}` : ""} :{" "}
            {formatEuro(tax.amount)}
          </strong>
          <p>
            {tax.taxable_adults} personne(s) taxable(s) × {tax.nights} nuit(s) ×{" "}
            {formatEuro(tax.unit_amount)}
            {tax.exempt_people > 0
              ? ` · ${tax.exempt_people} personne(s) exonérée(s)`
              : ""}
            .
          </p>
          <p>
            {tax.collector === "host"
              ? `${tax.included ? "Comprise dans le prix annoncé" : "En supplément du prix annoncé"} · à collecter par vous.`
              : tax.collector === "platform"
                ? `Collectée par ${tax.platform || "la plateforme"} · non ajoutée au montant à vous payer.`
                : tax.collector === "not_applicable"
                  ? `Non applicable · ${tax.exemption_reason}`
                  : "Collecteur à préciser."}
          </p>
          {tax.issues.map((issue) => (
            <p role="alert" key={issue}>
              {issue}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function TouristTaxStayEditor({
  value,
  onChange,
  settings,
  nights,
  adults,
  children = 0,
  accommodation,
  start,
  initialize = false,
  onChildrenChange,
  onAdultsChange,
}: {
  value?: TouristTaxStay;
  onChange: (value: TouristTaxStay) => void;
  settings?: TouristTaxSettings | null;
  nights: number;
  adults: number;
  children?: number;
  accommodation: number;
  start: string;
  initialize?: boolean;
  onChildrenChange?: (children: number) => void;
  onAdultsChange?: (adults: number) => void;
}) {
  useEffect(() => {
    if (initialize && !value && settings)
      onChange(createTouristTaxStay(settings));
  }, [initialize, value, settings, onChange]);
  if (!value && !settings) return null;
  const patch = (change: Partial<TouristTaxStay>) =>
    value && onChange({ ...value, ...change });
  const result = value
    ? computeTouristTax({
        stay: value,
        nights,
        adults,
        children,
        accommodation,
        start,
      })
    : null;
  return (
    <section className="tourist-tax-stay" aria-label="Taxe de séjour du séjour">
      <h3>Taxe de séjour</h3>
      {!value ? (
        <>
          <p className="field-hint">
            Ce séjour conserve son calcul historique. Appliquer le barème actuel
            peut modifier son total.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => settings && onChange(createTouristTaxStay(settings))}
          >
            Appliquer le barème du gîte à ce séjour
          </button>
        </>
      ) : (
        <>
          <p className="field-hint">
            {value.settings.classified
              ? `Gîte classé ${value.settings.stars} étoile(s)`
              : "Gîte non classé"}{" "}
            · taxe{" "}
            {value.settings.included ? "comprise dans" : "en supplément de"}{" "}
            votre prix. Barème enregistré au séjour, applicable depuis le{" "}
            {value.settings.effective_from.split("-").reverse().join("/")}.
          </p>
          <label className="tourist-tax-switch">
            <span>
              <strong>Taxe comprise dans le prix de ce séjour</strong>
              <small>
                Reprend le réglage du gîte. Ajustez si le prix importé d’une
                plateforme suit une autre présentation.
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={value.settings.included}
              onChange={(e) =>
                patch({
                  settings: { ...value.settings, included: e.target.checked },
                })
              }
            />
          </label>
          <div className="grid-2">
            {onAdultsChange && (
              <label className="field">
                Adultes hébergés
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={adults}
                  onChange={(e) =>
                    onAdultsChange(
                      Math.max(1, Math.trunc(Number(e.target.value))),
                    )
                  }
                />
              </label>
            )}
            <label className="field">
              Qui collecte la taxe ?
              <select
                value={value.collector}
                onChange={(e) =>
                  patch({
                    collector: e.target.value as TouristTaxStay["collector"],
                  })
                }
              >
                <option value="unknown">À préciser</option>
                <option value="host">Je collecte la taxe</option>
                <option value="platform">
                  Une plateforme collecte la taxe
                </option>
                <option value="not_applicable">
                  Non applicable à ce séjour
                </option>
              </select>
            </label>
            {value.collector === "platform" && (
              <label className="field">
                Plateforme collectrice
                <input
                  value={value.platform}
                  maxLength={100}
                  placeholder="Airbnb, Booking…"
                  onChange={(e) => patch({ platform: e.target.value })}
                />
              </label>
            )}
            {onChildrenChange && (
              <label className="field">
                Enfants de 2 à 17 ans
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={children}
                  onChange={(e) =>
                    onChildrenChange(
                      Math.max(0, Math.trunc(Number(e.target.value))),
                    )
                  }
                />
              </label>
            )}
            <label className="field">
              Enfants de moins de 2 ans
              <input
                type="number"
                min={0}
                max={1000}
                step={1}
                value={value.infants}
                onChange={(e) =>
                  patch({
                    infants: Math.max(0, Math.trunc(Number(e.target.value))),
                  })
                }
              />
              <small>
                Exonérés, mais compris dans le nombre d’occupants pour le tarif
                proportionnel.
              </small>
            </label>
            <label className="field">
              Autres adultes exonérés
              <input
                type="number"
                min={0}
                max={adults}
                step={1}
                value={value.exempt_adults}
                onChange={(e) =>
                  patch({
                    exempt_adults: Math.max(
                      0,
                      Math.trunc(Number(e.target.value)),
                    ),
                  })
                }
              />
            </label>
            {(value.exempt_adults > 0 ||
              value.collector === "not_applicable") && (
              <label className="field">
                Motif d’exonération ou de non-application
                <input
                  value={value.exemption_reason}
                  maxLength={500}
                  placeholder="Domicilié dans la commune, travail saisonnier…"
                  onChange={(e) => patch({ exemption_reason: e.target.value })}
                />
              </label>
            )}
          </div>
          {result && <TouristTaxSummary taxes={[result]} />}
          {settings &&
            JSON.stringify(settings) !== JSON.stringify(value.settings) && (
              <button
                type="button"
                className="secondary"
                onClick={() => patch({ settings })}
              >
                Utiliser le barème actuel du gîte
              </button>
            )}
        </>
      )}
    </section>
  );
}

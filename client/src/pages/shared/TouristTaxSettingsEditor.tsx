import type { TouristTaxSettings } from "@contrats/shared";
import "./touristTax.css";

export default function TouristTaxSettingsEditor({
  value,
  onChange,
  legacyRate = 0,
  idPrefix = "tourist-tax",
}: {
  value: TouristTaxSettings | null;
  onChange: (value: TouristTaxSettings | null) => void;
  legacyRate?: number;
  idPrefix?: string;
}) {
  const patch = (change: Partial<TouristTaxSettings>) =>
    value && onChange({ ...value, ...change });
  return (
    <section
      className="tourist-tax-settings"
      aria-label="Réglages de la taxe de séjour"
    >
      <h3>Taxe de séjour au réel</h3>
      {!value ? (
        <>
          <p className="field-hint">
            Taxe de séjour à configurer. Renseignez le barème pour gérer la
            collecte et séparer la taxe du prix de l’hébergement. Les séjours
            déjà enregistrés conservent leurs montants.
          </p>
          <button
            type="button"
            className="secondary"
            id={`${idPrefix}-configure`}
            onClick={() =>
              onChange({
                version: 1,
                classified: false,
                stars: 0,
                included: false,
                fixed_rate: legacyRate,
                percentage: 0,
                cap: 0,
                additional_percentage: 0,
                accommodation_vat_rate: 0,
                authority: "",
                effective_from: new Intl.DateTimeFormat("sv-SE", {
                  timeZone: "Europe/Paris",
                }).format(new Date()),
              })
            }
          >
            Configurer la taxe de séjour
          </button>
        </>
      ) : (
        <>
          <label className="tourist-tax-switch">
            <span>
              <strong>Gîte classé en étoiles</strong>
              <small>
                {value.classified
                  ? "Tarif fixe par personne taxable et par nuit."
                  : "Meublé non classé : tarif proportionnel au prix de l’hébergement HT."}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={value.classified}
              onChange={(e) => patch({ classified: e.target.checked })}
            />
          </label>
          <label className="tourist-tax-switch">
            <span>
              <strong>Taxe comprise dans le prix annoncé</strong>
              <small>
                {value.included
                  ? "La taxe est isolée du prix sans augmenter le total annoncé."
                  : "La taxe est ajoutée au prix si vous la collectez."}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={value.included}
              onChange={(e) => patch({ included: e.target.checked })}
            />
          </label>
          <div className="grid-2">
            {value.classified ? (
              <>
                <label className="field">
                  Classement officiel
                  <select
                    id={`${idPrefix}-stars`}
                    value={value.stars}
                    onChange={(e) => patch({ stars: Number(e.target.value) })}
                  >
                    <option value={0}>Choisir le classement</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} étoile{n > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Tarif de base / personne / nuit (€)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    id={`${idPrefix}-fixed_rate`}
                    value={value.fixed_rate}
                    onChange={(e) =>
                      patch({ fixed_rate: Number(e.target.value) })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  Taux adopté par la collectivité (%)
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step="0.01"
                    id={`${idPrefix}-percentage`}
                    value={value.percentage || ""}
                    onChange={(e) =>
                      patch({ percentage: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  Plafond de base / personne / nuit (€)
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    id={`${idPrefix}-cap`}
                    value={value.cap || ""}
                    onChange={(e) => patch({ cap: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  TVA de l’hébergement pour calculer le prix HT (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    id={`${idPrefix}-accommodation_vat_rate`}
                    value={value.accommodation_vat_rate}
                    onChange={(e) =>
                      patch({ accommodation_vat_rate: Number(e.target.value) })
                    }
                  />
                  <small>0 si la TVA ne s’applique pas à l’hébergement.</small>
                </label>
              </>
            )}
            <label className="field">
              Taxes additionnelles (% du montant de base)
              <input
                type="number"
                min={0}
                max={200}
                step="0.01"
                id={`${idPrefix}-additional_percentage`}
                value={value.additional_percentage}
                onChange={(e) =>
                  patch({ additional_percentage: Number(e.target.value) })
                }
              />
              <small>
                Ne les ajoutez pas si elles sont déjà comprises dans le tarif
                saisi.
              </small>
            </label>
            <label className="field">
              Collectivité bénéficiaire
              <input
                id={`${idPrefix}-authority`}
                value={value.authority}
                maxLength={200}
                onChange={(e) => patch({ authority: e.target.value })}
              />
            </label>
            <label className="field">
              Barème applicable à partir du
              <input
                type="date"
                id={`${idPrefix}-effective_from`}
                value={value.effective_from}
                onChange={(e) => patch({ effective_from: e.target.value })}
              />
            </label>
          </div>
          <p className="field-hint">
            Renseignez le barème officiel de votre collectivité. Un tarif fixe
            pour un gîte classé relève ici de la taxe au réel, pas du régime de
            taxe au forfait.
          </p>
        </>
      )}
    </section>
  );
}

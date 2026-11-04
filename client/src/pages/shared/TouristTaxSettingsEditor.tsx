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
          <div className="grid-2">
            <label className="field">
              Référence du portail de déclaration
              <input
                id={`${idPrefix}-portal_reference`}
                aria-label="Référence du portail de déclaration"
                aria-describedby={`${idPrefix}-portal-reference-help`}
                value={value.portal_reference ?? ""}
                maxLength={100}
                onChange={(e) => patch({ portal_reference: e.target.value })}
              />
              <small id={`${idPrefix}-portal-reference-help`}>
                Référence de l’hébergement sur le portail de taxe de séjour.
                Elle est distincte du numéro d’enregistrement officiel.
              </small>
            </label>
            {value.classified && (
              <label className="field">
                Classement valable jusqu’au
                <input
                  type="date"
                  id={`${idPrefix}-classification_valid_until`}
                  value={value.classification_valid_until ?? ""}
                  onChange={(e) =>
                    patch({
                      classification_valid_until: e.target.value || undefined,
                    })
                  }
                />
                <small>
                  Date de fin de validité de la décision de classement.
                </small>
              </label>
            )}
          </div>
          <h4>Enregistrement et déclaration en mairie</h4>
          <div className="grid-2">
            <label className="field">
              Numéro d’enregistrement officiel
              <input
                id={`${idPrefix}-registration-number`}
                aria-label="Numéro d’enregistrement officiel"
                aria-describedby={`${idPrefix}-registration-help`}
                value={value.registration?.number ?? ""}
                maxLength={100}
                disabled={value.registration?.notApplicable ?? false}
                onChange={(e) =>
                  patch({
                    registration: {
                      number: e.target.value,
                      notApplicable: false,
                    },
                  })
                }
              />
              <small id={`${idPrefix}-registration-help`}>
                Repris automatiquement dans les rapports de nuitées de ce gîte.
              </small>
            </label>
            <label className="field">
              Référence du récépissé de déclaration en mairie
              <input
                id={`${idPrefix}-declaration_receipt_reference`}
                aria-label="Référence du récépissé de déclaration en mairie"
                aria-describedby={`${idPrefix}-receipt-help`}
                value={value.declaration_receipt_reference ?? ""}
                maxLength={100}
                onChange={(e) =>
                  patch({ declaration_receipt_reference: e.target.value })
                }
              />
              <small id={`${idPrefix}-receipt-help`}>
                Facultative. Le récépissé est distinct du numéro
                d’enregistrement officiel.
              </small>
            </label>
          </div>
          <label className="tourist-tax-registration-choice">
            <input
              type="checkbox"
              checked={value.registration?.notApplicable ?? false}
              onChange={(e) =>
                patch({
                  registration: { number: "", notApplicable: e.target.checked },
                })
              }
            />
            Enregistrement non applicable à ce gîte
          </label>
          <p className="field-hint">
            Si vous ne connaissez pas encore votre situation, laissez ces
            informations à compléter. Les rapports distinguent le numéro
            officiel, le récépissé de mairie et la référence du portail.
          </p>
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

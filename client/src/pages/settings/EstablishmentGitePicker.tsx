import type { FiscalInventoryGite } from "./establishmentGites";

export default function EstablishmentGitePicker({
  gites,
  selectedIds,
  establishmentId,
  disabled,
  onToggle,
}: {
  gites: FiscalInventoryGite[];
  selectedIds: string[];
  establishmentId: string;
  disabled: boolean;
  onToggle: (gite: FiscalInventoryGite, checked: boolean) => void;
}) {
  return (
    <fieldset className="fiscal-gite-picker" disabled={disabled}>
      <legend>Gîtes facturés par cet établissement</legend>
      <p className="fiscal-hint">
        Sélectionnez les gîtes existants. Ils partageront le SIRET indiqué
        ci-dessous. Aucun nouveau gîte ne sera créé.
      </p>
      {!gites.length && (
        <p>
          Aucun gîte enregistré. <a href="/gites">Créer une fiche gîte</a>.
        </p>
      )}
      <div className="fiscal-gite-options">
        {gites.map((gite) => (
          <label
            className="fiscal-gite-option"
            key={gite.id}
            data-selected={selectedIds.includes(gite.id)}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(gite.id)}
              onChange={(event) => onToggle(gite, event.target.checked)}
            />
            <span>
              <strong>{gite.nom}</strong>
              <span>
                {[gite.adresse_ligne1, gite.adresse_ligne2]
                  .filter(Boolean)
                  .join(", ") || "Adresse du gîte à compléter"}
              </span>
              <small>
                {gite.fiscal_establishment
                  ? `${gite.fiscal_establishment.fiscal_entity.legal_name} · ${gite.fiscal_establishment.name} · ${gite.fiscal_establishment.siret ? `SIRET ${gite.fiscal_establishment.siret}` : "SIRET à compléter"}`
                  : "Pas encore rattaché"}
              </small>
              {gite.fiscal_establishment_id &&
                gite.fiscal_establishment_id !== establishmentId && (
                  <small>
                    Déjà rattaché ailleurs — un changement demandera
                    confirmation.
                  </small>
                )}
            </span>
          </label>
        ))}
      </div>
      <p className="fiscal-hint">
        Décocher un gîte déjà lié à cet établissement le détachera à
        l’enregistrement, sans le supprimer.
      </p>
    </fieldset>
  );
}

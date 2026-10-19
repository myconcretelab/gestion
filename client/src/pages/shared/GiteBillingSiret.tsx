import type { FiscalEstablishmentOption } from "../../utils/types";

export default function GiteBillingSiret({
  establishment,
  giteId,
}: {
  establishment?: FiscalEstablishmentOption;
  giteId: string | null;
}) {
  return (
    <div className="field">
      <label htmlFor="gite-billing-siret">
        SIRET de l’établissement facturant
      </label>
      <input
        id="gite-billing-siret"
        value={establishment?.siret ?? ""}
        readOnly
        placeholder="À renseigner dans l’établissement"
      />
      <span className="field-hint">
        Repris de l’établissement sélectionné : une seule valeur partagée par
        les gîtes qui en dépendent.
      </span>
      <a
        href={`/parametres/entreprises${giteId ? `?gite=${encodeURIComponent(giteId)}` : ""}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Renseigner le SIRET et les rattachements (nouvel onglet)
      </a>
      <span className="field-hint">
        Enregistrez vos saisies avant d’ouvrir cet onglet, puis rechargez cette
        fiche après avoir changé ses rattachements.
      </span>
    </div>
  );
}

import type { FiscalEstablishment } from "../../utils/types";

export type FiscalInventoryGite = {
  id: string;
  nom: string;
  adresse_ligne1: string;
  adresse_ligne2: string | null;
  gestionnaire_id: string | null;
  fiscal_establishment_id: string | null;
  missing_fields: string[];
  fiscal_establishment: {
    name: string;
    siret: string | null;
    fiscal_entity: { legal_name: string };
  } | null;
};

export const establishmentGiteChanges = (
  gites: FiscalInventoryGite[],
  establishmentId: string,
  selectedIds: string[],
  confirmReassignment: boolean,
) =>
  gites.flatMap((gite) => {
    const attach = selectedIds.includes(gite.id);
    const wasAttached =
      !!establishmentId && gite.fiscal_establishment_id === establishmentId;
    return attach === wasAttached
      ? []
      : [
          {
            gite_id: gite.id,
            expected_establishment_id: gite.fiscal_establishment_id,
            attach,
            confirm_reassignment: confirmReassignment,
          },
        ];
  });

/** The old gîte address is free text. Never guess a postcode/city, legal SIRET or overwrite a draft. */
export const prefillEstablishmentFromGite = <
  T extends {
    name: string;
    address_line1: string;
    address_line2: string;
  },
>(
  draft: T,
  gite: Pick<FiscalInventoryGite, "nom" | "adresse_ligne1" | "adresse_ligne2">,
): T => ({
  ...draft,
  name: draft.name || gite.nom,
  address_line1: draft.address_line1 || gite.adresse_ligne1,
  address_line2: draft.address_line2 || gite.adresse_ligne2 || "",
});

export const linkedGiteIds = (establishment?: FiscalEstablishment) =>
  establishment?.gites.map((gite) => gite.id) ?? [];

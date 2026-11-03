import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDocumentOccupancy } from "../src/routes/shared/rentalDocument.js";

test("les erreurs d’effectif ciblent les champs de la facture et un gîte configuré pour deux enfants les accepte", () => {
  const gite = { capacite_max: 4, nb_adultes_max: 4, nb_enfants_max: 0 };
  const error = validateDocumentOccupancy({ gite, nbAdultes: 2, nbEnfants: 2 });
  assert.deepEqual(error?.flatten().fieldErrors, {
    nb_enfants_2_17: ["Aucun enfant n'est configuré pour ce gîte."],
  });
  assert.equal(
    validateDocumentOccupancy({
      gite: { ...gite, nb_enfants_max: 2 },
      nbAdultes: 2,
      nbEnfants: 2,
    }),
    null,
  );
});

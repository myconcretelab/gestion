import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/utils/api.ts";
import { mergeOptions, extractValidationFieldErrors } from "../src/pages/shared/rentalForm.ts";
import { mergeReservationOptions, computeReservationOptionsPreview } from "../src/utils/reservationOptions.ts";

test("les options partielles restent éditables avec tous les services initialisés", () => {
  for (const normalize of [mergeOptions, mergeReservationOptions]) {
    const options = normalize({ draps: { enabled: true, nb_lits: 2, prix_unitaire: 12 } });
    assert.equal(options.draps.enabled, true);
    assert.equal(options.linge_toilette.enabled, false);
    assert.equal(options.menage.enabled, false);
    assert.equal(options.depart_tardif.enabled, false);
    assert.equal(options.chiens.enabled, false);
    assert.equal(computeReservationOptionsPreview(options, { nights: 3, gite: null }).total, 24);
    assert.equal(computeReservationOptionsPreview(undefined, { nights: 3, gite: null }).total, 0);
  }
});

test("la validation accepte les détails inconnus et conserve les erreurs des champs autorisés", () => {
  const fields = new Set(["date_fin", "hote_nom"]);
  for (const details of [undefined, null, "indisponible", 42, {}]) {
    assert.deepEqual(extractValidationFieldErrors(new ApiError(400, { error: "Erreur", details }), fields, "date_fin"), {});
  }
  const error = new ApiError(400, { details: { fieldErrors: { hote_nom: [null, "Nom requis"], inconnu: ["Ignoré"] } } });
  assert.deepEqual(extractValidationFieldErrors(error, fields, "date_fin"), { hote_nom: "Nom requis" });
});

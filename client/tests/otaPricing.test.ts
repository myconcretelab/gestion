import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTotals } from "../src/utils/contractCalc";
import { computeReservationOptionsPreview } from "../src/utils/reservationOptions";
import { invoiceReservationPrefill } from "../src/pages/shared/invoiceReservationPrefill";
import type { Gite, Reservation } from "../src/utils/types";
test("les options incluses gardent leur valeur sans doubler les totaux ni devenir offertes", () => {
  const options = {
    draps: { enabled: true, nb_lits: 9, inclus: true, montant_inclus: 135 },
    menage: { enabled: true, inclus: true, montant_inclus: 120 },
  };
  const gite = {
    options_draps_par_lit: 15,
    options_menage_forfait: 120,
  } as Gite;
  const preview = computeReservationOptionsPreview(options, {
    nights: 5,
    gite,
  });
  assert.equal(preview.total, 0);
  assert.match(preview.label, /Draps x9 inclus/);
  const totals = computeTotals({
    dateDebut: "2026-07-27",
    dateFin: "2026-08-01",
    prixParNuit: 401,
    remiseMontant: 0,
    nbAdultes: 9,
    nbEnfants: 0,
    arrhesMontant: 0,
    options,
    gite,
  });
  assert.equal(totals.totalGlobal, 2005);
  const prefill = invoiceReservationPrefill(
    { nb_nuits: 5, frais_optionnels_montant: 0, options } as Reservation,
    gite,
  );
  assert.ok(prefill.options.draps?.inclus);
  assert.ok(prefill.options.menage?.inclus);
  assert.deepEqual(prefill.fees, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  getReservationOriginSystem,
  shouldExportReservationToIcal,
} from "../src/utils/reservationOrigin.ts";

test("une reservation legacy marquee ICAL n'est pas reexportee", () => {
  const reservation = {
    commentaire: "[ICAL_TO_VERIFY]\nMissing in feed",
    source_paiement: "Airbnb",
    prix_total: 0,
    prix_par_nuit: 0,
  };

  assert.equal(getReservationOriginSystem(reservation), "ical");
  assert.equal(shouldExportReservationToIcal(reservation), false);
});

test("les reservations app et what-today sont exportables, les imports Pump non", () => {
  assert.equal(
    shouldExportReservationToIcal({
      origin_system: "app",
      export_to_ical: true,
    }),
    true
  );

  assert.equal(
    shouldExportReservationToIcal({
      origin_system: "what-today",
      export_to_ical: true,
    }),
    true
  );

  assert.equal(
    shouldExportReservationToIcal({
      origin_system: "pump",
      export_to_ical: false,
    }),
    false
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { extractAirbnbReservationUrl } from "../src/utils/airbnbReservationUrl.ts";

test("extractAirbnbReservationUrl recupere la Reservation URL explicite", () => {
  assert.equal(
    extractAirbnbReservationUrl("Reservation URL: https://www.airbnb.fr/hosting/reservations/details/HM12345678\nAutre ligne"),
    "https://www.airbnb.fr/hosting/reservations/details/HM12345678"
  );
});

test("extractAirbnbReservationUrl retombe sur une URL Airbnb presente dans la description", () => {
  assert.equal(
    extractAirbnbReservationUrl("Voir: https://www.airbnb.fr/trips/v1/reservation-details/abc123 ; merci"),
    "https://www.airbnb.fr/trips/v1/reservation-details/abc123"
  );
});

test("extractAirbnbReservationUrl retourne null quand aucune URL Airbnb n'est presente", () => {
  assert.equal(extractAirbnbReservationUrl("Reservation sans lien"), null);
});

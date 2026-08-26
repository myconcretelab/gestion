import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAirbnbPumpReference,
  buildAirbnbReservationUrl,
  extractAirbnbConfirmationCode,
  normalizeAirbnbConfirmationCode,
} from "../src/utils/airbnbReservationIdentity.ts";
import { normalizePumpReservation } from "../src/services/pumpClient.ts";
import { isUnknownHostName } from "../src/utils/reservationText.ts";

test("extrait le code Airbnb depuis une URL iCal ou une ancienne référence Pump", () => {
  assert.equal(
    extractAirbnbConfirmationCode("https://www.airbnb.com/hosting/reservations/details/HMNN9C5P4S"),
    "HMNN9C5P4S",
  );
  assert.equal(extractAirbnbConfirmationCode("48504640|HMNN9C5P4S|2026-09-16|2026-09-21"), "HMNN9C5P4S");
  assert.equal(normalizeAirbnbConfirmationCode(" hmnn9c5p4s "), "HMNN9C5P4S");
  assert.equal(
    buildAirbnbReservationUrl("HMNN9C5P4S"),
    "https://www.airbnb.com/hosting/reservations/details/HMNN9C5P4S",
  );
});

test("la référence Pump Airbnb reste stable lorsque les dates changent", () => {
  const first = normalizePumpReservation({
    id: "48504640|HMNN9C5P4S|2026-09-23|2026-09-28",
    confirmationCode: "HMNN9C5P4S",
    listingId: "48504640",
    type: "airbnb",
    checkIn: "2026-09-23",
    checkOut: "2026-09-28",
    guestName: "Romain Marques",
    payout: 316.85,
  });
  const moved = normalizePumpReservation({
    id: "48504640|HMNN9C5P4S|2026-09-16|2026-09-21",
    confirmationCode: "HMNN9C5P4S",
    listingId: "48504640",
    type: "airbnb",
    checkIn: "2026-09-16",
    checkOut: "2026-09-21",
    guestName: "Romain Marques",
    payout: 316.85,
  });

  assert.equal(first.id, buildAirbnbPumpReference("48504640", "HMNN9C5P4S"));
  assert.equal(moved.id, first.id);
  assert.equal(moved.confirmationCode, "HMNN9C5P4S");
});

test("les libellés iCal Airbnb ne remplacent pas le nom réel fourni par Pump", () => {
  assert.equal(isUnknownHostName("Reserved"), true);
  assert.equal(isUnknownHostName("Airbnb (Not available)"), true);
  assert.equal(isUnknownHostName("Romain Marques"), false);
});

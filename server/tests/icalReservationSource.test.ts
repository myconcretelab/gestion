import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveIcalReservationSource,
  shouldPreferIcalReservation,
  shouldUpdateIcalReservationSource,
} from "../src/utils/icalReservationSource.ts";

test("les entrees iCal Airbnb sans nom fiable restent en source 'A définir'", () => {
  assert.equal(
    resolveIcalReservationSource({
      normalizedSourceType: "Airbnb",
      hostName: null,
    }),
    "A définir"
  );

  assert.equal(
    resolveIcalReservationSource({
      normalizedSourceType: "Airbnb",
      hostName: "Hôte inconnu",
    }),
    "A définir"
  );

  assert.equal(
    resolveIcalReservationSource({
      normalizedSourceType: "Airbnb",
      summary: "Airbnb (Not available)",
      hostName: "Marie Motais",
    }),
    "A définir"
  );

  assert.equal(
    resolveIcalReservationSource({
      normalizedSourceType: "Airbnb",
      summary: "Reserved",
      hostName: null,
    }),
    "Airbnb"
  );

  assert.equal(
    resolveIcalReservationSource({
      normalizedSourceType: "Airbnb",
      hostName: "Marie Motais",
    }),
    "Airbnb"
  );
});

test("la deduplication iCal prefere une source metier a Airbnb sur la meme periode", () => {
  assert.equal(
    shouldPreferIcalReservation(
      {
        normalizedSourceType: "Abritel",
        hostName: null,
        summary: "Reservation Abritel",
      },
      {
        normalizedSourceType: "Airbnb",
        hostName: null,
        summary: "Reserved",
      }
    ),
    true
  );

  assert.equal(
    shouldPreferIcalReservation(
      {
        normalizedSourceType: "Airbnb",
        hostName: "Marie Motais",
        summary: "Marie Motais",
      },
      {
        normalizedSourceType: "Gites de France",
        hostName: null,
        summary: "BOOKED",
      }
    ),
    false
  );
});

test("le sync iCal peut corriger Airbnb vers 'A définir' ou une source plus fiable", () => {
  assert.equal(
    shouldUpdateIcalReservationSource({
      currentSource: "Airbnb",
      currentHostName: "Hôte inconnu",
      nextSource: "A définir",
    }),
    true
  );

  assert.equal(
    shouldUpdateIcalReservationSource({
      currentSource: "Airbnb",
      currentHostName: "Marie Motais",
      nextSource: "A définir",
    }),
    false
  );

  assert.equal(
    shouldUpdateIcalReservationSource({
      currentSource: "Airbnb",
      currentHostName: "Marie Motais",
      nextSource: "Gites de France",
    }),
    true
  );
});

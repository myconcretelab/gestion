import assert from "node:assert/strict";
import test from "node:test";
import { resolveImportedReservationSourceType } from "../src/utils/importedReservationSource.ts";

test("les reservations personnelles issues d'un commentaire restent en source 'A définir'", () => {
  assert.equal(
    resolveImportedReservationSourceType({
      reservationType: "personal",
      mappedSourceType: "Airbnb",
    }),
    "A définir"
  );

  assert.equal(
    resolveImportedReservationSourceType({
      reservationType: "personal",
      mappedSourceType: null,
    }),
    "A définir"
  );
});

test("les reservations Airbnb gardent la source mappee du listing quand elle existe", () => {
  assert.equal(
    resolveImportedReservationSourceType({
      reservationType: "airbnb",
      mappedSourceType: "Abritel",
    }),
    "Abritel"
  );

  assert.equal(
    resolveImportedReservationSourceType({
      reservationType: "airbnb",
      mappedSourceType: "",
    }),
    "Airbnb"
  );
});

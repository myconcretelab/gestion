import assert from "node:assert/strict";
import test from "node:test";
import { resolveImportedPumpStorageStateId } from "../src/services/pumpAutomation.ts";

test("resolveImportedPumpStorageStateId privilegie l'ID canonique derive de la config", () => {
  assert.equal(
    resolveImportedPumpStorageStateId(
      {
        baseUrl: "https://www.airbnb.fr/multicalendar/",
        username: "soazigmolinier@hotmail.fr",
      },
      "www-airbnb-fr__soazigmolinier-hotmail-fr (2).json"
    ),
    "www-airbnb-fr__soazigmolinier-hotmail-fr"
  );
});

test("resolveImportedPumpStorageStateId retombe sur le nom du fichier si la config est incomplete", () => {
  assert.equal(
    resolveImportedPumpStorageStateId(
      {
        baseUrl: "",
        username: "",
      },
      "www-airbnb-fr__soazigmolinier-hotmail-fr (2).json"
    ),
    "www-airbnb-fr__soazigmolinier-hotmail-fr-2"
  );
});

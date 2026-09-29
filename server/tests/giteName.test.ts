import assert from "node:assert/strict";
import test from "node:test";
import { buildGiteNameWithPreposition } from "../src/utils/giteName.ts";

test("buildGiteNameWithPreposition accorde les articles français", () => {
  assert.equal(buildGiteNameWithPreposition({ nom: "La Grée" }), "de la Grée");
  assert.equal(buildGiteNameWithPreposition({ nom: "Tante Phonsine" }), "de Tante Phonsine");
  assert.equal(buildGiteNameWithPreposition({ nom: "L'oncle Edmond" }), "de l’oncle Edmond");
  assert.equal(buildGiteNameWithPreposition({ nom: "Le Liberté" }), "du Liberté");
  assert.equal(buildGiteNameWithPreposition({ nom: "Les Bruyères" }), "des Bruyères");
});

test("buildGiteNameWithPreposition privilégie la valeur éditée", () => {
  assert.equal(
    buildGiteNameWithPreposition({ nom: "Le Liberté", nom_avec_preposition: "  au large du Liberté  " }),
    "au large du Liberté",
  );
});

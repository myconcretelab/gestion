import assert from "node:assert/strict";
import { test } from "node:test";
import {
  documentOccupancyIssues,
  getDocumentOccupancyLimits,
} from "../src/documentOccupancy.js";

const gite = { capacite_max: 4, nb_adultes_max: 4, nb_enfants_max: 2 };

test("deux adultes et deux enfants respectent les capacités configurées", () => {
  assert.deepEqual(
    documentOccupancyIssues({ gite, nbAdultes: 2, nbEnfants: 2 }),
    [],
  );
});

test("la saisie du séjour ne remplace pas le maximum d’enfants du gîte", () => {
  assert.deepEqual(
    documentOccupancyIssues({
      gite: { ...gite, nb_enfants_max: 0 },
      nbAdultes: 2,
      nbEnfants: 2,
    }),
    [
      {
        field: "nb_enfants_2_17",
        message: "Aucun enfant n'est configuré pour ce gîte.",
      },
    ],
  );
});

test("les enfants partagent la capacité totale avec les adultes", () => {
  assert.deepEqual(
    documentOccupancyIssues({ gite, nbAdultes: 3, nbEnfants: 2 }),
    [
      {
        field: "nb_enfants_2_17",
        message:
          "Avec 3 adulte(s), le nombre d'enfants ne peut pas dépasser 1 pour ce gîte.",
      },
    ],
  );
  assert.equal(
    documentOccupancyIssues({ gite, nbAdultes: 5, nbEnfants: 0 })[0].field,
    "nb_adultes",
  );
});

test("les anciens gîtes sans plafond explicite et les séjours sans adulte restent compatibles", () => {
  assert.equal(
    getDocumentOccupancyLimits({ capacite_max: 6, nb_adultes_max: 4 })
      .configuredMaxChildren,
    2,
  );
  assert.deepEqual(
    documentOccupancyIssues({ gite, nbAdultes: 0, nbEnfants: 2 }),
    [],
  );
});

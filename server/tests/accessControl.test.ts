import assert from "node:assert/strict";
import test from "node:test";
import {
  isAmountsOnlyApiPath,
  isWriteMethod,
  containsMonetaryFields,
  redactMonetaryValues,
  getRequiredPageForApiPath,
} from "../src/services/accessControl.ts";

test("redactMonetaryValues retire les montants sans masquer les compteurs", () => {
  const result = redactMonetaryValues({
    id: "reservation-1",
    total_count: 4,
    prix_total: 420,
    pricing_snapshot: {
      montant_hebergement: 380,
      options_detail: { draps: 20, menage: 20 },
    },
    guest: { name: "Camille", adults_count: 2 },
    prices_by_gite: { gite_1: 120 },
  }) as Record<string, unknown>;

  assert.equal(result.total_count, 4);
  assert.equal(result.prix_total, null);
  assert.deepEqual(result.pricing_snapshot, {
    montant_hebergement: null,
    options_detail: {},
  });
  assert.deepEqual(result.guest, { name: "Camille", adults_count: 2 });
  assert.deepEqual(result.prices_by_gite, {});
});

test("les API dédiées respectent le droit de page", () => {
  assert.equal(getRequiredPageForApiPath("/today/overview/primary"), "today");
  assert.equal(getRequiredPageForApiPath("/contracts/abc"), "contracts");
  assert.equal(getRequiredPageForApiPath("/users/owners"), "gites");
  assert.equal(getRequiredPageForApiPath("/users"), "settings");
  assert.equal(getRequiredPageForApiPath("/reservations/calendar"), null);
});

test("les modules financiers et les méthodes d'écriture sont identifiés", () => {
  assert.equal(isAmountsOnlyApiPath("/contracts/abc/pdf"), true);
  assert.equal(isAmountsOnlyApiPath("/statistics"), true);
  assert.equal(isAmountsOnlyApiPath("/reservations"), false);
  assert.equal(isWriteMethod("PATCH"), true);
  assert.equal(isWriteMethod("GET"), false);
  assert.equal(containsMonetaryFields({ commentaire: "ok", prix_total: 50 }), true);
  assert.equal(containsMonetaryFields({ commentaire: "ok", adults_count: 2 }), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  fiscalEntitySchema,
  fiscalEstablishmentSchema,
  fiscalEntityMissingFields,
} from "../src/fiscal.js";

test("les identifiants sont normalisés et les incohérences fiscales sont refusées", () => {
  const entity = fiscalEntitySchema.parse({
    legal_name: "  Exemple  ",
    siren: "732 829 320",
    vat_number: "fr 44 732829320",
  });
  assert.equal(entity.siren, "732829320");
  assert.equal(entity.vat_number, "FR44732829320");
  assert.equal(entity.vat_regime, "unknown");
  assert.equal(entity.legal_name, "Exemple");
  assert.equal(
    fiscalEntitySchema.safeParse({ legal_name: "Exemple", siren: "12345678" })
      .success,
    false,
  );
  assert.equal(
    fiscalEntitySchema.safeParse({
      legal_name: "Exemple",
      siren: "123456789",
      vat_number: entity.vat_number,
    }).success,
    false,
  );
  assert.equal(
    fiscalEntitySchema.safeParse({
      legal_name: "Exemple",
      vat_regime: "invented",
    }).success,
    false,
  );
  assert.equal(
    fiscalEstablishmentSchema.safeParse({
      name: "Siège",
      siret: "7328293200007",
    }).success,
    false,
  );
  assert.equal(
    fiscalEstablishmentSchema.parse({
      name: "Siège",
      siret: "732 829 320 00074",
    }).siret,
    "73282932000074",
  );
});

test("les brouillons restent possibles et la TVA n’est pas déduite de l’activité", () => {
  const draft = fiscalEntitySchema.parse({
    legal_name: "Gîtes Exemple",
    siren: " ",
    vat_number: "",
  });
  assert.equal(draft.siren, null);
  assert.deepEqual(fiscalEntityMissingFields(draft), [
    "SIREN",
    "Régime de TVA",
    "Adresse du siège",
  ]);
  const complete = {
    ...draft,
    siren: "732829320",
    vat_regime: "franchise_en_base",
    address_line1: "1 rue Exemple",
    postal_code: "35000",
    city: "Rennes",
  };
  assert.deepEqual(fiscalEntityMissingFields(complete), []);
  assert.deepEqual(
    fiscalEntityMissingFields({ ...complete, vat_regime: "reel_normal" }),
    ["Numéro de TVA"],
  );
});

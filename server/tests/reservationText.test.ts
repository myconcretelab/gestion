import assert from "node:assert/strict";
import test from "node:test";
import {
  hasMeaningfulImportedComment,
  isUnknownHostName,
  normalizeImportedComment,
  normalizeImportedHostName,
} from "../src/utils/reservationText.ts";

test("normalizeImportedComment ignore les placeholders de commentaire non significatifs", () => {
  assert.equal(normalizeImportedComment("Reserved"), null);
  assert.equal(normalizeImportedComment(" Airbnb (Not available) "), null);
  assert.equal(normalizeImportedComment("Marie Motais - mail du 10/05/25"), "Marie Motais - mail du 10/05/25");
  assert.equal(hasMeaningfulImportedComment("Reserved"), false);
  assert.equal(hasMeaningfulImportedComment("Commentaire réel"), true);
});

test("normalizeImportedHostName traite 'Hôte inconnu' comme vide logique", () => {
  assert.equal(normalizeImportedHostName("Hôte inconnu"), null);
  assert.equal(normalizeImportedHostName(" host unknown "), null);
  assert.equal(normalizeImportedHostName("Marie Motais"), "Marie Motais");
  assert.equal(isUnknownHostName("Hôte inconnu"), true);
  assert.equal(isUnknownHostName(""), true);
  assert.equal(isUnknownHostName("Marie Motais"), false);
});

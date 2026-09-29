import assert from "node:assert/strict";
import test from "node:test";
import { buildPhoneHref, formatPhoneForDisplay } from "../src/utils/phone.ts";

test("formate les numéros français avec des points", () => {
  assert.equal(formatPhoneForDisplay("0658929065"), "06.58.92.90.65");
  assert.equal(formatPhoneForDisplay("+33 6 58 92 90 65"), "+33.6.58.92.90.65");
});

test("construit un lien d'appel sans ponctuation", () => {
  assert.equal(buildPhoneHref("06.58.92.90.65"), "tel:0658929065");
  assert.equal(buildPhoneHref("+33 6 58 92 90 65"), "tel:+33658929065");
  assert.equal(buildPhoneHref(""), null);
});

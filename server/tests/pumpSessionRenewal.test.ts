import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAirbnbSmsChallengeDestination,
  isAirbnbAccountRenewalScreenText,
  isAirbnbSmsChallengeScreenText,
} from "../src/services/pumpSessionRenewal.ts";

test("isAirbnbAccountRenewalScreenText detecte l'ecran de compte reconnu", () => {
  assert.equal(
    isAirbnbAccountRenewalScreenText(
      "Ravis de vous revoir, Sebastien Soazig\ns***r@hotmail.fr\nNous vous enverrons peut-être un code de connexion par e-mail ou par SMS.\nSe connecter\nCe n'est pas vous ?"
    ),
    true
  );
  assert.equal(isAirbnbAccountRenewalScreenText("Connexion standard Airbnb"), false);
});

test("isAirbnbSmsChallengeScreenText detecte l'ecran de code SMS", () => {
  assert.equal(
    isAirbnbSmsChallengeScreenText(
      "Confirmez qu'il s'agit bien de vous\nNous avons envoyé un code au +33 * ** ** 37 35.\nEnvoyer un nouveau code"
    ),
    true
  );
  assert.equal(isAirbnbSmsChallengeScreenText("Bienvenue sur Airbnb"), false);
});

test("extractAirbnbSmsChallengeDestination retourne la destination masquee", () => {
  assert.equal(
    extractAirbnbSmsChallengeDestination(
      "Confirmez qu'il s'agit bien de vous\nNous avons envoyé un code au +33 * ** ** 37 35.\nEnvoyer un nouveau code"
    ),
    "Nous avons envoyé un code au +33 * ** ** 37 35."
  );
  assert.equal(
    extractAirbnbSmsChallengeDestination(
      "Ravis de vous revoir\ns***r@hotmail.fr\nNous vous enverrons peut-être un code."
    ),
    "s***r@hotmail.fr"
  );
});

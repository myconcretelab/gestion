import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAirbnbAuthRateLimitMessage,
  extractAirbnbSmsChallengeDestination,
  isAirbnbAuthRateLimitedScreenText,
  isAirbnbAccountRenewalScreenText,
  isAirbnbSmsChallengeScreenText,
  isAirbnbStandardLoginScreenText,
} from "../src/services/pumpSessionRenewal.ts";
import { isAirbnbAccountChooserActionLabel as isSharedAirbnbAccountChooserActionLabel } from "../src/services/airbnbAccountChooser.ts";

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

test("isAirbnbStandardLoginScreenText detecte le login Airbnb standard", () => {
  assert.equal(
    isAirbnbStandardLoginScreenText(
      "Connexion ou inscription\nContinuer avec un e-mail\nContinuer avec Google"
    ),
    true
  );
  assert.equal(
    isAirbnbStandardLoginScreenText("Confirmez qu'il s'agit bien de vous\nNous avons envoyé un code"),
    false
  );
});

test("isAirbnbAuthRateLimitedScreenText detecte le blocage temporaire Airbnb", () => {
  const bodyText =
    "Ravis de vous revoir, Sebastien Soazig\ns***r@hotmail.fr\nTrop de tentatives\nVous pouvez vous connecter par un autre moyen maintenant, ou réessayer dans 1 heure.\n\nNous vous enverrons peut-être un code de connexion par e-mail ou par SMS.\n\nSe connecter";

  assert.equal(isAirbnbAccountRenewalScreenText(bodyText), true);
  assert.equal(isAirbnbAuthRateLimitedScreenText(bodyText), true);
  assert.equal(
    extractAirbnbAuthRateLimitMessage(bodyText),
    "Trop de tentatives Vous pouvez vous connecter par un autre moyen maintenant, ou réessayer dans 1 heure."
  );
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

test("isAirbnbAccountChooserActionLabel accepte le libelle Se connecter", () => {
  assert.equal(isSharedAirbnbAccountChooserActionLabel("Se connecter"), true);
  assert.equal(isSharedAirbnbAccountChooserActionLabel("Continuer"), true);
  assert.equal(isSharedAirbnbAccountChooserActionLabel("Ce n'est pas vous ?"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  isUnresolvedPumpPersistedAuthFailure,
  resolveImportedPumpStorageStateId,
} from "../src/services/pumpAutomation.ts";

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

test("isUnresolvedPumpPersistedAuthFailure bloque jusqu'a remplacement de la session", () => {
  const latestRefreshAt = "2026-06-26T08:00:02.132Z";

  assert.equal(
    isUnresolvedPumpPersistedAuthFailure({
      latestSessionStatus: "failed",
      latestError:
        "Session Airbnb expirée ou absente. Le mode phase 1 utilise uniquement une session persistée importée depuis le local.",
      latestRefreshAt,
      sessionFileUpdatedAt: "2026-06-25T08:00:00.000Z",
    }),
    true
  );

  assert.equal(
    isUnresolvedPumpPersistedAuthFailure({
      latestSessionStatus: "failed",
      latestError:
        "Session Airbnb expirée ou absente. Le mode phase 1 utilise uniquement une session persistée importée depuis le local.",
      latestRefreshAt,
      sessionFileUpdatedAt: "2026-06-26T08:05:00.000Z",
    }),
    false
  );
});

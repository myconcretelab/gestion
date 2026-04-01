import assert from "node:assert/strict";
import test from "node:test";
import { isSupersededPumpAuthFailure } from "../src/services/pumpHealth.ts";

test("isSupersededPumpAuthFailure ignore une ancienne erreur d'auth quand la session importee est plus recente", () => {
  assert.equal(
    isSupersededPumpAuthFailure({
      latestSessionStatus: "failed",
      latestError:
        "Session Airbnb expirée ou absente. Le mode phase 1 utilise uniquement une session persistée importée depuis le local.",
      latestRefreshAt: "2026-03-25T09:00:22.000Z",
      sessionFileUpdatedAt: "2026-04-01T10:43:22.000Z",
    }),
    true
  );
});

test("isSupersededPumpAuthFailure conserve les erreurs de refresh non liees a l'authentification", () => {
  assert.equal(
    isSupersededPumpAuthFailure({
      latestSessionStatus: "failed",
      latestError: "Zone de scroll introuvable.",
      latestRefreshAt: "2026-03-25T09:00:22.000Z",
      sessionFileUpdatedAt: "2026-04-01T10:43:22.000Z",
    }),
    false
  );
});

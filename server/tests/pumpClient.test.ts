import assert from "node:assert/strict";
import test from "node:test";
import { buildPumpFetchErrorMessage } from "../src/services/pumpClient.ts";
import {
  isPumpRefreshFailureStatus,
  isPumpRefreshRunningStatus,
  isPumpRefreshSuccessStatus,
} from "../src/services/pumpCron.ts";

test("buildPumpFetchErrorMessage ajoute les details reseau quand fetch echoue", () => {
  const nestedCause = new Error("connect ECONNREFUSED 127.0.0.1:3000");
  (nestedCause as Error & { code?: string }).code = "ECONNREFUSED";

  const error = new TypeError("fetch failed", { cause: nestedCause });
  const message = buildPumpFetchErrorMessage("http://127.0.0.1:3000/api/reservations/refresh", error);

  assert.match(message, /Échec de connexion à Pump/);
  assert.match(message, /ECONNREFUSED/);
  assert.match(message, /127\.0\.0\.1:3000/);
  assert.match(message, /PUMP_API_BASE_URL/);
});

test("buildPumpFetchErrorMessage preserve les erreurs non generiques", () => {
  const error = new Error("Unauthorized");
  const message = buildPumpFetchErrorMessage("https://pump.example.com/api/reservations/refresh", error);

  assert.equal(
    message,
    "Erreur Pump lors de l'appel https://pump.example.com/api/reservations/refresh: Unauthorized"
  );
});

test("les helpers de statut Pump classent les etats de refresh", () => {
  assert.equal(isPumpRefreshRunningStatus("running"), true);
  assert.equal(isPumpRefreshRunningStatus("refreshing"), true);
  assert.equal(isPumpRefreshRunningStatus("done"), false);

  assert.equal(isPumpRefreshSuccessStatus("success"), true);
  assert.equal(isPumpRefreshSuccessStatus("completed"), true);
  assert.equal(isPumpRefreshSuccessStatus("running"), false);

  assert.equal(isPumpRefreshFailureStatus("failed"), true);
  assert.equal(isPumpRefreshFailureStatus("error"), true);
  assert.equal(isPumpRefreshFailureStatus("completed"), false);
});

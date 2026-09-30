import assert from "node:assert/strict";
import test from "node:test";
import { getReservationsLocationPeriod } from "../src/utils/reservationNavigation";

test("initialise directement l'année et le mois demandés par un lien", () => {
  assert.deepEqual(
    getReservationsLocationPeriod("?focus=reservation-1&tab=gite-1&year=2027&month=4", 2026),
    { year: 2027, month: 4 },
  );
});

test("utilise l'année courante quand les paramètres sont absents ou invalides", () => {
  assert.deepEqual(getReservationsLocationPeriod("?year=invalide&month=15", 2026), {
    year: 2026,
    month: 0,
  });
});

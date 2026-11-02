import assert from "node:assert/strict";
import test from "node:test";
import {
  getReservationsLocationPeriod,
  reservationPaymentsHref,
} from "../src/utils/reservationNavigation";

test("initialise directement l'année et le mois demandés par un lien", () => {
  assert.deepEqual(
    getReservationsLocationPeriod(
      "?focus=reservation-1&tab=gite-1&year=2027&month=4",
      2026,
    ),
    { year: 2027, month: 4 },
  );
});

test("utilise l'année courante quand les paramètres sont absents ou invalides", () => {
  assert.deepEqual(
    getReservationsLocationPeriod("?year=invalide&month=15", 2026),
    {
      year: 2026,
      month: 0,
    },
  );
});

test("les liens de règlements ciblent le séjour dans le listing, y compris une autre année", () => {
  const url = new URL(
    reservationPaymentsHref("reservation /1", "2027-04-29"),
    "https://example.test",
  );
  assert.equal(url.pathname, "/reservations");
  assert.equal(url.searchParams.get("focus"), "reservation /1");
  assert.equal(url.searchParams.get("payments"), "1");
  assert.equal(url.searchParams.get("year"), "2027");
  assert.equal(url.searchParams.get("month"), "0");
  assert.equal(url.searchParams.get("tab"), "all-gites");
  const unknownPeriod = new URL(
    reservationPaymentsHref("reservation-2"),
    url.origin,
  );
  assert.equal(unknownPeriod.searchParams.has("year"), false);
});

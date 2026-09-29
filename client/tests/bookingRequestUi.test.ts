import assert from "node:assert/strict";
import test from "node:test";
import { buildApprovedReservationHref, formatBookingRequestCreatedAt } from "../src/pages/bookingRequestUi";

const now = new Date(2026, 7, 19, 18, 30);

test("formats recent booking requests with relative French day labels", () => {
  assert.match(
    formatBookingRequestCreatedAt(new Date(2026, 7, 19, 9, 5).toISOString(), now),
    /^Aujourd’hui, 09:05$/,
  );
  assert.match(
    formatBookingRequestCreatedAt(new Date(2026, 7, 18, 12, 15).toISOString(), now),
    /^Hier, 12:15$/,
  );
  assert.match(
    formatBookingRequestCreatedAt(new Date(2026, 7, 17, 8, 0).toISOString(), now),
    /^Avant-hier, 08:00$/,
  );
});

test("falls back to an absolute date for older booking requests", () => {
  assert.equal(
    formatBookingRequestCreatedAt(new Date(2026, 7, 10, 9, 5).toISOString(), now),
    "10/08/2026",
  );
});

test("handles a missing creation date", () => {
  assert.equal(formatBookingRequestCreatedAt(undefined, now), "Date inconnue");
});

test("builds a link that focuses the approved reservation", () => {
  const href = buildApprovedReservationHref({
    approved_reservation_id: "reservation-123",
    gite_id: "gite-456",
    date_entree: "2027-04-12",
  } as any);

  assert.equal(
    href,
    "/reservations?focus=reservation-123&tab=gite-456&year=2027#reservation-reservation-123",
  );
});

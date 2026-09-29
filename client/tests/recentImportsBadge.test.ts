import assert from "node:assert/strict";
import test from "node:test";
import { isRecentImportedReservation } from "../src/utils/recentImportsBadge.ts";

const now = new Date("2026-09-29T12:00:00.000Z").getTime();

test("considère une réservation Booked récente comme nouvelle", () => {
  assert.equal(
    isRecentImportedReservation(
      { origin_system: "booked", createdAt: "2026-09-29T11:30:00.000Z" },
      now,
    ),
    true,
  );
});

test("ignore une réservation Booked âgée de plus de 24 heures", () => {
  assert.equal(
    isRecentImportedReservation(
      { origin_system: "booked", createdAt: "2026-09-28T11:59:59.000Z" },
      now,
    ),
    false,
  );
});

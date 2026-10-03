import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGiteCleaningReadiness,
  isCleaningCheckAvailable,
} from "../src/services/giteCleaningReadiness.js";

const gite = { id: "g1", nom: "Éden", prefixe_contrat: "ED", ordre: 1 };
const reservation = (overrides: Partial<{
  id: string;
  date_entree: Date;
  date_sortie: Date;
  departure_cleaning_checked_at: Date | null;
}> = {}) => ({
  id: overrides.id ?? "departure",
  gite_id: gite.id,
  date_entree: overrides.date_entree ?? new Date("2026-10-01T00:00:00.000Z"),
  date_sortie: overrides.date_sortie ?? new Date("2026-10-03T00:00:00.000Z"),
  departure_cleaning_checked_at: overrides.departure_cleaning_checked_at ?? null,
});

test("le gîte devient disponible au contrôle à 8 h 30 le jour du départ", () => {
  const [readiness] = buildGiteCleaningReadiness([gite], [reservation()], new Date("2026-10-03T06:29:00.000Z"));
  assert.ok(readiness);
  assert.equal(isCleaningCheckAvailable(readiness, new Date("2026-10-03T06:29:00.000Z")), false);
  assert.equal(isCleaningCheckAvailable(readiness, new Date("2026-10-03T06:30:00.000Z")), true);
});

test("le contrôle reste à faire pendant les jours vides avant la prochaine arrivée", () => {
  const nextArrival = reservation({
    id: "arrival",
    date_entree: new Date("2026-10-06T00:00:00.000Z"),
    date_sortie: new Date("2026-10-09T00:00:00.000Z"),
  });
  const [readiness] = buildGiteCleaningReadiness(
    [gite],
    [reservation(), nextArrival],
    new Date("2026-10-05T10:00:00.000Z"),
  );
  assert.equal(readiness?.departure_reservation_id, "departure");
  assert.equal(readiness?.next_arrival_reservation_id, "arrival");
});

test("le contrôle est consommé après le début du séjour suivant", () => {
  const nextArrival = reservation({
    id: "arrival",
    date_entree: new Date("2026-10-06T00:00:00.000Z"),
    date_sortie: new Date("2026-10-09T00:00:00.000Z"),
  });
  const readiness = buildGiteCleaningReadiness(
    [gite],
    [reservation(), nextArrival],
    new Date("2026-10-07T10:00:00.000Z"),
  );
  assert.deepEqual(readiness, []);
});

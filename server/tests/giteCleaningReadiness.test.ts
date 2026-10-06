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
  options: unknown;
}> = {}) => ({
  id: overrides.id ?? "departure",
  gite_id: gite.id,
  date_entree: overrides.date_entree ?? new Date("2026-10-01T00:00:00.000Z"),
  date_sortie: overrides.date_sortie ?? new Date("2026-10-03T00:00:00.000Z"),
  departure_cleaning_checked_at: overrides.departure_cleaning_checked_at ?? null,
  options: overrides.options ?? {},
});

test("le gîte devient disponible au contrôle à minuit le jour du départ", () => {
  const [readiness] = buildGiteCleaningReadiness([gite], [reservation()], new Date("2026-10-02T22:00:00.000Z"));
  assert.ok(readiness);
  assert.equal(isCleaningCheckAvailable(readiness, new Date("2026-10-02T21:59:00.000Z")), false);
  assert.equal(isCleaningCheckAvailable(readiness, new Date("2026-10-02T22:00:00.000Z")), true);
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

test("le statut signale l’option ménage de la réservation sortante", () => {
  const [withCleaning] = buildGiteCleaningReadiness(
    [gite],
    [reservation({ options: JSON.stringify({ menage: { enabled: true } }) })],
    new Date("2026-10-03T10:00:00.000Z"),
  );
  const [withoutCleaning] = buildGiteCleaningReadiness(
    [gite],
    [reservation({ options: { menage: { enabled: false } } })],
    new Date("2026-10-03T10:00:00.000Z"),
  );
  assert.equal(withCleaning?.departure_has_cleaning_option, true);
  assert.equal(withoutCleaning?.departure_has_cleaning_option, false);
});

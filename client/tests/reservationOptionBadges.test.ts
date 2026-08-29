import assert from "node:assert/strict";
import test from "node:test";
import { getReservationOptionBadges } from "../src/utils/reservationOptionBadges";

test("crée un macaron uniquement pour chaque option activée", () => {
  const badges = getReservationOptionBadges({
    draps: { enabled: true },
    linge_toilette: { enabled: true },
    menage: { enabled: false },
    depart_tardif: { enabled: true },
    chiens: { enabled: false },
  });

  assert.deepEqual(
    badges.map(({ key, letter, label }) => ({ key, letter, label })),
    [
      { key: "draps", letter: "D", label: "Draps" },
      { key: "linge_toilette", letter: "S", label: "Serviettes" },
      { key: "depart_tardif", letter: "T", label: "Départ tardif" },
    ]
  );
});

test("accepte les options sérialisées de SQLite", () => {
  assert.deepEqual(
    getReservationOptionBadges(JSON.stringify({ menage: { enabled: true }, chiens: { enabled: true } })).map(
      ({ letter }) => letter
    ),
    ["M", "C"]
  );
});

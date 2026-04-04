import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyReservationEmailMessage } from "../src/services/dailyReservationEmail.ts";

test("buildDailyReservationEmailMessage construit un digest avec reservations", () => {
  const message = buildDailyReservationEmailMessage({
    generatedAt: new Date("2026-04-04T07:00:00.000Z"),
    windowStart: new Date("2026-04-03T07:00:00.000Z"),
    windowEnd: new Date("2026-04-04T07:00:00.000Z"),
    reservations: [
      {
        id: "res-1",
        gite_nom: "La Clairière",
        hote_nom: "Camille Martin",
        date_entree: "2026-05-10",
        date_sortie: "2026-05-13",
        nb_nuits: 3,
        prix_total: 540,
        source_paiement: "Airbnb",
        created_at: "2026-04-03T10:30:00.000Z",
      },
    ],
    totalsByGite: [
      {
        gite_id: "g1",
        gite_nom: "La Clairière",
        total_amount: 1540,
        reservations_count: 4,
      },
      {
        gite_id: "g2",
        gite_nom: "Le Refuge",
        total_amount: 980,
        reservations_count: 2,
      },
    ],
    totalAmount: 2520,
    totalReservationsCount: 6,
  });

  assert.match(message.subject, /Nouvelles réservations du/);
  assert.match(message.text, /La Clairière \| Camille Martin/);
  assert.match(message.text, /Montant total actuel : 2 520,00 €/);
  assert.match(message.html, /Réservations des dernières 24h/);
  assert.match(message.html, /Camille Martin/);
  assert.match(message.html, /Le Refuge/);
});

test("buildDailyReservationEmailMessage gère l'absence de nouvelles reservations", () => {
  const message = buildDailyReservationEmailMessage({
    generatedAt: new Date("2026-04-04T07:00:00.000Z"),
    windowStart: new Date("2026-04-03T07:00:00.000Z"),
    windowEnd: new Date("2026-04-04T07:00:00.000Z"),
    reservations: [],
    totalsByGite: [
      {
        gite_id: "g1",
        gite_nom: "La Clairière",
        total_amount: 1540,
        reservations_count: 4,
      },
    ],
    totalAmount: 1540,
    totalReservationsCount: 4,
  });

  assert.match(message.subject, /Point quotidien réservations du/);
  assert.match(
    message.text,
    /Aucune nouvelle réservation créée sur les dernières 24 heures/,
  );
  assert.match(message.html, /Aucune nouvelle réservation n&#39;a été créée|Aucune nouvelle réservation n'a été créée/);
});

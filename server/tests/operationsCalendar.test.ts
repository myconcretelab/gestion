import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationsCalendarIcs } from "../src/services/operationsCalendar.ts";

test("le flux opérationnel crée une arrivée et un départ avec les horaires du contrat", () => {
  const body = buildOperationsCalendarIcs(
    [
      {
        id: "reservation-1",
        date_entree: new Date("2026-07-10T00:00:00.000Z"),
        date_sortie: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-06-28T10:30:00.000Z"),
        heure_arrivee: "18:30",
        heure_depart: "10:15",
        gite: {
          nom: "La Prairie",
          heure_arrivee_defaut: "17:00",
          heure_depart_defaut: "12:00",
        },
      },
    ],
    new Date("2026-06-28T12:00:00.000Z"),
  );

  assert.match(body, /X-WR-CALNAME:Programme des gîtes/);
  assert.match(body, /UID:arrival-reservation-1@contrats/);
  assert.match(body, /DTSTART;TZID=Europe\/Paris:20260710T183000/);
  assert.match(body, /SUMMARY:Arrivée au gîte La Prairie/);
  assert.match(body, /UID:departure-reservation-1@contrats/);
  assert.match(body, /DTSTART;TZID=Europe\/Paris:20260714T101500/);
  assert.match(body, /SUMMARY:Départ du gîte La Prairie/);
  assert.doesNotMatch(body, /·/);
  assert.equal((body.match(/BEGIN:VEVENT/g) ?? []).length, 2);
});

test("le flux opérationnel utilise les horaires par défaut du gîte", () => {
  const body = buildOperationsCalendarIcs([
    {
      id: "reservation-2",
      date_entree: new Date("2026-08-01T00:00:00.000Z"),
      date_sortie: new Date("2026-08-02T00:00:00.000Z"),
      updatedAt: new Date("2026-06-28T10:30:00.000Z"),
      gite: {
        nom: "Le Bois",
        heure_arrivee_defaut: "16:00",
        heure_depart_defaut: "11:00",
      },
    },
  ]);

  assert.match(body, /DTSTART;TZID=Europe\/Paris:20260801T160000/);
  assert.match(body, /DTSTART;TZID=Europe\/Paris:20260802T110000/);
});

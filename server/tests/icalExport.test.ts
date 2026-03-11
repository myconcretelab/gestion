import assert from "node:assert/strict";
import test from "node:test";
import { buildReservationsIcs } from "../src/services/icalExport.ts";

test("le flux iCal produit des evenements tout-jour avec UID stable", () => {
  const body = buildReservationsIcs({
    giteName: "La Prairie",
    reservations: [
      {
        id: "r1",
        hote_nom: "Alice Martin",
        date_entree: new Date("2026-07-10T00:00:00.000Z"),
        date_sortie: new Date("2026-07-14T00:00:00.000Z"),
        source_paiement: "A définir",
        commentaire: "Blocage what-today",
        createdAt: new Date("2026-03-10T10:00:00.000Z"),
        updatedAt: new Date("2026-03-11T11:30:00.000Z"),
        origin_system: "what-today",
        origin_reference: "wt-42",
      },
    ],
  });

  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /X-WR-CALNAME:Disponibilites La Prairie/);
  assert.match(body, /UID:what-today-wt-42-20260710-20260714@contrats/);
  assert.match(body, /DTSTART;VALUE=DATE:20260710/);
  assert.match(body, /DTEND;VALUE=DATE:20260714/);
  assert.match(body, /SUMMARY:Reserve - Alice Martin/);
  assert.match(body, /DESCRIPTION:Source: A définir\\nNote: Blocage what-today/);
  assert.match(body, /END:VCALENDAR/);
});

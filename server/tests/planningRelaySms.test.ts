import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlanningRelayProgramSmsMessage,
  isPlanningRelaySmsDue,
  normalizePlanningRelaySmsTime,
} from "../src/services/planningRelaySms.ts";

test("buildPlanningRelayProgramSmsMessage genere un programme sans noms d'hotes", () => {
  const message = buildPlanningRelayProgramSmsMessage({
    targetIsoDate: "2026-07-11",
    reservations: [
      {
        id: "departure-1",
        gite_id: "gite-1",
        date_entree: new Date("2026-07-08T00:00:00.000Z"),
        date_sortie: new Date("2026-07-11T00:00:00.000Z"),
        options: { menage: { enabled: true } },
        gite: {
          id: "gite-1",
          nom: "Gîte Étang",
          ordre: 1,
          heure_arrivee_defaut: "17:00",
          heure_depart_defaut: "10:00",
        },
      },
      {
        id: "arrival-1",
        gite_id: "gite-1",
        date_entree: new Date("2026-07-11T00:00:00.000Z"),
        date_sortie: new Date("2026-07-14T00:00:00.000Z"),
        options: {},
        gite: {
          id: "gite-1",
          nom: "Gîte Étang",
          ordre: 1,
          heure_arrivee_defaut: "17:00",
          heure_depart_defaut: "10:00",
        },
      },
    ],
    contracts: [
      {
        reservation_id: "departure-1",
        heure_arrivee: "17:00",
        heure_depart: "09:30",
      },
    ],
  });

  assert.equal(
    message,
    "Programme demain:\n- Gite Etang: 9h30 sortie + menage / 17h entree",
  );
});

test("isPlanningRelaySmsDue evite les doublons quotidiens", () => {
  assert.equal(normalizePlanningRelaySmsTime("8:05"), "08:05");
  assert.equal(
    isPlanningRelaySmsDue({
      nowTime: "18:10",
      sendTime: "18:00",
      targetIsoDate: "2026-07-11",
      lastAttemptForDate: null,
    }),
    true,
  );
  assert.equal(
    isPlanningRelaySmsDue({
      nowTime: "18:10",
      sendTime: "18:00",
      targetIsoDate: "2026-07-11",
      lastAttemptForDate: "2026-07-11",
    }),
    false,
  );
});

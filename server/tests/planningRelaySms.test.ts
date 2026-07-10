import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlanningRelayProgramSmsMessages,
  getPlanningRelayProgramHeading,
  getPlanningRelayProgramTargetIsoDate,
  isPlanningRelaySmsDue,
  normalizePlanningRelaySmsTime,
} from "../src/services/planningRelaySms.ts";

test("buildPlanningRelayProgramSmsMessages regroupe les interventions du jour sans noms d'hotes", () => {
  const messages = buildPlanningRelayProgramSmsMessages({
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
      {
        id: "departure-2",
        gite_id: "gite-2",
        date_entree: new Date("2026-07-08T00:00:00.000Z"),
        date_sortie: new Date("2026-07-11T00:00:00.000Z"),
        options: {},
        gite: {
          id: "gite-2",
          nom: "Le Liberté",
          ordre: 2,
          heure_arrivee_defaut: "17:00",
          heure_depart_defaut: "12:00",
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

  assert.deepEqual(messages, [
    [
      "Programme demain:",
      "Gite Etang: Entre 9h30 et 17h (entree + sortie) + menage",
      "Le Liberte: A partir de 12h (sortie)",
    ].join("\n"),
  ]);
});

test("calcule le programme vise selon l'option veille ou jour meme", () => {
  assert.equal(getPlanningRelayProgramTargetIsoDate("2026-07-10", "previous_day"), "2026-07-11");
  assert.equal(getPlanningRelayProgramTargetIsoDate("2026-07-10", "same_day"), "2026-07-10");
  assert.equal(getPlanningRelayProgramHeading("same_day"), "Programme aujourd'hui");
  assert.deepEqual(
    buildPlanningRelayProgramSmsMessages({
      targetIsoDate: "2026-07-10",
      heading: getPlanningRelayProgramHeading("same_day"),
      reservations: [],
    }),
    [],
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

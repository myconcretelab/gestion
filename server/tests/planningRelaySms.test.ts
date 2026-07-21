import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlanningRelayProgramSmsMessages,
  buildPlanningRelayPublicUrl,
  extractPlanningRelayProgramVariables,
  getPlanningRelayProgramHeading,
  getPlanningRelayProgramTargetIsoDate,
  getPlanningRelayTestProgramHeading,
  isPlanningRelaySmsDue,
  normalizePlanningRelaySmsConfigs,
  normalizePlanningRelaySmsTime,
  renderPlanningRelaySmsTemplate,
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

test("le filtre d'entrées SMS conserve les rotations et masque les sorties seules", () => {
  const messages = buildPlanningRelayProgramSmsMessages({
    targetIsoDate: "2026-07-11",
    arrivalsOnly: true,
    reservations: [
      {
        id: "departure-1",
        gite_id: "gite-1",
        date_entree: new Date("2026-07-08T00:00:00.000Z"),
        date_sortie: new Date("2026-07-11T00:00:00.000Z"),
        options: {},
        gite: { id: "gite-1", nom: "Rotation", ordre: 1, heure_arrivee_defaut: "17:00", heure_depart_defaut: "10:00" },
      },
      {
        id: "arrival-1",
        gite_id: "gite-1",
        date_entree: new Date("2026-07-11T00:00:00.000Z"),
        date_sortie: new Date("2026-07-14T00:00:00.000Z"),
        options: {},
        gite: { id: "gite-1", nom: "Rotation", ordre: 1, heure_arrivee_defaut: "17:00", heure_depart_defaut: "10:00" },
      },
      {
        id: "departure-2",
        gite_id: "gite-2",
        date_entree: new Date("2026-07-08T00:00:00.000Z"),
        date_sortie: new Date("2026-07-11T00:00:00.000Z"),
        options: {},
        gite: { id: "gite-2", nom: "Sortie seule", ordre: 2, heure_arrivee_defaut: "17:00", heure_depart_defaut: "10:00" },
      },
    ],
  });

  assert.deepEqual(messages, ["Programme demain:\nRotation: Entre 10h et 17h (entree + sortie)"]);
});

test("utilise le domaine public de la requête et refuse localhost pour un envoi automatique", () => {
  const period = { share_nonce: "preview-origin-test", public_origin: "http://localhost:5173" };
  assert.match(
    buildPlanningRelayPublicUrl(period, "https://gestion.example.fr"),
    /^https:\/\/gestion\.example\.fr\/r\//,
  );
  assert.throws(
    () => buildPlanningRelayPublicUrl(period, undefined, true),
    /URL publique manquante/,
  );
});

test("personnalise un SMS avec les variables disponibles", () => {
  assert.equal(
    renderPlanningRelaySmsTemplate("Bonjour {{intervenant}}, {{programme}} — {{date}} — {{periode}} — {{lien}}", {
      intervenant: "Élodie",
      programme: "Gîte Étang: ménage",
      gite: "Gîte Étang",
      horaire: "Entre 10h et 17h",
      in_out: "entrée + sortie",
      date: "21/07/2026",
      periode: "Vacances Espagne",
      lien: "https://example.test/r/ABC12345",
    }),
    "Bonjour Elodie, Gite Etang: menage — 21/07/2026 — Vacances Espagne — https://example.test/r/ABC12345",
  );
});

test("décompose le programme en variables gîte, horaire et entrée-sortie", () => {
  const variables = extractPlanningRelayProgramVariables([
    "Programme demain:",
    "Tante Phonsine: Entre 12h et 17h (entree + sortie)",
    "Le Liberte: A partir de 12h (sortie) + menage",
  ].join("\n"));
  assert.deepEqual(variables, {
    gite: "Tante Phonsine / Le Liberte",
    horaire: "Entre 12h et 17h / A partir de 12h",
    in_out: "entree + sortie / sortie",
  });
  assert.equal(
    renderPlanningRelaySmsTemplate("{{gite}} | {{horaire}} | {{in-out}}", {
      ...variables,
      date: "21/07/2026",
      programme: "",
      intervenant: "Mathilde",
      periode: "Relais",
      lien: "https://example.test/r/ABC12345",
    }),
    "Tante Phonsine / Le Liberte | Entre 12h et 17h / A partir de 12h | entree + sortie / sortie",
  );
});

test("limite chaque période à une configuration SMS et migre le destinataire historique", () => {
  const configs = normalizePlanningRelaySmsConfigs(JSON.stringify([
    { id: "sms-1", worker_id: "worker-1", enabled: true, send_time: "8:05", send_day: "same_day", template: "{{programme}}" },
    { id: "sms-2", worker_id: "worker-2", enabled: false, send_time: "18:00", send_day: "previous_day", template: "Bonjour {{intervenant}}" },
  ]));
  assert.equal(configs.length, 1);
  assert.equal(configs[0].send_time, "08:05");
  assert.equal(configs[0].worker_id, "worker-1");

  const legacy = normalizePlanningRelaySmsConfigs("[]", {
    sms_enabled: true,
    sms_worker_id: "worker-old",
    sms_send_time: "19:00",
    sms_send_day: "previous_day",
  });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].worker_id, "worker-old");
  assert.equal(legacy[0].template, "{{gite}} : {{horaire}} ({{in_out}})");
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

test("buildPlanningRelayProgramSmsMessages ignore les arrivees deja traitees par une sortie precedente", () => {
  const gite = {
    id: "gite-1",
    nom: "Oncle Edmond",
    ordre: 1,
    heure_arrivee_defaut: "17:00",
    heure_depart_defaut: "12:00",
  };

  assert.deepEqual(
    buildPlanningRelayProgramSmsMessages({
      contextStartIsoDate: "2026-07-10",
      targetIsoDate: "2026-07-13",
      reservations: [
        {
          id: "departure-previous",
          gite_id: "gite-1",
          date_entree: new Date("2026-07-10T00:00:00.000Z"),
          date_sortie: new Date("2026-07-12T00:00:00.000Z"),
          options: { menage: { enabled: true } },
          gite,
        },
        {
          id: "handled-arrival",
          gite_id: "gite-1",
          date_entree: new Date("2026-07-13T00:00:00.000Z"),
          date_sortie: new Date("2026-07-27T00:00:00.000Z"),
          options: {},
          gite,
        },
      ],
    }),
    [],
  );

  assert.deepEqual(
    buildPlanningRelayProgramSmsMessages({
      contextStartIsoDate: "2026-07-10",
      targetIsoDate: "2026-07-13",
      arrivalsOnly: true,
      reservations: [
        {
          id: "departure-previous",
          gite_id: "gite-1",
          date_entree: new Date("2026-07-10T00:00:00.000Z"),
          date_sortie: new Date("2026-07-12T00:00:00.000Z"),
          options: { menage: { enabled: true } },
          gite,
        },
        {
          id: "handled-arrival",
          gite_id: "gite-1",
          date_entree: new Date("2026-07-13T00:00:00.000Z"),
          date_sortie: new Date("2026-07-27T00:00:00.000Z"),
          options: {},
          gite,
        },
      ],
    }),
    ["Programme demain:\nOncle Edmond: Avant 17h (entree)"],
  );
});

test("isPlanningRelaySmsDue evite les doublons quotidiens", () => {
  assert.equal(getPlanningRelayTestProgramHeading("2026-07-13"), "TEST - Programme du 13/07/2026");
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

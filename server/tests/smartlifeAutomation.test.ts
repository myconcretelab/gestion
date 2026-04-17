import assert from "node:assert/strict";
import test from "node:test";
import {
  applySameDayRotationGuards,
  buildDueEvents,
} from "../src/services/smartlifeAutomation.ts";
import type { SmartlifeAutomationConfig } from "../src/services/smartlifeSettings.ts";

const buildConfig = (rules: SmartlifeAutomationConfig["rules"]): SmartlifeAutomationConfig => ({
  enabled: true,
  region: "eu",
  access_id: "",
  access_secret: "",
  rules,
  energy_devices: [],
});

const buildReservation = (params: {
  id: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  linkedContract?: {
    heure_arrivee?: string | null;
    heure_depart?: string | null;
  } | null;
}) => ({
  id: params.id,
  gite_id: "gite-1",
  hote_nom: params.guest,
  date_entree: new Date(`${params.checkIn}T00:00:00.000Z`),
  date_sortie: new Date(`${params.checkOut}T00:00:00.000Z`),
  linked_contract: params.linkedContract
    ? {
        heure_arrivee: params.linkedContract.heure_arrivee ?? null,
        heure_depart: params.linkedContract.heure_depart ?? null,
      }
    : null,
  gite: {
    id: "gite-1",
    nom: "Mauron",
    heure_arrivee_defaut: "17:00",
    heure_depart_defaut: "12:00",
  },
});

test("ignore une regle de depart qui tomberait apres l'arrivee suivante le meme jour", () => {
  const reservations = [
    buildReservation({
      id: "reservation-depart",
      guest: "Client sortant",
      checkIn: "2026-04-14",
      checkOut: "2026-04-17",
    }),
    buildReservation({
      id: "reservation-arrivee",
      guest: "Client entrant",
      checkIn: "2026-04-17",
      checkOut: "2026-04-20",
    }),
  ];
  const config = buildConfig([
    {
      id: "rule-after-departure",
      enabled: true,
      label: "Couper chauffage apres depart",
      gite_ids: ["gite-1"],
      trigger: "after-departure",
      offset_minutes: 6 * 60,
      action: "device-off",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: false,
    },
    {
      id: "rule-before-arrival",
      enabled: true,
      label: "Relancer chauffage avant arrivee",
      gite_ids: ["gite-1"],
      trigger: "before-arrival",
      offset_minutes: 2 * 60,
      action: "device-on",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: true,
    },
  ]);

  const dueEvents = buildDueEvents(config, reservations, new Date("2026-04-17T19:00:00.000Z"));
  const { actionableEvents, skippedEvents } = applySameDayRotationGuards(dueEvents, reservations);

  assert.equal(dueEvents.length, 2);
  assert.equal(actionableEvents.length, 1);
  assert.equal(actionableEvents[0]?.rule_id, "rule-before-arrival");
  assert.equal(skippedEvents.length, 1);
  assert.equal(skippedEvents[0]?.rule_id, "rule-after-departure");
  assert.match(skippedEvents[0]?.message ?? "", /rotation le meme jour|rotation le même jour/i);
});

test("ignore une regle d'arrivee qui tomberait avant le depart precedent le meme jour", () => {
  const reservations = [
    buildReservation({
      id: "reservation-depart",
      guest: "Client sortant",
      checkIn: "2026-04-14",
      checkOut: "2026-04-17",
    }),
    buildReservation({
      id: "reservation-arrivee",
      guest: "Client entrant",
      checkIn: "2026-04-17",
      checkOut: "2026-04-20",
    }),
  ];
  const config = buildConfig([
    {
      id: "rule-before-arrival",
      enabled: true,
      label: "Prechauffage trop tot",
      gite_ids: ["gite-1"],
      trigger: "before-arrival",
      offset_minutes: 8 * 60,
      action: "device-on",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: true,
    },
    {
      id: "rule-after-departure",
      enabled: true,
      label: "Coupure pendant le menage",
      gite_ids: ["gite-1"],
      trigger: "after-departure",
      offset_minutes: 2 * 60,
      action: "device-off",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: false,
    },
  ]);

  const dueEvents = buildDueEvents(config, reservations, new Date("2026-04-17T15:30:00.000Z"));
  const { actionableEvents, skippedEvents } = applySameDayRotationGuards(dueEvents, reservations);

  assert.equal(dueEvents.length, 2);
  assert.equal(actionableEvents.length, 1);
  assert.equal(actionableEvents[0]?.rule_id, "rule-after-departure");
  assert.equal(skippedEvents.length, 1);
  assert.equal(skippedEvents[0]?.rule_id, "rule-before-arrival");
});

test("conserve les commandes placees dans la fenetre entre depart et arrivee", () => {
  const reservations = [
    buildReservation({
      id: "reservation-depart",
      guest: "Client sortant",
      checkIn: "2026-04-14",
      checkOut: "2026-04-17",
    }),
    buildReservation({
      id: "reservation-arrivee",
      guest: "Client entrant",
      checkIn: "2026-04-17",
      checkOut: "2026-04-20",
    }),
  ];
  const config = buildConfig([
    {
      id: "rule-after-departure",
      enabled: true,
      label: "Couper pour le menage",
      gite_ids: ["gite-1"],
      trigger: "after-departure",
      offset_minutes: 2 * 60,
      action: "device-off",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: false,
    },
    {
      id: "rule-before-arrival",
      enabled: true,
      label: "Relancer avant arrivee",
      gite_ids: ["gite-1"],
      trigger: "before-arrival",
      offset_minutes: 1 * 60,
      action: "device-on",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: true,
    },
  ]);

  const dueEvents = buildDueEvents(config, reservations, new Date("2026-04-17T16:30:00.000Z"));
  const { actionableEvents, skippedEvents } = applySameDayRotationGuards(dueEvents, reservations);

  assert.equal(dueEvents.length, 2);
  assert.equal(actionableEvents.length, 2);
  assert.equal(skippedEvents.length, 0);
});

test("utilise l'heure d'arrivee du contrat lie pour declencher une regle", () => {
  const reservations = [
    buildReservation({
      id: "reservation-arrivee",
      guest: "Client entrant",
      checkIn: "2026-04-17",
      checkOut: "2026-04-20",
      linkedContract: {
        heure_arrivee: "15:00",
      },
    }),
  ];
  const config = buildConfig([
    {
      id: "rule-before-arrival",
      enabled: true,
      label: "Prechauffage",
      gite_ids: ["gite-1"],
      trigger: "before-arrival",
      offset_minutes: 60,
      action: "device-on",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: true,
    },
  ]);

  const dueEvents = buildDueEvents(
    config,
    reservations,
    new Date("2026-04-17T14:30:00.000Z"),
  );

  assert.equal(dueEvents.length, 1);
  assert.equal(dueEvents[0]?.scheduled_at, "2026-04-17T12:00:00.000Z");
});

test("utilise les heures du contrat lie pour la garde rotation le meme jour", () => {
  const reservations = [
    buildReservation({
      id: "reservation-depart",
      guest: "Client sortant",
      checkIn: "2026-04-14",
      checkOut: "2026-04-17",
      linkedContract: {
        heure_depart: "11:00",
      },
    }),
    buildReservation({
      id: "reservation-arrivee",
      guest: "Client entrant",
      checkIn: "2026-04-17",
      checkOut: "2026-04-20",
      linkedContract: {
        heure_arrivee: "19:00",
      },
    }),
  ];
  const config = buildConfig([
    {
      id: "rule-after-departure",
      enabled: true,
      label: "Couper en fin de menage",
      gite_ids: ["gite-1"],
      trigger: "after-departure",
      offset_minutes: 7 * 60,
      action: "device-off",
      device_id: "device-1",
      device_name: "Chauffage",
      command_code: "switch_1",
      command_label: "Interrupteur",
      command_value: false,
    },
  ]);

  const dueEvents = buildDueEvents(
    config,
    reservations,
    new Date("2026-04-17T18:30:00.000Z"),
  );
  const { actionableEvents, skippedEvents } = applySameDayRotationGuards(
    dueEvents,
    reservations,
  );

  assert.equal(dueEvents.length, 1);
  assert.equal(dueEvents[0]?.scheduled_at, "2026-04-17T16:00:00.000Z");
  assert.equal(actionableEvents.length, 1);
  assert.equal(skippedEvents.length, 0);
});

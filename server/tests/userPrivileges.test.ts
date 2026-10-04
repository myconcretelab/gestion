import assert from "node:assert/strict";
import test from "node:test";
import { APP_PAGE_IDS, DEFAULT_STATUS_PRESETS, normalizePageAccess, serializeAppUser, serializeStatusPreset } from "../src/services/appUsers.ts";
import { buildGiteCheckedMessage } from "../src/services/telegramNotifications.ts";

test("un propriétaire conserve toujours toutes les pages", () => {
  assert.deepEqual(normalizePageAccess([], true), [...APP_PAGE_IDS]);
  assert.deepEqual(normalizePageAccess('["today","invalid","calendar"]'), ["today", "calendar"]);
});

test("les modèles de droits filtrent les pages et verrouillent le propriétaire", () => {
  assert.deepEqual(DEFAULT_STATUS_PRESETS.worker.pageAccess, ["today", "calendar", "planning_relay"]);
  assert.deepEqual(serializeStatusPreset({
    status: "custom",
    page_access: '["today","invalid","contracts"]',
    can_write: true,
    can_view_amounts: false,
  }), {
    status: "custom",
    canWrite: true,
    canViewAmounts: false,
    pageAccess: ["today", "contracts"],
    locked: false,
  });
  assert.deepEqual(serializeStatusPreset({
    status: "owner",
    page_access: "[]",
    can_write: false,
    can_view_amounts: false,
  }).pageAccess, [...APP_PAGE_IDS]);
});

test("le prénom et le nom pilotent le nom affiché d’un utilisateur", () => {
  const user = serializeAppUser({
    id: "user-1",
    display_name: "Ancien libellé",
    first_name: "Sébastien",
    last_name: "Jacqmin",
    gestionnaire_id: "manager-1",
    intervenant_id: null,
    status: "owner",
    page_access: "[]",
    can_write: true,
    can_view_amounts: true,
    is_owner: true,
    is_active: true,
  });

  assert.equal(user.displayName, "Sébastien Jacqmin");
  assert.equal(user.firstName, "Sébastien");
  assert.equal(user.lastName, "Jacqmin");

  const singleNameUser = serializeAppUser({
    id: "user-2",
    display_name: "Camille",
    first_name: "Camille",
    last_name: "",
    gestionnaire_id: null,
    intervenant_id: null,
    status: "worker",
    page_access: "[]",
    can_write: true,
    can_view_amounts: false,
    is_owner: false,
    is_active: true,
  });
  assert.equal(singleNameUser.displayName, "Camille");
  assert.equal(singleNameUser.lastName, "");
});

test("le message Telegram du ménage indique le prénom de l’utilisateur", () => {
  const message = buildGiteCheckedMessage("La Grange", new Date("2026-10-04T09:30:00.000Z"), [], "Soazig");
  assert.match(message, /Par Soazig/);
  assert.match(message, /Gîte La Grange checké/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { APP_PAGE_IDS, DEFAULT_STATUS_PRESETS, normalizePageAccess, serializeStatusPreset } from "../src/services/appUsers.ts";
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

test("le message Telegram du ménage indique le prénom de l’utilisateur", () => {
  const message = buildGiteCheckedMessage("La Grange", new Date("2026-10-04T09:30:00.000Z"), [], "Soazig");
  assert.match(message, /Par Soazig/);
  assert.match(message, /Gîte La Grange checké/);
});

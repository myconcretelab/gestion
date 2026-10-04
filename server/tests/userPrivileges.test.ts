import assert from "node:assert/strict";
import test from "node:test";
import { APP_PAGE_IDS, normalizePageAccess } from "../src/services/appUsers.ts";
import { buildGiteCheckedMessage } from "../src/services/telegramNotifications.ts";

test("un propriétaire conserve toujours toutes les pages", () => {
  assert.deepEqual(normalizePageAccess([], true), [...APP_PAGE_IDS]);
  assert.deepEqual(normalizePageAccess('["today","invalid","calendar"]'), ["today", "calendar"]);
});

test("le message Telegram du ménage indique le prénom de l’utilisateur", () => {
  const message = buildGiteCheckedMessage("La Grange", new Date("2026-10-04T09:30:00.000Z"), [], "Soazig");
  assert.match(message, /Par Soazig/);
  assert.match(message, /Gîte La Grange checké/);
});

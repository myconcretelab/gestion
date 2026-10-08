import assert from "node:assert/strict";
import test from "node:test";
import {
  isAmountsOnlyApiPath,
  isWriteMethod,
  containsMonetaryFields,
  redactMonetaryValues,
  getRequiredPageForApiPath,
  getRequiredBusinessPermission,
  hasBusinessPermission,
  canActAsRequestedUser,
} from "../src/services/accessControl.ts";
import type { AppUserSummary } from "../src/services/appUsers.ts";

test("redactMonetaryValues retire les montants sans masquer les compteurs", () => {
  const result = redactMonetaryValues({
    id: "reservation-1",
    total_count: 4,
    prix_total: 420,
    pricing_snapshot: {
      montant_hebergement: 380,
      options_detail: { draps: 20, menage: 20 },
    },
    guest: { name: "Camille", adults_count: 2 },
    prices_by_gite: { gite_1: 120 },
  }) as Record<string, unknown>;

  assert.equal(result.total_count, 4);
  assert.equal(result.prix_total, null);
  assert.deepEqual(result.pricing_snapshot, {
    montant_hebergement: null,
    options_detail: {},
  });
  assert.deepEqual(result.guest, { name: "Camille", adults_count: 2 });
  assert.deepEqual(result.prices_by_gite, {});
});

const worker = {
  id: "user-1", loginId: "worker", displayName: "Worker", firstName: "Work", lastName: "Er",
  gestionnaireId: null, intervenantId: "worker-1", roles: ["worker"], status: "worker",
  telephone: null, email: null, adresse: null, telegramChatId: null, hourlyRate: 0,
  cleaningCheckRate: 0, fullCleaningRate: 0, pageAccess: ["today", "reservations", "calendar", "planning_relay"],
  isActive: true, permissions: { canWrite: true, canViewAmounts: false, isOwner: false },
} as AppUserSummary;

test("chaque famille de routes reçoit une permission métier explicite", () => {
  const cases: Array<[string, string, string]> = [
    ["GET", "/reservations", "reservations:read"], ["POST", "/reservations", "reservations:write"],
    ["GET", "/gites", "gites:read"], ["PUT", "/gites/1", "gites:write"],
    ["GET", "/gites/1/season-rates", "rates:read"], ["GET", "/reservations/calendar", "calendar:read"],
    ["GET", "/contracts", "contracts:read"], ["POST", "/contracts", "contracts:write"],
    ["GET", "/invoices", "invoices:read"], ["GET", "/statistics", "statistics:read"],
    ["GET", "/personal-expenses", "finances:read"], ["POST", "/urssaf-declarations", "declarations:write"],
    ["GET", "/users", "users:read"], ["PUT", "/settings/security", "settings:write"],
    ["GET", "/settings/pump/status", "integrations:manage"], ["GET", "/planning-relay-periods", "planning:read"],
    ["GET", "/cleaning-tasks", "planning:read"], ["PATCH", "/cleaning-tasks/task-1/status", "cleaning:execute"],
    ["PATCH", "/cleaning-tasks/task-1/note", "cleaning:execute"],
    ["PUT", "/cleaning-tasks/rules/gite-1", "planning:write"],
    ["GET", "/action-tasks", "planning:read"], ["POST", "/action-tasks/templates", "planning:write"],
    ["PATCH", "/action-tasks/tasks/task-1/status", "actions:execute"],
    ["PATCH", "/action-tasks/tasks/task-1/note", "actions:execute"],
    ["PUT", "/today/cleaning-readiness/gite-1", "cleaning:execute"],
    ["GET", "/booking-requests", "booking_requests:read"], ["GET", "/today/overview/primary", "today:read"],
  ];
  for (const [method, path, permission] of cases) assert.equal(getRequiredBusinessPermission(method, path), permission, `${method} ${path}`);
});

test("un intervenant est refusé sur les familles hors rôle et ne peut pas emprunter une identité", () => {
  assert.equal(hasBusinessPermission(worker, "reservations:read"), true);
  assert.equal(hasBusinessPermission(worker, "contracts:read"), false);
  assert.equal(hasBusinessPermission(worker, "users:read"), false);
  assert.equal(hasBusinessPermission(worker, "integrations:manage"), false);
  assert.equal(canActAsRequestedUser(worker, "/interventions", { userId: "user-2" }), false);
  assert.equal(canActAsRequestedUser(worker, "/intervenants/hours/worker-2", {}), false);
  assert.equal(canActAsRequestedUser(worker, "/intervenants/hours/worker-1", {}), true);
  const readOnlyWorker = { ...worker, permissions: { ...worker.permissions, canWrite: false } };
  assert.equal(hasBusinessPermission(readOnlyWorker, "cleaning:execute"), true);
  assert.equal(hasBusinessPermission(readOnlyWorker, "actions:execute"), true);
  assert.equal(hasBusinessPermission(readOnlyWorker, "planning:write"), false);
});

test("les API dédiées respectent le droit de page", () => {
  assert.equal(getRequiredPageForApiPath("/today/overview/primary"), "today");
  assert.equal(getRequiredPageForApiPath("/contracts/abc"), "contracts");
  assert.equal(getRequiredPageForApiPath("/users/owners"), "gites");
  assert.equal(getRequiredPageForApiPath("/users"), "settings");
  assert.equal(getRequiredPageForApiPath("/cleaning-tasks"), "planning_relay");
  assert.equal(getRequiredPageForApiPath("/action-tasks"), "planning_relay");
  assert.equal(getRequiredPageForApiPath("/reservations/calendar"), null);
});

test("les modules financiers et les méthodes d'écriture sont identifiés", () => {
  assert.equal(isAmountsOnlyApiPath("/contracts/abc/pdf"), true);
  assert.equal(isAmountsOnlyApiPath("/statistics"), true);
  assert.equal(isAmountsOnlyApiPath("/reservations"), false);
  assert.equal(isWriteMethod("PATCH"), true);
  assert.equal(isWriteMethod("GET"), false);
  assert.equal(containsMonetaryFields({ commentaire: "ok", prix_total: 50 }), true);
  assert.equal(containsMonetaryFields({ commentaire: "ok", adults_count: 2 }), false);
});

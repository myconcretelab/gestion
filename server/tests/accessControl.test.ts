import assert from "node:assert/strict";
import test from "node:test";
import {
  isAmountsOnlyApiPath,
  isWriteMethod,
  containsMonetaryFields,
  redactMonetaryValues,
  getRequiredPageForApiPath,
  getRequiredBusinessPermission,
  getAdditionalBusinessPermissions,
  hasBusinessPermission,
  canActAsRequestedUser,
} from "../src/services/accessControl.ts";
import type { AppUserSummary } from "../src/services/appUsers.ts";

test("l’atelier sandbox exige les droits d’intégration pour toute route et tout verbe",()=>{
  for(const method of ["GET","POST","PUT","DELETE"])
    for(const path of ["/superpdp-workshop","/superpdp-workshop/activate","/superpdp-workshop/id/pdf/native","/superpdp-workshop/id/send","/superpdp-workshop/id/recordPayment","/superpdp-workshop/id/sendPayment"])
      assert.equal(getRequiredBusinessPermission(method,path),"integrations:manage");
});

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
  cleaningCheckRate: 0, fullCleaningRate: 0, fullCleaningRates: {}, pageAccess: ["today", "reservations", "calendar", "planning_relay"],
  isActive: true, permissions: { canWrite: true, canViewAmounts: false, isOwner: false },
} as AppUserSummary;

test("les tâches du drawer restent utilisables depuis Aujourd’hui ou Calendrier sans ouvrir les réglages du planning", () => {
  for (const page of ["today", "calendar"] as const) {
    const drawerUser = { ...worker, pageAccess: [page] };
    for (const action of ["assignment", "status", "note"]) {
      const path = `/action-tasks/tasks/task-a/${action}`;
      const permission = getRequiredBusinessPermission("PATCH", path)!;
      assert.equal(permission, "actions:execute");
      assert.equal(hasBusinessPermission(drawerUser, permission), true);
      assert.equal(getRequiredPageForApiPath(path), null);
    }
    assert.equal(getRequiredBusinessPermission("PATCH", "/action-tasks/tasks/task-a"), "actions:execute");
    assert.equal(getRequiredPageForApiPath("/action-tasks/tasks/task-a"), null);
    assert.equal(hasBusinessPermission(drawerUser, "planning:write"), false);
    assert.equal(getRequiredPageForApiPath("/action-tasks/templates/template-a"), "planning_relay");
  }
  assert.equal(hasBusinessPermission({ ...worker, pageAccess: ["reservations"] }, "actions:execute"), false);
});

test("rattacher des gîtes depuis les établissements exige aussi gites:write", () => {
  const settingsOnly = { ...worker, pageAccess: ["settings"] } as AppUserSummary;
  const path = "/fiscal-entities/company/establishments/establishment";
  assert.equal(hasBusinessPermission(settingsOnly, getRequiredBusinessPermission("PUT", path)!), true);
  assert.deepEqual(getAdditionalBusinessPermissions("PUT", path, { gite_links: [{ gite_id: "gite" }] }), ["gites:write"]);
  assert.equal(hasBusinessPermission(settingsOnly, "gites:write"), false);
  assert.equal(hasBusinessPermission({ ...settingsOnly, pageAccess: ["settings", "gites"] }, "gites:write"), true);
  assert.deepEqual(getAdditionalBusinessPermissions("POST", "/fiscal-entities/company/establishments", { gite_links: [{}] }), ["gites:write"]);
  assert.deepEqual(getAdditionalBusinessPermissions("PUT", path, { gite_links: [] }), []);
  assert.deepEqual(getAdditionalBusinessPermissions("PUT", path, {}), []);
  assert.deepEqual(getAdditionalBusinessPermissions("GET", path, { gite_links: [{}] }), []);
});

test("chaque famille de routes reçoit une permission métier explicite", () => {
  const cases: Array<[string, string, string]> = [
    ["GET", "/reservations", "reservations:read"], ["POST", "/reservations", "reservations:write"],
    ["GET", "/gites", "gites:read"], ["PUT", "/gites/1", "gites:write"],
    ["GET", "/gites/1/season-rates", "rates:read"], ["GET", "/reservations/calendar", "calendar:read"],
    ["GET", "/contracts", "contracts:read"], ["POST", "/contracts", "contracts:write"],
    ["GET", "/invoices", "invoices:read"], ["GET", "/statistics", "statistics:read"],
    ["GET", "/personal-expenses", "finances:read"], ["POST", "/urssaf-declarations", "declarations:write"],
    ["GET", "/users", "users:read"], ["PUT", "/settings/security", "settings:write"],
    ["GET", "/fiscal-entities", "settings:read"], ["GET", "/fiscal-entities/inventory", "settings:read"],
    ["GET", "/fiscal-entities/1/superpdp", "integrations:manage"],
    ["GET", "/invoices/1/electronic", "integrations:manage"],
    ["GET", "/purchase-invoices", "integrations:manage"],
    ["GET", "/purchase-invoices/1/original", "integrations:manage"],
    ["PUT", "/purchase-invoices/1/match", "integrations:manage"],
    ["DELETE", "/purchase-invoices/1/match", "integrations:manage"],
    ["PUT", "/fiscal-entities/1/superpdp/inbox", "integrations:manage"],
    ["POST", "/invoices/1/electronic/prepare", "integrations:manage"],
    ["POST", "/invoices/1/electronic/send", "integrations:manage"],
    ["GET", "/invoices/1/electronic/factur-x", "integrations:manage"],
    ["PUT", "/fiscal-entities/1/superpdp/config", "integrations:manage"],
    ["POST", "/fiscal-entities/1/superpdp/connect", "integrations:manage"],
    ["GET", "/fiscal-entities/superpdp/oauth/callback", "integrations:manage"],
    ["POST", "/fiscal-entities/1/establishments", "settings:write"],
    ["GET", "/gites/fiscal-establishments", "gites:read"],
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
  assert.equal(hasBusinessPermission(worker, "settings:read"), false);
  assert.equal(hasBusinessPermission(worker, "settings:write"), false);
  assert.equal(canActAsRequestedUser(worker, "/interventions", { userId: "user-2" }), false);
  assert.equal(canActAsRequestedUser(worker, "/intervenants/hours/worker-2", {}), false);
  assert.equal(canActAsRequestedUser(worker, "/intervenants/hours/worker-1", {}), true);
  const readOnlyWorker = { ...worker, permissions: { ...worker.permissions, canWrite: false } };
  assert.equal(hasBusinessPermission(readOnlyWorker, "cleaning:execute"), true);
  assert.equal(hasBusinessPermission(readOnlyWorker, "actions:execute"), true);
  assert.equal(hasBusinessPermission(readOnlyWorker, "planning:write"), false);
  const todayOnlyWorker = { ...readOnlyWorker, pageAccess: ["today"] as AppUserSummary["pageAccess"] };
  assert.equal(hasBusinessPermission(todayOnlyWorker, "cleaning:execute"), true);
  assert.equal(hasBusinessPermission(todayOnlyWorker, "planning:read"), false);
  assert.equal(hasBusinessPermission({ ...todayOnlyWorker, pageAccess: [] }, "cleaning:execute"), false);
});

test("les API dédiées respectent le droit de page", () => {
  assert.equal(getRequiredPageForApiPath("/today/overview/primary"), "today");
  assert.equal(getRequiredPageForApiPath("/contracts/abc"), "contracts");
  assert.equal(getRequiredPageForApiPath("/users/owners"), "gites");
  assert.equal(getRequiredPageForApiPath("/users"), "settings");
  assert.equal(getRequiredPageForApiPath("/fiscal-entities/inventory"), "settings");
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

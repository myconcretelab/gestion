import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_TASK_SHORTCUTS, actionWindow, summarizeActionTasks, syncActionTasks } from "../src/services/actionTasks.js";
import { parseRotationAssignees, rotationAssigneeAt } from "../src/services/assignmentRules.js";
import prisma from "../src/db/prisma.js";

test("une action peut être prévue la veille d'une arrivée en heure de Paris", () => {
  const window = actionWindow("2026-10-25", {
    starts_offset_days: -1, due_offset_days: 0, start_time: "09:00", due_time: "16:00",
  });
  assert.equal(window.startsAt.toISOString(), "2026-10-24T07:00:00.000Z");
  assert.equal(window.dueAt.toISOString(), "2026-10-25T15:00:00.000Z");
});

test("le tour de rôle suit l'ordre défini et revient au début", () => {
  const pool = parseRotationAssignees('["a","b","a","c"]');
  assert.deepEqual(pool, ["a", "b", "c"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((cursor) => rotationAssigneeAt(pool, cursor)), ["a", "b", "c", "a", "b"]);
  assert.equal(rotationAssigneeAt([], 1), null);
});

test("les tâches courtes et longues ont des compteurs distincts", () => {
  assert.deepEqual(summarizeActionTasks([
    { category: "short", status: "planned" },
    { category: "short", status: "in_progress" },
    { category: "long", status: "planned" },
    { category: "short", status: "done" },
  ]), { open_short: 2, open_long: 1, completed: 1 });
});

test("les raccourcis essentiels sont disponibles en ajout rapide", () => {
  assert.ok(ACTION_TASK_SHORTCUTS.some((item) => item.title.includes("savon")));
  assert.ok(ACTION_TASK_SHORTCUTS.some((item) => item.title.includes("papier toilette")));
  assert.ok(ACTION_TASK_SHORTCUTS.some((item) => item.title.includes("aspirateur")));
  assert.ok(ACTION_TASK_SHORTCUTS.every((item) => item.category === "short" || item.category === "long"));
});

test("modifier une automatisation sans renvoyer le montant conserve le forfait existant", async () => {
  const { default: router } = await import("../src/modules/operations/actionTasks.js");
  const handler = (router as any).stack.find((layer: any) => layer.route?.path === "/templates/:id" && layer.route.methods.put).route.stack[0].handle;
  const original = { find: prisma.actionTemplate.findUnique, update: prisma.actionTemplate.update, gite: prisma.gite.findUnique };
  const draft = { gite_id: "gite-a", title: "Préparer le linge", category: "short", trigger_event: "departure", starts_offset_days: 0, due_offset_days: 1, start_time: "09:00", due_time: "17:00", assignment_mode: "unassigned", default_assignee_id: null, rotation_assignee_ids: [], enabled: false, compensation_mode: "flat_rate", default_minutes: null };
  try {
    prisma.actionTemplate.findUnique = (async () => ({ id: "template-a", assignment_mode: "unassigned", rotation_assignee_ids: "[]", compensation_amount: 17.5 })) as any;
    prisma.gite.findUnique = (async () => ({ id: "gite-a" })) as any;
    prisma.actionTemplate.update = (async ({ data }: any) => { assert.equal(data.compensation_amount, 17.5); return { id: "template-a", ...data }; }) as any;
    let result: any; let error: unknown;
    await handler({ headers: {}, params: { id: "template-a" }, body: draft }, { status() { return this; }, json(value: unknown) { result = value; } }, (reason: unknown) => { error = reason; });
    assert.equal(error, undefined);
    assert.equal(result.compensation_amount, 17.5);
    assert.equal(result.enabled, false);
  } finally { prisma.actionTemplate.findUnique = original.find; prisma.actionTemplate.update = original.update; prisma.gite.findUnique = original.gite; }
});

test("l’édition conserve une occurrence personnalisée, refuse les tâches terminées et détecte les conflits", async () => {
  const { default: router } = await import("../src/modules/operations/actionTasks.js");
  const handler = (router as any).stack.find((layer: any) => layer.route?.path === "/tasks/:id" && layer.route.methods.patch).route.stack[0].handle;
  const original = { find: prisma.actionTask.findUnique, update: prisma.actionTask.updateMany, gite: prisma.gite.findUnique };
  const task = {
    id: "task-a", template_id: "template-a", reservation_id: null, gite_id: "gite-a", title: "Savon",
    category: "short", assignee_id: null, status: "planned", starts_at: new Date("2026-10-19T08:00:00Z"),
    due_at: new Date("2026-10-20T10:00:00Z"), updatedAt: new Date("2026-10-19T09:00:00Z"),
    completed_at: null, compensation_mode: "none", compensation_amount: 0, spent_minutes: null, source_type: "automatic", note: "",
  };
  let current = { ...task };
  let updates: any[] = [];
  let updateCount = 1;
  try {
    prisma.actionTask.findUnique = (async () => current) as any;
    prisma.gite.findUnique = (async () => ({ nom: "Le Moulin" })) as any;
    prisma.actionTask.updateMany = (async (args: any) => { updates.push(args); current = { ...current, ...args.data }; return { count: updateCount }; }) as any;
    const invoke = async (override = {}) => {
      const response = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
      let error: unknown;
      await handler({ headers: {}, params: { id: task.id }, body: {
        title: "Apporter du savon", category: "long", assignee_id: null, due_day: "2026-10-22", due_time: "14:30",
        note: "Sous l’évier", compensation_mode: "flat_rate", compensation_amount: 12.5,
        expected_updated_at: task.updatedAt.toISOString(), ...override,
      } }, response, (reason: unknown) => { error = reason; });
      assert.equal(error, undefined);
      return response;
    };
    const saved = await invoke();
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.title, "Apporter du savon");
    assert.equal(updates[0].data.source_type, "customized");
    assert.equal(updates[0].data.due_at.toISOString(), "2026-10-22T12:30:00.000Z");
    assert.equal(updates[0].where.updatedAt.toISOString(), task.updatedAt.toISOString());
    assert.deepEqual(updates[0].where.status, { not: "done" });

    current = { ...task, status: "done" };
    updates = [];
    assert.equal((await invoke()).statusCode, 409);
    assert.equal(updates.length, 0);
    current = { ...task };
    assert.equal((await invoke({ compensation_amount: 0 })).statusCode, 400);
    assert.equal((await invoke({ due_day: "2026-10-18" })).statusCode, 400);
    assert.equal((await invoke({ due_day: "2026-02-31" })).statusCode, 400);
    assert.equal((await invoke({ compensation_mode: undefined, compensation_amount: undefined })).statusCode, 200);
    assert.equal(updates.at(-1).data.compensation_mode, "none");
    assert.equal(updates.at(-1).data.compensation_amount, 0);
    updateCount = 0;
    assert.equal((await invoke()).statusCode, 409);
  } finally {
    prisma.actionTask.findUnique = original.find;
    prisma.actionTask.updateMany = original.update;
    prisma.gite.findUnique = original.gite;
  }
});

test("la synchronisation conserve les retouches d’une tâche automatique sans bloquer les autres occurrences", async () => {
  const original = { templates: prisma.actionTemplate.findMany, reservations: prisma.reservation.findMany, tasks: prisma.actionTask.findMany, update: prisma.actionTask.update };
  let sourceType = "customized";
  let updates = 0;
  try {
    prisma.actionTemplate.findMany = (async () => [{ id: "template-a", gite_id: "gite-a", title: "Titre du modèle", category: "short", compensation_mode: "none", compensation_amount: 0, trigger_event: "departure", starts_offset_days: 0, due_offset_days: 0, start_time: "09:00", due_time: "17:00" }]) as any;
    prisma.reservation.findMany = (async () => [{ id: "reservation-a", gite_id: "gite-a", date_entree: new Date("2026-10-19T00:00:00Z"), date_sortie: new Date("2026-10-22T00:00:00Z") }]) as any;
    prisma.actionTask.findMany = (async () => [{ id: "task-a", template_id: "template-a", reservation_id: "reservation-a", status: "planned", title: "Titre personnalisé", category: "long", source_type: sourceType, starts_at: new Date("2026-10-22T07:00:00Z"), due_at: new Date("2026-10-22T15:00:00Z"), compensation_mode: "none", compensation_amount: 0 }]) as any;
    prisma.actionTask.update = (async () => { updates += 1; return {}; }) as any;
    await syncActionTasks("2026-10-20", "2026-10-25");
    assert.equal(updates, 0);
    sourceType = "automatic";
    await syncActionTasks("2026-10-20", "2026-10-25");
    assert.equal(updates, 1);
  } finally {
    prisma.actionTemplate.findMany = original.templates;
    prisma.reservation.findMany = original.reservations;
    prisma.actionTask.findMany = original.tasks;
    prisma.actionTask.update = original.update;
  }
});

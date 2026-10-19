import assert from "node:assert/strict";
import test from "node:test";
import { cleaningTaskReadinessUpdate, cleaningWindow, parisWallTime, serializeCleaningTask } from "../src/services/cleaningTasks.js";

test("un ménage peut être prévu la veille de l’arrivée sans commencer avant le départ", () => {
  const window = cleaningWindow({
    departureDate: "2026-10-21", departureTime: "10:00",
    arrivalDate: "2026-10-25", arrivalTime: "17:00",
    scheduleMode: "day_before_arrival", bufferMinutes: 0,
  });
  assert.equal(window.startsAt.toISOString(), "2026-10-24T06:00:00.000Z");
  assert.equal(window.dueAt?.toISOString(), "2026-10-25T16:00:00.000Z");
  assert.equal(window.impossibleWindow, false);
});

test("une rotation le même jour avance la tâche au départ réel", () => {
  const window = cleaningWindow({
    departureDate: "2026-10-25", departureTime: "10:00",
    arrivalDate: "2026-10-25", arrivalTime: "17:00",
    scheduleMode: "day_before_arrival", bufferMinutes: 60,
  });
  assert.equal(window.startsAt.toISOString(), "2026-10-25T09:00:00.000Z");
  assert.equal(window.dueAt?.toISOString(), "2026-10-25T15:00:00.000Z");
});

test("une marge impossible est signalée pour une arrivée trop proche du départ", () => {
  const window = cleaningWindow({
    departureDate: "2026-10-25", departureTime: "10:00",
    arrivalDate: "2026-10-25", arrivalTime: "10:30",
    scheduleMode: "after_departure", bufferMinutes: 60,
  });
  assert.equal(window.impossibleWindow, true);
});

test("la tâche expose l’arrivée réelle pour sortir les ménages manqués de la liste active", () => {
  const task = serializeCleaningTask({
    id: "cleaning-1", gite_id: "gite-1", departure_reservation_id: "departure-1",
    arrival_reservation_id: "arrival-1", assignee_id: null, status: "planned",
    starts_at: new Date("2026-10-08T09:00:00.000Z"), due_at: new Date("2026-10-08T15:00:00.000Z"),
    completed_at: null, checked_at: null, note: "",
  }, { arrivalAt: parisWallTime("2026-10-08", "18:00") }, true);
  assert.equal(task.arrival_at, "2026-10-08T16:00:00.000Z");
  assert.equal(task.due_at, "2026-10-08T15:00:00.000Z");
});

test("la validation directe crédite le ménage au prestataire choisi sans changer l’attribution", () => {
  const checkedAt = new Date("2026-10-19T11:08:23.000Z");
  const update = cleaningTaskReadinessUpdate({
    completed_at: null, completed_by_id: null, checked_at: null,
  }, true, checkedAt, "checker", "performer");
  assert.deepEqual(update, {
    status: "verified",
    completed_at: checkedAt,
    completed_by_id: "performer",
    checked_at: checkedAt,
    checked_by_id: "checker",
  });
  assert.equal("assignee_id" in update, false);
});

test("annuler une validation directe remet le ménage à faire", () => {
  const checkedAt = new Date("2026-10-19T11:08:23.000Z");
  assert.deepEqual(cleaningTaskReadinessUpdate({
    completed_at: checkedAt, completed_by_id: "performer", checked_at: checkedAt,
  }, false, null, "checker"), {
    status: "planned",
    completed_at: null,
    completed_by_id: null,
    checked_at: null,
    checked_by_id: null,
  });
});

test("annuler un contrôle conserve un ménage déjà terminé", () => {
  const completedAt = new Date("2026-10-19T10:30:00.000Z");
  const checkedAt = new Date("2026-10-19T11:08:23.000Z");
  assert.deepEqual(cleaningTaskReadinessUpdate({
    completed_at: completedAt, completed_by_id: "performer", checked_at: checkedAt,
  }, false, null, "checker"), {
    status: "done",
    checked_at: null,
    checked_by_id: null,
  });
});

test("l’action globale retire seulement les attributions futures encore planifiées", async () => {
  const { default: prisma } = await import("../src/db/prisma.js");
  const { default: router } = await import("../src/modules/operations/cleaningTasks.js");
  const originalFindMany = prisma.gite.findMany;
  const originalTransaction = prisma.$transaction;
  const upserts: any[] = [];
  let taskWhere: any;
  let assignmentWhere: any;
  try {
    prisma.gite.findMany = (async () => [{ id: "gite-a" }, { id: "gite-b" }]) as any;
    prisma.$transaction = (async (callback: any) => callback({
      cleaningRule: { upsert: async (args: any) => { upserts.push(args); return args; } },
      cleaningTask: { updateMany: async ({ where }: any) => { taskWhere = where; return { count: 2 }; } },
      planningRelayAssignment: { deleteMany: async ({ where }: any) => { assignmentWhere = where; return { count: 3 }; } },
    })) as any;
    const layer = (router as any).stack.find((item: any) =>
      item.route?.path === "/rules/unassign-all" && item.route.methods.post);
    const response = {
      statusCode: 200,
      body: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(value: unknown) { this.body = value; return this; },
    };
    let error: unknown;
    await layer.route.stack[0].handle({ headers: {}, body: {} }, response, (reason: unknown) => { error = reason; });

    assert.equal(error, undefined);
    assert.deepEqual(response.body, { rules_updated: 2, tasks_unassigned: 2, planning_assignments_removed: 3 });
    assert.equal(upserts.length, 2);
    assert.ok(upserts.every((entry) => entry.update.assignment_mode === "unassigned" && entry.update.default_assignee_id === null));
    assert.deepEqual(taskWhere.status, "planned");
    assert.deepEqual(taskWhere.assignee_id, { not: null });
    assert.ok(taskWhere.starts_at.gte instanceof Date);
    assert.equal(typeof assignmentWhere.date.gte, "string");
  } finally {
    prisma.gite.findMany = originalFindMany;
    prisma.$transaction = originalTransaction;
  }
});

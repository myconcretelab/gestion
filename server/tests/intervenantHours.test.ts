import assert from "node:assert/strict";
import test from "node:test";
import { isValidWorkDate, MAX_WORK_MINUTES } from "../src/utils/intervenantHours.ts";

test("les heures utilisent une vraie date civile, y compris les années bissextiles", () => {
  assert.equal(isValidWorkDate("2028-02-29"), true);
  for (const invalid of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "2026-10-01T00:00:00Z"]) {
    assert.equal(isValidWorkDate(invalid), false);
  }
  assert.equal(MAX_WORK_MINUTES, 1440);
});

test("saisie des heures : retry unique, annulation durable et correction concurrente", async () => {
  const { default: prisma } = await import("../src/db/prisma.ts");
  const { default: router } = await import("../src/routes/intervenantHours.ts");
  const originalWorkerFind = prisma.planningRelayWorker.findUnique;
  const originalUpsert = prisma.intervenantHourEntry.upsert;
  const originalUpdateMany = prisma.intervenantHourEntry.updateMany;
  const originalFind = prisma.intervenantHourEntry.findUniqueOrThrow;
  const entries = new Map<string, any>();
  let revision = 0;
  const call = async (method: string, body?: unknown, workerId = "christine", entryId?: string) => {
    const routePath = method === "post" ? "/:workerId" : "/:workerId/:entryId";
    const layer = (router as any).stack.find((item: any) => item.route?.path === routePath && item.route.methods[method]);
    const response = {
      statusCode: 200, body: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(value: unknown) { this.body = value; return this; },
      end() { return this; },
    };
    let error: unknown;
    await layer.route.stack[0].handle({ params: { workerId, entryId }, body }, response, (err: unknown) => { error = err; });
    return { ...response, error };
  };
  const payload = { id: "00000000-0000-4000-8000-000000000001", worked_on: "2026-10-01", minutes: 120 };
  try {
    prisma.planningRelayWorker.findUnique = (async ({ where }: any) =>
      where.id === "missing" ? null : { id: where.id, nom: "Christine", is_active: where.id !== "inactive" }) as any;
    prisma.intervenantHourEntry.upsert = (async ({ where, create }: any) => {
      const existing = entries.get(where.id);
      if (existing) return existing;
      const entry = { ...create, deleted_at: null, createdAt: new Date("2026-10-01T12:00:00Z"), updatedAt: new Date("2026-10-01T12:00:00Z") };
      entries.set(where.id, entry);
      return entry;
    }) as any;
    prisma.intervenantHourEntry.updateMany = (async ({ where, data }: any) => {
      const entry = entries.get(where.id);
      if (!entry || entry.intervenant_id !== where.intervenant_id || entry.deleted_at ||
          (where.updatedAt && entry.updatedAt.getTime() !== where.updatedAt.getTime())) return { count: 0 };
      entries.set(entry.id, { ...entry, ...data, updatedAt: new Date(Date.UTC(2026, 9, 1, 13, 0, ++revision)) });
      return { count: 1 };
    }) as any;
    prisma.intervenantHourEntry.findUniqueOrThrow = (async ({ where }: any) => entries.get(where.id)) as any;

    const first = await call("post", payload);
    assert.equal(first.error, undefined);
    assert.equal(first.body.minutes, 120);
    const retry = await call("post", payload);
    assert.equal(retry.body.id, first.body.id);
    assert.equal(entries.size, 1);
    assert.equal((await call("post", payload, "other-worker")).statusCode, 409);
    assert.equal((await call("post", { ...payload, minutes: 60 })).statusCode, 409);
    assert.equal((await call("post", payload, "missing")).statusCode, 404);
    assert.equal((await call("post", payload, "inactive")).statusCode, 409);
    for (const minutes of [0, -1, 1.5, 1441, "120"]) {
      assert.ok((await call("post", { ...payload, minutes })).error);
    }
    assert.ok((await call("post", { ...payload, worked_on: "2026-02-30" })).error);

    const correction = { worked_on: "2026-09-30", minutes: 90, expected_updated_at: first.body.updated_at };
    assert.equal((await call("patch", correction, "other-worker", payload.id)).statusCode, 409);
    const changed = await call("patch", correction, "christine", payload.id);
    assert.equal(changed.error, undefined);
    assert.equal(changed.body.minutes, 90);
    assert.equal(changed.body.worked_on, "2026-09-30");
    assert.equal((await call("patch", correction, "christine", payload.id)).statusCode, 409);

    assert.equal((await call("delete", undefined, "other-worker", payload.id)).statusCode, 204);
    assert.equal(entries.get(payload.id).deleted_at, null);
    assert.equal((await call("delete", undefined, "christine", payload.id)).statusCode, 204);
    assert.ok(entries.get(payload.id).deleted_at);
    assert.equal((await call("delete", undefined, "christine", payload.id)).statusCode, 204);
    assert.equal((await call("post", payload)).statusCode, 409);
    assert.equal((await call("patch", { ...correction, expected_updated_at: changed.body.updated_at }, "christine", payload.id)).statusCode, 409);
  } finally {
    prisma.planningRelayWorker.findUnique = originalWorkerFind;
    prisma.intervenantHourEntry.upsert = originalUpsert;
    prisma.intervenantHourEntry.updateMany = originalUpdateMany;
    prisma.intervenantHourEntry.findUniqueOrThrow = originalFind;
  }
});

test("paiement des heures : remet le solde à zéro sans effacer l'historique", async () => {
  const { default: prisma } = await import("../src/db/prisma.ts");
  const { default: router } = await import("../src/routes/intervenantHours.ts");
  const originalWorkerFind = prisma.planningRelayWorker.findUnique;
  const originalEntriesFind = prisma.intervenantHourEntry.findMany;
  const originalUpdateMany = prisma.intervenantHourEntry.updateMany;
  const originalInterventionsFind = prisma.userIntervention.findMany;
  const originalInterventionsUpdate = prisma.userIntervention.updateMany;
  const entries = [
    { id: "h1", intervenant_id: "christine", minutes: 60, paid_at: null as Date | null, deleted_at: null, hourly_rate_snapshot: null as number | null },
    { id: "h2", intervenant_id: "christine", minutes: 90, paid_at: null as Date | null, deleted_at: null, hourly_rate_snapshot: null as number | null },
  ];
  const layer = (router as any).stack.find((item: any) =>
    item.route?.path === "/:workerId/settle" && item.route.methods.post);
  const call = async () => {
    const response = {
      statusCode: 200, body: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(value: unknown) { this.body = value; return this; },
    };
    let error: unknown;
    await layer.route.stack[0].handle({ params: { workerId: "christine" }, body: {} }, response, (err: unknown) => { error = err; });
    return { ...response, error };
  };
  try {
    prisma.planningRelayWorker.findUnique = (async () => ({ id: "christine", nom: "Christine", hourly_rate: 16 })) as any;
    prisma.intervenantHourEntry.findMany = (async () => entries
      .filter((entry) => !entry.paid_at && !entry.deleted_at)
      .map(({ id, minutes }) => ({ id, minutes }))) as any;
    prisma.intervenantHourEntry.updateMany = (async ({ where, data }: any) => {
      const ids = new Set(where.id.in);
      let count = 0;
      entries.forEach((entry) => {
        if (!ids.has(entry.id) || entry.paid_at) return;
        entry.paid_at = data.paid_at;
        entry.hourly_rate_snapshot = data.hourly_rate_snapshot;
        count++;
      });
      return { count };
    }) as any;
    prisma.userIntervention.findMany = (async () => []) as any;
    prisma.userIntervention.updateMany = (async () => ({ count: 0 })) as any;

    const result = await call();
    assert.equal(result.error, undefined);
    assert.equal(result.body.total_minutes, 150);
    assert.equal(result.body.hourly_rate, 16);
    assert.equal(result.body.amount, 40);
    assert.equal(result.body.entry_count, 2);
    assert.ok(entries.every((entry) => entry.paid_at && entry.hourly_rate_snapshot === 16));
    assert.equal(entries.length, 2);

    const second = await call();
    assert.equal(second.body.total_minutes, 0);
    assert.equal(second.body.entry_count, 0);
  } finally {
    prisma.planningRelayWorker.findUnique = originalWorkerFind;
    prisma.intervenantHourEntry.findMany = originalEntriesFind;
    prisma.intervenantHourEntry.updateMany = originalUpdateMany;
    prisma.userIntervention.findMany = originalInterventionsFind;
    prisma.userIntervention.updateMany = originalInterventionsUpdate;
  }
});

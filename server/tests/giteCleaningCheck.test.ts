import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("contrôle de ménage par occurrence : entrée et sortie restent indépendantes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reservation-check-test-"));
  const previousDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const { default: prisma } = await import("../src/db/prisma.ts");
  const { default: router } = await import("../src/routes/reservations.ts");
  const originalFind = prisma.reservation.findUnique;
  const originalUpdate = prisma.reservation.updateMany;
  let arrivalCheckedAt: Date | null = null;
  let departureCheckedAt: Date | null = null;
  const call = async (method: string, body?: unknown, id = "r1", occurrence = "arrival") => {
    const layer = (router as any).stack.find((item: any) => item.route?.path === "/:id/cleaning-check" && item.route.methods[method]);
    const response = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
    let error: unknown;
    await layer.route.stack[0].handle({ params: { id }, query: { occurrence }, body }, response, (err: unknown) => { error = err; });
    return { ...response, error };
  };
  try {
    prisma.reservation.findUnique = (async ({ where }: any) => where.id === "r1" ? {
      arrival_cleaning_checked_at: arrivalCheckedAt,
      departure_cleaning_checked_at: departureCheckedAt,
      gite: { nom: "Gîte & Jardin" },
    } : null) as any;
    prisma.reservation.updateMany = (async ({ where, data }: any) => {
      const field = Object.hasOwn(where, "arrival_cleaning_checked_at")
        ? "arrival_cleaning_checked_at"
        : "departure_cleaning_checked_at";
      const current = field === "arrival_cleaning_checked_at" ? arrivalCheckedAt : departureCheckedAt;
      if ((where[field] === null) !== (current === null)) return { count: 0 };
      if (field === "arrival_cleaning_checked_at") arrivalCheckedAt = data[field];
      else departureCheckedAt = data[field];
      return { count: 1 };
    }) as any;
    assert.equal((await call("get")).body.cleaning_checked_at, null);
    const results = await Promise.all([call("put", { checked: true }), call("put", { checked: true })]);
    assert.ok(results.every((result) => !result.error && result.body.cleaning_checked_at));
    assert.equal((await call("get", undefined, "r1", "departure")).body.cleaning_checked_at, null);
    const departure = await call("put", { checked: true, occurrence: "departure" }, "r1", "departure");
    assert.ok(departure.body.cleaning_checked_at);
    await call("put", { checked: false });
    assert.equal((await call("get")).body.cleaning_checked_at, null);
    assert.ok((await call("get", undefined, "r1", "departure")).body.cleaning_checked_at);
    assert.ok((await call("put", { checked: true })).body.cleaning_checked_at);
    assert.equal((await call("put", { checked: true }, "missing")).statusCode, 404);
    assert.ok((await call("put", { checked: "yes" })).error);
    assert.ok((await call("get", undefined, "r1", "invalid")).error);
  } finally {
    prisma.reservation.findUnique = originalFind;
    prisma.reservation.updateMany = originalUpdate;
    if (previousDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});

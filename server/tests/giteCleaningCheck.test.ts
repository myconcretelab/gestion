import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

type CleaningRecord = {
  id: string;
  gite_id: string;
  date_entree: Date;
  date_sortie: Date;
  arrival_cleaning_checked_at: Date | null;
  departure_cleaning_checked_at: Date | null;
  gite: { nom: string };
};

test("contrôle de ménage : une rotation partage le même état entre l'entrée et la sortie", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reservation-check-test-"));
  const previousDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const { default: prisma } = await import("../src/db/prisma.ts");
  const { default: router } = await import("../src/routes/reservations.ts");
  const originalFindUnique = prisma.reservation.findUnique;
  const originalFindFirst = prisma.reservation.findFirst;
  const originalUpdateMany = prisma.reservation.updateMany;
  const records = new Map<string, CleaningRecord>([
    ["departure", {
      id: "departure", gite_id: "g1",
      date_entree: new Date("2026-09-28T00:00:00.000Z"),
      date_sortie: new Date("2026-10-02T00:00:00.000Z"),
      arrival_cleaning_checked_at: null, departure_cleaning_checked_at: null,
      gite: { nom: "Gîte & Jardin" },
    }],
    ["arrival", {
      id: "arrival", gite_id: "g1",
      date_entree: new Date("2026-10-02T00:00:00.000Z"),
      date_sortie: new Date("2026-10-05T00:00:00.000Z"),
      arrival_cleaning_checked_at: null, departure_cleaning_checked_at: null,
      gite: { nom: "Gîte & Jardin" },
    }],
    ["solo", {
      id: "solo", gite_id: "g2",
      date_entree: new Date("2026-10-10T00:00:00.000Z"),
      date_sortie: new Date("2026-10-12T00:00:00.000Z"),
      arrival_cleaning_checked_at: null, departure_cleaning_checked_at: null,
      gite: { nom: "Gîte sans rotation" },
    }],
  ]);
  const call = async (method: string, body?: unknown, id = "arrival", occurrence = "arrival") => {
    const layer = (router as any).stack.find((item: any) => item.route?.path === "/:id/cleaning-check" && item.route.methods[method]);
    const response = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
    let error: unknown;
    await layer.route.stack[0].handle({ params: { id }, query: { occurrence }, body }, response, (err: unknown) => { error = err; });
    return { ...response, error };
  };
  try {
    prisma.reservation.findUnique = (async ({ where }: any) => records.get(where.id) ?? null) as any;
    prisma.reservation.findFirst = (async ({ where }: any) => {
      const dateField: "date_entree" | "date_sortie" = where.date_sortie ? "date_sortie" : "date_entree";
      const range = where[dateField];
      return [...records.values()].find((record) =>
        record.id !== where.id.not
        && record.gite_id === where.gite_id
        && record[dateField] >= range.gte
        && record[dateField] < range.lt
      ) ?? null;
    }) as any;
    prisma.reservation.updateMany = (async ({ where, data }: any) => {
      const record = records.get(where.id);
      if (!record) return { count: 0 };
      const field = Object.hasOwn(where, "arrival_cleaning_checked_at")
        ? "arrival_cleaning_checked_at"
        : Object.hasOwn(where, "departure_cleaning_checked_at")
          ? "departure_cleaning_checked_at"
          : null;
      if (field) {
        const current = record[field];
        if (where[field] === null && current !== null) return { count: 0 };
        if (where[field]?.not === null && current === null) return { count: 0 };
      }
      Object.assign(record, data);
      return { count: 1 };
    }) as any;

    const initial = await call("get");
    assert.equal(initial.body.cleaning_checked_at, null);
    assert.equal(initial.body.shared_with_rotation, true);

    const checkedFromArrival = await call("put", { checked: true, occurrence: "arrival" });
    assert.ok(checkedFromArrival.body.cleaning_checked_at);
    assert.equal(
      records.get("arrival")?.arrival_cleaning_checked_at?.toISOString(),
      records.get("departure")?.departure_cleaning_checked_at?.toISOString()
    );
    const viewedFromDeparture = await call("get", undefined, "departure", "departure");
    assert.equal(viewedFromDeparture.body.cleaning_checked_at.toISOString(), checkedFromArrival.body.cleaning_checked_at.toISOString());
    assert.equal(viewedFromDeparture.body.shared_with_rotation, true);

    await call("put", { checked: false, occurrence: "departure" }, "departure", "departure");
    assert.equal(records.get("arrival")?.arrival_cleaning_checked_at, null);
    assert.equal(records.get("departure")?.departure_cleaning_checked_at, null);

    const legacyCheckedAt = new Date("2026-10-02T09:15:00.000Z");
    records.get("arrival")!.arrival_cleaning_checked_at = legacyCheckedAt;
    const legacyState = await call("get", undefined, "departure", "departure");
    assert.equal(legacyState.body.cleaning_checked_at.toISOString(), legacyCheckedAt.toISOString());
    await call("put", { checked: true, occurrence: "departure" }, "departure", "departure");
    assert.equal(records.get("departure")?.departure_cleaning_checked_at?.toISOString(), legacyCheckedAt.toISOString());

    await call("put", { checked: true, occurrence: "arrival" }, "solo", "arrival");
    assert.ok(records.get("solo")?.arrival_cleaning_checked_at);
    assert.equal(records.get("solo")?.departure_cleaning_checked_at, null);

    assert.equal((await call("put", { checked: true, occurrence: "arrival" }, "missing")).statusCode, 404);
    assert.ok((await call("put", { checked: "yes", occurrence: "arrival" })).error);
    assert.ok((await call("get", undefined, "arrival", "invalid")).error);
  } finally {
    prisma.reservation.findUnique = originalFindUnique;
    prisma.reservation.findFirst = originalFindFirst;
    prisma.reservation.updateMany = originalUpdateMany;
    if (previousDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});

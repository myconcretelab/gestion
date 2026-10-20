import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import { updateGiteCleaningReadiness } from "../src/services/giteCleaningReadiness.ts";
import { fullCleaningAmount } from "../src/services/userInterventions.ts";

test("le forfait du gîte s'applique sans dérogation et le tarif intervenant peut le remplacer par gîte", () => {
  assert.equal(fullCleaningAmount(55, {}, "gite-a"), 55);
  assert.equal(fullCleaningAmount(55, '{"gite-a":42,"gite-b":0}', "gite-a"), 42);
  assert.equal(fullCleaningAmount(55, { "gite-a": 42, "gite-b": 0 }, "gite-b"), 0);
  assert.equal(fullCleaningAmount(70, { "gite-a": 42 }, "gite-b"), 70);
});

test("la validation directe comptabilise le contrôle et le ménage optionnel une seule fois, puis annule le ménage automatique", async () => {
  const original = {
    cleaningFind: prisma.cleaningTask.findFirst,
    transaction: prisma.$transaction,
    reservationUpdate: prisma.reservation.update,
    reservationFindUnique: prisma.reservation.findUnique,
    userFindUnique: prisma.appUser.findUnique,
    interventionUpsert: prisma.userIntervention.upsert,
    interventionDeleteMany: prisma.userIntervention.deleteMany,
  };
  const upserts: any[] = [];
  const deletions: any[] = [];
  const checkedAt = new Date("2026-10-15T12:00:00.000Z");
  const readiness = {
    gite_id: "gite-a", gite_name: "Tante Phonsine", gite_prefix: "TP", gite_order: 1,
    departure_reservation_id: "departure-a", departure_date: "2026-10-15",
    next_arrival_reservation_id: null, next_arrival_date: null,
    departure_has_cleaning_option: true, checked_at: null,
    checked_by_user_id: null, checked_by_name: null,
  };
  try {
    prisma.cleaningTask.findFirst = (async () => null) as any;
    prisma.$transaction = (async (queries: Promise<unknown>[]) => Promise.all(queries)) as any;
    prisma.reservation.update = (async () => ({})) as any;
    prisma.reservation.findUnique = (async () => ({
      id: "departure-a", gite_id: "gite-a", gite: { nom: "Tante Phonsine", options_menage_forfait: 55 },
    })) as any;
    prisma.appUser.findUnique = (async () => ({
      id: "worker-a", display_name: "Soazig", intervenant_id: "relay-worker-a",
      cleaning_check_rate: 15, full_cleaning_rates: { "gite-a": 42 },
    })) as any;
    prisma.userIntervention.upsert = (async (args: any) => { upserts.push(args); return args.create; }) as any;
    prisma.userIntervention.deleteMany = (async (args: any) => { deletions.push(args); return { count: 1 }; }) as any;

    await updateGiteCleaningReadiness(readiness, true, "worker-a", checkedAt, "worker-a");
    assert.deepEqual(upserts.map((args) => args.create.kind), ["cleaning_check", "full_cleaning"]);
    assert.equal(upserts[1].create.amount_snapshot, 42);
    assert.equal(upserts[1].create.automatic, true);
    assert.equal(upserts[1].create.source_key, "full-cleaning:departure-a");

    upserts.length = 0;
    await updateGiteCleaningReadiness({ ...readiness, departure_has_cleaning_option: false }, true, "worker-a", checkedAt, "worker-a");
    assert.deepEqual(upserts.map((args) => args.create.kind), ["cleaning_check"]);

    await updateGiteCleaningReadiness({ ...readiness, checked_at: checkedAt }, false, "worker-a", checkedAt);
    assert.equal(deletions[1].where.source_key, "full-cleaning:departure-a");
    assert.equal(deletions[1].where.automatic, true);
    assert.equal(deletions[1].where.paid_at, null);
  } finally {
    prisma.cleaningTask.findFirst = original.cleaningFind;
    prisma.$transaction = original.transaction;
    prisma.reservation.update = original.reservationUpdate;
    prisma.reservation.findUnique = original.reservationFindUnique;
    prisma.appUser.findUnique = original.userFindUnique;
    prisma.userIntervention.upsert = original.interventionUpsert;
    prisma.userIntervention.deleteMany = original.interventionDeleteMany;
  }
});

test("une correction administrateur met à jour l’intervention et journalise l’avant/après", async () => {
  const { default: router } = await import("../src/routes/userInterventions.ts");
  const original = {
    transaction: prisma.$transaction,
    interventionFind: prisma.userIntervention.findUnique,
    userFind: prisma.appUser.findUnique,
    giteFind: prisma.gite.findUnique,
  };
  const current = {
    id: "intervention-a",
    user_id: "user-a",
    user_name: "Ancien nom",
    kind: "cleaning_check",
    occurred_on: "2026-10-18",
    gite_id: "gite-a",
    gite_name: "Ancien gîte",
    reservation_id: "reservation-a",
    amount_snapshot: 15,
    automatic: true,
    paid_at: new Date("2026-10-19T10:00:00.000Z"),
    createdAt: new Date("2026-10-18T10:00:00.000Z"),
    updatedAt: new Date("2026-10-18T11:00:00.000Z"),
  };
  const updated = {
    ...current,
    user_id: "user-b",
    user_name: "Nouveau nom",
    kind: "full_cleaning",
    occurred_on: "2026-10-19",
    gite_id: "gite-b",
    gite_name: "Nouveau gîte",
    amount_snapshot: 42,
    paid_at: null,
    updatedAt: new Date("2026-10-19T12:00:00.000Z"),
  };
  let auditData: any;
  try {
    prisma.userIntervention.findUnique = (async () => current) as any;
    prisma.appUser.findUnique = (async () => ({
      id: "user-b", display_name: "Nouveau nom", roles: JSON.stringify(["worker"]),
    })) as any;
    prisma.gite.findUnique = (async () => ({ id: "gite-b", nom: "Nouveau gîte" })) as any;
    prisma.$transaction = (async (callback: any) => callback({
      userIntervention: {
        updateMany: async ({ where, data }: any) => {
          assert.equal(where.id, current.id);
          assert.equal(where.updatedAt.toISOString(), current.updatedAt.toISOString());
          assert.equal(data.amount_snapshot, 42);
          assert.equal(data.paid_at, null);
          return { count: 1 };
        },
        findUniqueOrThrow: async () => updated,
      },
      auditLog: { create: async ({ data }: any) => { auditData = data; return data; } },
    })) as any;

    const layer = (router as any).stack.find((item: any) => item.route?.path === "/:id" && item.route.methods.patch);
    const response = {
      statusCode: 200,
      body: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(value: unknown) { this.body = value; return this; },
      getHeader() { return "request-a"; },
    };
    let error: unknown;
    await layer.route.stack[0].handle({
      params: { id: current.id },
      headers: {},
      body: {
        userId: "user-b",
        kind: "full_cleaning",
        giteId: "gite-b",
        occurredOn: "2026-10-19",
        amount: 42,
        paid: false,
        reason: "Mauvaise attribution",
        expectedUpdatedAt: current.updatedAt.toISOString(),
      },
    }, response, (reason: unknown) => { error = reason; });

    assert.equal(error, undefined);
    assert.equal(response.body.user_name, "Nouveau nom");
    assert.equal(response.body.amount, 42);
    assert.equal(auditData.action, "user_intervention.corrected");
    const metadata = JSON.parse(auditData.metadata_json);
    assert.equal(metadata.reason, "Mauvaise attribution");
    assert.equal(metadata.before.amount, 15);
    assert.equal(metadata.after.amount, 42);
    assert.equal(metadata.after.paid_at, null);
    assert.equal(metadata.paid_at, "2026-10-19T10:00:00.000Z");
  } finally {
    prisma.$transaction = original.transaction;
    prisma.userIntervention.findUnique = original.interventionFind;
    prisma.appUser.findUnique = original.userFind;
    prisma.gite.findUnique = original.giteFind;
  }
});

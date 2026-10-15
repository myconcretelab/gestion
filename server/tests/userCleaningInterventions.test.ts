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
    prisma.$transaction = original.transaction;
    prisma.reservation.update = original.reservationUpdate;
    prisma.reservation.findUnique = original.reservationFindUnique;
    prisma.appUser.findUnique = original.userFindUnique;
    prisma.userIntervention.upsert = original.interventionUpsert;
    prisma.userIntervention.deleteMany = original.interventionDeleteMany;
  }
});

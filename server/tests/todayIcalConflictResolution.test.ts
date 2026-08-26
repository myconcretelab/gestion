import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { env } from "../src/config/env.ts";
import prisma from "../src/db/prisma.ts";
import { writeIcalConflictRecords } from "../src/services/icalConflicts.ts";

const conflictsPath = path.join(env.DATA_DIR, "ical-conflicts.json");

const getRouteHandler = async () => {
  const { default: router } = await import("../src/routes/today.ts");
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === "/ical-conflicts/:id/resolve" && item.route?.methods?.post,
  );
  assert.ok(layer, "Route de résolution iCal introuvable");
  return layer.route.stack[0].handle as (req: any, res: any, next: (error?: unknown) => void) => Promise<void>;
};

test("Appliquer iCal fusionne le doublon Pump portant le même code Airbnb", async () => {
  const conflictsBackup = fs.existsSync(conflictsPath) ? fs.readFileSync(conflictsPath, "utf-8") : null;
  const prismaAny = prisma as any;
  const originalFindUnique = prismaAny.reservation.findUnique;
  const originalFindMany = prismaAny.reservation.findMany;
  const originalTransaction = prismaAny.$transaction;
  let deletedIds: string[] = [];
  let updatedReservation: any = null;

  try {
    writeIcalConflictRecords([
      {
        id: "conflict-moved-airbnb",
        type: "modified",
        status: "open",
        fingerprint: "fingerprint-moved-airbnb",
        reservation_id: "reservation-originale",
        gite_id: "gite-1",
        detected_at: "2026-08-26T08:00:00.000Z",
        updated_at: "2026-08-26T08:00:00.000Z",
        resolved_at: null,
        resolution_action: null,
        reservation_snapshot: {
          reservation_id: "reservation-originale",
          gite_id: "gite-1",
          gite_nom: "Gîte test",
          hote_nom: "Romain Marques",
          date_entree: "2026-09-23",
          date_sortie: "2026-09-28",
          source_paiement: "Airbnb",
          airbnb_url: "https://www.airbnb.com/hosting/reservations/details/HMNN9C5P4S",
          commentaire: null,
          origin_system: "ical",
          origin_reference: "1418fb94e984-97f97758aeeelfe700732c1a304f9341@airbnb.com",
        },
        incoming_snapshot: {
          reservation_id: "ical-event",
          gite_id: "gite-1",
          gite_nom: "Gîte test",
          hote_nom: "Reserved",
          date_entree: "2026-09-16",
          date_sortie: "2026-09-21",
          source_paiement: "Airbnb",
          final_source: "Airbnb",
          airbnb_url: "https://www.airbnb.com/hosting/reservations/details/HMNN9C5P4S",
          commentaire: null,
          origin_system: "ical",
          origin_reference: "1418fb94e984-97f97758aeeelfe700732c1a304f9341@airbnb.com",
        },
      },
    ]);

    prismaAny.reservation.findUnique = async () => ({
      id: "reservation-originale",
      gite_id: "gite-1",
      placeholder_id: null,
      stay_group_id: null,
      origin_system: "ical",
      origin_reference: "1418fb94e984-97f97758aeeelfe700732c1a304f9341@airbnb.com",
      export_to_ical: false,
      airbnb_url: "https://www.airbnb.com/hosting/reservations/details/HMNN9C5P4S",
      hote_nom: "Romain Marques",
      telephone: null,
      email: null,
      date_entree: new Date("2026-09-23T00:00:00.000Z"),
      date_sortie: new Date("2026-09-28T00:00:00.000Z"),
      nb_nuits: 5,
      nb_adultes: 2,
      prix_par_nuit: 63.37,
      prix_total: 316.85,
      source_paiement: "Airbnb",
      commentaire: null,
    });
    prismaAny.reservation.findMany = async () => [
      {
        id: "reservation-pump-dupliquee",
        gite_id: "gite-1",
        stay_group_id: null,
        origin_system: "pump",
        origin_reference: "48504640|HMNN9C5P4S|2026-09-16|2026-09-21",
        airbnb_url: null,
        hote_nom: "Romain Marques",
        telephone: null,
        email: null,
        date_entree: new Date("2026-09-16T00:00:00.000Z"),
        date_sortie: new Date("2026-09-21T00:00:00.000Z"),
        prix_par_nuit: 63.37,
        prix_total: 316.85,
        source_paiement: "Airbnb",
        commentaire: null,
      },
    ];
    prismaAny.$transaction = async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        contrat: { updateMany: async () => ({ count: 0 }) },
        facture: { updateMany: async () => ({ count: 0 }) },
        bookingRequest: { updateMany: async () => ({ count: 0 }) },
        reservation: {
          updateMany: async () => ({ count: 0 }),
          deleteMany: async ({ where }: any) => {
            deletedIds = where.id.in;
            return { count: deletedIds.length };
          },
          update: async (args: any) => {
            updatedReservation = args;
            return args.data;
          },
        },
      });

    const handler = await getRouteHandler();
    const response = {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    let nextError: unknown = null;

    await handler(
      { params: { id: "conflict-moved-airbnb" }, body: { action: "apply_ical" } },
      response,
      (error) => {
        nextError = error ?? null;
      },
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(deletedIds, ["reservation-pump-dupliquee"]);
    assert.equal(updatedReservation.where.id, "reservation-originale");
    assert.equal(updatedReservation.data.hote_nom, "Romain Marques");
    assert.equal(updatedReservation.data.date_entree.toISOString(), "2026-09-16T00:00:00.000Z");
    assert.deepEqual(response.body.merged_reservation_ids, ["reservation-pump-dupliquee"]);
  } finally {
    prismaAny.reservation.findUnique = originalFindUnique;
    prismaAny.reservation.findMany = originalFindMany;
    prismaAny.$transaction = originalTransaction;
    if (conflictsBackup === null) {
      try {
        fs.unlinkSync(conflictsPath);
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
    } else {
      fs.writeFileSync(conflictsPath, conflictsBackup, "utf-8");
    }
  }
});


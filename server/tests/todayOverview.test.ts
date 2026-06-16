import assert from "node:assert/strict";
import test from "node:test";
import { createOverviewHandler } from "../src/routes/todayOverview.shared.ts";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

test("GET /today/overview inclut les départs du jour", async () => {
  let overviewToday: Date | null = null;
  let overviewEndExclusive: Date | null = null;
  let unassignedToday: Date | null = null;
  let unassignedEndExclusive: Date | null = null;
  let newReservationsStart: Date | null = null;
  let newReservationsEnd: Date | null = null;

  const get = createOverviewHandler({
    loadGites: async () => [{ id: "g1", nom: "Mauron", prefixe_contrat: "MA", ordre: 1 }],
    loadReservations: async (today, endExclusive) => {
      overviewToday = today;
      overviewEndExclusive = endExclusive;
      return [
        {
          id: "reservation-depart-today",
          energy_tracking: null,
          gite_id: "g1",
          hote_nom: "Phonsine",
          date_entree: new Date("2026-03-26T00:00:00.000Z"),
          date_sortie: new Date("2026-03-29T00:00:00.000Z"),
          source_paiement: "Airbnb",
          commentaire: null,
          telephone: null,
          airbnb_url: null,
          gite: { id: "g1", nom: "Mauron", prefixe_contrat: "MA", ordre: 1, electricity_price_per_kwh: 0.27 },
        },
      ];
    },
    countUnassignedReservations: async (today, endExclusive) => {
      unassignedToday = today;
      unassignedEndExclusive = endExclusive;
      return 0;
    },
    loadRecentAppActivity: async () => [],
    listOpenIcalConflicts: () => [],
    loadConflictReservations: async () => [],
    buildNewReservations: async (windowStart, windowEnd) => {
      newReservationsStart = windowStart;
      newReservationsEnd = windowEnd;
      return [
        {
          id: "reservation-new",
          gite_id: "g1",
          hote_nom: "Camille Martin",
          date_entree: "2026-04-03",
          date_sortie: "2026-04-06",
          nb_nuits: 3,
          prix_total: 540,
          source_paiement: "Airbnb",
          created_at: "2026-04-02T09:30:00.000Z",
          gite_nom: "Mauron",
        },
      ];
    },
    loadLiveEnergyByReservationId: async () => ({}),
    readTraceabilityLog: () => [],
    readSourceColors: () => ({ Airbnb: "#FF1920" }),
  });

  const response = createMockResponse();
  let nextError: unknown = null;

  await get(
    {
      query: { days: "14" },
      params: {},
    } as any,
    response as any,
    (err) => {
      nextError = err ?? null;
    }
  );

  assert.equal(nextError, null);
  assert.equal(response.statusCode, 200);
  assert.ok(overviewToday);
  assert.ok(overviewEndExclusive);
  assert.ok(unassignedToday);
  assert.ok(unassignedEndExclusive);
  assert.ok(newReservationsStart);
  assert.ok(newReservationsEnd);
  assert.equal(overviewToday.toISOString().slice(0, 10), unassignedToday.toISOString().slice(0, 10));
  assert.equal(overviewEndExclusive.toISOString(), unassignedEndExclusive.toISOString());
  assert.equal(newReservationsStart.toISOString().slice(0, 10), overviewToday.toISOString().slice(0, 10));
  assert.ok(newReservationsEnd.getTime() >= newReservationsStart.getTime());

  const body = response.body as any;
  assert.equal(body.notification_days, 1);
  assert.equal(body.reservations.length, 1);
  assert.equal(body.reservations[0].hote_nom, "Phonsine");
  assert.equal(new Date(body.reservations[0].date_sortie).toISOString().slice(0, 10), "2026-03-29");
  assert.ok(!("managers" in body));
  assert.ok(!("statuses" in body));
  assert.equal(body.new_reservations.length, 1);
  assert.equal(body.new_reservations[0].hote_nom, "Camille Martin");
  assert.equal(body.new_reservations[0].nb_nuits, 3);
});

test("GET /today/overview garde les conflits iCal ouverts hors fenêtre de notification", async () => {
  let loadedConflictReservationIds: string[] = [];

  const get = createOverviewHandler({
    loadGites: async () => [],
    loadReservations: async () => [],
    countUnassignedReservations: async () => 0,
    loadRecentAppActivity: async () => [],
    listOpenIcalConflicts: () => [
      {
        id: "conflict-old-open",
        type: "deleted",
        status: "open",
        reservation_id: "reservation-old-conflict",
        detected_at: "2020-01-01T08:00:00.000Z",
        reservation_snapshot: {
          reservation_id: "reservation-old-conflict",
          gite_id: "g1",
          gite_nom: "Mauron",
          hote_nom: "Client iCal",
          date_entree: "2026-04-03",
          date_sortie: "2026-04-06",
          source_paiement: "Airbnb",
          airbnb_url: null,
          commentaire: null,
          origin_system: "ical",
          origin_reference: "event-old",
        },
        incoming_snapshot: null,
      },
    ],
    loadConflictReservations: async (reservationIds) => {
      loadedConflictReservationIds = reservationIds;
      return [{ id: "reservation-old-conflict", hote_nom: "Client iCal" }];
    },
    buildNewReservations: async () => [],
    loadLiveEnergyByReservationId: async () => ({}),
    readTraceabilityLog: () => [],
    readSourceColors: () => ({}),
  });

  const response = createMockResponse();
  let nextError: unknown = null;

  await get(
    {
      query: { notification_days: "1" },
      params: {},
    } as any,
    response as any,
    (err) => {
      nextError = err ?? null;
    }
  );

  assert.equal(nextError, null);
  assert.deepEqual(loadedConflictReservationIds, ["reservation-old-conflict"]);

  const body = response.body as any;
  assert.equal(body.notification_days, 1);
  assert.equal(body.ical_conflicts.length, 1);
  assert.equal(body.ical_conflicts[0].id, "conflict-old-open");
  assert.equal(body.ical_conflicts[0].reservation?.hote_nom, "Client iCal");
});

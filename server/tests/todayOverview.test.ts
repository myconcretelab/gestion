import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.ts";

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

const getRouteHandler = (router: any, method: "get", routePath: string) => {
  const layer = router.stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
  );
  assert.ok(layer, `Route introuvable: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
};

test("GET /today/overview inclut les départs du jour", async () => {
  const originals = {
    giteFindMany: prisma.gite.findMany,
    reservationFindMany: prisma.reservation.findMany,
    reservationCount: prisma.reservation.count,
  };

  let overviewReservationsWhere: any = null;
  let unassignedWhere: any = null;
  let newReservationsWhere: any = null;

  try {
    prisma.gite.findMany = async () => [{ id: "g1", nom: "Mauron", prefixe_contrat: "MA", ordre: 1 }];
    prisma.reservation.findMany = async ({ where }: any) => {
      if (where?.date_entree && where?.date_sortie) {
        overviewReservationsWhere = where;
      }

      if (where?.createdAt) {
        newReservationsWhere = where;
        return [
          {
            id: "reservation-new",
            gite_id: "g1",
            hote_nom: "Camille Martin",
            date_entree: new Date("2026-04-03T00:00:00.000Z"),
            date_sortie: new Date("2026-04-06T00:00:00.000Z"),
            nb_nuits: 3,
            prix_total: 540,
            source_paiement: "Airbnb",
            createdAt: new Date("2026-04-02T09:30:00.000Z"),
            gite: { nom: "Mauron", ordre: 1 },
          },
        ];
      }

      if (where?.OR) {
        return [];
      }

      return [
        {
          id: "reservation-depart-today",
          gite_id: "g1",
          hote_nom: "Phonsine",
          date_entree: new Date("2026-03-26T00:00:00.000Z"),
          date_sortie: new Date("2026-03-29T00:00:00.000Z"),
          source_paiement: "Airbnb",
          commentaire: null,
          telephone: null,
          airbnb_url: null,
          gite: { id: "g1", nom: "Mauron", prefixe_contrat: "MA", ordre: 1 },
        },
      ];
    };
    prisma.reservation.count = async ({ where }: any) => {
      unassignedWhere = where;
      return 0;
    };

    const todayRouterModule = await import("../src/routes/today.ts");
    const get = getRouteHandler(todayRouterModule.default, "get", "/overview");
    const response = createMockResponse();
    let nextError: unknown = null;

    await get(
      {
        query: { days: "14" },
        params: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.ok(overviewReservationsWhere);
    assert.ok(unassignedWhere);
    assert.ok(newReservationsWhere);
    assert.ok("gte" in overviewReservationsWhere.date_sortie);
    assert.ok(!("gt" in overviewReservationsWhere.date_sortie));
    assert.ok("gte" in unassignedWhere.date_sortie);
    assert.ok(!("gt" in unassignedWhere.date_sortie));
    assert.ok("gte" in newReservationsWhere.createdAt);
    assert.ok("lt" in newReservationsWhere.createdAt);

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
  } finally {
    prisma.gite.findMany = originals.giteFindMany;
    prisma.reservation.findMany = originals.reservationFindMany;
    prisma.reservation.count = originals.reservationCount;
  }
});

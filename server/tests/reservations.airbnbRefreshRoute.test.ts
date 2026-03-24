import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import {
  setAirbnbCalendarRefreshExecutorForTests,
} from "../src/services/airbnbCalendarRefresh.ts";

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

const getRouteHandler = (router: any, method: "post", routePath: string) => {
  const layer = router.stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
  );
  assert.ok(layer, `Route introuvable: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
};

const createReservationPayload = () => ({
  gite_id: "gite-1",
  hote_nom: "Client Test",
  telephone: "0600000000",
  date_entree: "2026-03-21",
  date_sortie: "2026-03-24",
  nb_adultes: 2,
  prix_par_nuit: 100,
  price_driver: "nightly" as const,
  source_paiement: "Airbnb",
  commentaire: "note",
});

test("POST /reservations retourne skipped si le gite n'a pas d'ID Airbnb", async () => {
  const originals = {
    giteFindUnique: prisma.gite.findUnique,
    reservationFindMany: prisma.reservation.findMany,
    reservationCreate: prisma.reservation.create,
    transaction: prisma.$transaction,
  };
  let giteLookupCount = 0;

  setAirbnbCalendarRefreshExecutorForTests(async () => undefined);

  try {
    prisma.gite.findUnique = async () => {
      giteLookupCount += 1;
      if (giteLookupCount === 1) return { id: "gite-1" };
      return { id: "gite-1", airbnb_listing_id: null };
    };
    prisma.reservation.findMany = async () => [];
    prisma.reservation.create = async ({ data }: any) => ({
      id: "reservation-1",
      ...data,
      gite: { id: "gite-1", nom: "Gite test", prefixe_contrat: "GT", ordre: 0 },
      placeholder: null,
    });
    prisma.$transaction = async (operations: Promise<unknown>[]) => Promise.all(operations);

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const post = getRouteHandler(reservationsRouterModule.default, "post", "/");
    const response = createMockResponse();
    let nextError: unknown = null;

    await post(
      {
        body: createReservationPayload(),
        params: {},
        query: {},
        headers: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 201);
    assert.equal((response.body as any).airbnb_calendar_refresh.status, "skipped");
  } finally {
    prisma.gite.findUnique = originals.giteFindUnique;
    prisma.reservation.findMany = originals.reservationFindMany;
    prisma.reservation.create = originals.reservationCreate;
    prisma.$transaction = originals.transaction;
    setAirbnbCalendarRefreshExecutorForTests(null);
  }
});

test("POST /reservations retourne queued meme sans token iCal si l'execution echoue ensuite", async () => {
  const originals = {
    giteFindUnique: prisma.gite.findUnique,
    reservationFindMany: prisma.reservation.findMany,
    reservationCreate: prisma.reservation.create,
    transaction: prisma.$transaction,
  };
  let giteLookupCount = 0;

  setAirbnbCalendarRefreshExecutorForTests(async () => {
    throw new Error("background failure");
  });

  try {
    prisma.gite.findUnique = async () => {
      giteLookupCount += 1;
      if (giteLookupCount === 1) return { id: "gite-1" };
      return { id: "gite-1", airbnb_listing_id: "48504640" };
    };
    prisma.reservation.findMany = async () => [];
    prisma.reservation.create = async ({ data }: any) => ({
      id: "reservation-1",
      ...data,
      gite: { id: "gite-1", nom: "Gite test", prefixe_contrat: "GT", ordre: 0 },
      placeholder: null,
    });
    prisma.$transaction = async (operations: Promise<unknown>[]) => Promise.all(operations);

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const post = getRouteHandler(reservationsRouterModule.default, "post", "/");
    const response = createMockResponse();
    let nextError: unknown = null;

    await post(
      {
        body: createReservationPayload(),
        params: {},
        query: {},
        headers: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 201);
    assert.equal((response.body as any).airbnb_calendar_refresh.status, "queued");
    assert.ok(typeof (response.body as any).airbnb_calendar_refresh.job_id === "string");
  } finally {
    prisma.gite.findUnique = originals.giteFindUnique;
    prisma.reservation.findMany = originals.reservationFindMany;
    prisma.reservation.create = originals.reservationCreate;
    prisma.$transaction = originals.transaction;
    setAirbnbCalendarRefreshExecutorForTests(null);
  }
});

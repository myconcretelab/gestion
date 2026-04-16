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

const getRouteHandler = (router: any, method: "get" | "post", routePath: string) => {
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

test("GET /reservations/:id retourne la reservation hydratee", async () => {
  const originalFindUnique = prisma.reservation.findUnique;

  try {
    prisma.reservation.findUnique = async () => ({
      id: "reservation-1",
      gite_id: "gite-1",
      placeholder_id: null,
      hote_nom: "Client Test",
      telephone: "0600000000",
      email: null,
      date_entree: new Date("2026-03-21T00:00:00.000Z"),
      date_sortie: new Date("2026-03-24T00:00:00.000Z"),
      nb_nuits: 3,
      nb_adultes: 2,
      prix_par_nuit: 100,
      prix_total: 300,
      source_paiement: "Airbnb",
      commentaire: "note",
      remise_montant: 0,
      commission_channel_mode: "euro",
      commission_channel_value: 0,
      frais_optionnels_montant: 0,
      frais_optionnels_libelle: null,
      frais_optionnels_declares: false,
      options: null,
      airbnb_url: null,
      origin_system: "app",
      origin_reference: null,
      export_to_ical: true,
      createdAt: new Date("2026-03-20T00:00:00.000Z"),
      updatedAt: new Date("2026-03-20T00:00:00.000Z"),
      gite: { id: "gite-1", nom: "Gite test", prefixe_contrat: "GT", ordre: 0 },
      placeholder: null,
    });

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const get = getRouteHandler(reservationsRouterModule.default, "get", "/:id");
    const response = createMockResponse();
    let nextError: unknown = null;

    await get(
      {
        body: {},
        params: { id: "reservation-1" },
        query: {},
        headers: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as any).id, "reservation-1");
    assert.equal((response.body as any).gite?.id, "gite-1");
    assert.equal((response.body as any).date_entree.toISOString(), "2026-03-21T00:00:00.000Z");
  } finally {
    prisma.reservation.findUnique = originalFindUnique;
  }
});

test("GET /reservations charge le tarif elec du gite pour le calcul live", async () => {
  const originalFindMany = prisma.reservation.findMany;
  let capturedArgs: any = null;

  try {
    prisma.reservation.findMany = async (args?: any) => {
      capturedArgs = args ?? null;
      return [];
    };

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const get = getRouteHandler(reservationsRouterModule.default, "get", "/");
    const response = createMockResponse();
    let nextError: unknown = null;

    await get(
      {
        body: {},
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
    assert.equal(response.statusCode, 200);
    assert.equal(capturedArgs?.include?.gite?.select?.electricity_price_per_kwh, true);
  } finally {
    prisma.reservation.findMany = originalFindMany;
  }
});

test("GET /reservations/calendar charge un payload primaire filtre par chevauchement annuel", async () => {
  const originals = {
    giteFindMany: prisma.gite.findMany,
    reservationFindMany: prisma.reservation.findMany,
    contratFindMany: prisma.contrat.findMany,
  };
  let capturedReservationArgs: any = null;

  try {
    prisma.gite.findMany = async () => [
      { id: "gite-1", nom: "Gite test", prefixe_contrat: "GT", ordre: 1 },
    ];
    prisma.reservation.findMany = async (args?: any) => {
      capturedReservationArgs = args ?? null;
      return [
        {
          id: "reservation-1",
          gite_id: "gite-1",
          hote_nom: "Client Test",
          date_entree: new Date("2025-12-29T00:00:00.000Z"),
          date_sortie: new Date("2026-01-03T00:00:00.000Z"),
          nb_nuits: 5,
          nb_adultes: 2,
          prix_total: 500,
          source_paiement: "Airbnb",
        },
      ];
    };
    prisma.contrat.findMany = async () => [
      { reservation_id: "reservation-1" },
    ];

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const get = getRouteHandler(reservationsRouterModule.default, "get", "/calendar");
    const response = createMockResponse();
    let nextError: unknown = null;

    await get(
      {
        body: {},
        params: {},
        query: { year: "2026" },
        headers: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.equal(capturedReservationArgs?.where?.date_entree?.lt?.toISOString(), "2027-01-01T00:00:00.000Z");
    assert.equal(capturedReservationArgs?.where?.date_sortie?.gt?.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal((response.body as any).gites[0].id, "gite-1");
    assert.equal((response.body as any).reservations[0].has_linked_contract, true);
    assert.equal(typeof (response.body as any).source_colors, "object");
  } finally {
    prisma.gite.findMany = originals.giteFindMany;
    prisma.reservation.findMany = originals.reservationFindMany;
    prisma.contrat.findMany = originals.contratFindMany;
  }
});

test("GET /reservations/placeholders est declare avant /reservations/:id", async () => {
  const reservationsRouterModule = await import("../src/routes/reservations.ts");
  const getRoutePaths = reservationsRouterModule.default.stack
    .filter((item: any) => item.route?.methods?.get)
    .map((item: any) => item.route.path);

  const placeholdersIndex = getRoutePaths.indexOf("/placeholders");
  const byIdIndex = getRoutePaths.indexOf("/:id");

  assert.notEqual(placeholdersIndex, -1, "Route GET /placeholders introuvable");
  assert.notEqual(byIdIndex, -1, "Route GET /:id introuvable");
  assert.ok(placeholdersIndex < byIdIndex, "GET /placeholders doit etre declare avant GET /:id");
});

test("GET /reservations/:id retourne 404 si la reservation est absente", async () => {
  const originalFindUnique = prisma.reservation.findUnique;

  try {
    prisma.reservation.findUnique = async () => null;

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const get = getRouteHandler(reservationsRouterModule.default, "get", "/:id");
    const response = createMockResponse();
    let nextError: unknown = null;

    await get(
      {
        body: {},
        params: { id: "reservation-missing" },
        query: {},
        headers: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 404);
    assert.equal((response.body as any).error, "Réservation introuvable");
  } finally {
    prisma.reservation.findUnique = originalFindUnique;
  }
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
